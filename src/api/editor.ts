import { sValidator } from "@hono/standard-validator";
import { and, eq } from "drizzle-orm";
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
    sValidator(
      "query",
      z.object({
        limit: z.uint32().optional(),
        id: z.ulid().optional(),
        cursor: z.base64url().transform((s, ctx) => {
          const cursorPayloadSchema = z.object({
            id: z.ulid(),
            createdAt: z.iso.datetime(),
          });
          try {
            const json = JSON.parse(
              Buffer.from(s, "base64url").toString("utf8"),
            );

            const parsed = cursorPayloadSchema.safeParse(json);
            if (!parsed.success) {
              ctx.addIssue("Decoded cursor does not match schema");
              return z.NEVER;
            }

            return parsed.data; // ← これが“使えるカーソル”
          } catch {
            ctx.addIssue("Invalid base64url or invalid JSON");
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

      const db = drizzle(c.env.DB, { schema });

      const res = await db.query.markdownDocs.findMany({
        where: (docs, { eq, gt }) => {
          const conds = [];

          // 単一IDで絞る
          if (query.id) {
            conds.push(eq(docs.id, query.id));
          }

          if (query.cursor) {
            conds.push(gt(docs.id, query.cursor.id));
          }

          return conds.length ? and(...conds) : undefined;
        },
        limit,
      });

      return c.json(res);
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
