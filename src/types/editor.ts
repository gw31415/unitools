import type { JSONContent } from "@tiptap/core";

export interface InitialEditorState {
  initialDocUpdate?: string;
  initialDocId: string;
  initialDocJSON?: JSONContent;
}
