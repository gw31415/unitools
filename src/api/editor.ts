import { sValidator } from "@hono/standard-validator";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context, MiddlewareHandler } from "hono";
import { yRoute } from "y-durableobjects";
import z from "zod";
import * as schema from "@/db/schema";
import { b64urlToStruct, structToBase64Url } from "@/lib/base64";
import { createApp, type Env } from "@/lib/hono";
import { type ULID, ulid } from "@/lib/ulid";
import type { Editor, EditorInsert } from "@/models";
import { ulidSchema } from "@/validators";
import { requireUser, useUser } from "./auth";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const R2_BULK_DELETE_LIMIT = 1000;

const cursorPayloadSchema = z.object({
  id: ulidSchema,
  createdAt: z.number().int().nonnegative(),
});

const toTimestamp = (value: unknown) =>
  value instanceof Date ? value.getTime() : Number(value);

const requireDocExists: MiddlewareHandler<Env> = async (c, next) => {
  const id = c.req.param("id");
  if (!id) {
    return c.notFound();
  }

  const db = drizzle(c.env.DB);
  const doc = await db
    .select({ id: schema.editors.id })
    .from(schema.editors)
    .where(eq(schema.editors.id, id as ULID))
    .limit(1);

  if (doc.length === 0) {
    return c.notFound();
  }

  await next();
};

const wsRoute = createApp()
  .use("/:id", requireDocExists)
  .route(
    "/",
    yRoute<Env>(
      (env) => env.UNITOOLS_EDITORS as unknown as DurableObjectNamespace,
    ),
  );

function getDurableObjectOfDoc<T extends Env>(c: Context<T>, id: string) {
  const room = c.env.UNITOOLS_EDITORS.idFromName(id);
  return c.env.UNITOOLS_EDITORS.get(room);
}

const editor = createApp()
  .get(
    "/",
    useUser,
    sValidator(
      "query",
      z.object({
        limit: z.coerce.number().int().nonnegative().optional(),
        cursor: z
          .base64url()
          .optional()
          .transform((s, ctx) => {
            if (!s) {
              return undefined;
            }
            try {
              return b64urlToStruct(s, cursorPayloadSchema);
            } catch {
              ctx.addIssue({
                code: "custom",
                message: "Invalid cursor payload",
              });
              return z.NEVER;
            }
          }),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json({
          items: [],
          pageInfo: {
            hasMore: false,
            nextCursor: null,
          },
        });
      }

      const query = c.req.valid("query");
      const limit = Math.min(
        Math.max(1, query.limit ?? DEFAULT_PAGE_SIZE),
        MAX_PAGE_SIZE,
      );
      const take = limit + 1;

      const db = drizzle(c.env.DB, { schema });
      const rows: Editor[] = await db.query.editors.findMany({
        where: (editors) => {
          if (!query.cursor) {
            return undefined;
          }
          const cursorCreatedAt = new Date(query.cursor.createdAt);
          const cursorId = query.cursor.id as ULID;
          return or(
            lt(editors.createdAt, cursorCreatedAt),
            and(
              eq(editors.createdAt, cursorCreatedAt),
              lt(editors.id, cursorId),
            ),
          );
        },
        orderBy: (editors) => [desc(editors.createdAt), desc(editors.id)],
        limit: take,
      });

      const hasMore = rows.length > limit;
      const pageItems = hasMore ? rows.slice(0, limit) : rows;
      const items = pageItems.map((editor) => ({
        id: editor.id,
        createdAt: toTimestamp(editor.createdAt),
      }));

      const last = items.at(-1);
      const nextCursor =
        hasMore && last
          ? structToBase64Url({ id: last.id, createdAt: last.createdAt })
          : null;

      return c.json({
        items,
        pageInfo: {
          hasMore,
          nextCursor,
        },
      });
    },
  )
  .post("/", requireUser, async (c) => {
    const id = ulid();
    const db = drizzle(c.env.DB, { schema });
    const [res] = await db
      .insert(schema.editors)
      .values({ id } satisfies EditorInsert)
      .returning();
    // ダメおしでDOインスタンスを初期化しておく
    await getDurableObjectOfDoc(c, id).reset();

    return c.json(res satisfies Editor);
  })
  .delete("/:id", requireUser, requireDocExists, async (c) => {
    const id = c.req.param("id") as ULID;
    const db = drizzle(c.env.DB, { schema });

    // 削除前に画像を取得
    const imagesToDelete = await db
      .select({ storageKey: schema.images.storageKey })
      .from(schema.images)
      .where(eq(schema.images.editorId, id));

    // エディタを削除（カスケードでDBの画像も削除）
    const res = await db
      .delete(schema.editors)
      .where(eq(schema.editors.id, id))
      .returning();

    if (res.length > 0) {
      // R2から画像を一括削除（1000個ずつチャンク）
      if (imagesToDelete.length > 0) {
        const keys = imagesToDelete.map((img) => img.storageKey);
        for (let i = 0; i < keys.length; i += R2_BULK_DELETE_LIMIT) {
          const chunk = keys.slice(i, i + R2_BULK_DELETE_LIMIT);
          await c.env.UNITOOLS_R2.delete(chunk);
        }
      }
      await getDurableObjectOfDoc(c, id).reset();
    }

    return c.body(null, 204);
  })
  .get("/:id/doc", requireDocExists, async (c) => {
    const ydoc = await getDurableObjectOfDoc(c, c.req.param("id")).getYDoc();
    return c.body(new Uint8Array(ydoc), 200, {
      "Content-Type": "application/octet-stream",
    });
  })
  .route("/", wsRoute);

export default editor;
