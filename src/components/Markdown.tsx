import { Editor, type JSONContent, Node } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { renderToHTMLString } from "@tiptap/static-renderer";
import type { HTMLAttributes } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { b64ToUint8Array } from "@/lib/base64";
import { baseExtensions } from "@/lib/editorExtensions";
import { uploadImage as uploadImageService } from "@/lib/imageService";
import { cn } from "@/lib/utils";

type PartialEditorOptions = Partial<ConstructorParameters<typeof Editor>[0]>;
const UPLOADING_ALT_PREFIX = "uploading:";

interface ImageDimensions {
  width: number;
  height: number;
}

const IMAGE_URL_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "svg",
]);

const MIME_TYPE_TO_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

// Create gray preview SVG for lazy loading
const createGrayPreviewSrc = ({ width, height }: ImageDimensions) =>
  `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}'><defs><linearGradient id='g' x1='-1' x2='0'><stop stop-color='%239ca3af' stop-opacity='.28'/><stop offset='.5' stop-color='%239ca3af' stop-opacity='.44'/><stop offset='1' stop-color='%239ca3af' stop-opacity='.28'/><animate attributeName='x1' from='-1' to='1' dur='1.2s' repeatCount='indefinite'/><animate attributeName='x2' from='0' to='2' dur='1.2s' repeatCount='indefinite'/></linearGradient></defs><rect width='100%' height='100%' fill='url(%23g)'/></svg>`;

// Get image dimensions from file
function getImageDimensions(file: File): Promise<ImageDimensions | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    const finish = (result: ImageDimensions | null) => {
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    };

    image.onload = () =>
      finish(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? { width: image.naturalWidth, height: image.naturalHeight }
          : null,
      );
    image.onerror = () => finish(null);

    image.src = objectUrl;
  });
}

function tryNormalizeHttpUrl(value: string): string | null {
  if (!value) return null;

  try {
    const normalized = new URL(value, window.location.origin);
    if (normalized.protocol !== "http:" && normalized.protocol !== "https:") {
      return null;
    }
    return normalized.toString();
  } catch {
    return null;
  }
}

function hasLikelyImageExtension(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const lastSegment = url.pathname.split("/").pop() ?? "";
    const extension = lastSegment.split(".").pop()?.toLowerCase();
    return !!extension && IMAGE_URL_EXTENSIONS.has(extension);
  } catch {
    return false;
  }
}

export function extractImageUrlsFromPastePayload({
  html,
  text,
}: {
  html?: string;
  text?: string;
}): string[] {
  const out = new Set<string>();

  if (html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const imageNodes = doc.querySelectorAll("img[src]");
    for (const image of imageNodes) {
      const src = image.getAttribute("src");
      if (!src) continue;
      const normalized = tryNormalizeHttpUrl(src);
      if (normalized) out.add(normalized);
    }
  }

  if (text) {
    const trimmedText = text.trim();
    const directUrl = tryNormalizeHttpUrl(trimmedText);
    if (directUrl && hasLikelyImageExtension(directUrl)) {
      out.add(directUrl);
    }

    const markdownImagePattern = /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/g;
    for (const match of trimmedText.matchAll(markdownImagePattern)) {
      const candidate = match[1];
      if (!candidate) continue;
      const normalized = tryNormalizeHttpUrl(candidate);
      if (normalized) out.add(normalized);
    }
  }

  return Array.from(out);
}

function fileNameFromImageUrl(imageUrl: string, mimeType: string): string {
  try {
    const url = new URL(imageUrl);
    const lastSegment = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    if (lastSegment) return lastSegment;
  } catch {
    // Ignore URL parsing failure; fallback below.
  }

  const extension = MIME_TYPE_TO_EXTENSION[mimeType] ?? "bin";
  return `pasted-image.${extension}`;
}

