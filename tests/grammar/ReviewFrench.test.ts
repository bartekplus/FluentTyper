import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  buildFrenchLexicon,
  buildFrenchNouns,
  FRENCH_LEXICON_SOURCES,
} from "../../scripts/generate-french-lexicon";
import {
  conjugate,
  finitePersons,
  IL,
  ILS,
  isInflectedNoun,
  isVerbHomograph,
  JE,
  NOUS,
  TU,
  verbReadings,
  VOUS,
} from "../../src/core/domain/grammar/review/french/frenchLexicon";
import {
  REVIEW_SUPPORTED_RULE_IDS,
  runsInReviewLanguage,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  detectReviewDiagnostics,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

function findings(ruleId: CatalogRuleId, text: string, lang = "fr_FR") {
  return detectReviewDiagnostics(
    { id: "fr", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules: [ruleId], lang, userDictionary: [], insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

/** [text, text with the first alternative applied] where the rule fires; texts where it must not. */
type Fixture = { pos: Array<[string, string]>; neg: string[] };

const FIXTURES: Array<[CatalogRuleId, Fixture]> = [
  [
    "frenchVerbForms",
    {
      pos: [
        // After avoir / être: the participle.
        [
          "Hier soir, nous avons manger chez mes parents.",
          "Hier soir, nous avons mangé chez mes parents.",
        ],
        ["Elle est tomber dans l'escalier.", "Elle est tombée dans l'escalier."],
        ["Ils sont arriver en retard.", "Ils sont arrivés en retard."],
        ["Avez-vous terminer le rapport ?", "Avez-vous terminé le rapport ?"],
        ["Je n'ai pas encore regarder le film.", "Je n'ai pas encore regardé le film."],
        ["Elle a signez la lettre ce matin.", "Elle a signé la lettre ce matin."],
        // After a preposition or a governing verb: the infinitive.
        ["Je voudrais acheté une voiture.", "Je voudrais acheter une voiture."],
        ["Il faut lavé la vaisselle.", "Il faut laver la vaisselle."],
        ["Nous allons visité le musée.", "Nous allons visiter le musée."],
        ["Il est parti sans payé l'addition.", "Il est parti sans payer l'addition."],
        ["J'ai oublié de fermé la porte.", "J'ai oublié de fermer la porte."],
        ["Il se fait souvent appelé par son surnom.", "Il se fait souvent appeler par son surnom."],
        ["J'ai déjà pu testé cette application.", "J'ai déjà pu tester cette application."],
        ["Elle commence à mangé sa soupe.", "Elle commence à manger sa soupe."],
        ["Je vais vous expliquez la situation.", "Je vais vous expliquer la situation."],
        ["Il est temps de commencez la réunion.", "Il est temps de commencer la réunion."],
        ["Le chef va vous rappelez demain.", "Le chef va vous rappeler demain."],
        // A "vous" subject: the -ez form.
        [
          "Si vous continuer comme ça, tout ira bien.",
          "Si vous continuez comme ça, tout ira bien.",
        ],
        [
          "Quand vous arriver à la gare, appelez-moi.",
          "Quand vous arrivez à la gare, appelez-moi.",
        ],
        ["Vous aimer marcher le long du canal.", "Vous aimez marcher le long du canal."],
      ],
      neg: [
        "Il a une machine a laver toute neuve.",
        "Il y a dîner chez Paul ce soir.",
        "Il est boucher depuis vingt ans.",
        "Partir, c'est mourir un peu.",
        "Rien de changé depuis hier.",
        "Je le veux terminé pour lundi.",
        "Je l'ai laissé fermé toute la nuit.",
        "Il se sait observé.",
        "Vous aider est notre priorité.",
        "Comment vous remercier pour tout ?",
        "Pour vous aider, nous avons créé ce guide.",
        "Je tiens à vous saluer et vous remercier de votre visite.",
        "Il ne fait que vous répéter la même chose.",
        "Un homme sans passé arrive en ville.",
        "Il a obtenu sa carte d'abonné.",
        "Le chat à mangé la souris.",
        "On a été manger au restaurant.",
        "Il semble fatigué ce soir.",
        "Elle est fière de son fils.",
        "Il est né à Vitré.",
        "Le menu affiché en vitrine change chaque jour.",
        "C'est tout à fait réglé.",
        "Il a en fait déjà mangé.",
        "Nous sommes près de vous, élevé ou pas.",
        "Le lieu d'arrivé reste à fixer.",
        "Le devoir sacré de chacun est de voter.",
        "Allez venez, on y va !",
      ],
    },
  ],
  [
    "frenchHomophones",
    {
      pos: [
        ["Il à mangé toute la tarte.", "Il a mangé toute la tarte."],
        ["On à déjà fini le travail.", "On a déjà fini le travail."],
        ["Ça à l'air facile.", "Ça a l'air facile."],
        ["Hier, Marie à trouvé la solution.", "Hier, Marie a trouvé la solution."],
        ["La maison à été vendue.", "La maison a été vendue."],
        ["Je pense a toi tous les jours.", "Je pense à toi tous les jours."],
        ["J'ai répondu a ta lettre hier.", "J'ai répondu à ta lettre hier."],
        ["Il faut parler a ta mère.", "Il faut parler à ta mère."],
        ["L'adresse a laquelle tu écris.", "L'adresse à laquelle tu écris."],
        ["Il n'y a rien a faire.", "Il n'y a rien à faire."],
        ["Le jour ou il est venu, il pleuvait.", "Le jour où il est venu, il pleuvait."],
        ["Je ne sais pas ou aller.", "Je ne sais pas où aller."],
        ["Ou sont mes clés ?", "Où sont mes clés ?"],
        ["Deux où trois personnes sont venues.", "Deux ou trois personnes sont venues."],
        ["Il faut se renseigner sûr les horaires.", "Il faut se renseigner sur les horaires."],
        ["Il est sur d'arriver à l'heure.", "Il est sûr d'arriver à l'heure."],
        ["Il ce lève tôt.", "Il se lève tôt."],
        ["Se sont des histoires.", "Ce sont des histoires."],
        ["Il a dit sa pour rire.", "Il a dit ça pour rire."],
        ["Il ma dit la vérité.", "Il m'a dit la vérité."],
        ["Je la vu hier.", "Je l'ai vu hier."],
        ["Il est parti avec sont frère.", "Il est parti avec son frère."],
        ["Il a du partir tôt.", "Il a dû partir tôt."],
        ["Ont dit que c'est facile.", "On dit que c'est facile."],
      ],
      neg: [
        "Il pense à sa mère.",
        "Va-t-il à Paris ?",
        "C'est à elle à décider.",
        "Une eau à capter pour la ville.",
        "Réponse à tout donnée en direct.",
        "Ce qu'il pense a de l'importance.",
        "Paul a la grippe.",
        "Maria a de longs cheveux.",
        "A la fin du film, tout le monde pleurait.",
        "Il faut distinguer a et b.",
        "Je ne pouvais pas le croire a priori.",
        "Le droit de voter a ses limites.",
        "Tu préfères le jour ou la nuit ?",
        "Je commande pour un mois ou je m'abonne pour un an.",
        "On dit ou on écrit, peu importe.",
        "Ou serait-ce l'inverse ?",
        "Il gagnera à coup sûr le match.",
        "Le livre est sur la table.",
        "Ils se sont levés tôt.",
        "Les musiciens se séparent, mais se sont retrouvés plus tard.",
        "Il s'est levé tôt.",
        "Ce que s'est dit Paul reste un mystère.",
        "Sa mère est là.",
        "Il la dit souvent.",
        "Les drames en vers sont une bonne source.",
        "Il a du pain.",
        "Il a du pouvoir.",
        "Ont-ils fini ?",
      ],
    },
  ],
  [
    "frenchHyphenation",
    {
      pos: [
        ["Pouvez vous m'aider ?", "Pouvez-vous m'aider ?"],
        ["As tu fini tes devoirs ?", "As-tu fini tes devoirs ?"],
        ["Y a t il des risques ?", "Y a-t-il des risques ?"],
        ["Où va t'on maintenant ?", "Où va-t-on maintenant ?"],
        ["Que mange il ce soir ?", "Que mange-t-il ce soir ?"],
        ["Que faut t-il faire ?", "Que faut-il faire ?"],
        ["Est ce que tu viens ?", "Est-ce que tu viens ?"],
        ["Comment est ce possible ?", "Comment est-ce possible ?"],
        ["Il partira peut être demain.", "Il partira peut-être demain."],
        ["Vous avez peut être raison.", "Vous avez peut-être raison."],
        ["Peut être viendra-t-il.", "Peut-être viendra-t-il."],
      ],
      neg: [
        "Quand tu viens tu manges ?",
        "Le but est ce que tu dis.",
        "C'est ce que je pense ?",
        "Il nous parle ?",
        "Il veut vous voir ?",
        "Quel est ce bruit ?",
        "Quel est ce son ?",
        "Il peut être tard.",
        "Cela peut être utile.",
        "Tout ce que vous dites peut être utilisé.",
        "Peut être résilié chaque mois.",
        "L'Écosse peut être très chaude.",
        "Pouvez-vous m'aider ?",
      ],
    },
  ],
  [
    "frenchSubjectVerbAgreement",
    {
      pos: [
        ["Je peut venir demain.", "Je peux venir demain."],
        ["Tu mange trop vite.", "Tu manges trop vite."],
        ["Ils mange ensemble.", "Ils mangent ensemble."],
        ["Nous avez raison.", "Nous avons raison."],
        ["Il peux partir.", "Il peut partir."],
        ["On allons voir.", "On va voir."],
        ["Je ne comprend pas.", "Je ne comprends pas."],
        ["Elle se sont donné la main.", "Elle s'est donné la main."],
        ["J'est fini.", "Je suis fini."],
        ["Je rêver souvent du chalet.", "Je rêve souvent du chalet."],
        ["Elle est arrivé hier.", "Elle est arrivée hier."],
        ["Ils sont passé ici.", "Ils sont passés ici."],
        ["Elles étaient fatigué.", "Elles étaient fatiguées."],
      ],
      neg: [
        "Tu ne la vois pas.",
        "Il nous parle souvent.",
        "Nous vous remercions.",
        "Vous nous avez aidés.",
        "Il le livre demain.",
        "Les avantages que vous offrent ces cours.",
        "Pierre et elle étaient fiancés.",
        "Nous sont parvenus des parchemins.",
        "Je vous écrirai et vous téléphonerai demain.",
        "Peux tu aller voir ?",
        "D'où vous vient cette idée ?",
        "Dit-il en riant.",
        "Elles se sont parlé.",
        "Il est arrivé une lettre.",
        "Pierre et elle étaient fiancés.",
      ],
    },
  ],
  [
    "frenchElision",
    {
      pos: [
        ["Je aime le chocolat.", "J'aime le chocolat."],
        ["Je pense que il va venir.", "Je pense qu'il va venir."],
        ["Il est parti lorsque il a plu.", "Il est parti lorsqu'il a plu."],
        ["Je viens de y aller.", "Je viens d'y aller."],
        ["Je le aime bien.", "Je l'aime bien."],
        ["C'est le ami de Paul.", "C'est l'ami de Paul."],
        ["J ai froid.", "J'ai froid."],
        ["Il n arrive jamais.", "Il n'arrive jamais."],
        ["Ils ont beaucoup d’ enfants.", "Ils ont beaucoup d’enfants."],
      ],
      neg: [
        "Le oui l'emporte.",
        "La une du journal.",
        "De un à dix.",
        "Lorsque Anna arrive.",
        "Les points a, b, c, d et e.",
        "Il faut 2 l eau.",
        "M. J Dupont est là.",
        "Prends-le à gauche.",
        "Fais-le entrer.",
        "Le hasard fait bien les choses.",
        "On omet souvent le ne explétif.",
        "Et la il est parti.",
        "Si c divise a, alors c est premier avec b.",
        "Il n' pas hésité.",
        "Le titre est Kiss Me Once.",
      ],
    },
  ],
  [
    "frenchDates",
    {
      pos: [
        ["Rendez-vous le 31 septembre.", "Rendez-vous le 30 septembre."],
        ["Elle est née le 31-04-1988.", "Elle est née le 30-04-1988."],
        ["Le 29 février 2023 tombait un mercredi.", "Le 28 février 2023 tombait un mercredi."],
        ["Mardi 3 mars 2025, la séance reprend.", "Lundi 3 mars 2025, la séance reprend."],
        [
          "La fête a eu lieu dimanche 14 juillet 2018.",
          "La fête a eu lieu samedi 14 juillet 2018.",
        ],
        ["Mercredi 2024/01/02 au matin.", "Mardi 2024/01/02 au matin."],
      ],
      neg: [
        "Rendez-vous le 30 septembre.",
        "Le 29 février 2024 était un jeudi.",
        "Né un 29 février, il fête rarement son anniversaire.",
        "Le 1er mai est férié.",
        "Lundi 3 mars 2025, la séance reprend.",
        "La version 31/09 du logiciel.",
        "Il a 31 ans et 12 mois de plus.",
        "Le mot « 31 septembre » est faux.",
      ],
    },
  ],
  [
    "frenchNounNumber",
    {
      pos: [
        ["Mes enfant sont partis.", "Mes enfants sont partis."],
        ["Les voiture roulent vite.", "Les voitures roulent vite."],
        ["La routes est longue.", "La route est longue."],
        ["Un plans de la ville.", "Un plan de la ville."],
        ["Les bateau coulent.", "Les bateaux coulent."],
        ["Les cheval galopent.", "Les chevaux galopent."],
        ["Des porte claquent.", "Des portes claquent."],
      ],
      neg: [
        "Je les aime beaucoup.",
        "Tu la portes bien.",
        "Il les porte.",
        "Ce sont mes amis.",
        "Le fils de Paul.",
        "Le temps passe.",
        "Les quatre saisons.",
        "Les tout premiers jours.",
        "Les Dupont arrivent.",
        "Vos nom et prénom, s'il vous plaît.",
        "Les voyant si nerveux, il se tut.",
        "Deux cent une personnes arrivent.",
        "Il a soixante et un ans.",
        "Les lundi et mardi sont fériés.",
        "Je suis sûr de les avoir vus.",
      ],
    },
  ],
];

describe.each(FIXTURES)("%s", (ruleId, { pos, neg }) => {
  test("runs only for French", () => {
    expect(runsInReviewLanguage(ruleId, "fr_FR")).toBe(true);
    for (const lang of ["en_US", "de_DE", "es_ES", "auto_detect"])
      expect(runsInReviewLanguage(ruleId, lang)).toBe(false);
  });
  test.each(pos)("fires on %p", (text, fixed) => {
    const [finding, ...rest] = findings(ruleId, text);
    expect(rest).toEqual([]);
    expect(finding).toBeDefined();
    const out = applyEdits(text, finding.alternatives[0].edits)!;
    expect(out).toBe(fixed);
    expect(findings(ruleId, out)).toEqual([]);
  });
  test.each(neg)("stays silent on %p", (text) => {
    expect(findings(ruleId, text).map((d) => d.original)).toEqual([]);
  });
});

describe("French lexicon", () => {
  test("the committed lexicon matches fr_FR.dic/.aff (bun run generate:french-lexicon)", async () => {
    const [dic, aff, committed] = await Promise.all(
      [FRENCH_LEXICON_SOURCES.dic, FRENCH_LEXICON_SOURCES.aff, FRENCH_LEXICON_SOURCES.out].map(
        (path) => readFile(path, "utf8"),
      ),
    );
    expect(buildFrenchLexicon(dic, aff)).toBe(committed);
  });

  test.each([
    ["mange", JE | IL],
    ["manges", TU],
    ["mangeons", NOUS],
    ["mangez", VOUS],
    ["mangent", ILS],
    ["mangeais", JE | TU],
    ["peux", JE | TU],
    ["peut", IL],
    ["vont", ILS],
    ["suis", JE | TU],
    ["sommes", TU | NOUS],
    ["faites", VOUS],
    ["viennent", ILS],
    ["livre", JE | IL],
    ["chaise", 0],
  ])("%s agrees with persons %d", (word, persons) => {
    expect(finitePersons(word as string)).toBe(persons as number);
  });

  test("readings name the lemma, the participles and the infinitives", () => {
    expect(verbReadings("mangé").map((r) => [r.lemma, r.slot])).toEqual([["manger", "Q"]]);
    expect(verbReadings("dû").map((r) => [r.lemma, r.slot])).toEqual([["devoir", "Q"]]);
    expect(verbReadings("aller").map((r) => r.slot)).toContain("I");
    const [peut] = verbReadings("peut");
    expect(conjugate(peut, JE)).toContain("peux");
    expect(conjugate(peut, ILS)).toEqual(["peuvent"]);
    const [allaient] = verbReadings("allaient");
    expect(conjugate(allaient, NOUS)).toEqual(["allions"]);
  });

  test("the noun filter knows inflected nouns and invariable words in s", () => {
    for (const word of ["maison", "cheval", "bateau", "fils", "temps"])
      expect(isInflectedNoun(word)).toBe(true);
    for (const word of ["maisons", "chevaux", "mangeons"])
      expect(isInflectedNoun(word)).toBe(false);
  });

  test("the committed noun filter matches fr_FR.dic/.aff", async () => {
    const [dic, aff, committed] = await Promise.all(
      [FRENCH_LEXICON_SOURCES.dic, FRENCH_LEXICON_SOURCES.aff, FRENCH_LEXICON_SOURCES.nouns].map(
        (path) => readFile(path, "utf8"),
      ),
    );
    expect(buildFrenchNouns(dic, aff)).toBe(committed);
  });

  test("homographs are verb forms that another entry also spells", () => {
    expect(isVerbHomograph("passé")).toBe(true);
    expect(isVerbHomograph("dîner")).toBe(true);
    expect(isVerbHomograph("mangé")).toBe(false);
  });
});

test("no French chunk stalls on adversarial input", () => {
  const options = {
    lang: "fr_FR",
    enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
    userDictionary: [],
    insertSpaceAfterAutocomplete: true,
  };
  const slowest = (text: string) => {
    const prepared = prepareReview(
      { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      options,
    );
    let ms = 0;
    for (const chunk of reviewChunks(prepared)) {
      const start = performance.now();
      scanReviewChunk(prepared, chunk);
      ms = Math.max(ms, performance.now() - start);
    }
    return ms;
  };
  const triggers =
    "vous ne le lui avez pas encore demander pour vous aider à mangé de passé il faut lavé. ";
  slowest(triggers.repeat(10));
  for (const text of [
    triggers.repeat(60),
    "vous ".repeat(1_000),
    "de de de mangé ".repeat(400),
    `x${" ".repeat(3_800)}${triggers}`,
    "mangé ".repeat(800),
    "il à a ou où sa se ce la ma sont du ont ".repeat(150),
  ])
    expect(slowest(text)).toBeLessThan(100);
});

test("French time zones and pronoun + article pairs stay clean", () => {
  for (const text of ["La réunion commence à 15:00 CEST.", "Rendez-vous à 20h30, cest."])
    expect(findings("englishContractionNormalization", text)).toEqual([]);
  expect(findings("englishContractionNormalization", "Je pense que cest vrai.")).toHaveLength(1);
  expect(findings("englishRepeatedWords", "Je m'en achèterai un un jour.")).toEqual([]);
  expect(findings("englishRepeatedWords", "Il a pris les les clés.")).toHaveLength(1);
});

const FRENCH_ON = REVIEW_SUPPORTED_RULE_IDS.filter(
  (id) =>
    runsInReviewLanguage(id, "fr_FR") &&
    !["capitalizeSentenceStart", "capitalizeAfterLineBreak", "styleLongSentence"].includes(id),
);

test("the clean French corpus has no findings", () => {
  const text = readFileSync("tests/fixtures/native-review-corpus/french-clean.txt", "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  const found = detectReviewDiagnostics(
    { id: "clean", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      enabledRules: FRENCH_ON,
      lang: "fr_FR",
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics;
  expect(found.map((d) => `${d.ruleId}: ${d.original} @ ${d.range.start}`)).toEqual([]);
});

test.each([
  ["frenchElision", "Le sigle vient de also known as, en anglais."],
  ["frenchElision", "Il épelle son nom : d o r a."],
  ["frenchSubjectVerbAgreement", "« Je est un autre » reste une formule célèbre."],
  ["frenchSubjectVerbAgreement", "Le pronom personnel tu n'est pas toujours exprimé."],
  ["frenchHomophones", "Il a l'air ravi de sa journée."],
  ["frenchHomophones", "S'est dit d'un outil qu'on emporte partout."],
  ["frenchHomophones", "Comme même les plus prudents se trompent, restons humbles."],
  ["frenchVerbForms", "Ces travaux ont bien entendu gêné les riverains."],
  ["frenchNounNumber", "Un tiens vaut mieux que deux tu l'auras."],
  ["frenchHyphenation", "Ce texte devra peu à peu être corrigé."],
  ["englishPhraseCorrections", "La créatrice Mary Quant, Quant on la cite, fait sourire."],
  ["duplicatePunctuationCollapse", "Jean Dupont (1960-....) est peintre."],
] as Array<[CatalogRuleId, string]>)("%s stays silent on %p", (ruleId, text) => {
  expect(findings(ruleId, text).map((d) => d.original)).toEqual([]);
});

test.each([
  ["frenchHomophones", "Il est venu comme même.", "Il est venu quand même."],
  ["frenchHomophones", "C'est comme même bizarre.", "C'est quand même bizarre."],
  ["frenchHyphenation", "Il viendra peu être demain.", "Il viendra peut-être demain."],
  ["frenchHyphenation", "C'est peu être la bonne réponse.", "C'est peut-être la bonne réponse."],
  ["frenchElision", "Il parle de un ami.", "Il parle d'un ami."],
] as Array<[CatalogRuleId, string, string]>)("%s fixes %p", (ruleId, text, fixed) => {
  const [finding, ...rest] = findings(ruleId, text);
  expect(rest).toEqual([]);
  expect(applyEdits(text, finding.alternatives[0].edits)).toBe(fixed);
});
