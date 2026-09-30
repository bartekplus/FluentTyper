export const ENGLISH_COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/** Authored countable nouns; no suffix inference, collectives or invariant-number guesses. */
const PAIRS = [
  ["device", "devices"],
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

const FORMS = new Map<string, { singular: string; plural: string }>(
  PAIRS.flatMap(([singular, plural]) => {
    const forms = { singular, plural };
    return [
      [singular, forms],
      [plural, forms],
    ] as const;
  }),
);

export function englishNounForms(word: string): { singular: string; plural: string } | null {
  return FORMS.get(word.toLowerCase()) ?? null;
}

export function knownEnglishNounNumber(word: string): "singular" | "plural" | null {
  const forms = englishNounForms(word);
  return forms ? (word.toLowerCase() === forms.singular ? "singular" : "plural") : null;
}

/** Do not interpret the tail of a compound quantity or numbered label as a whole count. */
export function hasCountPrefix(before: string): boolean {
  return (
    /\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|point|or|and|to)[ \t\u00a0]+$/i.test(
      before,
    ) ||
    /[0-9](?:[.,][ \t\u00a0\u202f]*|[ \t\u00a0\u202f]+)$/.test(before) ||
    /\b(?:model|version|chapter|section|code|row|column|label)[ \t]+$/i.test(before)
  );
}
