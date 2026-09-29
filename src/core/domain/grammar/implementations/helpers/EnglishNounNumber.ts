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
