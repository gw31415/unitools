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
    levenshtein: number;
    jaroWinkler: number;
    dice: number;
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

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const aChars = toCharacters(a);
  const bChars = toCharacters(b);
  if (aChars.length === 0) return bChars.length;
  if (bChars.length === 0) return aChars.length;

  const previous = Array.from({ length: bChars.length + 1 }, (_, index) => index);
  const current = Array.from({ length: bChars.length + 1 }, () => 0);

  for (let i = 1; i <= aChars.length; i++) {
    current[0] = i;
    for (let j = 1; j <= bChars.length; j++) {
      const substitutionCost = aChars[i - 1] === bChars[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[bChars.length];
}

function levenshteinSimilarity(a: string, b: string): number {
  const maxLength = Math.max(toCharacters(a).length, toCharacters(b).length);
  if (maxLength === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLength;
}

function jaroSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const aChars = toCharacters(a);
  const bChars = toCharacters(b);
  if (aChars.length === 0 || bChars.length === 0) return 0;

  const matchDistance = Math.max(Math.floor(Math.max(aChars.length, bChars.length) / 2) - 1, 0);
  const aMatches = Array.from({ length: aChars.length }, () => false);
  const bMatches = Array.from({ length: bChars.length }, () => false);
  let matches = 0;

  for (let i = 0; i < aChars.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, bChars.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || aChars[i] !== bChars[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let bIndex = 0;
  for (let i = 0; i < aChars.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[bIndex]) bIndex++;
    if (aChars[i] !== bChars[bIndex]) transpositions++;
    bIndex++;
  }

  return (
    (matches / aChars.length + matches / bChars.length + (matches - transpositions / 2) / matches) /
    3
  );
}

function jaroWinklerSimilarity(a: string, b: string): number {
  const jaro = jaroSimilarity(a, b);
  const aChars = toCharacters(a);
  const bChars = toCharacters(b);
  let prefixLength = 0;
  while (
    prefixLength < 4 &&
    prefixLength < aChars.length &&
    prefixLength < bChars.length &&
    aChars[prefixLength] === bChars[prefixLength]
  ) {
    prefixLength++;
  }
  return jaro + prefixLength * 0.1 * (1 - jaro);
}

function bigrams(value: string): string[] {
  const chars = toCharacters(value);
  if (chars.length <= 1) return chars;
  return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
}

function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  if (aBigrams.length === 0 || bBigrams.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const bigram of aBigrams) {
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }

  let overlap = 0;
  for (const bigram of bBigrams) {
    const count = counts.get(bigram) ?? 0;
    if (count === 0) continue;
    overlap++;
    counts.set(bigram, count - 1);
  }

  return (2 * overlap) / (aBigrams.length + bBigrams.length);
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
    levenshtein: levenshteinSimilarity(query, term),
    jaroWinkler: jaroWinklerSimilarity(query, term),
    dice: diceSimilarity(query, term),
    partial: partialSimilarity(query, term),
  };
  const score = Math.max(
    metrics.levenshtein * 0.35 + metrics.jaroWinkler * 0.35 + metrics.dice * 0.3,
    metrics.partial * 0.72,
  );
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
