import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  collectReferencedImageIds,
  collectReferencedImageIdsFromYXmlFragment,
  extractImageIdFromSource,
} from "../editorImageCleanup";

describe("editorImageCleanup", () => {
  describe("extractImageIdFromSource", () => {
    it("extracts image id from relative image API path", () => {
      const id = "01HZX3T47PW5Z7F73Q0Z6E4TQ3";
      expect(extractImageIdFromSource(`/api/v1/images/${id}`)).toBe(id);
    });

    it("extracts image id from absolute URL with query", () => {
      const id = "01HZX3T47PW5Z7F73Q0Z6E4TQ3";
      expect(
        extractImageIdFromSource(
          `https://example.com/api/v1/images/${id}?cache=1`,
        ),
      ).toBe(id);
    });

    it("returns null for non-image API paths and data URLs", () => {
      expect(extractImageIdFromSource("data:image/png;base64,xxx")).toBeNull();
      expect(
        extractImageIdFromSource("/images/01HZX3T47PW5Z7F73Q0Z6E4TQ3"),
      ).toBe(null);
    });
  });

  describe("collectReferencedImageIds", () => {
    it("collects image ids from src and dataSrc recursively", () => {
      const firstId = "01HZX3T47PW5Z7F73Q0Z6E4TQ3";
      const secondId = "01HZX3T47PW5Z7F73Q0Z6E4TQ4";

      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "image",
                attrs: {
                  src: `/api/v1/images/${firstId}`,
                },
              },
            ],
          },
          {
            type: "image",
            attrs: {
              src: "data:image/svg+xml,placeholder",
              dataSrc: `https://example.com/api/v1/images/${secondId}`,
            },
          },
        ],
      };

      expect(Array.from(collectReferencedImageIds(content)).sort()).toEqual(
        [firstId, secondId].sort(),
      );
    });

    it("ignores invalid or missing image IDs", () => {
      const content = {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              src: "/api/v1/images/not-valid-id",
            },
          },
          {
            type: "image",
            attrs: {},
          },
        ],
      };

      expect(collectReferencedImageIds(content).size).toBe(0);
    });
  });

  describe("collectReferencedImageIdsFromYXmlFragment", () => {
    it("collects image ids from yjs xml image nodes", () => {
      const firstId = "01HZX3T47PW5Z7F73Q0Z6E4TQ3";
      const secondId = "01HZX3T47PW5Z7F73Q0Z6E4TQ4";

      const doc = new Y.Doc();
      const root = doc.getXmlFragment("default");
      const paragraph = new Y.XmlElement("paragraph");
      const image1 = new Y.XmlElement("image");
      const image2 = new Y.XmlElement("image");

      image1.setAttribute("src", `/api/v1/images/${firstId}`);
      image2.setAttribute(
        "dataSrc",
        `https://example.com/api/v1/images/${secondId}`,
      );
      paragraph.push([image1, image2]);
      root.push([paragraph]);

      expect(
        Array.from(collectReferencedImageIdsFromYXmlFragment(root)).sort(),
      ).toEqual([firstId, secondId].sort());
    });
  });
});
