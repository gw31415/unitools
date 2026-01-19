import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { Markdown as MarkdownExt } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { renderToHTMLString } from "@tiptap/static-renderer";
import type { HTMLAttributes } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { cn } from "@/lib/utils";

const baseExtensions = [StarterKit, MarkdownExt];

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
  content,
  contentJSON,
  className,
  ...props
}: {
  content?: string;
  contentJSON?: JSONContent | null;
} & HTMLAttributes<HTMLDivElement>) {
  let json: JSONContent;
  if (contentJSON) {
    json = contentJSON;
  } else {
    const editor = createEditor({ element: null, content: content ?? "" });
    json = editor.getJSON();
  }
  const html = renderToHTMLString({
    content: json,
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

const base64ToUint8Array = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export default function Markdown({
  docId,
  initialDocUpdate,
  initialDocJSON,
  readonly,
  ...props
}: {
  docId: string;
  initialDocUpdate?: string;
  initialDocJSON?: JSONContent | null;
  readonly?: boolean;
} & HTMLAttributes<HTMLDivElement>) {
  const [mounted, setMounted] = useState(false);
  const [collabState, setCollabState] = useState<{
    doc: Y.Doc;
    provider: WebsocketProvider;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || readonly || !docId) {
      setCollabState(null);
      return;
    }
    const doc = new Y.Doc();
    if (initialDocUpdate) {
      try {
        Y.applyUpdate(doc, base64ToUint8Array(initialDocUpdate));
      } catch {
        // Ignore malformed updates; live sync will repair.
      }
    }
    const wsBase = new URL(
      `/api/v1/page/${encodeURIComponent(docId)}/editor`,
      window.location.origin,
    );
    wsBase.protocol = wsBase.protocol === "https:" ? "wss:" : "ws:";
    const provider = new WebsocketProvider(wsBase.toString(), "ws", doc);
    setCollabState({ doc, provider });
    return () => {
      provider.destroy();
      doc.destroy();
      setCollabState(null);
    };
  }, [mounted, readonly, docId, initialDocUpdate]);

  const editorOpts = useMemo<PartialEditorOptions | undefined>(() => {
    if (!collabState || !docId) return undefined;
    return {
      extensions: [
        ...baseExtensions,
        Collaboration.configure({
          document: collabState.doc,
          field: "default",
        }),
      ],
      editorProps: {
        attributes: {
          "data-collab-ws": `/api/v1/page/${encodeURIComponent(docId)}/editor/ws`,
        },
      },
    };
  }, [collabState, docId]);

  const shouldRenderEditor = mounted && !readonly && !!collabState;
  return (
    <>
      {import.meta.env.SSR || !shouldRenderEditor ? (
        <MarkdownView contentJSON={initialDocJSON} {...props} />
      ) : (
        <MarkdownEditor editorOpts={editorOpts} {...props} />
      )}
    </>
  );
}
