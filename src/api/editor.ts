import { sValidator } from "@hono/standard-validator";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context, MiddlewareHandler } from "hono";
import { yRoute } from "y-durableobjects";
import z from "zod";
import * as schema from "@/db/schema";
import { b64urlToStruct, structToBase64Url } from "@/lib/base64";
import {
  deleteEditorFtsIndex,
  searchEditorFtsIndex,
  segmentText,
  suggestEditorFtsTerms,
  listEditorFtsTerms,
} from "@/lib/editorFts";
import { createApp, type Env } from "@/lib/hono";
import { type ULID, ulid } from "@/lib/ulid";
import type { Editor } from "@/models";
import { ulidSchema } from "@/validators";
import { editorInsertSchema, editorUpdateSchema } from "@/validators/editor";
import { requireUser, useUser } from "./auth";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SUGGESTION_LIMIT = 20;
const MAX_SUGGESTION_LIMIT = 100;
const DEFAULT_SUGGESTION_MIN_SCORE = 0.35;
const R2_BULK_DELETE_LIMIT = 1000;

const cursorPayloadSchema = z.object({
  id: ulidSchema,
  createdAt: z.number().int().nonnegative(),
});

type EditorSearchMatch = {
  source: "title" | "content";
  text: string;
};

const toTimestamp = (value: unknown) => (value instanceof Date ? value.getTime() : Number(value));

function escapeSqlLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const requireDocExists: MiddlewareHandler<Env> = async (c, next) => {
  const id = c.req.param("id");
  if (!id) return c.notFound();

  const db = drizzle(c.env.DB);
  const [doc] = await db
    .select({ id: schema.editors.id })
    .from(schema.editors)
    .where(eq(schema.editors.id, id as ULID))
    .limit(1);

  if (!doc) return c.notFound();

  await next();
};

