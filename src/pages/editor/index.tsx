import { hc } from "hono/client";
import { useAtomValue } from "jotai";
import { Clock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorSearchDock, type SearchDockItem } from "@/components/EditorSearchDock";
import Markdown from "@/components/Markdown";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { findEditorTextMatch, normalizeEditorSearchText } from "@/lib/editorTextMatch";
import { Header } from "@/pages/editor/Header";
import type { ServerAppType } from "@/server";
import { currentUserAtom, editorStateAtom, markdownBootstrapAtom } from "@/store";

const SIDEBAR_PAGE_SIZE = 20;
const SEARCH_SUGGESTION_SOCKET_PATH = "/api/v1/editor/search-suggestions";
const FOCUS_EDITOR_ON_LOAD_KEY = "focus-editor-on-load";
const SCROLL_TO_SEARCH_TEXT_ON_LOAD_KEY = "scroll-to-search-text-on-load";
const SCROLL_TO_IMAGE_ON_LOAD_KEY = "scroll-to-image-on-load";
const IMAGE_API_PATH_PREFIX = "/api/v1/images/";
const getClient = () =>
  typeof window === "undefined" ? null : hc<ServerAppType>(window.location.origin);

function getEditorRoot() {
  const root = document.querySelector('[aria-label="Main content editor/viewer of this page"]');
  return root instanceof HTMLElement ? root : null;
}

function focusEditorElement() {
  const root = getEditorRoot();
  if (!root) return;
  const editable = root.querySelector('[contenteditable="true"]') as HTMLElement | null;
  if (editable) {
    editable.focus({ preventScroll: true });
    return;
  }
  root.focus({ preventScroll: true });
}

function scrollToEditorText(searchText: string, attempt = 0) {
  const normalizedSearchText = normalizeEditorSearchText(searchText);
  if (!normalizedSearchText) return false;

  const root = getEditorRoot();
  const match = root ? findEditorTextMatch(root, searchText) : null;
  if (!root || !match) {
    if (attempt < 20) {
      window.setTimeout(() => scrollToEditorText(searchText, attempt + 1), 100);
    }
    return false;
  }

  const range = document.createRange();
  range.setStart(match.node, match.startOffset);
  range.setEnd(match.node, match.endOffset);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  const container =
    match.node.parentElement ??
    (match.node.parentNode instanceof HTMLElement ? match.node.parentNode : root);
  container.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  return true;
}

function scheduleScrollToEditorText(searchText: string) {
  const timers: number[] = [];
  for (const delay of [0, 100, 300, 700, 1200]) {
    timers.push(window.setTimeout(() => scrollToEditorText(searchText), delay));
  }
  return () => {
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
  };
}

function getImageIdFromElement(image: HTMLImageElement) {
  const sources = [image.getAttribute("data-src"), image.getAttribute("src")];

  for (const source of sources) {
    if (!source) continue;

    try {
      const pathname = new URL(source, window.location.origin).pathname;
      if (!pathname.startsWith(IMAGE_API_PATH_PREFIX)) continue;
      const imageId = pathname.slice(IMAGE_API_PATH_PREFIX.length).replace(/\/+$/, "");
      if (imageId) return imageId;
    } catch {
      continue;
    }
  }

  return null;
}

function scrollToEditorImage(imageId: string, attempt = 0) {
  const normalizedImageId = imageId.trim();
  if (!normalizedImageId) return false;

  const root = getEditorRoot();
  const image = root
    ? Array.from(root.querySelectorAll("img")).find(
        (image) => getImageIdFromElement(image) === normalizedImageId,
      )
    : null;

  if (!root || !image) {
    if (attempt < 20) {
      window.setTimeout(() => scrollToEditorImage(normalizedImageId, attempt + 1), 100);
    }
    return false;
  }

  const target = image.closest(".image-node-view") ?? image;
  if (target instanceof HTMLElement) {
    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    target.focus?.({ preventScroll: true });
  } else {
    image.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }
  return true;
}

type SearchDockPageInfo = {
  hasMore: boolean;
  nextCursor: string | null;
};

type SearchSuggestionSocketMessage =
  | {
      type: "items";
      keyword: string;
      items: SearchDockItem[];
      pageInfo: SearchDockPageInfo;
    }
  | {
      type: "error";
      keyword: string;
      message?: string;
    };

