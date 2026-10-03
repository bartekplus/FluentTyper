import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";
import { languageRules, scan, slowestChunkMs } from "./reviewHarness";

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
  // A noun subject, its complements and its verb, inside one clause.
  [
    "frenchSubjectVerbAgreement",
    "Le prix de la maison au bord du lac ont doublé.",
    "Le prix de la maison au bord du lac a doublé.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "Les clés sur la table est à moi.",
    "Les clés sur la table sont à moi.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "Toutes ses amies affirme cela.",
    "Toutes ses amies affirment cela.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "Tous les élèves de la classe part demain.",
    "Tous les élèves de la classe partent demain.",
  ],
  ["frenchSubjectVerbAgreement", "Les jeunes aime la musique.", "Les jeunes aiment la musique."],
  [
    "frenchSubjectVerbAgreement",
    "La lettre pour mes parents sont partie.",
    "La lettre pour mes parents est partie.",
  ],
  // Être and its attribute, after the same complements.
  [
    "frenchAdjectiveAgreement",
    "La réunion au sein de la mairie est annulé.",
    "La réunion au sein de la mairie est annulée.",
  ],
  [
    "frenchAdjectiveAgreement",
    "Hier soir, les routes du village étaient glissant.",
    "Hier soir, les routes du village étaient glissantes.",
  ],
  [
    "frenchAdjectiveAgreement",
    "Les budgets des petites communes sont étriqué.",
    "Les budgets des petites communes sont étriqués.",
  ],
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
  ["frenchSubjectVerbAgreement", "Le livre pour les enfants est beau."],
  ["frenchSubjectVerbAgreement", "La voiture avec ses quatre roues roule vite."],
  ["frenchSubjectVerbAgreement", "Le chat de mes voisins sans ses petits dort."],
  ["frenchSubjectVerbAgreement", "Le comité contre les violences se réunit ce soir."],
  ["frenchSubjectVerbAgreement", "Les clés de la voiture sur la table sont à moi."],
  ["frenchSubjectVerbAgreement", "La plupart des élèves aux cheveux longs sont partis."],
  ["frenchSubjectVerbAgreement", "Le père de ces enfants aux yeux bleus travaille ici."],
  ["frenchSubjectVerbAgreement", "Les enfants pour qui j'ai cuisiné sont partis."],
  ["frenchSubjectVerbAgreement", "Il aime tous les gens que je connais."],
  ["frenchSubjectVerbAgreement", "Les gens par ici parlent fort."],
  ["frenchAdjectiveAgreement", "La maison aux volets bleus est vendue."],
  ["frenchAdjectiveAgreement", "Le vin du pays aux arômes fruités est excellent."],
  ["frenchAdjectiveAgreement", "Les pommes dans le panier sont mûres."],
  ["frenchAdjectiveAgreement", "Dans le jardin, des roses et des lys sont fanés."],
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

// The rules these frames report under, timed alone after one warm-up scan (lexicon loading).
const TIMED: CatalogRuleId[] = [
  "frenchHomophones",
  "frenchSubjectVerbAgreement",
  "frenchAdjectiveAgreement",
];

test("the wave 15 French clause frames stay fast on adversarial input", () => {
  slowestChunkMs("Il la bien fait.", "fr_FR", TIMED);
  for (const text of [
    "les clés de la voiture au fond du couloir sur la table pour les amis avec des ".repeat(50),
    "il la bien fait elle ta souvent parlé il sa trompé on ma déjà ".repeat(70),
    "toutes ses amies tous les jeunes seules les petites communes ".repeat(70),
    "la réunion au sein de la mairie est la liste des invités pour la fête est ".repeat(55),
  ])
    expect(slowestChunkMs(text, "fr_FR", TIMED)).toBeLessThan(30);
});
