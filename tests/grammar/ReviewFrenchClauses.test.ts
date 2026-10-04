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
  ["frenchHomophones", "Elles mon souvent aidé.", "Elles m'ont souvent aidé."],
  ["frenchHomophones", "Ils ton fait peur.", "Ils t'ont fait peur."],
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
  // The infinitive after a verb and its preposition, after a perception verb and its object,
  // and the participle after être past a stressed pronoun.
  ["frenchVerbForms", "Elle a fini par accepté l'offre.", "Elle a fini par accepter l'offre."],
  [
    "frenchVerbForms",
    "Ils viennent de passé la frontière.",
    "Ils viennent de passer la frontière.",
  ],
  ["frenchVerbForms", "Nous continuons à fumé.", "Nous continuons à fumer."],
  ["frenchVerbForms", "Elle essaie de sauté.", "Elle essaie de sauter."],
  ["frenchVerbForms", "Pour ne pas travaillé le dimanche.", "Pour ne pas travailler le dimanche."],
  [
    "frenchVerbForms",
    "Paul laisse sa sœur gardé les enfants.",
    "Paul laisse sa sœur garder les enfants.",
  ],
  [
    "frenchVerbForms",
    "J'entends ma sœur chanté une berceuse.",
    "J'entends ma sœur chanter une berceuse.",
  ],
  ["frenchVerbForms", "Il regarde Léa préparé le repas.", "Il regarde Léa préparer le repas."],
  ["frenchVerbForms", "Laissez-vous tenté par ce dessert.", "Laissez-vous tenter par ce dessert."],
  ["frenchVerbForms", "Jamais entendu parlé de ce film.", "Jamais entendu parler de ce film."],
  ["frenchVerbForms", "Il sera lui-même nommer demain.", "Il sera lui-même nommé demain."],
  // The participle after avoir agrees with the "que" before it.
  [
    "frenchAdjectiveAgreement",
    "Ceux que nous avons invité arrivent.",
    "Ceux que nous avons invités arrivent.",
  ],
  [
    "frenchAdjectiveAgreement",
    "Celle que tu as choisi est belle.",
    "Celle que tu as choisie est belle.",
  ],
  [
    "frenchAdjectiveAgreement",
    "La lettre que tu lui as envoyé est arrivée.",
    "La lettre que tu lui as envoyée est arrivée.",
  ],
  [
    "frenchAdjectiveAgreement",
    "Les fleurs que tu m'as offert sont belles.",
    "Les fleurs que tu m'as offertes sont belles.",
  ],
  // "où", "sûr" and "ont" read from the clause around them.
  ["frenchHomophones", "Pouvez-vous me dire ou se garer ?", "Pouvez-vous me dire où se garer ?"],
  ["frenchHomophones", "Elle se demande ou est son sac.", "Elle se demande où est son sac."],
  ["frenchHomophones", "On part quelque part ou il neige.", "On part quelque part où il neige."],
  ["frenchHomophones", "Partout ou elle passe, on sourit.", "Partout où elle passe, on sourit."],
  ["frenchHomophones", "Nous sommes surs qu'il pleuvra.", "Nous sommes sûrs qu'il pleuvra."],
  ["frenchHomophones", "Je suis sur que tu as raison.", "Je suis sûr que tu as raison."],
  ["frenchHomophones", "Un abri sur où dormir.", "Un abri sûr où dormir."],
  ["frenchHomophones", "Vous pouvez bien sur la garder.", "Vous pouvez bien sûr la garder."],
  ["frenchHomophones", "Mes voisins on la clé.", "Mes voisins ont la clé."],
  ["frenchVerbForms", "Il nous reste beaucoup a visité.", "Il nous reste beaucoup à visiter."],
  ["frenchVerbForms", "Nous avons tout a recommencé.", "Nous avons tout à recommencer."],
  ["frenchVerbForms", "Ce document est à signé.", "Ce document est à signer."],
  // "tous" with no plural to go with: "tout".
  ["frenchTout", "Tu as tous rangé ?", "Tu as tout rangé ?"],
  ["frenchTout", "Elle veut tous comprendre.", "Elle veut tout comprendre."],
  ["frenchTout", "Je ferai tous pour toi.", "Je ferai tout pour toi."],
  ["frenchTout", "Les tous derniers arrivés partent.", "Les tout derniers arrivés partent."],
];