// Setup lazy loading for images
function setupLazyLoading(container: HTMLElement): () => void {
  const images = Array.from(container.querySelectorAll("img"));
  const cleanupFunctions: Array<() => void> = [];

  let observer: IntersectionObserver | null = null;
  if (typeof window !== "undefined" && "IntersectionObserver" in window) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const image = entry.target as HTMLImageElement;
          const dataSrc = image.getAttribute("data-src");
          if (dataSrc) {
            image.setAttribute("src", dataSrc);
            image.classList.remove("lazy-image-pending");
          }
          observer?.unobserve(image);
        }
      },
      { rootMargin: "600px" },
    );
  }

  for (const image of images) {
    const alt = image.getAttribute("alt") ?? "";
    if (alt.startsWith(UPLOADING_ALT_PREFIX)) continue;

    const dataSrc = image.getAttribute("data-src");
    if (!dataSrc || dataSrc.startsWith("data:")) continue;

    const alreadyPrepared = image.dataset.lazyPrepared === "true";
    const alreadyLoaded = image.getAttribute("src") === dataSrc;
    if (alreadyLoaded) {
      image.dataset.lazyPrepared = "true";
      image.classList.remove("lazy-image-pending");
      continue;
    }
    if (alreadyPrepared && alreadyLoaded) continue;

    image.dataset.lazyPrepared = "true";
    image.classList.add("lazy-image-pending");

    const handleLoad = () => {
      if (image.getAttribute("src") !== image.getAttribute("data-src")) {
        return;
      }
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        image.setAttribute("width", String(image.naturalWidth));
        image.setAttribute("height", String(image.naturalHeight));
      }
    };

    image.addEventListener("load", handleLoad);
    cleanupFunctions.push(() => image.removeEventListener("load", handleLoad));

    if (observer) {
      observer.observe(image);
      cleanupFunctions.push(() => observer.unobserve(image));
    } else {
      image.setAttribute("src", dataSrc);
    }
  }

  return () => {
    for (const cleanup of cleanupFunctions) cleanup();
    observer?.disconnect();
  };
}

function normalizeEditorImagesForLazyLoading(
  editor: Editor,
  skipDataSrcs?: ReadonlySet<string>,
): void {
  let tr = editor.state.tr;
  let changed = false;

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "image") return;

    const attrs = node.attrs as Record<string, unknown>;
    const alt = typeof attrs.alt === "string" ? attrs.alt : "";
    if (alt.startsWith(UPLOADING_ALT_PREFIX)) return;

    const src = typeof attrs.src === "string" ? attrs.src : "";
    const dataSrc =
      typeof attrs.dataSrc === "string" && attrs.dataSrc.length > 0
        ? attrs.dataSrc
        : src;
    if (!dataSrc || dataSrc.startsWith("data:")) return;
    if (skipDataSrcs?.has(dataSrc)) return;

    const width =
      typeof attrs.width === "number" && attrs.width > 0 ? attrs.width : null;
    const height =
      typeof attrs.height === "number" && attrs.height > 0
        ? attrs.height
        : null;
    if (!width || !height) return;

    const placeholderSrc = createGrayPreviewSrc({ width, height });
    if (src === placeholderSrc && attrs.dataSrc === dataSrc) return;

    tr = tr.setNodeMarkup(pos, undefined, {
      ...attrs,
      src: placeholderSrc,
      dataSrc,
    });
    changed = true;
  });

  if (changed) {
    editor.view.dispatch(tr);
  }
}

// Decorate content with lazy loading attributes
function decorateLazyImages(content: JSONContent): JSONContent {
  if (content.type === "image") {
    const attrs = (content.attrs ?? {}) as Record<string, unknown>;
    const alt = typeof attrs.alt === "string" ? attrs.alt : "";

    if (!alt.startsWith(UPLOADING_ALT_PREFIX)) {
      const dataSrc =
        typeof attrs.dataSrc === "string" && attrs.dataSrc.length > 0
          ? attrs.dataSrc
          : typeof attrs.src === "string"
            ? attrs.src
            : "";

      if (
        dataSrc &&
        !dataSrc.startsWith("data:") &&
        typeof attrs.width === "number" &&
        typeof attrs.height === "number" &&
        attrs.width > 0 &&
        attrs.height > 0
      ) {
        return {
          ...content,
          attrs: {
            ...attrs,
            src: createGrayPreviewSrc({
              width: attrs.width,
              height: attrs.height,
            }),
            dataSrc,
            loading: "lazy",
            decoding: "async",
          },
        };
      }
    }
  }

  if (!content.content) return content;
  return { ...content, content: content.content.map(decorateLazyImages) };
}

