import type { JSONContent } from "@tiptap/core";

const DATA_IMAGE_PREFIX = "data:image/";

function resolveExportImageSrc(attrs: Record<string, unknown>): string | null {
  const candidates = [attrs.dataSrc, attrs.src];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const source = candidate.trim();
    if (!source || source.startsWith(DATA_IMAGE_PREFIX)) {
      continue;
    }
    return source;
  }

  return null;
}

export function normalizeMarkdownExportContent(
  content: JSONContent,
): JSONContent {
  const visit = (node: JSONContent): JSONContent | null => {
    const rawContent = Array.isArray(node.content) ? node.content : undefined;
    const nextChildren = rawContent
      ?.map(visit)
      .filter((child): child is JSONContent => child !== null);

    if (node.type === "image") {
      const attrs =
        node.attrs && typeof node.attrs === "object"
          ? (node.attrs as Record<string, unknown>)
          : {};
      if (attrs.uploading === true) {
        return null;
      }

      const source = resolveExportImageSrc(attrs);
      if (!source) {
        return null;
      }

      const { dataSrc: _dataSrc, ...restAttrs } = attrs;
      return {
        ...node,
        attrs: {
          ...restAttrs,
          src: source,
        },
        ...(nextChildren ? { content: nextChildren } : {}),
      };
    }

    return {
      ...node,
      ...(nextChildren ? { content: nextChildren } : {}),
    };
  };

  const normalized = visit(content);
  return normalized ?? { type: "doc", content: [] };
}
