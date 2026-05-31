import { type ComponentType, Fragment } from "react";
import type { SSRStateType } from "@/store";

const pages = {
  EditorPage: () => import("@/pages/editor").then((m) => m.default),
  AuthPage: () =>
    import("@/pages/auth").then((m) => {
      const Comp = m.default;
      return () => <Comp redirect="/editor" />;
    }),
} as const;

export type ComponentName = keyof typeof pages;

export async function loadComponent(state: SSRStateType): Promise<ComponentType> {
  return state.pageAtom ? pages[state.pageAtom]() : Fragment;
}
