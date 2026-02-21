import { hc } from "hono/client";
import { useAtomValue } from "jotai";
import { Clock } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EditorSearchDock,
  type SearchDockItem,
} from "@/components/EditorSearchDock";
import { Header } from "@/components/Header";
import Markdown from "@/components/Markdown";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { formatEditorLabel } from "@/lib/editorLabel";
import type { ServerAppType } from "@/server";
import {
  currentUserAtom,
  editorStateAtom,
  markdownBootstrapAtom,
} from "@/store";

const SIDEBAR_PAGE_SIZE = 20;
const FOCUS_EDITOR_ON_LOAD_KEY = "focus-editor-on-load";

export default function DocumentPage() {
  const editorState = useAtomValue(editorStateAtom);
  const user = useAtomValue(currentUserAtom);
  const bootstrap = useAtomValue(markdownBootstrapAtom);
  const client = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : hc<ServerAppType>(window.location.origin),
    [],
  );
  const [searchValue, setSearchValue] = useState("");
  const [searchItems, setSearchItems] = useState<SearchDockItem[]>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearchAuthRequired, setIsSearchAuthRequired] = useState(false);

  const fetchSearchItems = useCallback(async () => {
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
  }, [client]);

  const handleFocusEditor = useCallback(() => {
    const root = document.querySelector(
      '[aria-label="Main content editor/viewer of this page"]',
    );
    if (!root) return;
    const editable = root.querySelector(
      '[contenteditable="true"]',
    ) as HTMLElement | null;
    if (editable) {
      editable.focus();
      return;
    }
    if (root instanceof HTMLElement) {
      root.focus();
    }
  }, []);

  const handleNavigateToEditor = useCallback(
    (editorId: string, options?: { focusEditor?: boolean }) => {
      const shouldFocusEditor = options?.focusEditor ?? true;
      if (shouldFocusEditor) {
        sessionStorage.setItem(FOCUS_EDITOR_ON_LOAD_KEY, "1");
      } else {
        sessionStorage.removeItem(FOCUS_EDITOR_ON_LOAD_KEY);
      }
      window.location.assign(`/editor/${editorId}`);
    },
    [],
  );

  useEffect(() => {
    if (!client) return;
    void fetchSearchItems();
  }, [client, fetchSearchItems]);

  useEffect(() => {
    if (!editorState.editorId) return;
    if (sessionStorage.getItem(FOCUS_EDITOR_ON_LOAD_KEY) !== "1") return;
    sessionStorage.removeItem(FOCUS_EDITOR_ON_LOAD_KEY);
    const timer = window.setTimeout(() => {
      handleFocusEditor();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editorState.editorId, handleFocusEditor]);

  const headerTitle = editorState.editorId
    ? formatEditorLabel({
        id: editorState.editorId,
        createdAt: editorState.createdAt ?? Number.NaN,
        title: editorState.title,
      })
    : "";
  const headerFallbackTitle = editorState.editorId
    ? formatEditorLabel({
        id: editorState.editorId,
        createdAt: editorState.createdAt ?? Number.NaN,
      })
    : "";

  return (
    <div className="min-h-svh flex flex-col">
      <Header
        user={user}
        title={headerTitle}
        fallbackTitle={headerFallbackTitle}
        editorId={editorState.editorId || undefined}
        initialTitle={editorState.title}
      />
      <main
        className={`flex-1 min-h-0 ${
          editorState.editorId ? "bg-(--markdown-surface)" : ""
        }`}
      >
        {editorState.editorId ? (
          <div className="container mx-auto w-full px-4 sm:px-6 lg:px-8 h-full">
            <div className="mx-auto w-full max-w-4xl h-full">
              <Markdown
                editorId={editorState.editorId}
                bootstrap={bootstrap}
                readonly={!user}
                tabIndex={-1}
                className="w-full py-2 pb-24"
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
                      <a href="/auth">Login</a>
                      is required to edit articles. You can view articles from
                      the search dock.
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
        onRequestFocusEditor={handleFocusEditor}
        onNavigateToEditor={handleNavigateToEditor}
      />
    </div>
  );
}
