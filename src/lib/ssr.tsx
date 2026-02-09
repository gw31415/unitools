import type { Atom, WritableAtom } from "jotai";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ReactNode } from "react";

/**
 * Configuration for SSR atoms
 */
interface SSRAtomConfig<T = unknown> {
  atom: WritableAtom<T, [T | undefined], unknown>;
  key: string;
}

/**
 * SSR state that gets serialized/deserialized
 */
type SSRState = Record<string, unknown>;

/**
 * Provider that handles SSR hydration automatically
 * Creates a store with hydrated values on both server and client
 */
export function SSRProvider({
  children,
  config,
  ssrState,
}: {
  children: ReactNode;
  config: SSRAtomConfig[];
  ssrState?: SSRState;
}) {
  const isClient = typeof window !== "undefined";

  // Create store with initial values
  const store = isClient
    ? getHydratedStore(config)
    : getServerStore(config, ssrState || {});

  if (isClient) {
    console.log("[SSR Provider] Created store with hydrated values");
  } else {
    console.log("[SSR Provider] Created server store with SSR state");
  }

  return <JotaiProvider store={store}>{children}</JotaiProvider>;
}

/**
 * Create a store with hydrated values on the client
 */
function getHydratedStore(config: SSRAtomConfig[]) {
  const store = createStore();
  const ssrStateElement = document.getElementById("__SSR_STATE__");

  if (!ssrStateElement?.textContent) {
    console.warn("[SSR] No SSR state found in DOM");
    return store;
  }

  try {
    const state: SSRState = JSON.parse(ssrStateElement.textContent);
    console.log("[SSR] Parsed SSR state:", state);

    // Set each atom value in the store
    for (const { key, atom } of config) {
      if (key in state) {
        const value = state[key] === null ? undefined : state[key];
        store.set(atom, value);
        console.log(`[SSR] Set atom "${key}":`, value);
      }
    }

    console.log("[SSR] Store hydrated with", config.length, "atoms");
  } catch (error) {
    console.error("[SSR] Failed to parse state:", error);
  }

  return store;
}

/**
 * Create a store with SSR values on the server
 */
function getServerStore(config: SSRAtomConfig[], state: SSRState) {
  const store = createStore();

  // Set each atom value in the store
  for (const { key, atom } of config) {
    if (key in state) {
      const value = state[key] === null ? undefined : state[key];
      store.set(atom, value);
    }
  }

  return store;
}

/**
 * Serialize atom values for SSR
 * Note: When using this in React, pass the result as children of a script tag,
 * and React will automatically handle escaping
 */
export function serializeSSRState(values: Record<string, unknown>): string {
  return JSON.stringify(values);
}

/**
 * Type-safe helper to create SSR-enabled app
 */
export interface SSRAppContext<T extends Record<string, unknown>> {
  config: SSRAtomConfig[];
  getState: (values: T) => SSRState;
}

/**
 * Create SSR configuration
 */
export function createSSRConfig<T extends Record<string, unknown>>(
  atomMap: { [K in keyof T]: { key: string; atom: Atom<T[K]> } },
): SSRAppContext<T> {
  const config = Object.values(atomMap).map(
    (v: { key: string; atom: WritableAtom<unknown, [unknown], unknown> }) => ({
      key: v.key,
      atom: v.atom,
    }),
  );

  const getState = (values: T): SSRState => {
    const state: SSRState = {};
    for (const [key, value] of Object.entries(values)) {
      // Include all values, even undefined, by converting to null
      // JSON.stringify drops undefined but keeps null
      state[key] = value === undefined ? null : value;
    }
    return state;
  };

  return { config, getState };
}
