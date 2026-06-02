import fuzzysort from "fuzzysort";

const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
const MIN_FUZZY_SCORE = 0.3;
const MAX_WINDOW_WORDS = 12;
const MAX_TERM_GROUP_ALTERNATIVES = 5;
const MAX_GROUPED_QUERIES = 80;

function normalizeSearchMatchText(text: string) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replaceAll("ー", "")
    .replaceAll("-", "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .trim();
}

function addGroupedQueries(queries: string[], termGroups: string[][]) {
  let combinations = [""];
  for (const group of termGroups) {
    const terms = [...new Set(group.map(normalizeSearchMatchText).filter(Boolean))].slice(
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

function buildContentCandidates(content: string) {
  const segments = [...segmenter.segment(content)]
    .filter((segment) => segment.isWordLike)
    .map((segment) => ({
      startOffset: segment.index,
      endOffset: segment.index + segment.segment.length,
    }));

  const candidates: Array<{ text: string; target: string }> = [];
  for (let start = 0; start < segments.length; start += 1) {
    for (let end = start; end < segments.length && end < start + MAX_WINDOW_WORDS; end += 1) {
      const first = segments[start];
      const last = segments[end];
      const text = content.slice(first.startOffset, last.endOffset).trim();
      const target = normalizeSearchMatchText(text);
      if (target) candidates.push({ text, target });
    }
  }
  return candidates;
}

function displayContentMatchText(text: string) {
  return text.replace(/(?<![A-Za-z0-9])\s+|\s+(?![A-Za-z0-9])/g, "");
}

export function findContentMatchText(content: string, termGroups: string[][]) {
  const queries: string[] = [];
  addGroupedQueries(queries, termGroups);
  if (queries.length === 0) return undefined;

  let best: { text: string; target: string; score: number } | null = null;
  for (const candidate of buildContentCandidates(content)) {
    for (const query of queries) {
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

  return best ? displayContentMatchText(best.text) : undefined;
}
