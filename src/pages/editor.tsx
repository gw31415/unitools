import { hc } from "hono/client";
import { useAtomValue } from "jotai";
import { Clock, Menu, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/Header";
import Markdown from "@/components/Markdown";
import {
  SideMenu,
  SideMenuProvider,
  SideMenuTrigger,
} from "@/components/SideMenu";
import { Button } from "@/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import type { ServerAppType } from "@/server";
import {
  currentUserAtom,
  editorStateAtom,
  markdownBootstrapAtom,
} from "@/store";

const SIDEBAR_PAGE_SIZE = 20;

type EditorListItem = {
  id: string;
  createdAt: number;
};

const sidebarDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const formatSidebarLabel = (item: EditorListItem) => {
  const date = new Date(item.createdAt);
  const dateLabel = Number.isNaN(date.getTime())
    ? "Invalid date"
    : sidebarDateFormatter.format(date).replaceAll("/", "-");
  return `${dateLabel} · ${item.id.slice(-6)}`;
};

export default function DocumentPage() {
  const editorState = useAtomValue(editorStateAtom);
  const user = useAtomValue(currentUserAtom);
  const bootstrap = useAtomValue(markdownBootstrapAtom);

  return (
    <SideMenuProvider>
      <div className="h-svh flex flex-col">
        <Header user={user} />
        <Markdown
          docId={editorState.docId}
          bootstrap={bootstrap}
          readonly={!user}
          className="px-4 py-2 size-full pb-15 md:pb-2"
          aria-label="Main content editor/viewer of this page"
        />
        <SideMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="rounded-full fixed bottom-4 left-4 z-50 md:hidden"
            aria-label="Open drawer menu"
          >
            <Menu />
          </Button>
        </SideMenuTrigger>
      </div>
      <SideMenu className="gap-0 overflow-hidden">
        <SidebarHeader className="shrink-0">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <SidebarInput placeholder="Search articles..." className="pl-9" />
          </div>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarGroup className="min-h-0 flex-1">
          <SidebarGroupLabel>Past articles</SidebarGroupLabel>
          <EditorSidebarMenu currentDocId={editorState.docId} />
        </SidebarGroup>
      </SideMenu>
    </SideMenuProvider>
  );
}

function EditorSidebarMenu({ currentDocId }: { currentDocId: string }) {
  const client = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : hc<ServerAppType>(window.location.origin),
    [],
  );
  const seenIdsRef = useRef(new Set<string>());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  const [items, setItems] = useState<EditorListItem[]>([]);
  const [pageInfo, setPageInfo] = useState<{
    hasMore: boolean;
    nextCursor: string | null;
  } | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [isAuthRequired, setIsAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (args: { cursor: string | null; initial: boolean }) => {
      if (!client) return;

      if (args.initial) {
        setIsInitialLoading(true);
      } else {
        setIsFetchingMore(true);
      }
      setError(null);

      try {
        const query = args.cursor
          ? { limit: String(SIDEBAR_PAGE_SIZE), cursor: args.cursor }
          : { limit: String(SIDEBAR_PAGE_SIZE) };
        const res = await client.api.v1.editor.$get({ query });

        if (!mountedRef.current) return;

        if (res.status === 401) {
          setIsAuthRequired(true);
          setPageInfo({
            hasMore: false,
            nextCursor: pageInfo?.nextCursor ?? null,
          });
          return;
        }
        if (!res.ok) {
          setError("Failed to load articles.");
          return;
        }

        const { items, pageInfo: pageInfoData } = await res.json();
        const nextSeen = args.initial
          ? new Set<string>()
          : new Set(seenIdsRef.current);

        setItems((prev) => {
          const merged = args.initial ? [] : [...prev];
          for (const item of items) {
            if (nextSeen.has(item.id)) continue;
            nextSeen.add(item.id);
            merged.push(item);
          }
          return merged;
        });
        seenIdsRef.current = nextSeen;
        setPageInfo(pageInfoData);
        setIsAuthRequired(false);
      } catch (fetchError) {
        console.error(fetchError);
        if (!mountedRef.current) return;
        setError("Failed to load articles.");
      } finally {
        if (mountedRef.current) {
          if (args.initial) {
            setIsInitialLoading(false);
          } else {
            setIsFetchingMore(false);
          }
        }
      }
    },
    [client, pageInfo?.nextCursor],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!client) return;
    seenIdsRef.current.clear();
    void fetchPage({ cursor: null, initial: true });
  }, [client, fetchPage]);

  useEffect(() => {
    const root = scrollRootRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (!visible) return;
        if (
          !pageInfo?.hasMore ||
          isFetchingMore ||
          isInitialLoading ||
          isAuthRequired
        ) {
          return;
        }
        if (!pageInfo?.nextCursor) return;
        fetchPage({ cursor: pageInfo.nextCursor, initial: false });
      },
      { root, rootMargin: "240px 0px 240px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchPage, isAuthRequired, isFetchingMore, isInitialLoading, pageInfo]);

  const handleRetry = useCallback(() => {
    if (isInitialLoading || isFetchingMore) return;
    if (items.length === 0) {
      void fetchPage({ cursor: null, initial: true });
      return;
    }
    if (!pageInfo?.nextCursor) return;
    void fetchPage({ cursor: pageInfo.nextCursor, initial: false });
  }, [fetchPage, isFetchingMore, isInitialLoading, items.length, pageInfo]);

  return (
    <SidebarGroupContent className="min-h-0 flex-1">
      <div ref={scrollRootRef} className="h-full min-h-0 overflow-y-auto pr-1">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton asChild isActive={item.id === currentDocId}>
                <a href={`/editor/${item.id}`}>
                  <Clock />
                  <span>{formatSidebarLabel(item)}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}

          {isInitialLoading ? (
            <>
              <SidebarMenuSkeleton showIcon />
              <SidebarMenuSkeleton showIcon />
            </>
          ) : null}

          {!isInitialLoading &&
          !error &&
          !isAuthRequired &&
          items.length === 0 ? (
            <SidebarMenuItem>
              <div className="text-muted-foreground text-xs m-2">
                No articles yet.
              </div>
            </SidebarMenuItem>
          ) : null}

          {error ? (
            <SidebarMenuItem>
              <div className="text-muted-foreground text-xs m-2 flex items-center gap-2">
                <span>{error}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleRetry}
                >
                  Retry
                </Button>
              </div>
            </SidebarMenuItem>
          ) : null}

          {isAuthRequired ? (
            <SidebarMenuItem>
              <div className="text-muted-foreground text-xs m-2">
                Login is required.
              </div>
            </SidebarMenuItem>
          ) : null}

          {isFetchingMore ? (
            <SidebarMenuItem>
              <div className="text-muted-foreground text-xs flex m-2 gap-2">
                <Spinner />
                <span>Loading more articles...</span>
              </div>
            </SidebarMenuItem>
          ) : null}

          <SidebarMenuItem>
            <div ref={sentinelRef} className="h-1 w-full" />
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
    </SidebarGroupContent>
  );
}
