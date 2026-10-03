import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";
import { languageRules, scan } from "./reviewHarness";

const FRENCH = languageRules("fr_FR");
const findings = (ruleId: CatalogRuleId, text: string) =>
  scan(text, { lang: "fr_FR", enabledRules: [ruleId] }).filter((d) => d.ruleId === ruleId);

// [rule, text, the text with the first alternative applied]
const POSITIVES: Array<[CatalogRuleId, string, string]> = [
  // A pronoun and the auxiliary run together, with adverbs before the participle.
  ["frenchHomophones", "Il la bien fait.", "Il l'a bien fait."],
  ["frenchHomophones", "Tu la vraiment cru ?", "Tu l'as vraiment cru ?"],
  ["frenchHomophones", "Elle ta souvent parlé.", "Elle t'a souvent parlé."],
  ["frenchHomophones", "On ma déjà prévenu.", "On m'a déjà prévenu."],
  ["frenchHomophones", "Il sa trompé de porte.", "Il s'est trompé de porte."],
  ["frenchHomophones", "Elle sa encore blessé.", "Elle s'est encore blessé."],
];

const NEGATIVES: Array<[CatalogRuleId, string]> = [
  ["frenchHomophones", "Il la fait chaque matin."],
  ["frenchHomophones", "Elle la dit souvent."],
  ["frenchHomophones", "Il prend sa voiture."],
  ["frenchHomophones", "Il sa vie."],
  // The participle waits for the "t'a", "m'a", "l'a" fix: no agreement finding on it.
  ["frenchAdjectiveAgreement", "Elle ta souvent parlé."],
  ["frenchAdjectiveAgreement", "Elle ma encore aidé."],
  ["frenchAdjectiveAgreement", "Il sa souvent trompé."],
  ["frenchAdjectiveAgreement", "Marie ta toujours écouté."],
  ["frenchSubjectVerbAgreement", "Il la bien fait."],
  ["frenchSubjectVerbAgreement", "Je la vraiment cru."],
  ["frenchAdjectiveAgreement", "Ce bien est vendu."],
];

test.each(POSITIVES)("%s fires on %p", (ruleId, text, fixed) => {
  const [found, ...rest] = findings(ruleId, text);
  expect(rest).toEqual([]);
  expect(found).toBeDefined();
  expect(applyEdits(text, found.alternatives[0].edits)).toBe(fixed);
  expect(findings(ruleId, fixed)).toEqual([]);
});

test.each(NEGATIVES)("%s stays silent on %p", (ruleId, text) => {
  expect(findings(ruleId, text).map((d) => d.original)).toEqual([]);
});

test("an elided auxiliary gets one fix and no empty one", () => {
  for (const text of ["Il la bien fait.", "Elle ta souvent parlé.", "Je la bien reçu."]) {
    const found = scan(text, { lang: "fr_FR", enabledRules: FRENCH });
    expect(found.every((d) => d.alternatives.length > 0)).toBe(true);
    expect(found.map((d) => d.ruleId)).toEqual(["frenchHomophones"]);
  }
});
