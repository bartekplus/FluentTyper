import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";
import { scan, slowestChunkMs } from "./reviewHarness";

const findings = (ruleId: CatalogRuleId, text: string) =>
  scan(text, { lang: "fr_FR", enabledRules: [ruleId] }).filter((d) => d.ruleId === ruleId);

// [rule, text, the text with the first alternative applied]
const POSITIVES: Array<[CatalogRuleId, string, string]> = [
  // A verb's object noun at the end of its clause takes a determiner.
  ["frenchNounGender", "Elle ouvre fenêtre.", "Elle ouvre une fenêtre."],
  ["frenchNounGender", "Nous achetons pain.", "Nous achetons un pain."],
  ["frenchNounGender", "Tu ranges valises ?", "Tu ranges des valises ?"],
  ["frenchNounGender", "J'ai réparé vélo.", "J'ai réparé un vélo."],
  [
    "frenchNounGender",
    "Il leur envoie colis, puis il part.",
    "Il leur envoie un colis, puis il part.",
  ],
  ["frenchNounGender", "Vous lavez assiettes.", "Vous lavez des assiettes."],
];

const NEGATIVES: Array<[CatalogRuleId, string]> = [
  ["frenchNounGender", "Il prend froid."],
  ["frenchNounGender", "Elle porte plainte."],
  ["frenchNounGender", "Nous gardons espoir."],
  ["frenchNounGender", "Il devient médecin."],
  ["frenchNounGender", "Elle travaille dimanche."],
  ["frenchNounGender", "Je demande pardon."],
  ["frenchNounGender", "Il a pris peur."],
  ["frenchNounGender", "Ils font grève."],
  ["frenchNounGender", "Elle attend Marie."],
  ["frenchNounGender", "Il rebrousse chemin."],
  ["frenchNounGender", "Vous faites erreur."],
  ["frenchNounGender", "La porte ferme mal."],
  ["frenchNounGender", "Il parle affaires."],
  ["frenchNounGender", "Il le trouve beau."],
  ["frenchNounGender", "Elle se dit experte."],
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

// The rules these frames report under, timed alone after one warm-up scan (lexicon loading).
const TIMED: CatalogRuleId[] = ["frenchNounGender"];

test("the wave 14 French frames stay fast on adversarial input", () => {
  slowestChunkMs("Il ferme porte.", "fr_FR", TIMED);
  for (const text of [
    "il lui ferme porte, elle ouvre fenêtre, j'ai pris pain. ".repeat(70),
    "on prend on prend on prend café; ".repeat(120),
  ])
    expect(slowestChunkMs(text, "fr_FR", TIMED)).toBeLessThan(30);
});
