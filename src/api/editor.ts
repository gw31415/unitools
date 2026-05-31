import { sValidator } from "@hono/standard-validator";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context, MiddlewareHandler } from "hono";
import { yRoute } from "y-durableobjects";
import z from "zod";
import * as schema from "@/db/schema";
import { b64urlToStruct, structToBase64Url } from "@/lib/base64";
import { createApp, type Env } from "@/lib/hono";
import { type ULID, ulid } from "@/lib/ulid";
import type { Editor } from "@/models";
import { ulidSchema } from "@/validators";
import { editorInsertSchema, editorUpdateSchema } from "@/validators/editor";
import { requireUser, useUser } from "./auth";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const AI_SEARCH_MAX_RESULTS = 50;
const SEARCH_MATCH_SNIPPET_LENGTH = 180;
const R2_BULK_DELETE_LIMIT = 1000;
const ULID_PATTERN_SOURCE = "[0-9A-HJKMNP-TV-Z]{26}";
const EDITOR_ID_PATTERN = new RegExp(ULID_PATTERN_SOURCE);
const IMAGE_STORAGE_KEY_PATTERN = new RegExp(
  `(?:^|/)images/(${ULID_PATTERN_SOURCE})/(${ULID_PATTERN_SOURCE})\\.[^/]+$`,
);
const MARKDOWN_STORAGE_KEY_PATTERN = new RegExp(`(?:^|/)editor/(${ULID_PATTERN_SOURCE})\\.md$`);

const cursorPayloadSchema = z.object({
  id: ulidSchema,
  createdAt: z.number().int().nonnegative(),
});

type EditorSearchMatch = {
  source: "title" | "content" | "image";
  text: string;
  imageId?: ULID;
};

const toTimestamp = (value: unknown) => (value instanceof Date ? value.getTime() : Number(value));

function escapeSqlLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function getStringSearchResultValues(result: AutoRagSearchResponse["data"][number]) {
  return [
    result.filename,
    result.file_id,
    ...Object.values(result.attributes).filter(
      (value): value is string => typeof value === "string",
    ),
  ];
}

function getImageMatchFromSearchResult(result: AutoRagSearchResponse["data"][number]) {
  for (const value of getStringSearchResultValues(result)) {
    const match = value.match(IMAGE_STORAGE_KEY_PATTERN);
    if (!match) continue;

    const [, editorId, imageId] = match;
    if (ulidSchema.safeParse(editorId).success && ulidSchema.safeParse(imageId).success) {
      return {
        editorId: editorId as ULID,
        imageId: imageId as ULID,
      };
    }
  }

  return null;
}

function getEditorIdFromSearchResult(result: AutoRagSearchResponse["data"][number]) {
  const imageMatch = getImageMatchFromSearchResult(result);
  if (imageMatch) return imageMatch.editorId;

  const metadataEditorId =
    result.attributes.editorId ?? result.attributes.editor_id ?? result.attributes.id;
  if (typeof metadataEditorId === "string" && ulidSchema.safeParse(metadataEditorId).success) {
    return metadataEditorId as ULID;
  }

  for (const value of getStringSearchResultValues(result)) {
    const markdownMatch = value.match(MARKDOWN_STORAGE_KEY_PATTERN);
    if (markdownMatch && ulidSchema.safeParse(markdownMatch[1]).success) {
      return markdownMatch[1] as ULID;
    }

    const idMatch = value.match(EDITOR_ID_PATTERN);
    if (idMatch && ulidSchema.safeParse(idMatch[0]).success) {
      return idMatch[0] as ULID;
    }
  }

  return null;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getSearchMatchSnippet(result: AutoRagSearchResponse["data"][number], keyword: string) {
  const text = compactText(result.content.map((content) => content.text).join(" "));
  if (!text) return null;

  const normalizedText = text.toLocaleLowerCase();
  const normalizedKeyword = keyword.toLocaleLowerCase();
  const matchIndex = normalizedText.indexOf(normalizedKeyword);
  if (matchIndex < 0) {
    return text.slice(0, SEARCH_MATCH_SNIPPET_LENGTH);
  }

  const contextLength = Math.max(0, Math.floor((SEARCH_MATCH_SNIPPET_LENGTH - keyword.length) / 2));
  const start = Math.max(0, matchIndex - contextLength);
  const end = Math.min(text.length, start + SEARCH_MATCH_SNIPPET_LENGTH);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function getSearchMatchesByEditorId(results: AutoRagSearchResponse["data"], keyword: string) {
  const matches = new Map<ULID, EditorSearchMatch>();

  for (const result of results) {
    const id = getEditorIdFromSearchResult(result);
    if (!id || matches.has(id)) continue;
    const text = getSearchMatchSnippet(result, keyword);
    if (!text) continue;
    const imageMatch = getImageMatchFromSearchResult(result);
    matches.set(
      id,
      imageMatch
        ? { source: "image", text, imageId: imageMatch.imageId }
        : { source: "content", text },
    );
  }

  return matches;
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
          const searchResults = await c.env.AI.autorag("unitools-editors").search({
            query: keyword,
            max_num_results: Math.min(limit, AI_SEARCH_MAX_RESULTS),
          });
          return getSearchMatchesByEditorId(searchResults.data, keyword);
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
