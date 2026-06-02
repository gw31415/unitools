import { describe, expect, it } from "vite-plus/test";
import { findEditorTextMatch } from "../editorTextMatch";

function createRoot(text: string) {
  const root = document.createElement("div");
  root.textContent = text;
  return root;
}

function matchedText(root: HTMLElement, searchText: string) {
  const match = findEditorTextMatch(root, searchText);
  if (!match) return null;

  const range = document.createRange();
  range.setStart(match.node, match.startOffset);
  range.setEnd(match.node, match.endOffset);
  return range.toString();
}

describe("editor text matching", () => {
  it("matches only the requested phrase instead of the rest of the text node", () => {
    const root = createRoot("Before Alpha keyword after");

    expect(matchedText(root, "Alpha keyword")).toBe("Alpha keyword");
  });

  it("does not fuzzy-match a similar phrase on the client", () => {
    const root = createRoot("Intro Alpha related after");

    expect(matchedText(root, "Alpha keyword")).toBeNull();
  });

  it("maps normalized matches back to the original text offsets", () => {
    const root = createRoot("Ａｌｐｈａ keyword after");

    expect(matchedText(root, "Alpha keyword")).toBe("Ａｌｐｈａ keyword");
  });

  it("matches server-provided phrases across punctuation and whitespace differences", () => {
    const root = createRoot("夜間のADH分泌↓が関連→中途覚醒の強制は逆効果。");

    expect(matchedText(root, "ADH分泌が関連")).toBe("ADH分泌↓が関連");
  });
});
