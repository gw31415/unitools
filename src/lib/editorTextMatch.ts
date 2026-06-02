type TextMatch = {
  node: Node;
  startOffset: number;
  endOffset: number;
};

const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

export function normalizeEditorSearchText(text: string, { trim = true }: { trim?: boolean } = {}) {
  const normalized = text
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replaceAll("ー", "")
    .replaceAll("-", "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
  return trim ? normalized.trim() : normalized;
}

function buildNormalizedTextMap(text: string) {
  let normalizedText = "";
  const offsets: Array<{ startOffset: number; endOffset: number }> = [];

  for (const segment of graphemeSegmenter.segment(text)) {
    const normalizedSegment = normalizeEditorSearchText(segment.segment, { trim: false });
    const startOffset = segment.index;
    const endOffset = segment.index + segment.segment.length;
    for (let i = 0; i < normalizedSegment.length; i += 1) {
      offsets.push({ startOffset, endOffset });
    }
    normalizedText += normalizedSegment;
  }

  return { normalizedText, offsets };
}

export function findEditorTextMatch(root: HTMLElement, searchText: string): TextMatch | null {
  const needle = normalizeEditorSearchText(searchText);
  if (!needle) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const { normalizedText, offsets } = buildNormalizedTextMap(node.textContent ?? "");
    const index = normalizedText.indexOf(needle);
    if (index >= 0) {
      const start = offsets[index];
      const end = offsets[index + needle.length - 1];
      if (start && end) {
        return { node, startOffset: start.startOffset, endOffset: end.endOffset };
      }
    }
    node = walker.nextNode();
  }

  return null;
}
