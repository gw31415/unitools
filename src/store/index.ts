import { atom } from "jotai";
import { createSSRAtomState, type SSRStateOf } from "@/lib/ssr";
import type { User } from "@/models";
import type { ComponentName } from "@/pages";
import type { EditorState } from "@/types/route";

export const editorStateAtom = atom<EditorState>({
  docId: "",
  yjsUpdate: undefined,
  snapshotJSON: undefined,
});

export const currentUserAtom = atom<User | undefined>(undefined);

export const sidebarOpenAtom = atom<boolean>(true);

export const documentIdAtom = atom((get) => get(editorStateAtom).docId);

export const markdownBootstrapAtom = atom((get) => ({
  snapshotJSON: get(editorStateAtom).snapshotJSON,
  yjsUpdate: get(editorStateAtom).yjsUpdate,
}));

// Store the component name for client-side hydration
export const pageAtom = atom<ComponentName | undefined>(undefined);

// SSR configuration - defines which atoms to serialize/hydrate
export const ssrAtomState = createSSRAtomState({
  pageAtom,
  editorStateAtom,
  currentUserAtom,
  sidebarOpenAtom,
});

export type SSRStateType = SSRStateOf<typeof ssrAtomState>;
