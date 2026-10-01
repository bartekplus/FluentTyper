import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { buildFrenchLexicon, FRENCH_LEXICON_SOURCES } from "../../scripts/generate-french-lexicon";
import {
  conjugate,
  finitePersons,
  IL,
  ILS,
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
  ])
    expect(slowest(text)).toBeLessThan(100);
});
