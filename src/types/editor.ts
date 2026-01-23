import type { JSONContent } from "@tiptap/core";

export interface AppBootstrap {
  yjsUpdate?: string;
  docId: string;
  snapshotJSON?: JSONContent;
}
