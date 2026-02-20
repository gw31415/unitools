import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { baseExtensions } from "../editorExtensions";

describe("editorExtensions", () => {
  describe("CustomImage", () => {
    it("should parse image with width and height attributes", () => {
      const editor = new Editor({
        extensions: baseExtensions,
        content: '<img src="test.jpg" width="100" height="200" />',
      });

      // TipTap wraps content in paragraph by default
      const paragraph = editor.state.doc.firstChild;
      const imageNode = paragraph?.firstChild;
      expect(imageNode?.type.name).toBe("image");
      expect(imageNode?.attrs.width).toBe(100);
      expect(imageNode?.attrs.height).toBe(200);

      editor.destroy();
    });

    it("should handle invalid width/height gracefully", () => {
      const editor = new Editor({
        extensions: baseExtensions,
        content: '<img src="test.jpg" width="invalid" height="200" />',
      });

      const paragraph = editor.state.doc.firstChild;
      const imageNode = paragraph?.firstChild;
      expect(imageNode?.type.name).toBe("image");
      expect(imageNode?.attrs.width).toBeNull();

      editor.destroy();
    });

    it("should parse data-src attribute", () => {
      const editor = new Editor({
        extensions: baseExtensions,
        content: '<img data-src="real-image.jpg" src="placeholder.jpg" />',
      });

      const paragraph = editor.state.doc.firstChild;
      const imageNode = paragraph?.firstChild;
      expect(imageNode?.type.name).toBe("image");
      expect(imageNode?.attrs.dataSrc).toBe("real-image.jpg");

      editor.destroy();
    });

    it("should parse uploading attribute", () => {
      const editor = new Editor({
        extensions: baseExtensions,
        content: '<img src="test.jpg" data-uploading />',
      });

      const paragraph = editor.state.doc.firstChild;
      const imageNode = paragraph?.firstChild;
      expect(imageNode?.type.name).toBe("image");
      expect(imageNode?.attrs.uploading).toBe(true);

      editor.destroy();
    });

    it("should render data-uploading attribute when uploading is true", () => {
      const editor = new Editor({
        extensions: baseExtensions,
        content: "",
      });

      // Insert content with custom attribute directly
      editor.commands.insertContent({
        type: "image",
        attrs: {
          src: "test.jpg",
          uploading: true,
        },
      });

      const html = editor.getHTML();
      expect(html).toContain('data-uploading');

      editor.destroy();
    });

    it("should render data-src attribute", () => {
      const editor = new Editor({
        extensions: baseExtensions,
        content: "",
      });

      // Insert content with custom attribute directly
      editor.commands.insertContent({
        type: "image",
        attrs: {
          src: "placeholder.jpg",
          dataSrc: "real.jpg",
        },
      });

      const html = editor.getHTML();
      expect(html).toContain('data-src="real.jpg"');

      editor.destroy();
    });
  });

  describe("baseExtensions", () => {
    it("should include CustomImage extension", () => {
      const editor = new Editor({
        extensions: baseExtensions,
        content: "",
      });

      expect(editor.extensionManager.extensions).toContainEqual(
        expect.objectContaining({
          name: "image",
        }),
      );

      editor.destroy();
    });
  });
});
