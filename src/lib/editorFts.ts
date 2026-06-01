import type { ULID } from "@/lib/ulid";

const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

export type EditorFtsSearchMatch = {
  editorId: ULID;
  text: string;
};

export type EditorFtsTerm = {
  term: string;
  docCount: number;
  occurrenceCount: number;
};

export type EditorFtsTermSuggestion = EditorFtsTerm & {
  normalizedTerm: string;
  score: number;
  metrics: {
    partial: number;
  };
};

type FtsVocabRow = {
  term: string;
  doc: number;
  cnt: number;
};

export function tokenize(text: string): string {
  return [...segmenter.segment(text)]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment)
    .join(" ");
}

export function segmentText(text: string): string[] {
  return [...segmenter.segment(text)].filter((s) => s.isWordLike).map((s) => s.segment);
}

export function normalizeFtsTerm(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("ja-JP").replaceAll("ー", "").trim();
}

function toCharacters(value: string): string[] {
  return Array.from(graphemeSegmenter.segment(value), (segment) => segment.segment);
}

function partialSimilarity(query: string, term: string): number {
  if (!query || !term) return 0;
  if (query === term) return 1;
  if (term.includes(query) || query.includes(term)) {
    const queryLength = toCharacters(query).length;
    const termLength = toCharacters(term).length;
    return Math.min(queryLength, termLength) / Math.max(queryLength, termLength);
  }
  return 0;
}

function calculateTermSuggestionScore(query: string, term: string) {
  const metrics = {
    partial: partialSimilarity(query, term),
  };
  const score = metrics.partial * 0.72;
  return { score, metrics };
}

export async function deleteEditorFtsIndex(db: D1Database, editorId: ULID): Promise<void> {
  await db.prepare("DELETE FROM editors_fts_index WHERE editor_id = ?").bind(editorId).run();
}

export async function upsertEditorFtsIndex(
  db: D1Database,
  editorId: ULID,
  text: string,
): Promise<void> {
  const content = tokenize(text);
  await deleteEditorFtsIndex(db, editorId);

  if (!content) {
    return;
  }

  await db
    .prepare("INSERT INTO editors_fts_index (editor_id, content) VALUES (?, ?)")
    .bind(editorId, content)
    .run();
}

export async function searchEditorFtsIndex(
  db: D1Database,
  keyword: string,
  limit: number,
): Promise<EditorFtsSearchMatch[]> {
  const query = tokenize(keyword);
  if (!query) {
    return [];
  }

  const result = await db
    .prepare(
      "SELECT editor_id, content FROM editors_fts_index WHERE editors_fts_index MATCH ? LIMIT ?",
    )
    .bind(query, limit)
    .all<{ editor_id: ULID; content: string }>();

  return result.results.map((row) => ({
    editorId: row.editor_id,
    text: row.content,
  }));
}

export async function listEditorFtsTerms(
  db: D1Database,
  options: { kv: KVNamespace; kv_key: string; expirationTtl: number },
): Promise<EditorFtsTerm[]> {
  const { kv, expirationTtl, kv_key } = options;
  const cached = await kv.get<EditorFtsTerm[]>(kv_key, "json");
  if (cached) return cached;

  const result = await db
    .prepare("SELECT term, doc, cnt FROM editors_fts_vocab ORDER BY cnt DESC, term ASC")
    .all<FtsVocabRow>();

  const res = result.results.map((row) => ({
    term: row.term,
    docCount: Number(row.doc),
    occurrenceCount: Number(row.cnt),
  }));
  await kv.put(kv_key, JSON.stringify(res), { expirationTtl }); // キャッシュは1時間有効
  return res;
}

export async function suggestEditorFtsTerms(
  db: EditorFtsTerm[],
  query: string,
  options: { limit: number; minScore: number },
): Promise<EditorFtsTermSuggestion[]> {
  const normalizedQuery = normalizeFtsTerm(query);
  if (!normalizedQuery) return [];

  return db
    .map((term) => {
      const normalizedTerm = normalizeFtsTerm(term.term);
      const { score, metrics } = calculateTermSuggestionScore(normalizedQuery, normalizedTerm);
      return {
        ...term,
        normalizedTerm,
        score,
        metrics,
      };
    })
    .filter((suggestion) => suggestion.score >= options.minScore)
    .sort(
      (a, b) =>
        b.score - a.score || b.occurrenceCount - a.occurrenceCount || a.term.localeCompare(b.term),
    )
    .slice(0, options.limit);
}
