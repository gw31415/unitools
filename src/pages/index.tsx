import { type ComponentType, Fragment } from "react";
import type { SSRStateType } from "@/store";

/**
 * Registry of available components for dynamic loading
 * Uses dynamic imports with proper path resolution at build time
 */
const pages = {
  EditorPage: () => import("@/pages/editor").then((m) => m.default),
  AuthPage: () =>
    import("@/pages/auth").then((m) => {
      const Comp = m.default;
      return () => <Comp redirect="/editor" />;
    }),
} as const;

export type ComponentName = keyof typeof pages;

/**
 * Load a component from the registry
 */
export async function loadComponent(
  state: SSRStateType,
): Promise<ComponentType> {
  return state.pageAtom ? pages[state.pageAtom]() : Fragment;
}

export default pages;
