type EditorFtsVocabSuggestion = {
  term: string;
  normalizedTerm: string;
  score: number;
  metrics: {
    partial: number;
    embedding: number;
  };
};

export type EditorFtsTermGroupItem = {
  term: string;
  normalizedTerm: string;
  score: number;
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

function isAsciiSearchTerm(term: string): boolean {
  return /^[a-z0-9]+$/i.test(term);
}

function asciiLexicalBoost(partial: number): number {
  return partial === 0 ? 0.1 : partial;
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
    topK: Math.min(options.limit * 10, 50),
    returnValues: true,
    returnMetadata: "none",
  });

  // normalizedTerm をキーにして db を検索できるようにする
  const termMap = new Map(terms.map((term) => [normalizeFtsTerm(term), term]));

  const suggestionsByTerm = new Map<string, EditorFtsVocabSuggestion>();
  const useAsciiLexicalScoring = isAsciiSearchTerm(normalizedQuery);

  const addSuggestion = (term: string, embeddingScore: number) => {
    const normalizedTerm = normalizeFtsTerm(term);
    if (!normalizedTerm) return;

    const partial = partialSimilarity(normalizedQuery, normalizedTerm);
    const score = useAsciiLexicalScoring
      ? Math.max(partial, embeddingScore * asciiLexicalBoost(partial))
      : Math.max(partial, embeddingScore);
    if (score < options.minScore) return;

    const current = suggestionsByTerm.get(normalizedTerm);
    if (current && current.score >= score) return;

    suggestionsByTerm.set(normalizedTerm, {
      term,
      normalizedTerm,
      score,
      metrics: {
        partial,
        embedding: embeddingScore,
      },
    });
  };

  for (const match of matches.matches) {
    const normalizedTerm = match.id;
    const term = termMap.get(normalizedTerm);
    if (!term) continue;

    addSuggestion(term, match.score);
  }

  for (const term of terms) {
    addSuggestion(term, 0);
  }

  const suggestions = [...suggestionsByTerm.values()];
  return suggestions
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .slice(0, options.limit);
}

export async function buildExpandedFtsTerms(
  query: string,
  options: { minScore: number; limit: number; ai: Ai; vectorize: VectorizeIndex },
  terms: string[],
): Promise<string[][]> {
  const termGroups = await buildExpandedFtsTermGroups(query, options, terms);
  return termGroups.map((group) => group.map((item) => item.term));
}

export async function buildExpandedFtsTermGroups(
  query: string,
  options: { minScore: number; limit: number; ai: Ai; vectorize: VectorizeIndex },
  terms: string[],
): Promise<EditorFtsTermGroupItem[][]> {
  const segments = segmentText(query);
  if (segments.length === 0) return [];

  // 各セグメントに対して類似キーワードを取得
  const suggestionsPerSegment = await Promise.all(
    segments.map((segment) =>
      suggestEditorFtsTerms(terms, segment, {
        limit: options.limit,
        minScore: options.minScore,
        ai: options.ai,
        vectorize: options.vectorize,
      }),
    ),
  );

  // セグメントごとに用語グループを作成（元のセグメント + 類似キーワード）
  return segments.map((segment, i) => {
    const group = new Map<string, EditorFtsTermGroupItem>();
    const normalizedSegment = normalizeFtsTerm(segment);
    group.set(segment, {
      term: segment,
      normalizedTerm: normalizedSegment,
      score: 1,
    });
    for (const suggestion of suggestionsPerSegment[i]) {
      const current = group.get(suggestion.term);
      if (current && current.score >= suggestion.score) continue;
      group.set(suggestion.term, {
        term: suggestion.term,
        normalizedTerm: suggestion.normalizedTerm,
        score: suggestion.score,
      });
    }
    return [...group.values()].sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
  });
}
