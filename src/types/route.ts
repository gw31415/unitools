import type { JSONContent } from "@tiptap/core";

export type EditorState = {
  editorId: string;
  yjsUpdate?: string;
  snapshotJSON?: JSONContent;
};
