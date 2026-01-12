import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import { Markdown as MarkdownExt } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { renderToHTMLString } from "@tiptap/static-renderer";
import { type JSX, useEffect, useRef } from "hono/jsx";

const extensions = [StarterKit];

type PartialEditorOptions = Partial<ConstructorParameters<typeof Editor>[0]>;

function useEditor(options: PartialEditorOptions = {}) {
  return new Editor({
    extensions: [...extensions, MarkdownExt],
    contentType: "markdown",
    ...options,
  });
}

function MarkdownView({
  content,
  ...props
}: { content: string } & JSX.HTMLAttributes) {
  const editor = useEditor({ element: null, content });
  const json: JSONContent = editor.getJSON();
  const html = renderToHTMLString({ content: json, extensions });
  return <div dangerouslySetInnerHTML={{ __html: html }} {...props} />;
}

function MarkdownEditor({
  editorOpts,
  ...props
}: { editorOpts?: PartialEditorOptions } & JSX.HTMLAttributes) {
  const editorContainerRef = useRef<HTMLElement>(null);
  const editorRef = useRef<Editor>(null);

  useEffect(() => {
    editorRef.current = useEditor({
      element: { mount: editorContainerRef.current! },
      ...editorOpts,
    });

    return () => {
      if (editorRef.current) {
        editorRef.current.destroy();
      }
      editorRef.current = null;
    };
  }, []);
  return <div ref={editorContainerRef} {...props} />;
}

export default function Markdown({
  content,
  readonly,
  ...props
}: {
  content: string;
  readonly?: boolean;
} & JSX.HTMLAttributes) {
  return (
    <>
      {import.meta.env.SSR || readonly ? (
        <MarkdownView content={content} {...props} />
      ) : (
        <MarkdownEditor editorOpts={{ content }} {...props} />
      )}
    </>
  );
}
