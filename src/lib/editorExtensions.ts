import Image from "@tiptap/extension-image";
import { Markdown as MarkdownExt } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("width");
          if (!value) return null;
          const parsed = Number.parseInt(value, 10);
          return Number.isFinite(parsed) ? parsed : null;
        },
      },
      height: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("height");
          if (!value) return null;
          const parsed = Number.parseInt(value, 10);
          return Number.isFinite(parsed) ? parsed : null;
        },
      },
      dataSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-src"),
        renderHTML: (attributes) => {
          if (!attributes.dataSrc) return {};
          return { "data-src": attributes.dataSrc };
        },
      },
      uploading: {
        default: false,
        parseHTML: (element) => element.hasAttribute("data-uploading"),
        renderHTML: (attributes) => {
          if (!attributes.uploading) return {};
          return { "data-uploading": "" };
        },
      },
    };
  },
}).configure({
  inline: true,
  allowBase64: false,
  HTMLAttributes: {
    class: "not-prose",
  },
});

export const baseExtensions = [
  StarterKit.configure({ undoRedo: false }),
  MarkdownExt,
  CustomImage,
];
