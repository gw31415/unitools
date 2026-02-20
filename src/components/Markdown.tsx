import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { renderToHTMLString } from "@tiptap/static-renderer";
import type { HTMLAttributes } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { b64ToUint8Array } from "@/lib/base64";
import { baseExtensions } from "@/lib/editorExtensions";
import { uploadImage } from "@/lib/uploadImage";
import { cn } from "@/lib/utils";

type PartialEditorOptions = Partial<ConstructorParameters<typeof Editor>[0]>;
const GRAY_PREVIEW_SRC =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxIDEnIHByZXNlcnZlQXNwZWN0UmF0aW89J25vbmUnPjxkZWZzPjxsaW5lYXJHcmFkaWVudCBpZD0nZycgeDE9Jy0xJyB4Mj0nMCc+PHN0b3Agc3RvcC1jb2xvcj0nJTIzOWNhM2FmJyBzdG9wLW9wYWNpdHk9Jy4yOCcvPjxzdG9wIG9mZnNldD0nLjUnIHN0b3AtY29sb3I9JyUyMzljYTNhZicgc3RvcC1vcGFjaXR5PScuNDQnLz48c3RvcCBvZmZzZXQ9JzEnIHN0b3AtY29sb3I9JyUyMzljYTNhZicgc3RvcC1vcGFjaXR5PScuMjgnLz48YW5pbWF0ZSBhdHRyaWJ1dGVOYW1lPSd4MScgZnJvbT0nLTEnIHRvPScxJyBkdXI9JzEuMnMnIHJlcGVhdENvdW50PSdpbmRlZmluaXRlJy8+PGFuaW1hdGUgYXR0cmlidXRlTmFtZT0neDInIGZyb209JzAnIHRvPScyJyBkdXI9JzEuMnMnIHJlcGVhdENvdW50PSdpbmRlZmluaXRlJy8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9JzEnIGhlaWdodD0nMScgZmlsbD0ndXJsKCUyM2cpJy8+PC9zdmc+";
const UPLOADING_ALT_PREFIX = "uploading:";
const IMAGE_SIZE_CACHE_PREFIX = "unitools:image-size:";
const LAZY_ROOT_MARGIN = "600px 0px";
const FALLBACK_ASPECT_RATIO = "4 / 3";

type ImageDimensions = {
  width: number;
  height: number;
};

function getImageDimensions(file: File): Promise<ImageDimensions | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      URL.revokeObjectURL(objectUrl);
      if (width > 0 && height > 0) {
        resolve({ width, height });
        return;
      }
      resolve(null);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };

    image.src = objectUrl;
  });
}

function getImageSizeCacheKey(src: string) {
  return `${IMAGE_SIZE_CACHE_PREFIX}${encodeURIComponent(src)}`;
}

function readCachedImageDimensions(src: string): ImageDimensions | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getImageSizeCacheKey(src));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ImageDimensions>;
    if (
      typeof parsed.width === "number" &&
      Number.isFinite(parsed.width) &&
      parsed.width > 0 &&
      typeof parsed.height === "number" &&
      Number.isFinite(parsed.height) &&
      parsed.height > 0
    ) {
      return { width: parsed.width, height: parsed.height };
    }
  } catch {
    // Ignore broken cache.
  }

  return null;
}

function writeCachedImageDimensions(src: string, dimensions: ImageDimensions) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      getImageSizeCacheKey(src),
      JSON.stringify(dimensions),
    );
  } catch {
    // Ignore storage errors.
  }
}

function applyDimensionsToImageElement(
  image: HTMLImageElement,
  dimensions: ImageDimensions,
) {
  image.setAttribute("width", String(dimensions.width));
  image.setAttribute("height", String(dimensions.height));
}