export default function DocumentPage() {
  const editorState = useAtomValue(editorStateAtom);
  const user = useAtomValue(currentUserAtom);
  const bootstrap = useAtomValue(markdownBootstrapAtom);
  const [searchValue, setSearchValue] = useState("");
  const [searchItems, setSearchItems] = useState<SearchDockItem[]>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(true);
  const [isSearchContentLoading, setIsSearchContentLoading] = useState(false);
  const [isSearchLoadingMore, setIsSearchLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchContentError, setSearchContentError] = useState<string | null>(null);
  const [isSearchAuthRequired, setIsSearchAuthRequired] = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchNextCursor, setSearchNextCursor] = useState<string | null>(null);
  const searchValueRef = useRef("");
  const searchSocketRef = useRef<WebSocket | null>(null);

  const fetchSearchItems = useCallback(
    async ({
      cursor,
      append = false,
    }: {
      cursor?: string | null;
      append?: boolean;
    } = {}) => {
      const client = getClient();
      if (!client) return null;
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
          return null;
        }
        if (!res.ok) {
          setSearchError("Failed to load articles.");
          return null;
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
        return { items, pageInfo };
      } catch (error) {
        console.error(error);
        setSearchError("Failed to load articles.");
        return null;
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

  useEffect(() => {
    searchValueRef.current = searchValue.trim();
  }, [searchValue]);

  const handleSearchSuggestionMessage = useCallback((message: SearchSuggestionSocketMessage) => {
    if (message.keyword !== searchValueRef.current) return;
    switch (message.type) {
      case "items":
        setSearchItems(message.items);
        setSearchHasMore(message.pageInfo.hasMore);
        setSearchNextCursor(message.pageInfo.nextCursor);
        setIsSearchLoading(false);
        setIsSearchContentLoading(false);
        setIsSearchAuthRequired(false);
        break;
      case "error":
        console.error(message.message ?? "Failed to load search suggestions.");
        setSearchError("Failed to load articles.");
        setIsSearchLoading(false);
        setIsSearchContentLoading(false);
        break;
    }
  }, []);

  const getSearchSuggestionSocket = useCallback(() => {
    if (typeof window === "undefined") return null;

    const currentSocket = searchSocketRef.current;
    if (
      currentSocket &&
      (currentSocket.readyState === WebSocket.OPEN ||
        currentSocket.readyState === WebSocket.CONNECTING)
    ) {
      return currentSocket;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${protocol}://${window.location.host}${SEARCH_SUGGESTION_SOCKET_PATH}`,
    );
    searchSocketRef.current = socket;

    socket.addEventListener("message", (event) => {
      try {
        handleSearchSuggestionMessage(JSON.parse(String(event.data)));
      } catch (error) {
        console.error(error);
        setSearchError("Failed to load articles.");
        setIsSearchLoading(false);
        setIsSearchContentLoading(false);
      }
    });
    socket.addEventListener("close", () => {
      if (searchSocketRef.current === socket) {
        searchSocketRef.current = null;
      }
    });
    socket.addEventListener("error", () => {
      if (searchSocketRef.current !== socket) return;
      setSearchError("Failed to load articles.");
      setIsSearchLoading(false);
      setIsSearchContentLoading(false);
    });

    return socket;
  }, [handleSearchSuggestionMessage]);

  const sendSearchSuggestionRequest = useCallback(
    (keyword: string) => {
      const socket = getSearchSuggestionSocket();
      if (!socket) return;

      const send = () => {
        if (keyword !== searchValueRef.current) return;
        socket.send(keyword);
      };

      if (socket.readyState === WebSocket.OPEN) {
        send();
        return;
      }

      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", send, { once: true });
      }
    },
    [getSearchSuggestionSocket],
  );

  const loadMoreSearchItems = useCallback(async () => {
    if (isSearchLoading || isSearchLoadingMore || !searchHasMore || !searchNextCursor) {
      return;
    }
    await fetchSearchItems({ cursor: searchNextCursor, append: true });
  }, [fetchSearchItems, isSearchLoading, isSearchLoadingMore, searchHasMore, searchNextCursor]);

  const refreshSearchItems = useCallback(async () => {
    const keyword = searchValue.trim();
    searchValueRef.current = keyword;
    setSearchContentError(null);

    if (!keyword) {
      setIsSearchContentLoading(false);
      searchSocketRef.current?.close();
      searchSocketRef.current = null;
      await fetchSearchItems();
      return;
    }

    setIsSearchLoading(true);
    setIsSearchContentLoading(true);
    setSearchError(null);
    setSearchContentError(null);
    setSearchHasMore(false);
    setSearchNextCursor(null);

    sendSearchSuggestionRequest(keyword);
  }, [fetchSearchItems, searchValue, sendSearchSuggestionRequest]);

  useEffect(() => {
    void refreshSearchItems();
  }, [refreshSearchItems]);

  useEffect(() => {
    return () => {
      searchSocketRef.current?.close();
      searchSocketRef.current = null;
    };
  }, []);

  const handleRequestFocusEditor = (options?: { searchText?: string; imageId?: string }) => {
    if (options?.imageId && scrollToEditorImage(options.imageId)) {
      return;
    }
    if (options?.searchText && scrollToEditorText(options.searchText)) {
      return;
    }
    focusEditorElement();
  };

  const handleNavigateToEditor = (
    editorId: string,
    options?: {
      focusEditor?: boolean;
      searchText?: string;
      imageId?: string;
    },
  ) => {
    const shouldFocusEditor = options?.focusEditor ?? true;
    if (shouldFocusEditor) {
      sessionStorage.setItem(FOCUS_EDITOR_ON_LOAD_KEY, "1");
    } else {
      sessionStorage.removeItem(FOCUS_EDITOR_ON_LOAD_KEY);
    }
    if (options?.searchText) {
      sessionStorage.setItem(SCROLL_TO_SEARCH_TEXT_ON_LOAD_KEY, options.searchText);
    } else {
      sessionStorage.removeItem(SCROLL_TO_SEARCH_TEXT_ON_LOAD_KEY);
    }
    if (options?.imageId) {
      sessionStorage.setItem(SCROLL_TO_IMAGE_ON_LOAD_KEY, options.imageId);
    } else {
      sessionStorage.removeItem(SCROLL_TO_IMAGE_ON_LOAD_KEY);
    }
    window.location.assign(`/editor/${editorId}`);
  };
  useEffect(() => {
    if (!editorState.editorId) return;
    const imageId = sessionStorage.getItem(SCROLL_TO_IMAGE_ON_LOAD_KEY);
    if (imageId) {
      sessionStorage.removeItem(SCROLL_TO_IMAGE_ON_LOAD_KEY);
      const searchText = sessionStorage.getItem(SCROLL_TO_SEARCH_TEXT_ON_LOAD_KEY);
      sessionStorage.removeItem(SCROLL_TO_SEARCH_TEXT_ON_LOAD_KEY);
      const timer = window.setTimeout(() => {
        if (!scrollToEditorImage(imageId) && searchText) {
          scrollToEditorText(searchText);
        }
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const searchText = sessionStorage.getItem(SCROLL_TO_SEARCH_TEXT_ON_LOAD_KEY);
    if (searchText) {
      sessionStorage.removeItem(SCROLL_TO_SEARCH_TEXT_ON_LOAD_KEY);
      return scheduleScrollToEditorText(searchText);
    }

    if (sessionStorage.getItem(FOCUS_EDITOR_ON_LOAD_KEY) !== "1") {
      return;
    }
    sessionStorage.removeItem(FOCUS_EDITOR_ON_LOAD_KEY);
    const timer = window.setTimeout(() => {
      focusEditorElement();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editorState.editorId]);

  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="flex min-h-0 flex-1 flex-col bg-(--markdown-surface)">
        {editorState.editorId ? (
          <>
            <div className="container mx-auto flex size-full max-w-4xl flex-1 flex-col px-4 sm:px-6 lg:px-8">
              <Markdown
                editorId={editorState.editorId}
                bootstrap={bootstrap}
                readonly={!user}
                tabIndex={-1}
                className="w-full flex-1 py-2"
                aria-label="Main content editor/viewer of this page"
              />
            </div>
            <div
              className="h-[env(safe-area-inset-bottom,0px)] w-full shrink-0 bg-background"
              aria-hidden="true"
            />
          </>
        ) : (
          <div className="container mx-auto size-full px-4 sm:px-6 lg:px-8">
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
        isSearchingContent={isSearchContentLoading}
        isLoadingMore={isSearchLoadingMore}
        hasMore={searchHasMore}
        isAuthRequired={isSearchAuthRequired}
        error={searchError}
        contentSearchError={searchContentError}
        onRetry={refreshSearchItems}
        onLoadMore={loadMoreSearchItems}
        currentEditorId={editorState.editorId}
        onRequestFocusEditor={handleRequestFocusEditor}
        onNavigateToEditor={handleNavigateToEditor}
      />
    </div>
  );
}
