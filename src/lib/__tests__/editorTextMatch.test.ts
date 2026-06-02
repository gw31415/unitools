import { describe, expect, it } from "vite-plus/test";
import { findEditorTextMatch } from "../editorTextMatch";

function createRoot(text: string) {
  const root = document.createElement("div");
  root.textContent = text;
  return root;
}

function matchedText(root: HTMLElement, searchTexts: Array<string | null | undefined>) {
  const match = findEditorTextMatch(root, searchTexts);
  if (!match) return null;

  const range = document.createRange();
  range.setStart(match.node, match.startOffset);
  range.setEnd(match.node, match.endOffset);
  return range.toString();
}

describe("editor text matching", () => {
  it("matches only the requested phrase instead of the rest of the text node", () => {
    const root = createRoot("Before Alpha keyword after");

    expect(matchedText(root, ["Alpha keyword"])).toBe("Alpha keyword");
  });

  it("prefers a longer phrase over a shorter fallback match", () => {
    const root = createRoot("Intro Alpha keyword after");

    expect(matchedText(root, ["Alpha keyword", "Alpha"])).toBe("Alpha keyword");
  });

  it("falls back to a shorter term when the longer phrase is absent", () => {
    const root = createRoot("Intro Alpha related after");

    expect(matchedText(root, ["Alpha keyword", "Alpha"])).toBe("Alpha");
  });

  it("selects a similar long phrase before falling back to an exact short term", () => {
    const root = createRoot("Intro Alpha related keyword after");

    const match = findEditorTextMatch(root, ["Alpha", "Alpha keyword"], {
      termGroups: [["Alpha"], ["keyword"]],
    });
    expect(match).not.toBeNull();

    const range = document.createRange();
    range.setStart(match!.node, match!.startOffset);
    range.setEnd(match!.node, match!.endOffset);
    expect(range.toString()).toBe("Alpha related keyword");
  });

  it("selects a high-similarity Japanese phrase when particles differ from the query", () => {
    const root = createRoot("前置き プロンプトを改善する方法 後続");

    const match = findEditorTextMatch(root, ["プロンプト", "プロンプト改善"], {
      termGroups: [["プロンプト"], ["改善"]],
    });
    expect(match).not.toBeNull();

    const range = document.createRange();
    range.setStart(match!.node, match!.startOffset);
    range.setEnd(match!.node, match!.endOffset);
    expect(range.toString()).toBe("プロンプトを改善");
  });

  it("treats alternatives inside each term group as OR", () => {
    const root = createRoot("前置き プロンプトを改良する方法 後続");

    const match = findEditorTextMatch(root, ["プロンプト", "プロンプト改善"], {
      termGroups: [["プロンプト"], ["改善", "改良"]],
    });
    expect(match).not.toBeNull();

    const range = document.createRange();
    range.setStart(match!.node, match!.startOffset);
    range.setEnd(match!.node, match!.endOffset);
    expect(range.toString()).toBe("プロンプトを改良");
  });

  it("maps normalized matches back to the original text offsets", () => {
    const root = createRoot("Ａｌｐｈａ keyword after");

    expect(matchedText(root, ["Alpha keyword"])).toBe("Ａｌｐｈａ keyword");
  });
});
