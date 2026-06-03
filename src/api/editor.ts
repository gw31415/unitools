import { sValidator } from "@hono/standard-validator";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context, MiddlewareHandler } from "hono";
import { yRoute } from "y-durableobjects";
import z from "zod";
import * as schema from "@/db/schema";
import { b64urlToStruct, structToBase64Url } from "@/lib/base64";
import { normalizeFtsTerm, segmentText } from "@/lib/editorFts";
import { findContentMatchText } from "@/lib/editorSearchMatch";
import { createApp, type Env } from "@/lib/hono";
import { type ULID, ulid } from "@/lib/ulid";
import type { Editor } from "@/models";
import { ulidSchema } from "@/validators";
import { editorInsertSchema, editorUpdateSchema } from "@/validators/editor";
import { requireUser, useUser } from "./auth";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const SEARCH_SUGGESTION_DEBOUNCE_MS = 200;
const SEARCH_CACHE_TTL_SECONDS = 60;
const CONTENT_SEARCH_CACHE_PREFIX = "editor:search:content:v1:";
const R2_BULK_DELETE_LIMIT = 1000;

const cursorPayloadSchema = z.object({
  id: ulidSchema,
  createdAt: z.number().int().nonnegative(),
});

type EditorSearchMatch = {
  source: "title" | "content";
  text?: string;
};

type EditorSearchItem = {
  id: ULID;
  createdAt: number;
  title: string;
  match?: EditorSearchMatch;
};

type EditorSearchResponse = {
  items: EditorSearchItem[];
  pageInfo: {
    hasMore: boolean;
    nextCursor: string | null;
  };
};

type EditorSearchQuery = {
  limit: number;
  cursor?: z.infer<typeof cursorPayloadSchema>;
  keyword?: string;
};

type SearchSuggestionResponse =
  | (EditorSearchResponse & { type: "items"; keyword: string })
  | { type: "error"; keyword: string; message: string };

type CachedContentSearchMatch = {
  editorId: ULID;
  match: EditorSearchMatch;
};

type CachedContentSearchResult = {
  matches: CachedContentSearchMatch[];
};

const toTimestamp = (value: unknown) => (value instanceof Date ? value.getTime() : Number(value));

function isCachedContentSearchResult(value: unknown): value is CachedContentSearchResult {
  if (!value || typeof value !== "object") return false;
  const { matches } = value as { matches?: unknown };
  return (
    Array.isArray(matches) &&
    matches.every((item) => {
      if (!item || typeof item !== "object") return false;
      const { editorId, match } = item as { editorId?: unknown; match?: unknown };
      if (typeof editorId !== "string" || !match || typeof match !== "object") return false;
      const { source, text } = match as { source?: unknown; text?: unknown };
      return source === "content" && (typeof text === "string" || typeof text === "undefined");
    })
  );
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashCacheKey(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(hash));
}

function contentSearchMatchesToMap(matches: CachedContentSearchMatch[]) {
  return new Map<ULID, EditorSearchMatch>(matches.map(({ editorId, match }) => [editorId, match]));
}

function buildDirectFtsTermGroups(keyword: string) {
  return segmentText(keyword)
    .map((segment) => ({
      term: segment,
      normalizedTerm: normalizeFtsTerm(segment),
      score: 1,
    }))
    .filter((item) => item.normalizedTerm)
    .map((item) => [item]);
}

function escapeSqlLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildFts5PhraseExpression(term: string) {
  return sql`'"' || replace(${term}, '"', '""') || '"'`;
}

function buildFts5MatchExpression(termGroups: string[][]) {
  const groupExpressions = termGroups
    .map((group) => [...new Set(group.map((term) => term.trim()).filter(Boolean))])
    .filter((group) => group.length > 0)
    .map((group) => {
      const termExpressions = group.map(buildFts5PhraseExpression);
      return termExpressions.length === 1
        ? termExpressions[0]
        : sql`'(' || ${sql.join(termExpressions, sql` || ' OR ' || `)} || ')'`;
    });

  return groupExpressions.length === 0
    ? undefined
    : sql.join(groupExpressions, sql` || ' AND ' || `);
}

function sendSearchSuggestionMessage(socket: WebSocket, message: SearchSuggestionResponse) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