// SSR時に空キャプションが削除されることに対するワークアラウンド
const TrailingBreakNode = Node.create({
  name: "trailingBreak",
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  renderHTML() {
    return ["br", { class: "ProseMirror-trailingBreak" }];
  },
});

const EMPTY_CONTENT_JSON = new Editor({
  element: null,
  extensions: baseExtensions,
  contentType: "markdown",
  content: "",
}).getJSON();

function decorateImageOnlyParagraphTrailingBreak(
  content: JSONContent,
): JSONContent {
  const next = content.content
    ? {
        ...content,
        content: content.content.map(decorateImageOnlyParagraphTrailingBreak),
      }
    : content;

  if (next.type !== "paragraph") return next;

  const paragraphContent = next.content ?? [];
  const startsWithImage = paragraphContent[0]?.type === "image";
  const hasTrailingBreak = paragraphContent.some(
    (node) => node?.type === "trailingBreak",
  );
  if (!startsWithImage || hasTrailingBreak) {
    return next;
  }

  return {
    ...next,
    content: [...paragraphContent, { type: "trailingBreak" }],
  };
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
  const content = contentJSON ?? EMPTY_CONTENT_JSON;
  const html = renderToHTMLString({
    content: decorateImageOnlyParagraphTrailingBreak(
      decorateLazyImages(content),
    ),
    extensions: [...baseExtensions, TrailingBreakNode],
  });

  useEffect(() => {
    if (!containerRef.current) return;
    return setupLazyLoading(containerRef.current);
  }, []);

  return (
    <div
      ref={containerRef}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is rendered from TipTap content.
      dangerouslySetInnerHTML={{ __html: html }}
      {...props}
      className={cn(
        "tiptap w-full min-w-0 max-w-full overflow-visible",
        className,
      )}
    />
  );
}

function updatePlaceholder(
  editor: Editor,
  uploadToken: string,
  apply: (tr: Editor["state"]["tr"], pos: number) => void,
) {
  // Find placeholder node by upload token
  let pos: number | null = null;
  editor.state.doc.descendants((node, nodePos) => {
    if (
      node.type.name === "image" &&
      node.attrs.alt === `${UPLOADING_ALT_PREFIX}${uploadToken}`
    ) {
      pos = nodePos;
      return false;
    }
  });
  if (pos === null) return;

  const { tr } = editor.state;
  apply(tr, pos);
  editor.view.dispatch(tr);
}

async function uploadImageAndInsert(
  file: File,
  editor: Editor,
  editorId: string,
  onUploaded?: (url: string) => void,
) {
  const { from } = editor.state.selection;
  const dimensions = await getImageDimensions(file);
  const uploadToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const localPreviewUrl = URL.createObjectURL(file);

  // Insert placeholder image while uploading
  editor
    .chain()
    .focus()
    .insertContentAt(from, {
      type: "image",
      attrs: {
        src: localPreviewUrl,
        alt: `${UPLOADING_ALT_PREFIX}${uploadToken}`,
        uploading: true,
        width: null,
        height: null,
      },
    })
    .run();

  try {
    const result = await uploadImageService(file, editorId);
    // Replace placeholder with uploaded image
    updatePlaceholder(editor, uploadToken, (tr, pos) => {
      tr.setNodeMarkup(pos, undefined, {
        src: result.url,
        dataSrc: result.url,
        alt: file.name,
        uploading: false,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
      });
    });
    onUploaded?.(result.url);
  } catch (error) {
    // Remove placeholder on error
    updatePlaceholder(editor, uploadToken, (tr, pos) => {
      tr.delete(pos, pos + 1);
    });
    console.error("Upload failed:", {
      fileName: file.name,
      fileSize: file.size,
      editorId,
      uploadToken,
      error,
    });
  } finally {
    URL.revokeObjectURL(localPreviewUrl);
  }
}

