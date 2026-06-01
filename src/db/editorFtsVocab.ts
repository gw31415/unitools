import { tokenize } from "@/lib/editorFts";
import type { ULID } from "@/lib/ulid";

export type EditorFtsSearchMatch = {
  editorId: ULID;
  text: string;
};

export type EditorFtsVocabSuggestion = {
  term: string;
  normalizedTerm: string;
  score: number;
  metrics: {
    partial: number;
    embedding: number;
  };
};

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

export async function listEditorFtsVocab(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare("SELECT term FROM editors_fts_vocab ORDER BY term ASC")
    .all<{ term: string }>();

  return result.results.map((row) => row.term);
}