export async function fetchEditorSearchItems(
  env: CloudflareBindings,
  query: EditorSearchQuery,
): Promise<EditorSearchResponse> {
  const db = drizzle(env.DB, { schema });
  const { keyword, limit } = query;
  const take = limit + 1;

  if (keyword) {
    const fetchTitleRows = () =>
      db.query.editors.findMany({
        where: (editors) =>
          sql`${editors.title} LIKE ${`%${escapeSqlLikePattern(keyword)}%`} ESCAPE '\\'`,
        orderBy: (editors) => [desc(editors.createdAt), desc(editors.id)],
        limit,
      }) as Promise<Editor[]>;

    const fetchContentMatches = async () => {
      const contentSearchCacheKey = `${CONTENT_SEARCH_CACHE_PREFIX}${await hashCacheKey({
        keyword,
        limit,
      })}`;
      const cachedContentMatches = await env.KV.get<CachedContentSearchResult>(
        contentSearchCacheKey,
        "json",
      );
      if (isCachedContentSearchResult(cachedContentMatches)) {
        return contentSearchMatchesToMap(cachedContentMatches.matches);
      }

      const scoredTermGroups = buildDirectFtsTermGroups(keyword);
      const termGroups = scoredTermGroups.map((group) => group.map((item) => item.term));

      const ftsQueryExpression = buildFts5MatchExpression(termGroups);
      if (!ftsQueryExpression) return new Map<ULID, EditorSearchMatch>();

      const ftsMatches = await db.query.editorsFtsIndex.findMany({
        where: () => sql`editors_fts_index MATCH (${ftsQueryExpression})`,
        orderBy: () => sql`bm25(editors_fts_index)`,
        limit: Math.min(limit * 5, MAX_PAGE_SIZE),
      });

      const allSearchTerms = scoredTermGroups
        .flat()
        .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));

      const findMatchedTerm = (content: string): { score: number; text?: string } => {
        const normalizedContent = normalizeFtsTerm(content);
        for (const item of allSearchTerms) {
          if (normalizedContent.includes(item.normalizedTerm)) {
            return { score: item.score, text: item.term };
          }
        }
        return { score: 0 };
      };

      const contentMatches = ftsMatches
        .map((match, index) => ({
          match,
          index,
          matchedTerm: findMatchedTerm(match.content),
        }))
        .sort((a, b) => b.matchedTerm.score - a.matchedTerm.score || a.index - b.index)
        .slice(0, limit)
        .map(({ match, matchedTerm }) => ({
          editorId: match.editorId,
          match: {
            source: "content" as const,
            text:
              findContentMatchText(match.content, termGroups) ??
              (matchedTerm.text ? matchedTerm.text : undefined),
          },
        }));

      await env.KV.put(
        contentSearchCacheKey,
        JSON.stringify({ matches: contentMatches satisfies CachedContentSearchMatch[] }),
        { expirationTtl: SEARCH_CACHE_TTL_SECONDS },
      );
      return contentSearchMatchesToMap(contentMatches);
    };

    const titleRows = await fetchTitleRows();
    const matchesById = await fetchContentMatches();

    for (const editor of titleRows) {
      matchesById.set(editor.id, { source: "title", text: editor.title });
    }

    const titleIds = titleRows.map((editor) => editor.id);
    const ids = [
      ...titleIds,
      ...[...matchesById.keys()].filter((id) => !titleIds.includes(id)),
    ].slice(0, limit);
    if (ids.length === 0) {
      return {
        items: [],
        pageInfo: {
          hasMore: false,
          nextCursor: null,
        },
      };
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

    return {
      items,
      pageInfo: {
        hasMore: false,
        nextCursor: null,
      },
    };
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

  return {
    items,
    pageInfo: {
      hasMore,
      nextCursor,
    },
  };
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
      z
        .object({
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
        })
        .strict(),
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
      return c.json(await fetchEditorSearchItems(c.env, { limit, cursor: query.cursor }));
    },
  )
  .get("/search-suggestions", requireUser, async (c) => {
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      return c.text("Expected WebSocket upgrade.", 426);
    }

    const { 0: client, 1: server } = new WebSocketPair();
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let latestSequence = 0;
    const searchSuggestionKeywordSchema = z.string().trim().max(200);

    const clearDebounceTimer = () => {
      if (!debounceTimer) return;
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    };

    async function runSearch(query: string, sequence: number) {
      try {
        const result = await fetchEditorSearchItems(c.env, {
          limit: DEFAULT_PAGE_SIZE,
          keyword: query,
        });
        if (sequence !== latestSequence) return;
        sendSearchSuggestionMessage(server, { type: "items", keyword: query, ...result });
      } catch (error) {
        console.error(error);
        if (sequence !== latestSequence) return;
        sendSearchSuggestionMessage(server, {
          type: "error",
          keyword: query,
          message: "Failed to load articles.",
        });
      }
    };

    server.addEventListener("message", (event) => {
      const parsed = searchSuggestionKeywordSchema.safeParse(event.data);
      if (!parsed.success) {
        sendSearchSuggestionMessage(server, {
          type: "error",
          keyword: "",
          message: "Invalid search suggestion request.",
        });
        return;
      }

      clearDebounceTimer();
      latestSequence += 1;
      const sequence = latestSequence;
      debounceTimer = setTimeout(() => {
        void runSearch(parsed.data, sequence);
      }, SEARCH_SUGGESTION_DEBOUNCE_MS);
    });
    server.addEventListener("close", clearDebounceTimer);
    server.addEventListener("error", clearDebounceTimer);
    server.accept();

    return new Response(null, { status: 101, webSocket: client });
  })
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
      // FTSインデックスも削除
      await db.delete(schema.editorsFtsIndex).where(eq(schema.editorsFtsIndex.editorId, id)).run();

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
