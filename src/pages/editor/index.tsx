import { hc } from "hono/client";
import { useAtomValue } from "jotai";
import { Clock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  EditorSearchDock,
  type SearchDockItem,
} from "@/components/EditorSearchDock";
import Markdown from "@/components/Markdown";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Header } from "@/pages/editor/Header";
import type { ServerAppType } from "@/server";
import {
  currentUserAtom,
  editorStateAtom,
  markdownBootstrapAtom,
} from "@/store";

const SIDEBAR_PAGE_SIZE = 20;
const FOCUS_EDITOR_ON_LOAD_KEY = "focus-editor-on-load";
const getClient = () =>
  typeof window === "undefined"
    ? null
    : hc<ServerAppType>(window.location.origin);

function focusEditorElement() {
  const root = document.querySelector(
    '[aria-label="Main content editor/viewer of this page"]',
  );
  if (!root) return;
  const editable = root.querySelector(
    '[contenteditable="true"]',
  ) as HTMLElement | null;
  if (editable) {
    editable.focus({ preventScroll: true });
    return;
  }
  if (root instanceof HTMLElement) {
    root.focus({ preventScroll: true });
  }
}

export default function DocumentPage() {
  const editorState = useAtomValue(editorStateAtom);
  const user = useAtomValue(currentUserAtom);
  const bootstrap = useAtomValue(markdownBootstrapAtom);
  const [searchValue, setSearchValue] = useState("");
  const [searchItems, setSearchItems] = useState<SearchDockItem[]>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearchAuthRequired, setIsSearchAuthRequired] = useState(false);

  const fetchSearchItems = useCallback(async () => {
    const client = getClient();
    if (!client) return;
    setIsSearchLoading(true);
    setSearchError(null);
    try {
      const res = await client.api.v1.editor.$get({
        query: { limit: String(SIDEBAR_PAGE_SIZE) },
      });
      if (res.status === 401) {
        setIsSearchAuthRequired(true);
        setSearchItems([]);
        return;
      }
      if (!res.ok) {
        setSearchError("Failed to load articles.");
        return;
      }
      const { items } = await res.json();
      setSearchItems(items);
      setIsSearchAuthRequired(false);
    } catch (error) {
      console.error(error);
      setSearchError("Failed to load articles.");
    } finally {
      setIsSearchLoading(false);
    }
  }, []);

  const handleNavigateToEditor = (
    editorId: string,
    options?: { focusEditor?: boolean },
  ) => {
    const shouldFocusEditor = options?.focusEditor ?? true;
    if (shouldFocusEditor) {
      sessionStorage.setItem(FOCUS_EDITOR_ON_LOAD_KEY, "1");
    } else {
      sessionStorage.removeItem(FOCUS_EDITOR_ON_LOAD_KEY);
    }
    window.location.assign(`/editor/${editorId}`);
  };

  useEffect(() => {
    void fetchSearchItems();
  }, [fetchSearchItems]);

  useEffect(() => {
    if (!editorState.editorId) return;
    if (sessionStorage.getItem(FOCUS_EDITOR_ON_LOAD_KEY) !== "1") return;
    sessionStorage.removeItem(FOCUS_EDITOR_ON_LOAD_KEY);
    const timer = window.setTimeout(() => {
      focusEditorElement();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editorState.editorId]);

  return (
    <div className="min-h-dvh flex flex-col">
      <Header />
      <main
        className={`flex-1 min-h-0 ${
          editorState.editorId ? "bg-(--markdown-surface)" : ""
        }`}
      >
        {editorState.editorId ? (
          <div className="container mx-auto w-full px-4 sm:px-6 lg:px-8 h-full flex flex-col">
            <div className="mx-auto w-full max-w-4xl h-full flex flex-col">
              <Markdown
                editorId={editorState.editorId}
                bootstrap={bootstrap}
                readonly={!user}
                tabIndex={-1}
                className="w-full py-2 flex-1"
                aria-label="Main content editor/viewer of this page"
              />
            </div>
          </div>
        ) : (
          <div className="container mx-auto w-full px-4 sm:px-6 lg:px-8 h-full">
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Clock />
                </EmptyMedia>
                <EmptyTitle>
                  {user ? `Welcome, ${user.username}` : "Welcome to Unitools"}
                </EmptyTitle>
                <EmptyDescription>
                  {user ? (
                    "Use the search dock below to open an article."
                  ) : (
                    <>
                      <a href="/auth">Login</a> is required to edit articles.
                      You can view articles from the search dock.
                    </>
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </main>
      <EditorSearchDock
        value={searchValue}
        onValueChange={setSearchValue}
        items={searchItems}
        isLoading={isSearchLoading}
        isAuthRequired={isSearchAuthRequired}
        error={searchError}
        onRetry={fetchSearchItems}
        currentEditorId={editorState.editorId}
        onRequestFocusEditor={focusEditorElement}
        onNavigateToEditor={handleNavigateToEditor}
      />
    </div>
  );
}
