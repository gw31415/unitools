import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EditorSearchDock, type SearchDockItem } from "../EditorSearchDock";

const items: SearchDockItem[] = Array.from({ length: 12 }, (_, index) => ({
  id: `editor-${index + 1}`,
  createdAt: Date.UTC(2026, 0, index + 1),
  title: `Article ${String(index + 1).padStart(2, "0")}`,
}));

function renderSearchDock(props: Partial<React.ComponentProps<typeof EditorSearchDock>> = {}) {
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
      {...props}
    />,
  );
}

describe("EditorSearchDock", () => {
  beforeEach(() => {
    vi.useRealTimers();
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

  it("keeps existing results visible while loading", () => {
    renderSearchDock({ isLoading: true });

    fireEvent.click(screen.getByLabelText("Open search"));

    expect(screen.getByRole("button", { name: "Article 01" })).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("shows content search progress while title results are visible", () => {
    renderSearchDock({ value: "Article", isSearchingContent: true });

    fireEvent.click(screen.getByLabelText("Open search"));

    expect(screen.getByRole("button", { name: "Article 01" })).toBeInTheDocument();
    expect(screen.getByText("Searching content...")).toBeInTheDocument();
  });

  it("shows content search errors without clearing visible results", () => {
    renderSearchDock({ value: "Article", contentSearchError: "Content search failed." });

    fireEvent.click(screen.getByLabelText("Open search"));

    expect(screen.getByRole("button", { name: "Article 01" })).toBeInTheDocument();
    expect(screen.getByText("Content search failed.")).toBeInTheDocument();
  });

  it("passes the server-provided content match text", () => {
    const onRequestFocusEditor = vi.fn();
    renderSearchDock({
      value: "Alpha keyword",
      onRequestFocusEditor,
      items: [
        {
          id: "editor-1",
          createdAt: Date.UTC(2026, 0, 1),
          title: "Article 01",
          match: { source: "content", text: "Alpha related keyword", paragraph: "Intro Alpha related keyword after" },
        },
      ],
    });

    fireEvent.click(screen.getByLabelText("Open search"));
    const resultButton = screen.getByRole("button", { name: /Article 01/ });
    expect(resultButton).toHaveTextContent("Content: Alpha related keyword");
    fireEvent.click(resultButton);

    expect(onRequestFocusEditor).toHaveBeenCalledWith({
      searchText: "Intro Alpha related keyword after",
    });
  });
});
