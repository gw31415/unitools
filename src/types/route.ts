import type { JSONContent } from "@tiptap/core";

export type EditorState = {
  docId: string;
  yjsUpdate?: string;
  snapshotJSON?: JSONContent;
};
