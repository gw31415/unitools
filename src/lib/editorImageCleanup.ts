import * as Y from "yjs";

const IMAGE_ID_LENGTH = 26;
const IMAGE_API_PATH_PREFIX = "/api/v1/images/";

function toPathname(source: string): string | null {
  if (source.startsWith("data:")) {
    return null;
  }

  try {
    return new URL(source, "https://unitools.local").pathname;
  } catch {
    return null;
  }
}

export function extractImageIdFromSource(source: string): string | null {
  const pathname = toPathname(source);
  if (!pathname) {
    return null;
  }

  if (!pathname.startsWith(IMAGE_API_PATH_PREFIX)) {
    return null;
  }

  const id = pathname.slice(IMAGE_API_PATH_PREFIX.length).replace(/\/+$/, "");
  if (id.length !== IMAGE_ID_LENGTH) {
    return null;
  }

  return /^[0-9A-Za-z]+$/.test(id) ? id : null;
}

function collectImageIdsFromNode(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      collectImageIdsFromNode(child, out);
    }
    return;
  }

  const record = node as Record<string, unknown>;
  if (record.type === "image") {
    const attrs =
      record.attrs && typeof record.attrs === "object"
        ? (record.attrs as Record<string, unknown>)
        : {};
    const sources = [attrs.dataSrc, attrs.src];

    for (const source of sources) {
      if (typeof source !== "string") {
        continue;
      }
      const imageId = extractImageIdFromSource(source);
      if (imageId) {
        out.add(imageId);
      }
    }
  }

  collectImageIdsFromNode(record.content, out);
}

export function collectReferencedImageIds(content: unknown): Set<string> {
  const imageIds = new Set<string>();
  collectImageIdsFromNode(content, imageIds);
  return imageIds;
}

function collectImageIdsFromYNode(
  node: Y.XmlFragment | Y.XmlElement,
): Set<string> {
  const imageIds = new Set<string>();

  const visit = (current: Y.XmlFragment | Y.XmlElement) => {
    for (const child of current.toArray()) {
      if (!(child instanceof Y.XmlElement)) {
        continue;
      }

      if (child.nodeName === "image") {
        const attrs = child.getAttributes() as Record<string, unknown>;
        const sources = [attrs.dataSrc, attrs.src];

        for (const source of sources) {
          if (typeof source !== "string") {
            continue;
          }
          const imageId = extractImageIdFromSource(source);
          if (imageId) {
            imageIds.add(imageId);
          }
        }
      }

      visit(child);
    }
  };

  visit(node);
  return imageIds;
}

export function collectReferencedImageIdsFromYXmlFragment(
  xmlFragment: Y.XmlFragment,
): Set<string> {
  return collectImageIdsFromYNode(xmlFragment);
}
