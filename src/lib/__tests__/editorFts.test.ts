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
    // 元のセグメント（正規化）＋類似キーワードが含まれる
    expect(termGroups[0]).toContain("コンピュタ");
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
});
