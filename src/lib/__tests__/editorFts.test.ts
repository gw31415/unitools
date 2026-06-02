import { describe, expect, it, vi } from "vite-plus/test";
import {
  buildExpandedFtsTerms,
  segmentText,
  suggestEditorFtsTerms,
  tokenize,
} from "@/lib/editorFts";

function createAiMock(embeddings?: number[][]) {
  const run = vi.fn().mockResolvedValue({
    shape: [embeddings?.length ?? 0, 1024],
    data: embeddings ?? [],
  });
  return { run } as unknown as Ai;
}

function createVectorizeMock(matches: Array<{ id: string; score: number }>) {
  const query = vi.fn().mockResolvedValue({ matches });
  return { query } as unknown as VectorizeIndex;
}

describe("tokenize", () => {
  it("segments Japanese words with spaces", () => {
    expect(tokenize("東京都で検索します")).toBe("東京 都 で 検索 し ます");
  });

  it("normalizes whitespace by joining word-like segments", () => {
    expect(tokenize("Alpha   Beta\nGamma")).toBe("Alpha Beta Gamma");
  });

  it("filters punctuation and symbols", () => {
    expect(tokenize("検索、テスト! 123")).toBe("検索 テスト 123");
  });

  it("returns raw segments for segment API use", () => {
    expect(segmentText("東京都で検索します")).toEqual(["東京", "都", "で", "検索", "し", "ます"]);
  });
});

