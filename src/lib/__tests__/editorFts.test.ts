import { describe, expect, it, vi } from "vite-plus/test";
import { segmentText, suggestEditorFtsTerms, tokenize } from "@/lib/editorFts";

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
});
