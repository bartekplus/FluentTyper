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
  // "croître" (to grow) has no object: an object, "que" or an infinitive reads "croire".
  ["frenchHomophones", "Elle ne croît pas son frère.", "Elle ne croit pas son frère."],
  ["frenchHomophones", "Je te croîs sur parole.", "Je te crois sur parole."],
  ["frenchHomophones", "Il crût entendre un bruit.", "Il crut entendre un bruit."],
  [
    "frenchHomophones",
    "Si l'on en croît la météo, il pleut.",
    "Si l'on en croit la météo, il pleut.",
  ],
  ["frenchHomophones", "Elle croît que tu mens.", "Elle croit que tu mens."],
  ["frenchHomophones", "Croîs-moi, c'est vrai.", "Crois-moi, c'est vrai."],
  ["frenchHomophones", "J'ai crû voir une ombre.", "J'ai cru voir une ombre."],
  // The preposition "à" where avoir cannot stand.
  ["frenchHomophones", "Nous sommes prêts a vous aider.", "Nous sommes prêts à vous aider."],
  ["frenchHomophones", "Allez-vous a la plage ?", "Allez-vous à la plage ?"],
  ["frenchHomophones", "Oui, a ce soir.", "Oui, à ce soir."],
  ["frenchHomophones", "Il dort. a la fin, il part.", "Il dort. à la fin, il part."],
  ["frenchHomophones", "Une douleur légère a modérée.", "Une douleur légère à modérée."],
  [
    "frenchHomophones",
    "Étant attentive a sa santé, elle vient.",
    "Étant attentive à sa santé, elle vient.",
  ],
  ["frenchHomophones", "Tu n'as qua demander.", "Tu n'as qu'à demander."],
  ["frenchHomophones", "Pour qu'a la fin tout aille bien.", "Pour qu'à la fin tout aille bien."],
  // "se" before a noun, "son" before a participle, "sa" before a verb.
  ["frenchHomophones", "Se projet avance bien.", "Ce projet avance bien."],
  ["frenchHomophones", "Ils ont acheté se terrain.", "Ils ont acheté ce terrain."],
  ["frenchHomophones", "Ainsi, se sont des amis.", "Ainsi, ce sont des amis."],
  ["frenchHomophones", "Si tu viens, se sera génial.", "Si tu viens, ce sera génial."],
  ["frenchHomophones", "Les volets son fermés.", "Les volets sont fermés."],
  ["frenchHomophones", "Là-haut son rangés les draps.", "Là-haut sont rangés les draps."],
  ["frenchHomophones", "Sa suffit maintenant.", "Ça suffit maintenant."],
  ["frenchHomophones", "Il mange sa avant de dormir.", "Il mange ça avant de dormir."],
  // Subject and verb.
  ["frenchSubjectVerbAgreement", "Ensuite vous dîner ensemble.", "Ensuite vous dînez ensemble."],
  [
    "frenchSubjectVerbAgreement",
    "Les réactions chimiques libère de la chaleur.",
    "Les réactions chimiques libèrent de la chaleur.",
  ],
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
  ["frenchHomophones", "Le blé croît la nuit."],
  ["frenchHomophones", "La ville croît vite."],
  ["frenchHomophones", "Bien qu'il crût en elle, il doutait."],
  ["frenchHomophones", "La rivière a crû de deux mètres."],
  ["frenchHomophones", "Ce chêne croît à 300 mètres d'altitude."],
  ["frenchHomophones", "La population croît en nombre."],
  ["frenchHomophones", "Mon père, comme toujours, a la solution."],
  ["frenchHomophones", "Le modèle récent a meilleure allure."],
  ["frenchHomophones", "La Ligue 1 a la meilleure défense."],
  ["frenchHomophones", "a la fin du texte coupé."],
  ["frenchHomophones", "Une condition sine qua non."],
  ["frenchHomophones", "La maison qu'a mon frère est grande."],
  ["frenchHomophones", "Il a le pouvoir de dire non."],
  ["frenchHomophones", "Il faut se bien préparer."],
  ["frenchHomophones", "Elle se lève tôt."],
  ["frenchHomophones", "Les chats se battent."],
  ["frenchHomophones", "Le son entendu hier."],
  ["frenchHomophones", "L'année touche à sa fin."],
  ["frenchHomophones", "C'est sa première."],
  ["frenchHomophones", "Sa porte est fermée."],
  ["frenchHomophones", "Sa marche est lente."],
  ["frenchSubjectVerbAgreement", "Nous contacter par courriel."],
  ["frenchSubjectVerbAgreement", "Pour toute question, nous contacter."],
  ["frenchSubjectVerbAgreement", "Les sciences physiques passionnent Léa."],
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
const TIMED: CatalogRuleId[] = ["frenchNounGender", "frenchHomophones"];

test("the wave 14 French frames stay fast on adversarial input", () => {
  slowestChunkMs("Il ferme porte.", "fr_FR", TIMED);
  for (const text of [
    "il lui ferme porte, elle ouvre fenêtre, j'ai pris pain. ".repeat(70),
    "on prend on prend on prend café; ".repeat(120),
    "il ne te croît pas, croîs-moi, crût-il, crû que ".repeat(80),
    "prêts a te voir, va-t-il a la, Oui, a ce, faible a forte, qua la ".repeat(60),
  ])
    expect(slowestChunkMs(text, "fr_FR", TIMED)).toBeLessThan(30);
});
