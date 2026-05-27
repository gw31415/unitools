import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSearchDock, type SearchDockItem } from "../EditorSearchDock";

const items: SearchDockItem[] = Array.from({ length: 12 }, (_, index) => ({
  id: `editor-${index + 1}`,
  createdAt: Date.UTC(2026, 0, index + 1),
  title: `Article ${String(index + 1).padStart(2, "0")}`,
}));

function renderSearchDock() {
  return render(
    <EditorSearchDock
      value=""
      onValueChange={vi.fn()}
      items={items}
      isLoading={false}
      isLoadingMore={false}
      hasMore={false}
      isAuthRequired={false}
      error={null}
      onRetry={vi.fn()}
      onLoadMore={vi.fn()}
      currentEditorId="editor-1"
      onRequestFocusEditor={vi.fn()}
      onNavigateToEditor={vi.fn()}
    />,
  );
}

describe("EditorSearchDock", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it("scrolls the active menu item into view when moving with Super+n", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    renderSearchDock();

    fireEvent.click(screen.getByLabelText("Open search"));

    scrollIntoView.mockClear();
    fireEvent.keyDown(screen.getByLabelText("Search articles"), {
      key: "n",
      metaKey: true,
    });

    expect(screen.getByRole("button", { name: "Article 02" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});
