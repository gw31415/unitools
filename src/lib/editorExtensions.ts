import { Markdown as MarkdownExt } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

export const baseExtensions = [
  StarterKit.configure({ undoRedo: false }),
  MarkdownExt,
];
