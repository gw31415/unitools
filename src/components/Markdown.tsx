import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import { Markdown as MarkdownExt } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { renderToHTMLString } from "@tiptap/static-renderer";
import { useEffect, useRef } from "hono/jsx";

const extensions = [StarterKit];

type PartialEditorOptions = Partial<ConstructorParameters<typeof Editor>[0]>;

function useEditor(options: PartialEditorOptions = {}) {
  return new Editor({
    extensions: [...extensions, MarkdownExt],
    contentType: "markdown",
    ...options,
  });
}

function MarkdownView(props: { content: string }) {
  const editor = useEditor({
    element: null,
    content: props.content,
  });
  const content: JSONContent = editor.getJSON();
  const html = renderToHTMLString({ content, extensions });
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function MarkdownEditor(props: { editorOpts?: PartialEditorOptions }) {
  const editorContainerRef = useRef<HTMLElement>(null);
  const editorRef = useRef<Editor>(null);

  useEffect(() => {
    (async () => {
      editorRef.current = useEditor({
        element: editorContainerRef.current!,
        ...props.editorOpts,
      });
    })();

    return () => {
      if (editorRef.current) {
        editorRef.current.destroy();
      }
      editorRef.current = null;
    };
  }, []);
  return <div ref={editorContainerRef} />;
}

export function Markdown(props: { content: string }) {
  return (
    <>
      {import.meta.env.SSR ? (
        <MarkdownView content={props.content} />
      ) : (
        <MarkdownEditor editorOpts={{ content: props.content }} />
      )}
    </>
  );
}
