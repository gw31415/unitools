import { hc } from "hono/client";
import { useAtomValue } from "jotai";
import { Clock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EditorSearchDock, type SearchDockItem } from "@/components/EditorSearchDock";
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
import { currentUserAtom, editorStateAtom, markdownBootstrapAtom } from "@/store";

const SIDEBAR_PAGE_SIZE = 20;
const FOCUS_EDITOR_ON_LOAD_KEY = "focus-editor-on-load";
const getClient = () =>
  typeof window === "undefined" ? null : hc<ServerAppType>(window.location.origin);

function focusEditorElement() {
  const root = document.querySelector('[aria-label="Main content editor/viewer of this page"]');
  if (!root) return;
  const editable = root.querySelector('[contenteditable="true"]') as HTMLElement | null;
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
  const [isSearchLoadingMore, setIsSearchLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearchAuthRequired, setIsSearchAuthRequired] = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchNextCursor, setSearchNextCursor] = useState<string | null>(null);

  const fetchSearchItems = useCallback(
    async ({ cursor, append = false }: { cursor?: string | null; append?: boolean } = {}) => {
      const client = getClient();
      if (!client) return;
      if (append) {
        setIsSearchLoadingMore(true);
      } else {
        setIsSearchLoading(true);
      }
      setSearchError(null);
      try {
        const res = await client.api.v1.editor.$get({
          query: {
            limit: String(SIDEBAR_PAGE_SIZE),
            ...(cursor ? { cursor } : {}),
          },
        });
        if (res.status === 401) {
          setIsSearchAuthRequired(true);
          setSearchItems([]);
          setSearchHasMore(false);
          setSearchNextCursor(null);
          return;
        }
        if (!res.ok) {
          setSearchError("Failed to load articles.");
          return;
        }
        const { items, pageInfo } = await res.json();
        setSearchItems((prev) => {
          if (!append) return items;
          const nextItems = [...prev];
          for (const item of items) {
            if (nextItems.some((existing) => existing.id === item.id)) continue;
            nextItems.push(item);
          }
          return nextItems;
        });
        setSearchHasMore(pageInfo.hasMore);
        setSearchNextCursor(pageInfo.nextCursor);
        setIsSearchAuthRequired(false);
      } catch (error) {
        console.error(error);
        setSearchError("Failed to load articles.");
      } finally {
        if (append) {
          setIsSearchLoadingMore(false);
        } else {
          setIsSearchLoading(false);
        }
      }
    },
    [],
  );

  const loadMoreSearchItems = useCallback(async () => {
    if (isSearchLoading || isSearchLoadingMore || !searchHasMore || !searchNextCursor) {
      return;
    }
    await fetchSearchItems({ cursor: searchNextCursor, append: true });
  }, [fetchSearchItems, isSearchLoading, isSearchLoadingMore, searchHasMore, searchNextCursor]);

  const refreshSearchItems = useCallback(async () => {
    await fetchSearchItems();
  }, [fetchSearchItems]);

  useEffect(() => {
    void refreshSearchItems();
  }, [refreshSearchItems]);

  const handleNavigateToEditor = (editorId: string, options?: { focusEditor?: boolean }) => {
    const shouldFocusEditor = options?.focusEditor ?? true;
    if (shouldFocusEditor) {
      sessionStorage.setItem(FOCUS_EDITOR_ON_LOAD_KEY, "1");
    } else {
      sessionStorage.removeItem(FOCUS_EDITOR_ON_LOAD_KEY);
    }
    window.location.assign(`/editor/${editorId}`);
  };
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
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className={`min-h-0 flex-1 ${editorState.editorId ? "bg-(--markdown-surface)" : ""}`}>
        {editorState.editorId ? (
          <div className="container mx-auto flex h-full w-full flex-col px-4 sm:px-6 lg:px-8">
            <div className="mx-auto flex h-full w-full max-w-4xl flex-col">
              <Markdown
                editorId={editorState.editorId}
                bootstrap={bootstrap}
                readonly={!user}
                tabIndex={-1}
                className="w-full flex-1 py-2"
                aria-label="Main content editor/viewer of this page"
              />
            </div>
          </div>
        ) : (
          <div className="container mx-auto h-full w-full px-4 sm:px-6 lg:px-8">
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
                      <a href="/auth">Login</a> is required to edit articles. You can view articles
                      from the search dock.
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
        isLoadingMore={isSearchLoadingMore}
        hasMore={searchHasMore}
        isAuthRequired={isSearchAuthRequired}
        error={searchError}
        onRetry={refreshSearchItems}
        onLoadMore={loadMoreSearchItems}
        currentEditorId={editorState.editorId}
        onRequestFocusEditor={focusEditorElement}
        onNavigateToEditor={handleNavigateToEditor}
      />
    </div>
  );
}
