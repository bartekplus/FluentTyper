// English notation tokens. The frames of the rules en.notation and en.typography are in
// grammar/rules/en.yaml.

/**
 * Prose tokens that look technical but are notation englishNotation reads: "U.S.A", "e.g",
 * "32.500.000", "32.000,23", "PH.D". Written complete ("e.g.", "U.S.A.") they stay protected.
 */
const NOTATION_TOKEN =
  /^(?:(?:[A-Z]\.){1,4}[A-Z]|e\.g|i\.e|a\.k\.a|\d{1,3}(?:\.\d{3}){1,3}(?:,\d{1,2})?|P[Hh]\.D|[BM]\.(?:Sc|Eng|Ed|Phil|Arch|Com|Tech))$/;
export const notationToken = (source: string, start: number, bare: string) =>
  NOTATION_TOKEN.test(bare) && (/\d$/.test(bare) || source[start + bare.length] !== ".");
