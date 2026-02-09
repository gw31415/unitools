import { atom } from "jotai";
import type { User } from "@/db/schema";
import { createSSRConfig } from "@/lib/ssr";
import type { EditorState } from "@/types/route";

export const editorStateAtom = atom<EditorState>({
  docId: "",
  yjsUpdate: undefined,
  snapshotJSON: undefined,
});

export const currentUserAtom = atom<User | undefined>(undefined);

export const documentIdAtom = atom((get) => get(editorStateAtom).docId);

export const markdownBootstrapAtom = atom((get) => ({
  snapshotJSON: get(editorStateAtom).snapshotJSON,
  yjsUpdate: get(editorStateAtom).yjsUpdate,
}));

// SSR configuration - defines which atoms to serialize/hydrate
export const ssrConfig = createSSRConfig({
  editorState: { key: "editorState", atom: editorStateAtom },
  user: { key: "user", atom: currentUserAtom },
});
