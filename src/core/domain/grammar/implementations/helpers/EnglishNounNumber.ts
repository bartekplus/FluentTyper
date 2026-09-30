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
  // Irregular plurals. Left out: same-form plurals (sheep, species), plurals
  // shared with another noun (axes, bases, ellipses), and words English mostly
  // pluralizes regularly or uses as a mass noun (forums, schemas, data, media).
  ...[
    "child children",
    "grandchild grandchildren",
    "person people",
    "man men",
    "woman women",
    "gentleman gentlemen",
    "chairman chairmen",
    "businessman businessmen",
    "businesswoman businesswomen",
    "salesman salesmen",
    "spokesman spokesmen",
    "spokeswoman spokeswomen",
    "fisherman fishermen",
    "policeman policemen",
    "craftsman craftsmen",
    "mouse mice",
    "louse lice",
    "goose geese",
    "tooth teeth",
    "ox oxen",
    "knife knives",
    "wife wives",
    "life lives",
    "leaf leaves",
    "half halves",
    "shelf shelves",
    "thief thieves",
    "wolf wolves",
    "loaf loaves",
    "calf calves",
    "cactus cacti",
    "fungus fungi",
    "nucleus nuclei",
    "radius radii",
    "stimulus stimuli",
    "alumnus alumni",
    "analysis analyses",
    "crisis crises",
    "diagnosis diagnoses",
    "hypothesis hypotheses",
    "thesis theses",
    "parenthesis parentheses",
    "oasis oases",
    "phenomenon phenomena",
    "criterion criteria",
    "bacterium bacteria",
    "matrix matrices",
    "vertex vertices",
    "appendix appendices",
  ].map((pair) => pair.split(" ") as [string, string]),
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

/**
 * Do not interpret the tail of a compound quantity or numbered label as a whole
 * count, nor the pronoun "one" ("No one answers.", "The one leaves.").
 */
export function hasCountPrefix(before: string): boolean {
  return (
    /\b(?:no|any|each|every|the|this|that|which)[ \t ]+$/i.test(before) ||
    /\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|point|or|and|to)[ \t\u00a0]+$/i.test(
      before,
    ) ||
    /[0-9](?:[.,][ \t\u00a0\u202f]*|[ \t\u00a0\u202f]+)$/.test(before) ||
    /\b(?:model|version|chapter|section|code|row|column|label)[ \t]+$/i.test(before)
  );
}
