import { Editor, type JSONContent, Node } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { renderToHTMLString } from "@tiptap/static-renderer";
import type { HTMLAttributes } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { b64ToUint8Array } from "@/lib/base64";
import { baseExtensions } from "@/lib/editorExtensions";
import { uploadImage as uploadImageService } from "@/lib/imageService";
import { cn } from "@/lib/utils";

type PartialEditorOptions = Partial<ConstructorParameters<typeof Editor>[0]>;
const UPLOADING_ALT_PREFIX = "uploading:";

type ImageDimensions = {
  width: number;
  height: number;
};

// Create gray preview SVG for lazy loading
function createGrayPreviewSrc(dimensions: ImageDimensions): string {
  const { width, height } = dimensions;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}'><defs><linearGradient id='g' x1='-1' x2='0'><stop stop-color='%239ca3af' stop-opacity='.28'/><stop offset='.5' stop-color='%239ca3af' stop-opacity='.44'/><stop offset='1' stop-color='%239ca3af' stop-opacity='.28'/><animate attributeName='x1' from='-1' to='1' dur='1.2s' repeatCount='indefinite'/><animate attributeName='x2' from='0' to='2' dur='1.2s' repeatCount='indefinite'/></linearGradient></defs><rect width='100%' height='100%' fill='url(%23g)'/></svg>`;
  return `data:image/svg+xml,${svg}`;
}

// Get image dimensions from file
function getImageDimensions(file: File): Promise<ImageDimensions | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      } else {
        resolve(null);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };

    image.src = objectUrl;
  });
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
          if (entry.isIntersecting) {
            const image = entry.target as HTMLImageElement;
            const dataSrc = image.getAttribute("data-src");
            if (dataSrc) {
              image.setAttribute("src", dataSrc);
              image.classList.remove("lazy-image-pending");
            }
            observer?.unobserve(image);
          }
        }
      },
      { rootMargin: "600px" },
    );
  }

  for (const image of images) {
    if (image.dataset.lazyPrepared === "true") continue;

    const alt = image.getAttribute("alt") ?? "";
    if (alt.startsWith(UPLOADING_ALT_PREFIX)) continue;

    const dataSrc = image.getAttribute("data-src");
    if (!dataSrc || dataSrc.startsWith("data:")) continue;

    image.dataset.lazyPrepared = "true";
    image.classList.add("lazy-image-pending");

    const handleLoad = () => {
      const currentDataSrc = image.getAttribute("data-src");
      const currentSrc = image.getAttribute("src");
      if (currentDataSrc && currentSrc === currentDataSrc) {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          image.setAttribute("width", String(image.naturalWidth));
          image.setAttribute("height", String(image.naturalHeight));
        }
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
    for (const cleanup of cleanupFunctions) {
      cleanup();
    }
    observer?.disconnect();
  };
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

  if (content.content) {
    return {
      ...content,
      content: content.content.map(decorateLazyImages),
    };
  }

  return content;
}

function createEditor(options: PartialEditorOptions = {}) {
  const { extensions, ...rest } = options;
  return new Editor({
    extensions: extensions ?? baseExtensions,
    contentType: "markdown",
    ...rest,
  });
}

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

// SSR時に空キャプションが削除されることに対するワークアラウンド
function decorateImageOnlyParagraphTrailingBreak(
  content: JSONContent,
): JSONContent {
  const next: JSONContent = content.content
    ? {
        ...content,
        content: content.content.map(decorateImageOnlyParagraphTrailingBreak),
      }
    : content;

  if (next.type !== "paragraph") return next;

  const paragraphContent = next.content ?? [];
  const hasImageOnly =
    paragraphContent.length === 1 && paragraphContent[0]?.type === "image";
  if (!hasImageOnly) return next;

  return {
    ...next,
    content: [...paragraphContent, { type: "trailingBreak" }],
  };
}

function MarkdownView({
  contentJSON,
  className,
  ...props
}: {
  contentJSON?: JSONContent | null;
} & HTMLAttributes<HTMLDivElement>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => {
    const content =
      contentJSON ?? createEditor({ element: null, content: "" }).getJSON();
    return renderToHTMLString({
      content: decorateImageOnlyParagraphTrailingBreak(
        decorateLazyImages(content),
      ),
      extensions: [...baseExtensions, TrailingBreakNode],
    });
  }, [contentJSON]);

  useEffect(() => {
    if (containerRef.current) {
      return setupLazyLoading(containerRef.current);
    }
  }, []);

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

  // Insert placeholder image while uploading
  const insertUploadPlaceholder = useCallback(
    (editor: Editor, file: File, position: number) => {
      const uploadToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const localPreviewUrl = URL.createObjectURL(file);

      editor
        .chain()
        .focus()
        .insertContentAt(position, {
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

      return { uploadToken, localPreviewUrl };
    },
    [],
  );

  // Find placeholder node by upload token
  const findPlaceholderByToken = useCallback(
    (editor: Editor, uploadToken: string) => {
      let result: { pos: number; attrs: Record<string, unknown> } | undefined;

      editor.state.doc.descendants((node, pos) => {
        if (
          node.type.name === "image" &&
          node.attrs.alt === `${UPLOADING_ALT_PREFIX}${uploadToken}`
        ) {
          result = { pos, attrs: node.attrs as Record<string, unknown> };
          return false;
        }
      });

      return result;
    },
    [],
  );

  // Replace placeholder with uploaded image
  const replaceUploadPlaceholder = useCallback(
    (
      editor: Editor,
      uploadToken: string,
      file: File,
      dimensions: ImageDimensions | null,
      result: { url: string; id: string },
    ) => {
      const placeholder = findPlaceholderByToken(editor, uploadToken);
      if (!placeholder) return;

      const { tr } = editor.state;
      tr.setNodeMarkup(placeholder.pos, undefined, {
        src: dimensions ? createGrayPreviewSrc(dimensions) : result.url,
        dataSrc: result.url,
        alt: file.name,
        uploading: false,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
      });
      editor.view.dispatch(tr);
    },
    [findPlaceholderByToken],
  );

  // Remove placeholder on error
  const removeUploadPlaceholder = useCallback(
    (editor: Editor, uploadToken: string) => {
      const placeholder = findPlaceholderByToken(editor, uploadToken);
      if (!placeholder) return;

      const { tr } = editor.state;
      tr.delete(placeholder.pos, placeholder.pos + 1);
      editor.view.dispatch(tr);
    },
    [findPlaceholderByToken],
  );

  const uploadImageAndInsert = useCallback(
    async (file: File, editor: Editor) => {
      const { from } = editor.state.selection;
      const dimensions = await getImageDimensions(file);
      const { uploadToken, localPreviewUrl } = insertUploadPlaceholder(
        editor,
        file,
        from,
      );

      try {
        const result = await uploadImageService(file, editorId!);
        replaceUploadPlaceholder(editor, uploadToken, file, dimensions, result);
      } catch (error) {
        removeUploadPlaceholder(editor, uploadToken);
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
    },
    [
      editorId,
      insertUploadPlaceholder,
      replaceUploadPlaceholder,
      removeUploadPlaceholder,
    ],
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
    let cleanup = setupLazyLoading(container);

    const refresh = () => {
      cleanup?.();
      cleanup = setupLazyLoading(container);
    };

    editor.on("update", refresh);

    return () => {
      editor.off("update", refresh);
      cleanup?.();
    };
  }, []);

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