async function uploadImageUrlAndInsert(
  imageUrl: string,
  editor: Editor,
  editorId: string,
  onUploaded?: (url: string) => void,
) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image URL: ${response.status}`);
    }

    const contentType =
      (response.headers.get("content-type") ?? "").split(";")[0] ?? "";
    if (!contentType.startsWith("image/")) {
      throw new Error(`Fetched resource is not image content: ${contentType}`);
    }

    const blob = await response.blob();
    const fileType = blob.type || contentType;
    const file = new File([blob], fileNameFromImageUrl(imageUrl, fileType), {
      type: fileType,
    });

    await uploadImageAndInsert(file, editor, editorId, onUploaded);
  } catch (error) {
    console.error("Failed to upload pasted image URL. Falling back to URL.", {
      imageUrl,
      editorId,
      error,
    });

    const { from } = editor.state.selection;
    editor
      .chain()
      .focus()
      .insertContentAt(from, {
        type: "image",
        attrs: {
          src: imageUrl,
          dataSrc: imageUrl,
          alt: fileNameFromImageUrl(imageUrl, ""),
          uploading: false,
          width: null,
          height: null,
        },
      })
      .run();
  }
}

function MarkdownEditor({
  editorOpts,
  editable,
  className,
  editorId,
  ...props
}: {
  editorOpts?: PartialEditorOptions;
  editable?: boolean;
  editorId: string;
} & HTMLAttributes<HTMLDivElement>) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor>(null);
  const noLazyDataSrcsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const baseHandlePaste = editorOpts?.editorProps?.handlePaste;
    const editor = createEditor({
      ...editorOpts,
      element: { mount: editorContainerRef.current! },
      editable,
      editorProps: {
        ...(editorOpts?.editorProps ?? {}),
        handlePaste: (view, event, slice) => {
          const items = event.clipboardData?.items ?? [];
          for (const item of items) {
            if (!item.type.startsWith("image/")) continue;
            event.preventDefault();
            const file = item.getAsFile();
            const currentEditor = editorRef.current;
            if (file && currentEditor) {
              void uploadImageAndInsert(file, currentEditor, editorId, (url) =>
                noLazyDataSrcsRef.current.add(url),
              );
            }
            return true;
          }

          const imageUrls = extractImageUrlsFromPastePayload({
            html: event.clipboardData?.getData("text/html"),
            text: event.clipboardData?.getData("text/plain"),
          });
          if (imageUrls.length > 0) {
            event.preventDefault();
            const currentEditor = editorRef.current;
            if (currentEditor) {
              void Promise.all(
                imageUrls.map((imageUrl) =>
                  uploadImageUrlAndInsert(
                    imageUrl,
                    currentEditor,
                    editorId,
                    (url) => noLazyDataSrcsRef.current.add(url),
                  ),
                ),
              );
            }
            return true;
          }

          return baseHandlePaste?.(view, event, slice) ?? false;
        },
      },
    });
    editorRef.current = editor;
    normalizeEditorImagesForLazyLoading(editor, noLazyDataSrcsRef.current);

    return () => {
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, [editable, editorId, editorOpts]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const container = editor.view.dom as HTMLElement;
    let cleanup = setupLazyLoading(container);

    const refresh = () => {
      normalizeEditorImagesForLazyLoading(editor, noLazyDataSrcsRef.current);
      cleanup();
      cleanup = setupLazyLoading(container);
    };

    editor.on("update", refresh);

    return () => {
      editor.off("update", refresh);
      cleanup();
    };
  }, []);

  return (
    <div
      ref={editorContainerRef}
      {...props}
      className={cn(
        "tiptap w-full min-w-0 max-w-full overflow-visible",
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
  const [collabDoc, setCollabDoc] = useState<Y.Doc | null>(null);
  const { snapshotJSON, yjsUpdate } = bootstrap ?? {};

  useEffect(() => {
    if (!editorId) {
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
  }, [editorId, yjsUpdate]);

  const editorOpts = useMemo<PartialEditorOptions | undefined>(() => {
    if (!collabDoc) return undefined;
    return {
      extensions: [
        ...baseExtensions,
        Collaboration.configure({
          document: collabDoc,
          field: "default",
        }),
      ],
    };
  }, [collabDoc]);

  return import.meta.env.SSR || !collabDoc ? (
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
