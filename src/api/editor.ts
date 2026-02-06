import { sValidator } from "@hono/standard-validator";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context, MiddlewareHandler } from "hono";
import { ulid } from "ulid";
import { yRoute } from "y-durableobjects";
import z from "zod/v4";
import * as schema from "@/db/schema";
import { createApp, type Env } from "@/lib/hono";
import { requireUser } from "./auth";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const cursorPayloadSchema = z.object({
  id: z.ulid(),
  createdAt: z.number().int().nonnegative(),
});

type CursorPayload = z.infer<typeof cursorPayloadSchema>;

const encodeCursor = (cursor: CursorPayload) =>
  btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const decodeCursor = (cursor: string): CursorPayload => {
  const base64 = cursor
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(cursor.length / 4) * 4, "=");
  const parsed = cursorPayloadSchema.parse(JSON.parse(atob(base64)));
  return parsed;
};

const toTimestamp = (value: unknown) =>
  value instanceof Date ? value.getTime() : Number(value);

const requireDocExists: MiddlewareHandler<Env> = async (c, next) => {
  const id = c.req.param("id");
  if (!id) {
    return c.notFound();
  }

  const db = drizzle(c.env.DB);
  const doc = await db
    .select({ id: schema.markdownDocs.id })
    .from(schema.markdownDocs)
    .where(eq(schema.markdownDocs.id, id))
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
    requireUser,
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
              return decodeCursor(s);
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
      const query = c.req.valid("query");
      const limit = Math.min(
        Math.max(1, query.limit ?? DEFAULT_PAGE_SIZE),
        MAX_PAGE_SIZE,
      );
      const take = limit + 1;

      const db = drizzle(c.env.DB, { schema });
      const rows = await db.query.markdownDocs.findMany({
        where: (docs) => {
          if (!query.cursor) {
            return undefined;
          }
          const cursorCreatedAt = new Date(query.cursor.createdAt);
          return or(
            lt(docs.createdAt, cursorCreatedAt),
            and(
              eq(docs.createdAt, cursorCreatedAt),
              lt(docs.id, query.cursor.id),
            ),
          );
        },
        orderBy: (docs) => [desc(docs.createdAt), desc(docs.id)],
        limit: take,
      });

      const hasMore = rows.length > limit;
      const pageItems = hasMore ? rows.slice(0, limit) : rows;
      const items = pageItems.map((doc) => ({
        id: doc.id,
        createdAt: toTimestamp(doc.createdAt),
      }));

      const last = items.at(-1);
      const nextCursor =
        hasMore && last
          ? encodeCursor({ id: last.id, createdAt: last.createdAt })
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
      .insert(schema.markdownDocs)
      .values({ id })
      .returning();
    // ダメおしでDOインスタンスを初期化しておく
    await getDurableObjectOfDoc(c, id).reset();

    return c.json(res);
  })
  .delete("/:id", requireUser, requireDocExists, async (c) => {
    const id = c.req.param("id");
    const db = drizzle(c.env.DB, { schema });
    const res = await db
      .delete(schema.markdownDocs)
      .where(eq(schema.markdownDocs.id, id))
      .returning();
    if (res.length > 0) {
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
