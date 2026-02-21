import type { JSONContent } from "@tiptap/core";
import { renderToMarkdown } from "@tiptap/static-renderer";
import { describe, expect, it } from "vitest";
import { baseExtensions } from "../editorExtensions";
import { normalizeMarkdownExportContent } from "../markdownExport";

function render(content: JSONContent): string {
  return renderToMarkdown({
    content: normalizeMarkdownExportContent(content),
    extensions: baseExtensions,
  });
}

describe("normalizeMarkdownExportContent", () => {
  it("prefers dataSrc over placeholder data image src", () => {
    const markdown = render({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: {
                src: "data:image/svg+xml,placeholder",
                dataSrc: "/api/v1/images/01HZX3T47PW5Z7F73Q0Z6E4TQ3",
                alt: "test image",
              },
            },
          ],
        },
      ],
    });

    expect(markdown).toContain(
      "![test image](/api/v1/images/01HZX3T47PW5Z7F73Q0Z6E4TQ3)",
    );
    expect(markdown).not.toContain("data:image/svg+xml");
  });

  it("uses src when dataSrc is not present", () => {
    const markdown = render({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: {
                src: "/api/v1/images/01HZX3T47PW5Z7F73Q0Z6E4TQ4",
                alt: "fallback image",
              },
            },
          ],
        },
      ],
    });

    expect(markdown).toContain(
      "![fallback image](/api/v1/images/01HZX3T47PW5Z7F73Q0Z6E4TQ4)",
    );
  });

  it("removes uploading images from export", () => {
    const markdown = render({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: {
                src: "/api/v1/images/01HZX3T47PW5Z7F73Q0Z6E4TQ5",
                uploading: true,
                alt: "uploading image",
              },
            },
          ],
        },
      ],
    });

    expect(markdown).not.toContain("![uploading image]");
    expect(markdown.trim()).toBe("");
  });

  it("keeps non-image markdown content unchanged", () => {
    const markdown = render({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "hello world" }],
        },
      ],
    });

    expect(markdown.trim()).toBe("hello world");
  });
});
