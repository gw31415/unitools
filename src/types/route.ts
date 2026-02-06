import type { JSONContent } from "@tiptap/core";
import type { User } from "@/db/schema";

export type RouteData = { kind: "auth" } | { kind: "page"; docId: string };

export type InitialRouteState = {
  docId: string;
  user: User | undefined;
  yjsUpdate?: string;
  snapshotJSON?: JSONContent;
};
