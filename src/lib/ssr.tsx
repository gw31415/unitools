import { type Atom, createStore, Provider as JotaiProvider } from "jotai";

type SSRAtomType = Record<string, unknown>;

/**
 * Configuration for SSR atoms
 */
type SSRAtomState<T extends SSRAtomType> = {
  [K in keyof T]: Atom<T[K]>;
};

/**
 * SSR state that gets serialized/deserialized
 */
type SSRState<T extends SSRAtomType> = T;

/**
 * Get serialized state type of an SSRAtomState
 */
export type SSRStateOf<A> = A extends SSRAtomState<infer V> ? V : never;

/**
 * Provider that handles SSR hydration automatically
 * Creates a store with hydrated values on both server and client
 */
export function SSRProvider<T extends SSRAtomType>({
  children,
  config,
  ssrState,
}: {
  children: Parameters<typeof JotaiProvider>[0]["children"];
  config: SSRAtomState<T>;
  ssrState?: SSRState<T>;
}) {
  const isClient = typeof window !== "undefined";

  // Create store with initial values
  const store = isClient
    ? getHydratedStore(config)
    : getServerStore(config, ssrState || {});

  return <JotaiProvider store={store}>{children}</JotaiProvider>;
}

/**
 * Create a store with hydrated values on the client
 */
function getHydratedStore<T extends SSRAtomType>(config: SSRAtomState<T>) {
  const store = createStore();
  const ssrStateElement = document.getElementById("__SSR_STATE__");

  if (!ssrStateElement?.textContent) {
    console.warn("[SSR] No SSR state found in DOM");
    return store;
  }

  try {
    const state: SSRState<T> = JSON.parse(ssrStateElement.textContent);

    // Set each atom value in the store
    for (const [key, atom] of Object.entries(config)) {
      if (key in state) {
        const value = state[key] ?? undefined;
        store.set(atom, value);
      }
    }
  } catch (error) {
    console.error("[SSR] Failed to parse state:", error);
  }

  return store;
}

/**
 * Create a store with SSR values on the server
 */
function getServerStore<T extends SSRAtomType>(
  config: SSRAtomState<T>,
  state: SSRState<T>,
) {
  const store = createStore();

  // Set each atom value in the store
  for (const [key, atom] of Object.entries(config)) {
    if (key in state) {
      const value = state[key];
      store.set(atom, value);
    }
  }

  return store;
}

/**
 * Initialize SSRAtomState
 */
export function createSSRAtomState<T extends SSRAtomType>(
  atomMap: SSRAtomState<T>,
): SSRAtomState<T> {
  return atomMap;
}

/**
 * Initialize SSRState
 */
export function createSSRState<T extends SSRAtomType>(
  atomMap: SSRState<T>,
): SSRState<T> {
  return atomMap;
}
