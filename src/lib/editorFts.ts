type EditorFtsVocabSuggestion = {
  term: string;
  normalizedTerm: string;
  score: number;
  metrics: {
    partial: number;
    embedding: number;
  };
};

const segmenter = new Intl.Segmenter("ja", { granularity: "word" });

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

const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
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

export async function suggestEditorFtsTerms(
  terms: string[],
  query: string,
  options: { limit: number; minScore: number; ai: Ai; vectorize: VectorizeIndex },
): Promise<EditorFtsVocabSuggestion[]> {
  const normalizedQuery = normalizeFtsTerm(query);
  if (!normalizedQuery) return [];

  // クエリの embedding を生成
  const queryEmbeddingResponse = await options.ai.run("@cf/baai/bge-m3", {
    text: [normalizedQuery],
  });
  if (!("data" in queryEmbeddingResponse) || !queryEmbeddingResponse.data) {
    throw new Error("Failed to get embedding for query");
  }

  // Vectorize で類似キーワードを検索（topK は limit の数倍取得してフィルタリング）
  const matches = await options.vectorize.query(queryEmbeddingResponse.data[0], {
    topK: options.limit * 10,
    returnValues: true,
    returnMetadata: false,
  });

  // normalizedTerm をキーにして db を検索できるようにする
  const termMap = new Map(terms.map((term) => [normalizeFtsTerm(term), term]));

  const suggestions: EditorFtsVocabSuggestion[] = [];

  for (const match of matches.matches) {
    const normalizedTerm = match.id;
    const term = termMap.get(normalizedTerm);
    if (!term) continue;

    const embeddingScore = match.score;
    const partial = partialSimilarity(normalizedQuery, normalizedTerm);
    const score = Math.max(partial * 0.3, embeddingScore * 0.7);

    if (score < options.minScore) continue;

    suggestions.push({
      term,
      normalizedTerm,
      score,
      metrics: {
        partial,
        embedding: embeddingScore,
      },
    });

    if (suggestions.length >= options.limit) break;
  }

  return suggestions.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
}
