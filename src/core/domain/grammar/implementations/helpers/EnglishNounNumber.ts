/** Authored countable nouns; no suffix inference, collectives or invariant-number guesses. */
const PAIRS = [
  ["error", "errors"],
  ["problem", "problems"],
  ["file", "files"],
  ["document", "documents"],
  ["report", "reports"],
  ["key", "keys"],
  ["account", "accounts"],
  ["answer", "answers"],
  ["keyboard", "keyboards"],
  ["message", "messages"],
  ["option", "options"],
  ["child", "children"],
  ["person", "people"],
  ["mouse", "mice"],
] as const;

const NUMBER = new Map<string, "singular" | "plural">(
  PAIRS.flatMap(
    ([singular, plural]) =>
      [
        [singular, "singular"],
        [plural, "plural"],
      ] as [string, "singular" | "plural"][],
  ),
);

export function knownEnglishNounNumber(word: string): "singular" | "plural" | null {
  return NUMBER.get(word.toLowerCase()) ?? null;
}
