import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type SearchDockItem = {
  id: string;
  createdAt: number;
};

const sidebarDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatSidebarLabel(item: SearchDockItem) {
  const date = new Date(item.createdAt);
  const dateLabel = Number.isNaN(date.getTime())
    ? "Invalid date"
    : sidebarDateFormatter.format(date).replaceAll("/", "-");
  return `${dateLabel} · ${item.id.slice(-6)}`;
}

export function EditorSearchDock({
  value,
  onValueChange,
  items,
  isLoading,
  isAuthRequired,
  error,
  onRetry,
  currentEditorId,
  onRequestFocusEditor,
  onNavigateToEditor,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: SearchDockItem[];
  isLoading: boolean;
  isAuthRequired: boolean;
  error: string | null;
  onRetry: () => void;
  currentEditorId: string;
  onRequestFocusEditor: () => void;
  onNavigateToEditor: (editorId: string) => void;
}) {
  const DOCK_SPACING = 8;
  const SEARCH_BUTTON_SIZE = 40;
  const FAB_SIZE = SEARCH_BUTTON_SIZE + DOCK_SPACING * 2;
  const DOCK_MAX_WIDTH = 672;
  const OUTER_GUTTER = 16;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === "undefined" ? 1024 : window.innerWidth,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const suppressOpenOnChangeRef = useRef(false);
  const normalizedQuery = value.trim().toLowerCase();
  const openSearch = useCallback((selectText = true) => {
    setOpen(true);
    window.setTimeout(() => {
      inputRef.current?.focus();
      if (selectText) {
        inputRef.current?.select();
      }
    }, 0);
  }, []);
  const panelItems =
    normalizedQuery.length === 0
      ? items.slice(0, 6)
      : items
          .filter((item) =>
            formatSidebarLabel(item).toLowerCase().includes(normalizedQuery),
          )
          .slice(0, 6);
  const selectItem = useCallback(
    (item: SearchDockItem) => {
      if (item.id === currentEditorId) {
        setOpen(false);
        inputRef.current?.blur();
        onRequestFocusEditor();
        return;
      }
      setOpen(false);
      onNavigateToEditor(item.id);
    },
    [currentEditorId, onNavigateToEditor, onRequestFocusEditor],
  );

  useEffect(() => {
    if (!open || panelItems.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((prev) => Math.min(prev, panelItems.length - 1));
  }, [open, panelItems.length]);

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [openSearch]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const openDockWidth = Math.max(
    FAB_SIZE,
    Math.min(DOCK_MAX_WIDTH, viewportWidth - OUTER_GUTTER * 2),
  );
  const dockWidth = open ? openDockWidth : FAB_SIZE;
  const translateX = open
    ? Math.max(0, (viewportWidth - dockWidth) / 2 - OUTER_GUTTER)
    : 0;

  return (
    <div
      ref={dockRef}
      className="pointer-events-auto fixed bottom-4 left-4 z-50"
      style={{
        width: `${dockWidth}px`,
        transform: `translateX(${translateX}px)`,
        transitionProperty: "transform, width",
        transitionDuration: "300ms",
        transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onBlurCapture={(event) => {
        if (!open) return;
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && dockRef.current?.contains(nextTarget)) {
          return;
        }
        setOpen(false);
      }}
    >
      {open ? (
        <div className="mb-2 overflow-hidden rounded-2xl border border-white/35 bg-background/80 p-2 shadow-xl shadow-black/10 backdrop-blur-xl supports-backdrop-filter:bg-background/65 dark:border-white/10">
          <div className="text-muted-foreground px-2 py-1 text-xs">
            {normalizedQuery.length === 0
              ? "Recent articles"
              : "Search results"}
          </div>
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {isLoading ? (
              <div className="text-muted-foreground px-2 py-3 text-sm">
                Loading...
              </div>
            ) : error ? (
              <div className="text-muted-foreground px-2 py-3 text-sm">
                <span>{error}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-2"
                  onClick={onRetry}
                >
                  Retry
                </Button>
              </div>
            ) : isAuthRequired ? (
              <div className="text-muted-foreground px-2 py-3 text-sm">
                Login is required.
              </div>
            ) : panelItems.length > 0 ? (
              panelItems.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  className={`h-auto w-full justify-start rounded-xl px-2 py-2 text-left ${
                    panelItems[activeIndex]?.id === item.id ? "bg-muted" : ""
                  }`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => selectItem(item)}
                  onMouseEnter={() => {
                    const index = panelItems.findIndex(
                      (panelItem) => panelItem.id === item.id,
                    );
                    if (index >= 0) setActiveIndex(index);
                  }}
                >
                  <span
                    className={item.id === currentEditorId ? "font-medium" : ""}
                  >
                    {formatSidebarLabel(item)}
                  </span>
                </Button>
              ))
            ) : (
              <div className="text-muted-foreground px-2 py-3 text-sm">
                {normalizedQuery.length > 0
                  ? "No matching articles."
                  : "No articles yet."}
              </div>
            )}
          </div>
          <div className="text-muted-foreground px-2 pt-2 text-xs">
            Full search is coming soon.
          </div>
        </div>
      ) : null}
      <div
        className="flex items-center rounded-full border border-white/40 bg-background/70 shadow-lg shadow-black/5 backdrop-blur-xl supports-backdrop-filter:bg-background/55 dark:border-white/15 transition-all duration-300 ease-out"
        style={{
          padding: `${DOCK_SPACING}px`,
          gap: `${DOCK_SPACING}px`,
        }}
      >
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-10 shrink-0 rounded-full transition-all duration-300 ease-out"
          onClick={() => openSearch()}
          aria-label="Open search"
          tabIndex={open ? 0 : -1}
        >
          <Search className="size-5" />
        </Button>
        <div
          className={`relative transition-all duration-300 ease-out ${
            open ? "flex-1 opacity-100" : "hidden opacity-0"
          }`}
        >
          <Input
            ref={inputRef}
            type="search"
            tabIndex={open ? 0 : -1}
            value={value}
            onChange={(e) => {
              onValueChange(e.target.value);
              if (suppressOpenOnChangeRef.current) {
                suppressOpenOnChangeRef.current = false;
                return;
              }
              if (!open) openSearch(false);
            }}
            onFocus={() => openSearch(false)}
            onKeyDown={(e) => {
              const isCtrlEscape =
                e.ctrlKey && !e.metaKey && !e.altKey && e.key === "[";
              const isCtrlEnter =
                e.ctrlKey &&
                !e.metaKey &&
                !e.altKey &&
                e.key.toLowerCase() === "m";
              const isCtrlMove =
                e.ctrlKey &&
                !e.metaKey &&
                !e.altKey &&
                (e.key.toLowerCase() === "n" || e.key.toLowerCase() === "p");
              const isArrowMove = e.key === "ArrowDown" || e.key === "ArrowUp";

              if (isArrowMove || isCtrlMove) {
                e.preventDefault();
                if (!open) setOpen(true);
                if (panelItems.length === 0) return;
                const isNext =
                  e.key === "ArrowDown" || e.key.toLowerCase() === "n";
                setActiveIndex((prev) =>
                  isNext
                    ? (prev + 1) % panelItems.length
                    : (prev - 1 + panelItems.length) % panelItems.length,
                );
                return;
              }

              if (
                (e.key === "Enter" || isCtrlEnter) &&
                open &&
                panelItems.length > 0
              ) {
                e.preventDefault();
                const selected = panelItems[activeIndex] ?? panelItems[0];
                if (!selected) return;
                selectItem(selected);
                return;
              }

              if (e.key === "Escape" || isCtrlEscape) {
                e.preventDefault();
                suppressOpenOnChangeRef.current = true;
                setOpen(false);
                inputRef.current?.blur();
                onRequestFocusEditor();
              }
            }}
            placeholder="Search articles..."
            className="h-10 rounded-full border-0 bg-background/55 shadow-none"
            aria-label="Search articles"
          />
        </div>
      </div>
    </div>
  );
}
