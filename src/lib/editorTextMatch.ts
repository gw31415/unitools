import fuzzysort from "fuzzysort";

type TextMatch = {
  node: Node;
  startOffset: number;
  endOffset: number;
};

type MatchCandidate = TextMatch & {
  text: string;
  target: string;
};

const wordSegmenter = new Intl.Segmenter("ja", { granularity: "word" });
const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const MIN_FUZZY_SCORE = 0.3;
const MAX_WINDOW_WORDS = 12;
const MAX_TERM_GROUP_ALTERNATIVES = 5;
const MAX_GROUPED_QUERIES = 80;

export function normalizeEditorSearchText(text: string, { trim = true }: { trim?: boolean } = {}) {
  const normalized = text
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replaceAll("ー", "")
    .replaceAll("-", "");
  return trim ? normalized.trim() : normalized;
}

function normalizeFuzzyText(text: string) {
  return normalizeEditorSearchText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .trim();
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

function addQuery(queries: string[], text: string | null | undefined) {
  const query = normalizeFuzzyText(text ?? "");
  if (query && !queries.includes(query)) queries.push(query);
}

function addGroupedQueries(queries: string[], termGroups: string[][] | undefined) {
  if (!termGroups || termGroups.length === 0) return;

  let combinations = [""];
  for (const group of termGroups) {
    const terms = [...new Set(group.map(normalizeFuzzyText).filter(Boolean))].slice(
      0,
      MAX_TERM_GROUP_ALTERNATIVES,
    );
    if (terms.length === 0) continue;

    const nextCombinations: string[] = [];
    for (const prefix of combinations) {
      for (const term of terms) {
        nextCombinations.push(prefix ? `${prefix} ${term}` : term);
        if (nextCombinations.length >= MAX_GROUPED_QUERIES) break;
      }
      if (nextCombinations.length >= MAX_GROUPED_QUERIES) break;
    }
    combinations = nextCombinations;
  }

  for (const combination of combinations) {
    if (combination && !queries.includes(combination)) queries.push(combination);
  }
}

function findExactTextMatch(root: HTMLElement, searchTexts: Array<string | null | undefined>) {
  const needles = searchTexts
    .map((text) => normalizeEditorSearchText(text ?? ""))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const needle of needles) {
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
  }

  return null;
}

function buildCandidates(node: Node, text: string): MatchCandidate[] {
  const segments = [...wordSegmenter.segment(text)]
    .filter((segment) => segment.isWordLike)
    .map((segment) => ({
      startOffset: segment.index,
      endOffset: segment.index + segment.segment.length,
    }));

  const candidates: MatchCandidate[] = [];
  for (let start = 0; start < segments.length; start += 1) {
    for (let end = start; end < segments.length && end < start + MAX_WINDOW_WORDS; end += 1) {
      const first = segments[start];
      const last = segments[end];
      const candidateText = text.slice(first.startOffset, last.endOffset);
      const target = normalizeFuzzyText(candidateText);
      if (!target) continue;
      candidates.push({
        node,
        startOffset: first.startOffset,
        endOffset: last.endOffset,
        text: candidateText,
        target,
      });
    }
  }
  return candidates;
}

function rankCandidates(queries: string[], candidates: MatchCandidate[]) {
  let best: (MatchCandidate & { score: number }) | null = null;
  for (const query of queries) {
    for (const candidate of candidates) {
      const result = fuzzysort.single(query, candidate.target);
      if (!result || result.score < MIN_FUZZY_SCORE) continue;

      const score =
        result.score + Math.min(candidate.target.length / Math.max(query.length, 1), 1) * 0.05;
      if (
        !best ||
        score > best.score ||
        (score === best.score && candidate.target.length > best.target.length)
      ) {
        best = { ...candidate, score };
      }
    }
  }
  return best;
}

export function findEditorTextMatch(
  root: HTMLElement,
  searchTexts: Array<string | null | undefined>,
  { termGroups }: { termGroups?: string[][] } = {},
): TextMatch | null {
  const primaryQueries: string[] = [];
  addGroupedQueries(primaryQueries, termGroups);
  if (primaryQueries.length === 0) addQuery(primaryQueries, searchTexts[0]);

  const allQueries: string[] = [];
  addGroupedQueries(allQueries, termGroups);
  for (const searchText of searchTexts) addQuery(allQueries, searchText);

  if (!termGroups || termGroups.length === 0) {
    const exactMatch = findExactTextMatch(root, [searchTexts[0]]);
    if (exactMatch) return exactMatch;
  }

  const candidates: MatchCandidate[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    candidates.push(...buildCandidates(node, node.textContent ?? ""));
    node = walker.nextNode();
  }

  const primaryMatch = rankCandidates(primaryQueries, candidates);
  if (primaryMatch) return primaryMatch;

  const synonymMatch = rankCandidates(allQueries, candidates);
  if (synonymMatch) return synonymMatch;

  return findExactTextMatch(root, searchTexts);
}
