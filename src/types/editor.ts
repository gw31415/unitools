import type { JSONContent } from "@tiptap/core";
import type { User } from "@/db/schema";

export interface AppBootstrap {
  yjsUpdate?: string;
  docId: string;
  snapshotJSON?: JSONContent;
  user: User | undefined;
}
