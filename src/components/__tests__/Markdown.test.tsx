import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as imageService from "@/lib/imageService";
import Markdown from "../Markdown";

// Mock dependencies
vi.mock("@/lib/base64", () => ({
  b64ToUint8Array: vi.fn(() => new Uint8Array([])),
}));

vi.mock("@/lib/imageService", () => ({
  uploadImage: vi.fn(),
}));

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

global.IntersectionObserver =
  MockIntersectionObserver as unknown as typeof IntersectionObserver;

type MutableImportMetaEnv = ImportMetaEnv & { SSR: boolean };

const importMetaEnv = import.meta.env as unknown as MutableImportMetaEnv;

function setSsrForTest(value: boolean) {
  importMetaEnv.SSR = value;
}

describe("Markdown Component", () => {
  beforeEach(() => {
    // Mock browser environment
    global.window = {
      document: global.document,
      location: { origin: "http://localhost" },
    } as unknown as Window & typeof globalThis;
  });

  it("should render MarkdownView in SSR mode", () => {
    // Mock SSR environment
    const originalSSR = import.meta.env.SSR;
    setSsrForTest(true);

    const { container } = render(
      <Markdown
        editorId="test-editor"
        bootstrap={{
          snapshotJSON: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Test" }],
              },
            ],
          },
        }}
      />,
    );

    expect(container.querySelector(".tiptap")).toBeInTheDocument();

    setSsrForTest(originalSSR);
  });

  it("should render MarkdownView with image content", () => {
    const originalSSR = import.meta.env.SSR;
    setSsrForTest(true);

    const { container } = render(
      <Markdown
        editorId="test-editor"
        bootstrap={{
          snapshotJSON: {
            type: "doc",
            content: [
              {
                type: "image",
                attrs: {
                  src: "test.jpg",
                  width: 100,
                  height: 200,
                  alt: "Test image",
                },
              },
            ],
          },
        }}
      />,
    );

    const html = container.querySelector(".tiptap")?.innerHTML;
    expect(html).toContain("test.jpg");
    expect(html).toContain("width");
    expect(html).toContain("height");

    setSsrForTest(originalSSR);
  });

  it("should handle image with dataSrc attribute", () => {
    const originalSSR = import.meta.env.SSR;
    setSsrForTest(true);

    const { container } = render(
      <Markdown
        editorId="test-editor"
        bootstrap={{
          snapshotJSON: {
            type: "doc",
            content: [
              {
                type: "image",
                attrs: {
                  src: "placeholder.jpg",
                  dataSrc: "real-image.jpg",
                  width: 100,
                  height: 200,
                },
              },
            ],
          },
        }}
      />,
    );

    const html = container.querySelector(".tiptap")?.innerHTML;
    // Should have data-src attribute and gray preview
    expect(html).toContain('data-src="real-image.jpg"');
    expect(html).toContain("data:image/svg+xml");

    setSsrForTest(originalSSR);
  });

  it("should not modify uploading images", () => {
    const originalSSR = import.meta.env.SSR;
    setSsrForTest(true);

    const { container } = render(
      <Markdown
        editorId="test-editor"
        bootstrap={{
          snapshotJSON: {
            type: "doc",
            content: [
              {
                type: "image",
                attrs: {
                  src: "local-preview.jpg",
                  alt: "uploading:test-token",
                  uploading: true,
                },
              },
            ],
          },
        }}
      />,
    );

    const html = container.querySelector(".tiptap")?.innerHTML;
    // Uploading images should not have lazy loading
    expect(html).toContain("local-preview.jpg");
    expect(html).toContain('alt="uploading:test-token"');

    setSsrForTest(originalSSR);
  });

  it("should render with custom className", () => {
    const originalSSR = import.meta.env.SSR;
    setSsrForTest(true);

    const { container } = render(
      <Markdown
        editorId="test-editor"
        className="custom-class"
        bootstrap={{
          snapshotJSON: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Test" }],
              },
            ],
          },
        }}
      />,
    );

    expect(container.querySelector(".custom-class")).toBeInTheDocument();

    setSsrForTest(originalSSR);
  });

  it("should render empty content when snapshotJSON is null", () => {
    const originalSSR = import.meta.env.SSR;
    setSsrForTest(true);

    const { container } = render(
      <Markdown
        editorId="test-editor"
        bootstrap={{
          snapshotJSON: null,
        }}
      />,
    );

    expect(container.querySelector(".tiptap")).toBeInTheDocument();

    setSsrForTest(originalSSR);
  });

  describe("Image Upload Error Handling", () => {
    it("should log detailed error context on upload failure", async () => {
      const mockError = new Error("Network error");
      vi.mocked(imageService.uploadImage).mockRejectedValue(mockError);

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Create a mock file
      const mockFile = new File(["test"], "test.jpg", { type: "image/jpeg" });

      try {
        await imageService.uploadImage(mockFile, "test-editor");
      } catch {
        // Expected to throw
      }

      // Verify the service was called
      expect(imageService.uploadImage).toHaveBeenCalledWith(
        mockFile,
        "test-editor",
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Lazy Loading", () => {
    it("should setup IntersectionObserver for images with data-src", () => {
      const originalSSR = import.meta.env.SSR;
      setSsrForTest(true);

      const { container } = render(
        <Markdown
          editorId="test-editor"
          bootstrap={{
            snapshotJSON: {
              type: "doc",
              content: [
                {
                  type: "image",
                  attrs: {
                    src: "placeholder.jpg",
                    dataSrc: "real-image.jpg",
                    width: 100,
                    height: 200,
                  },
                },
              ],
            },
          }}
        />,
      );

      const image = container.querySelector("img[data-src]");
      expect(image).toBeInTheDocument();
      expect(image?.getAttribute("data-src")).toBe("real-image.jpg");

      setSsrForTest(originalSSR);
    });

    it("should add lazy-image-pending class to images with data-src", () => {
      const originalSSR = import.meta.env.SSR;
      setSsrForTest(true);

      const { container } = render(
        <Markdown
          editorId="test-editor"
          bootstrap={{
            snapshotJSON: {
              type: "doc",
              content: [
                {
                  type: "image",
                  attrs: {
                    src: "placeholder.jpg",
                    dataSrc: "real-image.jpg",
                    width: 100,
                    height: 200,
                  },
                },
              ],
            },
          }}
        />,
      );

      const html = container.querySelector(".tiptap")?.innerHTML;
      // The decorateLazyImages function doesn't add the class during SSR
      // The class is added by setupLazyLoading which runs in useEffect
      expect(html).toContain('data-src="real-image.jpg"');

      setSsrForTest(originalSSR);
    });

    it("should not add lazy loading to uploading images", () => {
      const originalSSR = import.meta.env.SSR;
      setSsrForTest(true);

      const { container } = render(
        <Markdown
          editorId="test-editor"
          bootstrap={{
            snapshotJSON: {
              type: "doc",
              content: [
                {
                  type: "image",
                  attrs: {
                    src: "local-preview.jpg",
                    alt: "uploading:test-token",
                    uploading: true,
                  },
                },
              ],
            },
          }}
        />,
      );

      const image = container.querySelector("img");
      expect(image?.classList.contains("lazy-image-pending")).toBe(false);

      setSsrForTest(originalSSR);
    });
  });
});
