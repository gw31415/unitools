import { useAtomValue } from "jotai";
import { Search } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEditorLabel } from "@/lib/editorLabel";
import { type FabPosition, fabPositionAtom } from "@/store";

const FAB_POSITION_COOKIE = "fab_position";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

async function setFabPositionCookie(position: FabPosition) {
  if (typeof window === "undefined") return;
  const cookieStore = window.cookieStore ?? globalThis.cookieStore;
  if (!cookieStore) {
    console.warn("Cookie Store API not available, cannot persist FAB position");
    return;
  }

  await cookieStore.set({
    name: FAB_POSITION_COOKIE,
    value: encodeURIComponent(JSON.stringify(position)),
    path: "/",
    expires: Date.now() + COOKIE_MAX_AGE * 1000,
  });
}

export type SearchDockItem = {
  id: string;
  createdAt: number;
  title?: string;
};

export const DOCK_SPACING = 8;
export const SEARCH_BUTTON_SIZE = 40;
export const FAB_SIZE = SEARCH_BUTTON_SIZE + DOCK_SPACING * 2;
const DOCK_MAX_WIDTH = 672;
const CLOSE_ANIMATION_MS = 300;
const FAB_MARGIN = 16;
const FAB_BOTTOM_SNAP_THRESHOLD = FAB_MARGIN * 2;
type Viewport = { width: number; height: number };

function getClientViewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") {
    return { width: 1024, height: 768 };
  }
  const visualViewportWidth = window.visualViewport?.width;
  const visualViewportHeight = window.visualViewport?.height;
  return {
    width:
      typeof visualViewportWidth === "number" && visualViewportWidth > 0
        ? Math.floor(visualViewportWidth)
        : window.innerWidth,
    height:
      typeof visualViewportHeight === "number" && visualViewportHeight > 0
        ? Math.floor(visualViewportHeight)
        : window.innerHeight,
  };
}

function clampFabBottom(bottom: number, viewportHeight: number): number {
  const maxBottom = Math.max(FAB_MARGIN, viewportHeight - FAB_SIZE - FAB_MARGIN);
  return Math.max(FAB_MARGIN, Math.min(maxBottom, bottom));
}

function clampFabPosition(position: FabPosition, viewportHeight: number): FabPosition {
  return {
    horizontal: position.horizontal,
    bottom: clampFabBottom(position.bottom, viewportHeight),
  };
}

