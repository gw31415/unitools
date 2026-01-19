import type { InitialEditorState } from "@/types/editor";

const root = document.querySelector("body");

declare global {
  interface Window {
    __INITIAL_EDITOR_STATE__?: InitialEditorState;
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

    const initialEditorState = window.__INITIAL_EDITOR_STATE__ ?? {
      initialDocUpdate: "",
      initialDocId: "",
      initialDocJSON: undefined,
    };

    function AppClient({ path }: { path: string }) {
      const [currentPath, setCurrentPath] = useState(path);
      if (
        currentPath !== path ||
        initialEditorState.initialDocId !== pathToDocId(path)
      ) {
        initialEditorState.initialDocUpdate = undefined;
        initialEditorState.initialDocJSON = undefined;
      }

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
      return <App path={currentPath} initialEditorState={initialEditorState} />;
    }
    hydrateRoot(root, <AppClient path={window.location.pathname} />);
  })();
}