function setupLazyImagePreview(container: HTMLElement) {
  const preparedImages: Array<{
    image: HTMLImageElement;
    handleLoad: () => void;
  }> = [];

  const observer =
    typeof window !== "undefined" && "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const image = entry.target as HTMLImageElement;
              const dataSrc = image.getAttribute("data-src");
              if (dataSrc && image.getAttribute("src") !== dataSrc) {
                image.setAttribute("src", dataSrc);
              }
              observer?.unobserve(image);
            }
          },
          { root: null, rootMargin: LAZY_ROOT_MARGIN },
        )
      : null;

  for (const image of Array.from(container.querySelectorAll("img"))) {
    if (image.dataset.lazyPrepared === "true") continue;

    const alt = image.getAttribute("alt") ?? "";
    if (alt.startsWith(UPLOADING_ALT_PREFIX)) continue;

    const src = image.getAttribute("src") ?? "";
    const dataSrc = image.getAttribute("data-src") ?? src;
    if (!dataSrc || dataSrc.startsWith("data:")) continue;

    if (!image.getAttribute("data-src")) {
      image.setAttribute("data-src", dataSrc);
    }

    if (!image.hasAttribute("width") || !image.hasAttribute("height")) {
      const cachedDimensions = readCachedImageDimensions(dataSrc);
      if (cachedDimensions) {
        applyDimensionsToImageElement(image, cachedDimensions);
      } else {
        image.classList.add("lazy-image-size-fallback");
        image.style.aspectRatio = FALLBACK_ASPECT_RATIO;
      }
    }

    image.dataset.lazyPrepared = "true";
    image.classList.add("lazy-image-pending");
    image.loading = "lazy";
    image.decoding = "async";
    image.setAttribute("src", GRAY_PREVIEW_SRC);

    const handleLoad = () => {
      const loadedSrc = image.getAttribute("src");
      const currentDataSrc = image.getAttribute("data-src");
      if (!loadedSrc || !currentDataSrc || loadedSrc !== currentDataSrc) return;

      image.classList.remove("lazy-image-pending");
      image.classList.remove("lazy-image-size-fallback");
      image.style.removeProperty("aspect-ratio");

      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        const dimensions = {
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
        applyDimensionsToImageElement(image, dimensions);
        writeCachedImageDimensions(currentDataSrc, dimensions);
      }
    };

    image.addEventListener("load", handleLoad);
    if (observer) {
      observer.observe(image);
    } else {
      image.setAttribute("src", dataSrc);
    }

    preparedImages.push({ image, handleLoad });
  }

  return () => {
    for (const { image, handleLoad } of preparedImages) {
      image.removeEventListener("load", handleLoad);
      observer?.unobserve(image);
    }
    observer?.disconnect();
  };
}

function createUploadToken() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function findPlaceholderImage(editor: Editor, uploadToken: string) {
  const expectedAlt = `${UPLOADING_ALT_PREFIX}${uploadToken}`;
  let result:
    | {
        pos: number;
        attrs: Record<string, unknown>;
      }
    | undefined;

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "image") {
      return;
    }

    if (node.attrs.alt === expectedAlt) {
      result = { pos, attrs: node.attrs as Record<string, unknown> };
      return false;
    }
  });

  return result;
}

function createEditor(options: PartialEditorOptions = {}) {
  const { extensions, ...rest } = options;
  return new Editor({
    extensions: extensions ?? baseExtensions,
    contentType: "markdown",
    ...rest,
  });
}

function MarkdownView({
  contentJSON,
  className,
  ...props
}: {
  contentJSON?: JSONContent | null;
} & HTMLAttributes<HTMLDivElement>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const html = renderToHTMLString({
    content:
      contentJSON ?? createEditor({ element: null, content: "" }).getJSON(),
    extensions: baseExtensions,
  });

  useEffect(() => {
    if (!containerRef.current) return;
    return setupLazyImagePreview(containerRef.current);
  });

  return (
    <div
      ref={containerRef}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is rendered from TipTap content.
      dangerouslySetInnerHTML={{ __html: html }}
      {...props}
      className={cn(
        "tiptap w-full min-w-0 max-w-full overflow-x-auto",
        className,
      )}
    />
  );
}

