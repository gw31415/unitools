import { describe, expect, it, vi } from "vite-plus/test";
import { searchEditorFtsIndex, tokenize, upsertEditorFtsIndex } from "@/lib/editorFts";
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
});
