import { describe, expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";
import { scan, slowestChunkMs } from "./reviewHarness";

// The shared clause reader (src/core/domain/grammar/review/clauseReader.ts): agreement past the
// complements and a relative clause of a subject.

const fixed = (ruleId: CatalogRuleId, text: string, lang: string) => {
  const found = scan(text, { lang, enabledRules: [ruleId] }).filter((d) => d.ruleId === ruleId);
  return found.length ? applyEdits(text, found[0].alternatives[0].edits) : text;
};

// [rule, language, text, the text with the first alternative applied]
const POSITIVES: Array<[CatalogRuleId, string, string, string]> = [
  // A relative clause after the complements: the numbers show what "qui" goes with.
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Les élèves de la classe qui ont réussi part demain.",
    "Les élèves de la classe qui ont réussi partent demain.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Les jardins du château qui entourent le parc est immense.",
    "Les jardins du château qui entourent le parc sont immense.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "La revue de cinéma qui paraît chaque mois depuis Lyon sont chère.",
    "La revue de cinéma qui paraît chaque mois depuis Lyon est chère.",
  ],
  // A relative clause with a noun phrase subject.
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Le bruit des moteurs que les voisins entendent sont gênant.",
    "Le bruit des moteurs que les voisins entendent est gênant.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Les lettres que la poste a perdues est arrivée.",
    "Les lettres que la poste a perdues sont arrivée.",
  ],
  [
    "frenchAdjectiveAgreement",
    "fr_FR",
    "Les boîtes que les enfants ont rangées sont lourde.",
    "Les boîtes que les enfants ont rangées sont lourdes.",
  ],
  [
    "frenchAdjectiveAgreement",
    "fr_FR",
    "La voiture que mon père a achetée est petit.",
    "La voiture que mon père a achetée est petite.",
  ],
  // A stressed pronoun closes a complement.
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Mes cadeaux pour toi arrive demain.",
    "Mes cadeaux pour toi arrivent demain.",
  ],
  [
    "frenchAdjectiveAgreement",
    "fr_FR",
    "Un morceau de moi était cassée.",
    "Un morceau de moi était cassé.",
  ],
];

// Correct text: the reader must stay silent.
const NEGATIVES: Array<[CatalogRuleId, string, string]> = [
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Le directeur des ventes qui travaille à Paris est absent.",
  ],
  ["frenchSubjectVerbAgreement", "fr_FR", "La liste des produits qui sont en stock est longue."],
  ["frenchSubjectVerbAgreement", "fr_FR", "La fille de mes voisins qui joue du piano chante bien."],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Les maisons du village qui donne sur la mer sont belles.",
  ],
  ["frenchSubjectVerbAgreement", "fr_FR", "Le fait que les prix montent inquiète les gens."],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Les choses que les parents disent aux enfants comptent.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Trois filles dont le voile sombre cache mal les écouteurs se lèvent.",
  ],
  ["frenchSubjectVerbAgreement", "fr_FR", "Les efforts pour lui plaire sont vains."],
  ["frenchAdjectiveAgreement", "fr_FR", "Les gens que le maire a invités sont venus."],
  ["frenchAdjectiveAgreement", "fr_FR", "La clé de la maison que j'ai vendue est perdue."],
];

describe("clause reader", () => {
  test.each(POSITIVES)("%s finds %p in %p", (ruleId, lang, text, expected) => {
    expect(fixed(ruleId, text, lang)).toBe(expected);
  });
  test.each(NEGATIVES)("%s stays silent on %p: %p", (ruleId, lang, text) => {
    expect(fixed(ruleId, text, lang)).toBe(text);
  });
  test("long subjects and relative clauses stay fast", () => {
    const french = (
      "Les élèves de la classe de la ville du pays qui ont réussi depuis mai part demain, " +
      "le bruit des moteurs que les voisins entendent sont gênant, mes cadeaux pour toi arrive. "
    ).repeat(25);
    // The first scan loads the lexicons.
    slowestChunkMs(french.slice(0, 400), "fr_FR");
    expect(slowestChunkMs(french, "fr_FR")).toBeLessThan(100);
  });
});