describe("editor FTS helpers", () => {
  it("suggests normalized and partial term matches by score", async () => {
    const terms = ["コンピューター", "検索", "コンピューターサイエンス", "京都"];

    // クエリの embedding モック
    const queryEmbedding = Array.from({ length: 1024 }, () => Math.random() - 0.5);
    const ai = createAiMock([queryEmbedding]);

    // Vectorize モック - 類似キーワードを返す
    // 正規化された用語を ID として使用
    const vectorize = createVectorizeMock([
      { id: "コンピュタ", score: 0.9 }, // コンピューター（高類似度）
      { id: "コンピュタサイエンス", score: 0.7 }, // コンピューターサイエンス（中類似度）
    ]);

    const suggestions = await suggestEditorFtsTerms(terms, "コンピュータ", {
      limit: 3,
      minScore: 0.2,
      ai,
      vectorize,
    });

    expect(suggestions.map((suggestion) => suggestion.term)).toEqual([
      "コンピューター",
      "コンピューターサイエンス",
    ]);
    expect(suggestions[0]?.score).toBeGreaterThan(suggestions[1]?.score ?? 0);
    expect(suggestions[0]?.normalizedTerm).toBe("コンピュタ");
  });

  it("suggests partial term matches even when vector search does not return them", async () => {
    const terms = ["Alpha", "Alphabet", "Beta"];
    const ai = createAiMock([Array.from({ length: 1024 }, () => 0)]);
    const vectorize = createVectorizeMock([]);

    const suggestions = await suggestEditorFtsTerms(terms, "alpha", {
      limit: 5,
      minScore: 0.35,
      ai,
      vectorize,
    });

    expect(suggestions.map((suggestion) => suggestion.term)).toEqual(["Alpha", "Alphabet"]);
    expect(suggestions[0]).toMatchObject({
      term: "Alpha",
      metrics: { partial: 1, embedding: 0 },
    });
  });

  it("ranks ASCII embedding-only noise below lexical matches", async () => {
    const terms = ["NSAIDs", "NSAID", "ssss"];
    const ai = createAiMock([Array.from({ length: 1024 }, () => 0)]);
    const vectorize = createVectorizeMock([
      { id: "ssss", score: 0.99 },
      { id: "nsaid", score: 0.7 },
    ]);

    const suggestions = await suggestEditorFtsTerms(terms, "NSAIDs", {
      limit: 5,
      minScore: 0.05,
      ai,
      vectorize,
    });

    expect(suggestions.map((suggestion) => suggestion.term)).toEqual(["NSAIDs", "NSAID", "ssss"]);
    expect(suggestions.at(-1)).toMatchObject({
      term: "ssss",
      metrics: { partial: 0, embedding: 0.99 },
    });
    expect(suggestions.at(-1)?.score).toBeCloseTo(0.099);
  });

  it("builds expanded FTS terms grouped by segment", async () => {
    const terms = ["コンピューター", "検索", "コンピューターサイエンス", "京都", "PC"];

    const queryEmbedding = Array.from({ length: 1024 }, () => Math.random() - 0.5);
    const ai = createAiMock([queryEmbedding]);

    const vectorize = createVectorizeMock([
      { id: "コンピュタ", score: 0.9 },
      { id: "pc", score: 0.85 },
    ]);

    const termGroups = await buildExpandedFtsTerms(
      "コンピュータ",
      {
        limit: 5,
        minScore: 0.35,
        ai,
        vectorize,
      },
      terms,
    );

    // 2次元配列が返される（セグメントごとのグループ）
    expect(Array.isArray(termGroups)).toBe(true);
    expect(termGroups.length).toBe(1); // "コンピュータ"は1セグメント
    expect(Array.isArray(termGroups[0])).toBe(true);
    // 元のセグメント＋実際にインデックスされている類似キーワードが含まれる
    expect(termGroups[0]).toContain("コンピュータ");
    expect(termGroups[0]).toContain("コンピューター");
    expect(termGroups[0].length).toBeGreaterThan(1);
  });

  it("builds expanded FTS terms for multiple segments", async () => {
    const terms = ["コンピューター", "検索", "コンピューターサイエンス", "京都", "PC"];

    const ai = createAiMock([Array.from({ length: 1024 }, () => Math.random() - 0.5)]);
    const vectorize = createVectorizeMock([{ id: "コンピュタ", score: 0.9 }]);

    const termGroups = await buildExpandedFtsTerms(
      "コンピュータ 検索",
      {
        limit: 5,
        minScore: 0.35,
        ai,
        vectorize,
      },
      terms,
    );

    // 2つのセグメントグループが返される
    expect(termGroups.length).toBe(2);
    // 各グループは配列
    expect(Array.isArray(termGroups[0])).toBe(true);
    expect(Array.isArray(termGroups[1])).toBe(true);
  });

  it("can skip lexical vocab scans when building search term groups", async () => {
    const terms = ["マス", "スクリーニング", "マスク"];
    const ai = createAiMock([Array.from({ length: 1024 }, () => 0)]);
    const vectorize = createVectorizeMock([]);

    const termGroups = await buildExpandedFtsTerms(
      "マススクリーニング",
      {
        limit: 5,
        minScore: 0.05,
        ai,
        vectorize,
        includeLexicalSuggestions: false,
      },
      terms,
    );

    expect(termGroups).toEqual([["マス"], ["スクリーニング"]]);
  });

  it("limits vector-only search term groups", async () => {
    const terms = ["マス", "測定", "水", "機", "ス", "ガス", "人"];
    const ai = createAiMock([Array.from({ length: 1024 }, () => 0)]);
    const vectorize = createVectorizeMock([
      { id: "測定", score: 0.9 },
      { id: "水", score: 0.8 },
      { id: "機", score: 0.7 },
      { id: "ス", score: 0.6 },
      { id: "ガス", score: 0.5 },
      { id: "人", score: 0.4 },
    ]);

    const termGroups = await buildExpandedFtsTerms(
      "マス",
      {
        limit: 5,
        minScore: 0.05,
        ai,
        vectorize,
        includeLexicalSuggestions: false,
      },
      terms,
    );

    expect(termGroups).toHaveLength(1);
    expect(termGroups[0]).toHaveLength(5);
    expect(termGroups[0]).toContain("マス");
  });
});
