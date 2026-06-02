import { describe, expect, it } from "vite-plus/test";
import { findContentMatchText } from "../editorSearchMatch";

describe("editor search match extraction", () => {
  it("selects a similar long phrase from the FTS content", () => {
    expect(
      findContentMatchText("Intro Alpha related keyword after", [["Alpha"], ["keyword"]]),
    ).toBe("Alpha related keyword");
  });

  it("selects a high-similarity Japanese phrase when particles differ from the term groups", () => {
    expect(
      findContentMatchText("前置き プロンプト を 改善 する 方法 後続", [["プロンプト"], ["改善"]]),
    ).toBe("プロンプトを改善");
  });

  it("treats alternatives inside each term group as OR", () => {
    expect(
      findContentMatchText("前置き プロンプト を 改良 する 方法 後続", [
        ["プロンプト"],
        ["改善", "改良"],
      ]),
    ).toBe("プロンプトを改良");
  });

  it("removes FTS token spaces around Japanese and mixed alphanumeric terms", () => {
    expect(findContentMatchText("夜間 の ADH 分泌 が 関連", [["ADH"], ["分泌"], ["関連"]])).toBe(
      "ADH分泌が関連",
    );
    expect(findContentMatchText("5 歳 以降", [["5"], ["歳"], ["以降"]])).toBe("5歳以降");
  });

  it("does not invent match text when no fuzzy phrase is found", () => {
    expect(findContentMatchText("Unrelated content", [["Alpha"], ["keyword"]])).toBeUndefined();
  });
});
