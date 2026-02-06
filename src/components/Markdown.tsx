import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { renderToHTMLString } from "@tiptap/static-renderer";
import type { HTMLAttributes } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { toUint8Array } from "@/lib/base64";
import { baseExtensions } from "@/lib/editorExtensions";
import { cn } from "@/lib/utils";

type PartialEditorOptions = Partial<ConstructorParameters<typeof Editor>[0]>;

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
  const html = renderToHTMLString({
    content:
      contentJSON ?? createEditor({ element: null, content: "" }).getJSON(),
    extensions: baseExtensions,
  });
  return (
    <div
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
  className,
  ...props
}: {
  editorOpts?: PartialEditorOptions;
  onReady?: (editor: Editor) => void;
} & HTMLAttributes<HTMLDivElement>) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor>(null);

  useEffect(() => {
    editorRef.current = createEditor({
      element: { mount: editorContainerRef.current! },
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
  }, [editorOpts, onReady]);
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
  docId,
  bootstrap,
  readonly,
  ...props
}: {
  docId: string;
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
    if (!mounted || readonly || !docId) {
      setCollabDoc(null);
      return;
    }
    const doc = new Y.Doc();
    if (yjsUpdate) {
      try {
        Y.applyUpdate(doc, toUint8Array(yjsUpdate));
      } catch {
        // Ignore malformed updates; live sync will repair.
      }
    }

    const wsUrl = new URL("/api/v1/editor", window.location.origin);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    const provider = new WebsocketProvider(wsUrl.toString(), docId, doc, {
      connect: true,
    });
    setCollabDoc(doc);
    return () => {
      provider.destroy();
      doc.destroy();
      setCollabDoc(null);
    };
  }, [mounted, readonly, docId, yjsUpdate]);

  const editorOpts = useMemo<PartialEditorOptions | undefined>(() => {
    if (!collabDoc || !docId) return undefined;
    return {
      extensions: [
        ...baseExtensions,
        Collaboration.configure({
          document: collabDoc,
          field: "default",
        }),
      ],
    };
  }, [collabDoc, docId]);

  const shouldRenderEditor = mounted && !readonly && !!collabDoc;
  return (
    <>
      {import.meta.env.SSR || !shouldRenderEditor ? (
        <MarkdownView contentJSON={snapshotJSON} {...props} />
      ) : (
        <MarkdownEditor editorOpts={editorOpts} {...props} />
      )}
    </>
  );
}