const NEGATIVES: Array<[CatalogRuleId, string]> = [
  ["frenchHomophones", "Il la fait chaque matin."],
  ["frenchHomophones", "Elle la dit souvent."],
  ["frenchHomophones", "Il prend sa voiture."],
  ["frenchHomophones", "Il sa vie."],
  ["frenchHomophones", "Ils mon livre."],
  ["frenchSubjectVerbAgreement", "Ils ton fait peur."],
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
  ["frenchVerbForms", "On le traite de raté."],
  ["frenchVerbForms", "Elle parle de passé et d'avenir."],
  ["frenchVerbForms", "Il est passé par Lyon."],
  ["frenchVerbForms", "Il est blessé par balle."],
  ["frenchVerbForms", "Râpé pour râpé."],
  ["frenchVerbForms", "Je vois la tour illuminée la nuit."],
  ["frenchVerbForms", "Je regarde la maison décorée de fleurs."],
  ["frenchVerbForms", "Il voit la voiture garée devant la maison."],
  ["frenchVerbForms", "J'entends le moteur réparé la semaine dernière."],
  ["frenchVerbForms", "Il regarde le match diffusé la veille."],
  ["frenchVerbForms", "Laisse-le fermé."],
  ["frenchVerbForms", "Laissez-la ouverte."],
  ["frenchVerbForms", "Il est lui-même boucher."],
  ["frenchAdjectiveAgreement", "Celles que tu as perdues sont là."],
  ["frenchAdjectiveAgreement", "J'ai fait tous les efforts, ceux que j'ai pu."],
  ["frenchAdjectiveAgreement", "Celles que j'ai vu partir sont revenues."],
  ["frenchAdjectiveAgreement", "Celle que j'ai eu la chance de voir est partie."],
  ["frenchAdjectiveAgreement", "Celle que j'ai dit qu'il fallait prendre est là."],
  ["frenchAdjectiveAgreement", "Ceux que j'ai aidé à porter le piano sont partis."],
  ["frenchHomophones", "Peux-tu me dire ou écrire la date ?"],
  ["frenchHomophones", "Il faut le dire ou le taire."],
  ["frenchHomophones", "Il veut partir quelque part ou rester ici."],
  ["frenchHomophones", "Il compte bien sur lui."],
  ["frenchHomophones", "Il tape bien sur la porte."],
  ["frenchHomophones", "Il compte sur ce que tu dis."],
  ["frenchHomophones", "Les enfants on la voit souvent."],
  ["frenchHomophones", "Les vacances, on la passe ici."],
  ["frenchVerbForms", "Tout a changé depuis hier."],
  ["frenchVerbForms", "Il est a mangé."],
  ["frenchVerbForms", "Il y a tout à refaire."],
  ["frenchTout", "Ils ont tous compris."],
  ["frenchTout", "On a tous compris."],
  ["frenchTout", "Il les a tous vus."],
  ["frenchTout", "Il nous a tous invités."],
  ["frenchTout", "Elle les aime tous pour leur bonté."],
  ["frenchTout", "Il voit tous les jours sa mère."],
  ["frenchTout", "Elle connaît tous ses voisins."],
  ["frenchTout", "Il en a tous pris."],
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
  "frenchTout",
  "frenchVerbForms",
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
    "il laisse son fils acheté le Marie regarde Léa préparé du il vient de sauté par ".repeat(55),
    "celles que tu m'as celui que j'ai perdue ceux que nous avons la lettre que tu lui as ".repeat(
      55,
    ),
  ])
    expect(slowestChunkMs(text, "fr_FR", TIMED)).toBeLessThan(30);
});