function getFabLeft(horizontal: FabPosition["horizontal"], viewportWidth: number): number {
  const minLeft = 0;
  const maxLeft = Math.max(0, viewportWidth - FAB_SIZE);
  const targetLeft = horizontal === "left" ? FAB_MARGIN : viewportWidth - FAB_SIZE - FAB_MARGIN;
  return Math.max(minLeft, Math.min(maxLeft, targetLeft));
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
  onNavigateToEditor: (editorId: string, options?: { focusEditor?: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewport, setViewport] = useState<Viewport>(getClientViewportSize);
  const [isDragging, setIsDragging] = useState(false);
  const [dragVisualPosition, setDragVisualPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const hasActuallyMovedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const navigationTimerRef = useRef<number | null>(null);
  const suppressOpenOnChangeRef = useRef(false);
  const touchSelectionRef = useRef(false);
  const rightAnchorTimerRef = useRef<number | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const clearRightAnchorTimer = useCallback(() => {
    if (rightAnchorTimerRef.current === null) return;
    window.clearTimeout(rightAnchorTimerRef.current);
    rightAnchorTimerRef.current = null;
  }, []);

  // Use SSR state for FAB position
  const ssrFabPosition = useAtomValue(fabPositionAtom);
  const [fabPosition, setFabPosition] = useState(ssrFabPosition);
  const [anchorMode, setAnchorMode] = useState<"left" | "right">(
    ssrFabPosition.horizontal === "right" ? "right" : "left",
  );

  // Ensure first client paint uses a clamped position and up-to-date viewport.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const nextViewport = getClientViewportSize();
    setViewport(nextViewport);

    const clamped = clampFabPosition(ssrFabPosition, nextViewport.height);
    setFabPosition(clamped);
    if (
      clamped.horizontal !== ssrFabPosition.horizontal ||
      clamped.bottom !== ssrFabPosition.bottom
    ) {
      setFabPositionCookie(clamped);
    }

    if (clamped.horizontal === "right") {
      // Use right anchor only for first paint, then normalize to left-based positioning.
      clearRightAnchorTimer();
      setAnchorMode("right");
      rightAnchorTimerRef.current = window.setTimeout(() => {
        setAnchorMode("left");
        rightAnchorTimerRef.current = null;
      }, CLOSE_ANIMATION_MS);
    } else {
      clearRightAnchorTimer();
      setAnchorMode("left");
    }
  }, [ssrFabPosition, clearRightAnchorTimer]);
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
          .filter((item) => formatEditorLabel(item).toLowerCase().includes(normalizedQuery))
          .slice(0, 6);
  const closeSearch = (options?: { restoreDockButtonFocus?: boolean }) => {
    setOpen(false);
    if (options?.restoreDockButtonFocus === false) {
      return;
    }
    if (searchButtonRef.current) {
      searchButtonRef.current.focus({ preventScroll: true });
      return;
    }
    inputRef.current?.blur();
  };
  const selectItem = (item: SearchDockItem, focusEditor = true) => {
    if (item.id === currentEditorId) {
      closeSearch({ restoreDockButtonFocus: !focusEditor });
      if (focusEditor) {
        onRequestFocusEditor();
      }
      return;
    }
    closeSearch({ restoreDockButtonFocus: !focusEditor });
    if (navigationTimerRef.current !== null) {
      window.clearTimeout(navigationTimerRef.current);
    }
    navigationTimerRef.current = window.setTimeout(() => {
      onNavigateToEditor(item.id, { focusEditor });
    }, CLOSE_ANIMATION_MS);
  };

  useEffect(() => {
    if (!open || panelItems.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((prev) => Math.min(prev, panelItems.length - 1));
  }, [open, panelItems.length]);

  useEffect(() => {
    return () => {
      if (navigationTimerRef.current !== null) {
        window.clearTimeout(navigationTimerRef.current);
      }
      clearRightAnchorTimer();
    };
  }, [clearRightAnchorTimer]);

  const handleDragStart = useCallback(
    (clientX: number, clientY: number) => {
      clearRightAnchorTimer();
      setAnchorMode("left");
      setIsDragging(true);
      hasActuallyMovedRef.current = false;
      dragStartPosRef.current = { x: clientX, y: clientY };
      const fabLeft = getFabLeft(fabPosition.horizontal, viewport.width);
      const fabTop = viewport.height - FAB_SIZE - fabPosition.bottom;
      setDragVisualPosition({ left: fabLeft, top: fabTop });
      dragOffsetRef.current = {
        x: clientX - fabLeft,
        y: clientY - fabTop,
      };
    },
    [fabPosition, viewport, clearRightAnchorTimer],
  );

  const handleDragMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDragging) return;

      const dragThreshold = 5;
      const deltaX = Math.abs(clientX - dragStartPosRef.current.x);
      const deltaY = Math.abs(clientY - dragStartPosRef.current.y);

      if (deltaX > dragThreshold || deltaY > dragThreshold) {
        hasActuallyMovedRef.current = true;
      }

      if (!hasActuallyMovedRef.current) return;

      const newX = clientX - dragOffsetRef.current.x;
      const newY = clientY - dragOffsetRef.current.y;
      const viewport = getClientViewportSize();
      const currentFabLeft = getFabLeft(fabPosition.horizontal, viewport.width);

      // Constrain to viewport bounds with margin
      const maxX = viewport.width - FAB_SIZE - FAB_MARGIN;
      const maxY = viewport.height - FAB_SIZE - FAB_MARGIN;
      const clampedX = open ? currentFabLeft : Math.max(FAB_MARGIN, Math.min(maxX, newX));
      const clampedY = Math.max(FAB_MARGIN, Math.min(maxY, newY));
      setDragVisualPosition({ left: clampedX, top: clampedY });
    },
    [isDragging, open, fabPosition.horizontal],
  );

  const handleDragEnd = useCallback(() => {
    if (!isDragging) return;
    const hasMoved = hasActuallyMovedRef.current;
    setIsDragging(false);
    const currentVisualPosition = dragVisualPosition;
    setDragVisualPosition(null);

    // Only snap and save if actually dragged
    if (!hasMoved) return;
    if (!currentVisualPosition) return;
    const viewport = getClientViewportSize();

    // Snap to nearest edge (left or right)
    const viewportCenter = viewport.width / 2;
    const currentLeft = currentVisualPosition.left;
    const rawBottom = clampFabBottom(
      viewport.height - FAB_SIZE - currentVisualPosition.top,
      viewport.height,
    );
    const snappedBottom = rawBottom <= FAB_BOTTOM_SNAP_THRESHOLD ? FAB_MARGIN : rawBottom;
    const snappedPosition: FabPosition = {
      horizontal: open
        ? fabPosition.horizontal
        : currentLeft + FAB_SIZE / 2 < viewportCenter
          ? "left"
          : "right",
      bottom: snappedBottom,
    };
    setFabPosition(snappedPosition);
    setFabPositionCookie(snappedPosition);
    // Keep drag-release snap animations on `left` so both directions interpolate.
    clearRightAnchorTimer();
    setAnchorMode("left");
  }, [isDragging, dragVisualPosition, clearRightAnchorTimer, open, fabPosition.horizontal]);

  // Global drag move and end handlers
  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) {
        return;
      }
      handleDragMove(e.clientX, e.clientY);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) {
        return;
      }
      activePointerIdRef.current = null;
      handleDragEnd();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

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
    const syncViewport = () => {
      setViewport(getClientViewportSize());
    };

    syncViewport();
    const rafId = window.requestAnimationFrame(syncViewport);
    const timerId = window.setTimeout(syncViewport, 300);

    window.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", syncViewport);
    window.addEventListener("pageshow", syncViewport);
    window.addEventListener("load", syncViewport);
    window.visualViewport?.addEventListener("resize", syncViewport);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
      window.removeEventListener("resize", syncViewport);
      window.removeEventListener("orientationchange", syncViewport);
      window.removeEventListener("pageshow", syncViewport);
      window.removeEventListener("load", syncViewport);
      window.visualViewport?.removeEventListener("resize", syncViewport);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const clamped = clampFabPosition(fabPosition, viewport.height);
    if (clamped.horizontal === fabPosition.horizontal && clamped.bottom === fabPosition.bottom) {
      return;
    }
    setFabPosition(clamped);
    setFabPositionCookie(clamped);
  }, [fabPosition, viewport.height]);

  const openDockWidth = Math.max(
    FAB_SIZE,
    Math.min(DOCK_MAX_WIDTH, viewport.width - FAB_MARGIN * 2),
  );
  const dockWidth = open ? openDockWidth : FAB_SIZE;
  const clampedFabPosition = clampFabPosition(fabPosition, viewport.height);
  const closedDockLeft = getFabLeft(clampedFabPosition.horizontal, viewport.width);
  const closedDockBottom = clampedFabPosition.bottom;
  const useRightAnchor =
    anchorMode === "right" &&
    !open &&
    !isDragging &&
    !dragVisualPosition &&
    clampedFabPosition.horizontal === "right";

  // Calculate position: when open, center horizontally; when closed, use FAB position
  const dockLeft = open
    ? (viewport.width - dockWidth) / 2
    : dragVisualPosition
      ? dragVisualPosition.left
      : closedDockLeft;
  const dockBottom = dragVisualPosition
    ? Math.max(FAB_MARGIN, viewport.height - FAB_SIZE - dragVisualPosition.top)
    : closedDockBottom;

  return (
    <div
      ref={dockRef}
      className="pointer-events-auto fixed z-50"
      style={{
        width: `${dockWidth}px`,
        left: useRightAnchor ? undefined : `${dockLeft}px`,
        right: useRightAnchor ? `${FAB_MARGIN}px` : undefined,
        bottom: `${dockBottom}px`,
        transitionProperty: isDragging ? "none" : "width, left",
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
        <div className="frosted-bg absolute right-0 bottom-[calc(100%+8px)] left-0 overflow-hidden rounded-2xl border border-black/10 p-2 shadow-xl shadow-black/10 dark:border-white/10">
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {normalizedQuery.length === 0 ? "Recent articles" : "Search results"}
          </div>
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {isLoading ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">Loading...</div>
            ) : error ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">
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
              <div className="px-2 py-3 text-sm text-muted-foreground">Login is required.</div>
            ) : panelItems.length > 0 ? (
              panelItems.map((item, index) => (
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  className={`h-auto w-full justify-start rounded-xl px-2 py-2 text-left ${
                    panelItems[activeIndex]?.id === item.id ? "bg-muted" : ""
                  }`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    touchSelectionRef.current = event.pointerType === "touch";
                  }}
                  onClick={() => {
                    const focusEditor = !touchSelectionRef.current;
                    touchSelectionRef.current = false;
                    selectItem(item, focusEditor);
                  }}
                  onMouseEnter={() => {
                    setActiveIndex(index);
                  }}
                >
                  <span className={item.id === currentEditorId ? "font-medium" : ""}>
                    {formatEditorLabel(item)}
                  </span>
                </Button>
              ))
            ) : (
              <div className="px-2 py-3 text-sm text-muted-foreground">
                {normalizedQuery.length > 0 ? "No matching articles." : "No articles yet."}
              </div>
            )}
          </div>
          <div className="px-2 pt-2 text-xs text-muted-foreground">Full search is coming soon.</div>
        </div>
      ) : null}
      <div
        className="frosted-bg flex items-center rounded-full border border-black/15 shadow-lg shadow-black/5 transition-all duration-300 ease-out dark:border-white/15"
        style={{
          padding: `${DOCK_SPACING}px`,
          gap: `${DOCK_SPACING}px`,
        }}
      >
        <Button
          ref={searchButtonRef}
          type="button"
          size="icon"
          variant="ghost"
          className="size-10 shrink-0 rounded-full transition-all duration-300 ease-out"
          onClick={() => {
            if (!hasActuallyMovedRef.current) {
              openSearch();
            }
          }}
          onPointerDown={(e) => {
            // Only start drag on primary mouse button, or any touch/pen contact.
            if (e.pointerType === "mouse" && e.button !== 0) return;
            activePointerIdRef.current = e.pointerId;
            e.currentTarget.setPointerCapture(e.pointerId);
            handleDragStart(e.clientX, e.clientY);
          }}
          aria-label="Open search"
          tabIndex={open ? 0 : -1}
          style={{
            cursor: isDragging ? "grabbing" : "grab",
            touchAction: "none",
          }}
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
              const isCtrlEscape = e.ctrlKey && !e.metaKey && !e.altKey && e.key === "[";
              const isCtrlEnter =
                e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "m";
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
                const isNext = e.key === "ArrowDown" || e.key.toLowerCase() === "n";
                setActiveIndex((prev) =>
                  isNext
                    ? (prev + 1) % panelItems.length
                    : (prev - 1 + panelItems.length) % panelItems.length,
                );
                return;
              }

              if ((e.key === "Enter" || isCtrlEnter) && open && panelItems.length > 0) {
                e.preventDefault();
                const selected = panelItems[activeIndex] ?? panelItems[0];
                if (!selected) return;
                selectItem(selected, true);
                return;
              }

              if (e.key === "Escape" || isCtrlEscape) {
                e.preventDefault();
                suppressOpenOnChangeRef.current = true;
                closeSearch({ restoreDockButtonFocus: false });
                onRequestFocusEditor();
              }
            }}
            placeholder="Search articles..."
            className="h-10 rounded-full border-0 bg-background/45 shadow-none"
            aria-label="Search articles"
          />
        </div>
      </div>
    </div>
  );
}