const wsRoute = createApp()
  .use("/:id", requireDocExists)
  .route(
    "/",
    yRoute<Env>((env) => env.UNITOOLS_EDITORS as unknown as DurableObjectNamespace),
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
        keyword: z
          .string()
          .trim()
          .max(200)
          .optional()
          .transform((value) => (value ? value : undefined)),
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
        searchMode: z.enum(["title", "content"]).optional(),
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
      const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
      const take = limit + 1;

      const db = drizzle(c.env.DB, { schema });
      if (query.keyword) {
        const keyword = query.keyword;

        const fetchTitleRows = () =>
          db.query.editors.findMany({
            where: (editors) =>
              sql`${editors.title} LIKE ${`%${escapeSqlLikePattern(keyword)}%`} ESCAPE '\\'`,
            orderBy: (editors) => [desc(editors.createdAt), desc(editors.id)],
            limit,
          }) as Promise<Editor[]>;

        const fetchContentMatches = async () => {
          const ftsMatches = await searchEditorFtsIndex(c.env.DB, keyword, limit);
          return new Map<ULID, EditorSearchMatch>(
            ftsMatches.map((match) => [match.editorId, { source: "content", text: match.text }]),
          );
        };

        const titleRows = query.searchMode === "content" ? [] : await fetchTitleRows();
        const matchesById =
          query.searchMode === "title"
            ? new Map<ULID, EditorSearchMatch>()
            : await fetchContentMatches();

        if (query.searchMode !== "content") {
          for (const editor of titleRows) {
            matchesById.set(editor.id, { source: "title", text: editor.title });
          }
        }

        const titleIds = titleRows.map((editor) => editor.id);
        const ids =
          query.searchMode === "content"
            ? [...matchesById.keys()].slice(0, limit)
            : [
                ...titleIds,
                ...[...matchesById.keys()].filter((id) => !titleIds.includes(id)),
              ].slice(0, limit);
        if (ids.length === 0) {
          return c.json({
            items: [],
            pageInfo: {
              hasMore: false,
              nextCursor: null,
            },
          });
        }

        const rows: Editor[] = await db.query.editors.findMany({
          where: (editors) => inArray(editors.id, ids),
        });
        const rowsById = new Map(rows.map((editor) => [editor.id, editor]));
        const items = ids
          .map((id) => rowsById.get(id))
          .filter((editor): editor is Editor => Boolean(editor))
          .map((editor) => {
            const matchText = matchesById.get(editor.id);
            return {
              id: editor.id,
              createdAt: toTimestamp(editor.createdAt),
              title: editor.title,
              match: matchText,
            };
          });

        return c.json({
          items,
          pageInfo: {
            hasMore: false,
            nextCursor: null,
          },
        });
      }

      const rows: Editor[] = await db.query.editors.findMany({
        where: (editors) =>
          query.cursor
            ? or(
                lt(editors.createdAt, new Date(query.cursor.createdAt)),
                and(
                  eq(editors.createdAt, new Date(query.cursor.createdAt)),
                  lt(editors.id, query.cursor.id as ULID),
                ),
              )
            : undefined,
        orderBy: (editors) => [desc(editors.createdAt), desc(editors.id)],
        limit: take,
      });

      const hasMore = rows.length > limit;
      const pageItems = hasMore ? rows.slice(0, limit) : rows;
      const items = pageItems.map((editor) => ({
        id: editor.id,
        createdAt: toTimestamp(editor.createdAt),
        title: editor.title,
      }));

      const last = items.at(-1);
      const nextCursor =
        hasMore && last ? structToBase64Url({ id: last.id, createdAt: last.createdAt }) : null;

      return c.json({
        items,
        pageInfo: {
          hasMore,
          nextCursor,
        },
      });
    },
  )
  .get(
    "/keywords/suggest",
    useUser,
    sValidator(
      "query",
      z.object({
        query: z.string().trim().max(200),
        limit: z.coerce.number().int().nonnegative().optional(),
        minScore: z.coerce.number().min(0).max(1).optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json({ items: [] });
      }

      const query = c.req.valid("query");
      const limit = Math.min(
        Math.max(1, query.limit ?? DEFAULT_SUGGESTION_LIMIT),
        MAX_SUGGESTION_LIMIT,
      );
      const db = await listEditorFtsTerms(c.env.DB, {
        kv: c.env.KV,
        kv_key: "fts-vocab:all",
        expirationTtl: 60 * 60, // 1時間
      });
      const items = await suggestEditorFtsTerms(db, query.query, {
        limit,
        minScore: query.minScore ?? DEFAULT_SUGGESTION_MIN_SCORE,
      });

      return c.json({ items });
    },
  )
  .get(
    "/segments",
    useUser,
    sValidator(
      "query",
      z.object({
        text: z.string().trim().max(2000),
      }),
    ),
    (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json({ segments: [] });
      }

      return c.json({ segments: segmentText(c.req.valid("query").text) });
    },
  )
  .post("/", requireUser, sValidator("json", editorInsertSchema), async (c) => {
    const id = ulid();
    const db = drizzle(c.env.DB, { schema });
    const [res] = await db
      .insert(schema.editors)
      .values({ ...c.req.valid("json"), id })
      .returning();
    // ダメおしでDOインスタンスを初期化しておく
    await getDurableObjectOfDoc(c, id).reset();

    return c.json(res satisfies Editor);
  })
  .patch(
    "/:id",
    requireUser,
    requireDocExists,
    sValidator("json", editorUpdateSchema),
    async (c) => {
      const id = c.req.param("id") as ULID;
      const db = drizzle(c.env.DB, { schema });
      const [res] = await db
        .update(schema.editors)
        .set(c.req.valid("json"))
        .where(eq(schema.editors.id, id))
        .returning();

      if (!res) {
        return c.notFound();
      }
      return c.json(res satisfies Editor);
    },
  )
  .delete("/:id", requireUser, requireDocExists, async (c) => {
    const id = c.req.param("id") as ULID;
    const db = drizzle(c.env.DB, { schema });

    // 削除前に画像を取得
    const imagesToDelete = await db
      .select({ storageKey: schema.images.storageKey })
      .from(schema.images)
      .where(eq(schema.images.editorId, id));

    // エディタを削除（カスケードでDBの画像も削除）
    const res = await db.delete(schema.editors).where(eq(schema.editors.id, id)).returning();

    if (res.length > 0) {
      await deleteEditorFtsIndex(c.env.DB, id);

      // R2から画像を一括削除（1000個ずつチャンク）
      if (imagesToDelete.length > 0) {
        const keys = imagesToDelete.map((img) => img.storageKey);
        for (let i = 0; i < keys.length; i += R2_BULK_DELETE_LIMIT) {
          await c.env.UNITOOLS_R2.delete(keys.slice(i, i + R2_BULK_DELETE_LIMIT));
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