function MarkdownEditor({
  editorOpts,
  onReady,
  editable,
  className,
  editorId,
  ...props
}: {
  editorOpts?: PartialEditorOptions;
  onReady?: (editor: Editor) => void;
  editable?: boolean;
  editorId?: string;
} & HTMLAttributes<HTMLDivElement>) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor>(null);

  const uploadImageAndInsert = useCallback(
    async (file: File, editor: Editor) => {
      const { from } = editor.state.selection;
      const uploadToken = createUploadToken();
      const localPreviewUrl = URL.createObjectURL(file);
      const dimensions = await getImageDimensions(file);

      // ローカル画像情報でアップロード中プレビューを挿入
      editor
        .chain()
        .focus()
        .insertContentAt(from, {
          type: "image",
          attrs: {
            src: localPreviewUrl,
            alt: `${UPLOADING_ALT_PREFIX}${uploadToken}`,
            uploading: true,
            width: dimensions?.width ?? null,
            height: dimensions?.height ?? null,
          },
        })
        .run();

      try {
        const result = await uploadImage({ file, editorId: editorId! });
        const placeholder = findPlaceholderImage(editor, uploadToken);
        if (!placeholder) {
          URL.revokeObjectURL(localPreviewUrl);
          return;
        }

        if (dimensions) {
          writeCachedImageDimensions(result.url, dimensions);
        }

        // 通常画像は灰色プレビュー + 近傍で遅延ダウンロード
        const { tr } = editor.state;
        tr.setNodeMarkup(placeholder.pos, undefined, {
          ...placeholder.attrs,
          src: GRAY_PREVIEW_SRC,
          dataSrc: result.url,
          alt: file.name,
          uploading: false,
          width: dimensions?.width ?? null,
          height: dimensions?.height ?? null,
        });
        editor.view.dispatch(tr);
      } catch (error) {
        const placeholder = findPlaceholderImage(editor, uploadToken);
        if (placeholder) {
          const { tr } = editor.state;
          tr.deleteRange(placeholder.pos, placeholder.pos + 1);
          editor.view.dispatch(tr);
        }
        console.error("Upload failed:", error);
      } finally {
        URL.revokeObjectURL(localPreviewUrl);
      }
    },
    [editorId],
  );

  useEffect(() => {
    editorRef.current = createEditor({
      element: { mount: editorContainerRef.current! },
      editable,
      ...editorOpts,
    });
    if (editorRef.current) {
      onReady?.(editorRef.current);
    }

    return () => {
      if (editorRef.current) {
        editorRef.current.destroy();
      }
      editorRef.current = null;
    };
  }, [editorOpts, onReady, editable]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !editorId || !editable) return;

    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          event.preventDefault();
          const file = item.getAsFile();
          if (file) {
            uploadImageAndInsert(file, editor);
          }
          return;
        }
      }
    };

    editor.view.dom.addEventListener("paste", handlePaste);
    return () => {
      editor.view.dom.removeEventListener("paste", handlePaste);
    };
  }, [editable, editorId, uploadImageAndInsert]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const container = editor.view.dom as HTMLElement;
    const cleanups: Array<() => void> = [];
    cleanups.push(setupLazyImagePreview(container));

    const refresh = () => {
      cleanups.push(setupLazyImagePreview(container));
    };

    editor.on("update", refresh);

    return () => {
      editor.off("update", refresh);
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  });

  return (
    <div
      ref={editorContainerRef}
      {...props}
      className={cn(
        "tiptap w-full min-w-0 max-w-full overflow-x-auto",
        className,
      )}
    />
  );
}

export default function Markdown({
  editorId,
  bootstrap,
  readonly,
  ...props
}: {
  editorId: string;
  bootstrap?: {
    snapshotJSON?: JSONContent | null;
    yjsUpdate?: string;
  };
  readonly?: boolean;
} & HTMLAttributes<HTMLDivElement>) {
  const [mounted, setMounted] = useState(false);
  const [collabDoc, setCollabDoc] = useState<Y.Doc | null>(null);
  const { snapshotJSON, yjsUpdate } = bootstrap ?? {};

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !editorId) {
      setCollabDoc(null);
      return;
    }
    const doc = new Y.Doc();
    if (yjsUpdate) {
      try {
        Y.applyUpdate(doc, b64ToUint8Array(yjsUpdate));
      } catch {
        // Ignore malformed updates; live sync will repair.
      }
    }

    const wsUrl = new URL("/api/v1/editor", window.location.origin);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    const provider = new WebsocketProvider(wsUrl.toString(), editorId, doc, {
      connect: true,
    });
    setCollabDoc(doc);
    return () => {
      provider.destroy();
      doc.destroy();
      setCollabDoc(null);
    };
  }, [mounted, editorId, yjsUpdate]);

  const editorOpts = useMemo<PartialEditorOptions | undefined>(() => {
    if (!collabDoc || !editorId) return undefined;
    return {
      extensions: [
        ...baseExtensions,
        Collaboration.configure({
          document: collabDoc,
          field: "default",
        }),
      ],
    };
  }, [collabDoc, editorId]);

  return import.meta.env.SSR || !mounted || !collabDoc ? (
    <MarkdownView contentJSON={snapshotJSON} {...props} />
  ) : (
    <MarkdownEditor
      editorOpts={editorOpts}
      editable={!readonly}
      editorId={editorId}
      {...props}
    />
  );
}
