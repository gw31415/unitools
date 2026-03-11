import { atom } from "jotai";
import { createSSRAtomState, type SSRStateOf } from "@/lib/ssr";
import type { EditorState, User } from "@/models";
import type { ComponentName } from "@/pages";

export const editorStateAtom = atom<EditorState>({
  editorId: "",
  createdAt: undefined,
  title: undefined,
  yjsUpdate: undefined,
  snapshotJSON: undefined,
});

export const currentUserAtom = atom<User | undefined>();

export const sidebarOpenAtom = atom<boolean>(true);

export const documentIdAtom = atom((get) => get(editorStateAtom).editorId);

export const markdownBootstrapAtom = atom((get) => ({
  snapshotJSON: get(editorStateAtom).snapshotJSON,
  yjsUpdate: get(editorStateAtom).yjsUpdate,
}));

// Store the component name for client-side hydration
export const pageAtom = atom<ComponentName | undefined>();

// Document title for SEO and page display
export const documentTitleAtom = atom<string | undefined>();

// SSR configuration - defines which atoms to serialize/hydrate
export const ssrAtomState = createSSRAtomState({
  pageAtom,
  editorStateAtom,
  currentUserAtom,
  sidebarOpenAtom,
  documentTitleAtom,
});

export type SSRStateType = SSRStateOf<typeof ssrAtomState>;
