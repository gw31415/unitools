import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import { Markdown as MarkdownExt } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { renderToHTMLString } from "@tiptap/static-renderer";
import type { HTMLAttributes } from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const extensions = [StarterKit];

type PartialEditorOptions = Partial<ConstructorParameters<typeof Editor>[0]>;

function createEditor(options: PartialEditorOptions = {}) {
  return new Editor({
    extensions: [...extensions, MarkdownExt],
    contentType: "markdown",
    ...options,
  });
}

function MarkdownView({
  content,
  className,
  ...props
}: { content: string } & HTMLAttributes<HTMLDivElement>) {
  const editor = createEditor({ element: null, content });
  const json: JSONContent = editor.getJSON();
  const html = renderToHTMLString({ content: json, extensions });
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
  className,
  ...props
}: { editorOpts?: PartialEditorOptions } & HTMLAttributes<HTMLDivElement>) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor>(null);

  useEffect(() => {
    editorRef.current = createEditor({
      element: { mount: editorContainerRef.current! },
      ...editorOpts,
    });

    return () => {
      if (editorRef.current) {
        editorRef.current.destroy();
      }
      editorRef.current = null;
    };
  }, [editorOpts]);
  return (
    <div
      ref={editorContainerRef}
      {...props}
      className={cn("tiptap w-full min-w-0 max-w-full overflow-x-auto", className)}
    />
  );
}

export default function Markdown({
  content,
  readonly,
  ...props
}: {
  content: string;
  readonly?: boolean;
} & HTMLAttributes<HTMLDivElement>) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const shouldRenderEditor = mounted && !readonly;
  return (
    <>
      {import.meta.env.SSR || !shouldRenderEditor ? (
        <MarkdownView content={content} {...props} />
      ) : (
        <MarkdownEditor editorOpts={{ content }} {...props} />
      )}
    </>
  );
}
