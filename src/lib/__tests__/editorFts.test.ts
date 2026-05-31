import { describe, expect, it, vi } from "vite-plus/test";
import {
  listEditorFtsTerms,
  searchEditorFtsIndex,
  segmentText,
  suggestEditorFtsTerms,
  tokenize,
  upsertEditorFtsIndex,
} from "@/lib/editorFts";
import type { ULID } from "@/lib/ulid";

const editorId = "01H00000000000000000000002" as ULID;

function createD1Mock(rows: Array<{ editor_id: ULID; content: string }> = []) {
  const run = vi.fn().mockResolvedValue({});
  const all = vi.fn().mockResolvedValue({ results: rows });
  const bind = vi.fn(() => ({ run, all }));
  const prepare = vi.fn(() => ({ bind }));

  return {
    db: { prepare } as unknown as D1Database,
    prepare,
    bind,
    run,
    all,
  };
}

function createTermD1Mock(rows: Array<{ term: string; doc: number; cnt: number }>) {
  const run = vi.fn().mockResolvedValue({});
  const all = vi.fn().mockResolvedValue({ results: rows });
  const bind = vi.fn(() => ({ run, all }));
  const prepare = vi.fn(() => ({ bind, run, all }));

  return {
    db: { prepare } as unknown as D1Database,
    prepare,
    bind,
    run,
    all,
  };
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
  it("deletes stale index before inserting tokenized content", async () => {
    const mock = createD1Mock();

    await upsertEditorFtsIndex(mock.db, editorId, "Alpha Beta");

    expect(mock.prepare).toHaveBeenNthCalledWith(
      1,
      "DELETE FROM editors_fts_index WHERE editor_id = ?",
    );
    expect(mock.bind).toHaveBeenNthCalledWith(1, editorId);
    expect(mock.prepare).toHaveBeenNthCalledWith(
      2,
      "INSERT INTO editors_fts_index (editor_id, content) VALUES (?, ?)",
    );
    expect(mock.bind).toHaveBeenNthCalledWith(2, editorId, "Alpha Beta");
  });

  it("skips insert when tokenized content is empty", async () => {
    const mock = createD1Mock();

    await upsertEditorFtsIndex(mock.db, editorId, "、。!");

    expect(mock.prepare).toHaveBeenCalledTimes(1);
    expect(mock.run).toHaveBeenCalledTimes(1);
  });

  it("tokenizes keyword before querying MATCH", async () => {
    const mock = createD1Mock([{ editor_id: editorId, content: "Alpha Beta" }]);

    await expect(searchEditorFtsIndex(mock.db, "Alpha   Beta", 20)).resolves.toEqual([
      { editorId, text: "Alpha Beta" },
    ]);
    expect(mock.prepare).toHaveBeenCalledWith(
      "SELECT editor_id, content FROM editors_fts_index WHERE editors_fts_index MATCH ? LIMIT ?",
    );
    expect(mock.bind).toHaveBeenCalledWith("Alpha Beta", 20);
  });

  it("segments Japanese keyword with the index tokenizer before querying MATCH", async () => {
    const mock = createD1Mock([{ editor_id: editorId, content: "東京 都 で 検索" }]);

    await expect(searchEditorFtsIndex(mock.db, "東京都で検索", 20)).resolves.toEqual([
      { editorId, text: "東京 都 で 検索" },
    ]);
    expect(mock.bind).toHaveBeenCalledWith("東京 都 で 検索", 20);
  });

  it("lists indexed terms from fts5vocab", async () => {
    const mock = createTermD1Mock([
      { term: "検索", doc: 2, cnt: 4 },
      { term: "東京", doc: 1, cnt: 1 },
    ]);

    await expect(listEditorFtsTerms(mock.db)).resolves.toEqual([
      { term: "検索", docCount: 2, occurrenceCount: 4 },
      { term: "東京", docCount: 1, occurrenceCount: 1 },
    ]);
    expect(mock.prepare).toHaveBeenNthCalledWith(
      2,
      "SELECT term, doc, cnt FROM temp.editors_fts_vocab ORDER BY cnt DESC, term ASC",
    );
  });

  it("falls back to indexed content when fts5vocab is unavailable", async () => {
    const run = vi.fn().mockRejectedValue(new Error("unsupported"));
    const all = vi.fn().mockResolvedValue({
      results: [{ content: "検索 東京 検索" }, { content: "検索 京都" }],
    });
    const prepare = vi.fn().mockReturnValueOnce({ run }).mockReturnValueOnce({ all });
    const db = { prepare } as unknown as D1Database;

    await expect(listEditorFtsTerms(db)).resolves.toEqual([
      { term: "検索", docCount: 2, occurrenceCount: 3 },
      { term: "京都", docCount: 1, occurrenceCount: 1 },
      { term: "東京", docCount: 1, occurrenceCount: 1 },
    ]);
  });

  it("suggests normalized and partial term matches by score", async () => {
    const mock = createTermD1Mock([
      { term: "コンピューター", doc: 2, cnt: 5 },
      { term: "検索", doc: 3, cnt: 7 },
      { term: "コンピューターサイエンス", doc: 1, cnt: 1 },
      { term: "京都", doc: 1, cnt: 1 },
    ]);

    const suggestions = await suggestEditorFtsTerms(mock.db, "コンピュータ", {
      limit: 3,
      minScore: 0.2,
    });

    expect(suggestions.map((suggestion) => suggestion.term)).toEqual([
      "コンピューター",
      "コンピューターサイエンス",
    ]);
    expect(suggestions[0]?.score).toBeGreaterThan(suggestions[1]?.score ?? 0);
    expect(suggestions[0]?.normalizedTerm).toBe("コンピュタ");
  });
});
