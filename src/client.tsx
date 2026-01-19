const root = document.querySelector("body");

declare global {
  interface Window {
    __INITIAL_DOC_UPDATE__?: string;
    __INITIAL_DOC_ID__?: string;
    __INITIAL_DOC_JSON__?: unknown;
  }
}

if (root) {
  document.addEventListener("click", (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const target = event.target as Element | null;
    const anchor = target?.closest("a");
    if (!anchor) return;
    if (anchor.target && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download")) return;

    const href = anchor.getAttribute("href");
    if (!href || !href.startsWith("/")) return;

    event.preventDefault();
    history.pushState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  (async () => {
    const [{ App, pathToDocId }, { hydrateRoot }, { useEffect, useState }] =
      await Promise.all([
        import("@/app"),
        import("react-dom/client"),
        import("react"),
      ]);

    const initialDocUpdate = window.__INITIAL_DOC_UPDATE__ ?? "";
    const initialDocId = window.__INITIAL_DOC_ID__ ?? "";
    const initialDocJSON = window.__INITIAL_DOC_JSON__ ?? null;

    function AppClient({ path }: { path: string }) {
      const [currentPath, setCurrentPath] = useState(path);
      const initialDocUpdateForPath =
        currentPath === path && initialDocId === pathToDocId(path)
          ? initialDocUpdate
          : undefined;
      const initialDocJSONForPath =
        currentPath === path && initialDocId === pathToDocId(path)
          ? initialDocJSON
          : null;

      useEffect(() => {
        const onPopState = () => {
          setCurrentPath(window.location.pathname);
        };

        window.addEventListener("popstate", onPopState);
        return () => {
          window.removeEventListener("popstate", onPopState);
        };
      }, []);

      useEffect(() => {
        setCurrentPath(path);
      }, [path]);
      return (
        <App
          path={currentPath}
          initialDocUpdate={initialDocUpdateForPath}
          initialDocJSON={initialDocJSONForPath}
        />
      );
    }
    hydrateRoot(root, <AppClient path={window.location.pathname} />);
  })();
}
