import { describe, expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import {
  reviewLanguageScope,
  reviewRuleIds,
  runsInReviewLanguage,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

type Fixture = { pos: Array<[string, string]>; neg: string[] };

function findings(ruleId: CatalogRuleId, text: string, lang: string) {
  return detectReviewDiagnostics(
    { id: "ext", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules: [ruleId], lang, userDictionary: [], insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

/** English rules Review extends to other languages with their own bounded tables. */
const EXTENSIONS: Array<[CatalogRuleId, Record<string, Fixture>]> = [
  [
    "englishDoubledDegree",
    {
      fr_FR: {
        pos: [
          ["Ce film est plus meilleur.", "Ce film est meilleur."],
          ["C'est la plus meilleure idée.", "C'est la meilleure idée."],
          ["Ses notes sont plus meilleures.", "Ses notes sont meilleures."],
          ["C'est plus pire qu'avant.", "C'est pire qu'avant."],
          ["Plus meilleur, tu meurs.", "Meilleur, tu meurs."],
        ],
        neg: [
          "Il n'est plus meilleur que lui.",
          "Ce n'est plus pire qu'avant.",
          "De plus pire encore.",
          "En plus meilleur marché.",
          "Le mot « plus meilleur » est fautif.",
        ],
      },
      es_ES: {
        pos: [
          ["Es más mejor así.", "Es mejor así."],
          ["Son más mejores ahora.", "Son mejores ahora."],
          ["Está más peor que ayer.", "Está peor que ayer."],
          ["Fueron más peores.", "Fueron peores."],
          ["Más mejor imposible.", "Mejor imposible."],
        ],
        neg: [
          "Es mucho mejor así.",
          "Es más grande.",
          "Es mayor que tú.",
          "La frase «más mejor» es incorrecta.",
          "Es más, mejor no ir.",
          "Cuanto más mejor.",
        ],
      },
      pt_BR: {
        pos: [
          ["É mais melhor assim.", "É melhor assim."],
          ["São mais melhores agora.", "São melhores agora."],
          ["Está mais pior que ontem.", "Está pior que ontem."],
          ["Foram mais piores.", "Foram piores."],
          ["Mais melhor impossível.", "Melhor impossível."],
        ],
        neg: [
          "Não é mais melhor que antes.",
          "É muito melhor assim.",
          "É mais bonito.",
          "A frase “mais melhor” está errada.",
          "Mais, melhor não ir.",
          "Quanto mais melhor.",
        ],
      },
      pl_PL: {
        pos: [
          ["Jest bardziej lepszy.", "Jest lepszy."],
          ["To bardziej lepsza wersja.", "To lepsza wersja."],
          ["Było bardziej gorzej.", "Było gorzej."],
          ["Są bardziej gorsi.", "Są gorsi."],
          ["Działa bardziej lepiej.", "Działa lepiej."],
        ],
        neg: [
          "Jest dużo lepszy.",
          "Jest bardziej zielony.",
          "Jest coraz lepszy.",
          "Fraza „bardziej lepszy” jest błędna.",
          "Bardziej, lepiej nie.",
        ],
      },
      hr_HR: {
        pos: [
          ["To je više bolji.", "To je bolji."],
          ["Ona je više bolja.", "Ona je bolja."],
          ["Treba više boljeg.", "Treba boljeg."],
          ["U više boljem stanju.", "U boljem stanju."],
          ["Tražim više bolju.", "Tražim bolju."],
        ],
        neg: [
          "Nije više bolji.",
          "Više gori nego prije.",
          "Idi više gore.",
          "Izraz „više bolji” je pogrešan.",
          "Puno bolji.",
        ],
      },
      sv_SE: {
        pos: [
          ["Det är mer bättre.", "Det är bättre."],
          ["Den är mera bättre.", "Den är bättre."],
          ["Det blev mer sämre.", "Det blev sämre."],
          ["Mer bättre blir det inte.", "Bättre blir det inte."],
          ["Han är mera sämre.", "Han är sämre."],
        ],
        neg: [
          "Det är mycket bättre.",
          "Det är mer grönt.",
          "Mer, bättre nej.",
          "Uttrycket ”mer bättre” är fel.",
          "Det blev bättre.",
        ],
      },
      el_GR: {
        pos: [
          ["Είναι πιο καλύτερος.", "Είναι καλύτερος."],
          ["Είναι πιο καλύτερη.", "Είναι καλύτερη."],
          ["Πάει πιο καλύτερα.", "Πάει καλύτερα."],
          ["Είναι πιο χειρότερο.", "Είναι χειρότερο."],
          ["Οι πιο καλύτεροι.", "Οι καλύτεροι."],
        ],
        neg: [
          "Είναι πολύ καλύτερος.",
          "Είναι πιο καλός.",
          "Είναι πιο μεγάλος.",
          "Η φράση «πιο καλύτερος» είναι λάθος.",
          "Πιο, καλύτερα όχι.",
        ],
      },
    },
  ],
  [
    "englishAlotCorrection",
    {
      de_DE: {
        pos: [
          ["Das geht garnicht.", "Das geht gar nicht."],
          ["Vorallem heute.", "Vor allem heute."],
          ["Ich komme aufjedenfall.", "Ich komme auf jeden Fall."],
          ["Er hat garkeine Zeit.", "Er hat gar keine Zeit."],
          ["Desweiteren gilt das.", "Des Weiteren gilt das."],
        ],
        neg: [
          "Das geht gar nicht.",
          "Ich bin zuhause.",
          "Das ist zurzeit gut.",
          "Das Wort „garnicht“ ist falsch.",
          "Siehe garnicht.de heute.",
        ],
      },
      fr_FR: {
        pos: [
          ["Parcontre, non.", "Par contre, non."],
          ["Biensûr que oui.", "Bien sûr que oui."],
          ["Tanpis pour lui.", "Tant pis pour lui."],
          ["Viens toutdesuite.", "Viens tout de suite."],
          ["Il part parceque tard.", "Il part parce que tard."],
        ],
        neg: [
          "Par contre, non.",
          "Il a de l'entrain.",
          "Quelquefois il pleut.",
          "Le mot « parcontre » est faux.",
          "Ouvre parcontre.fr maintenant.",
        ],
      },
      es_ES: {
        pos: [
          ["Aveces llueve.", "A veces llueve."],
          ["Almenos uno.", "Al menos uno."],
          ["Lo digo enserio.", "Lo digo en serio."],
          ["Ven porfavor.", "Ven por favor."],
          ["Estoy deacuerdo.", "Estoy de acuerdo."],
        ],
        neg: [
          "A veces llueve.",
          "El entorno es bueno.",
          "Lleva un sobretodo.",
          "La densidad osea es baja.",
          "La palabra «aveces» no existe.",
          "Visita aveces.es hoy.",
        ],
      },
      pt_BR: {
        pos: [
          ["Derrepente choveu.", "De repente choveu."],
          ["Concerteza vou.", "Com certeza vou."],
          ["Apartir de hoje.", "A partir de hoje."],
          ["Porisso fui.", "Por isso fui."],
          ["Faz denovo.", "Faz de novo."],
        ],
        neg: [
          "De repente choveu.",
          "O agente chegou.",
          "Embaixo da mesa.",
          "A palavra “derrepente” não existe.",
          "Visite derrepente.com hoje.",
        ],
      },
      pl_PL: {
        pos: [
          ["Napewno przyjdę.", "Na pewno przyjdę."],
          ["Wogóle nie wiem.", "W ogóle nie wiem."],
          ["Narazie cześć.", "Na razie cześć."],
          ["To poprostu działa.", "To po prostu działa."],
          ["Niewiem co robić.", "Nie wiem co robić."],
        ],
        neg: [
          "Na pewno przyjdę.",
          "Ona jest niema od urodzenia.",
          "Wcale nie.",
          "Słowo „napewno” jest błędne.",
          "Wejdź na napewno.pl teraz.",
        ],
      },
      sv_SE: {
        pos: [
          ["Iallafall kommer jag.", "I alla fall kommer jag."],
          ["Det är förmycket.", "Det är för mycket."],
          ["Tillsist gick vi.", "Till sist gick vi."],
          ["Tillochmed han kom.", "Till och med han kom."],
          ["Förövrigt ja.", "För övrigt ja."],
        ],
        neg: [
          "I alla fall kommer jag.",
          "Ibland regnar det.",
          "Istället gick vi.",
          "Ordet ”iallafall” är fel.",
          "Besök iallafall.se nu.",
        ],
      },
      hr_HR: {
        pos: [
          ["Nemogu doći.", "Ne mogu doći."],
          ["Neznam što.", "Ne znam što."],
          ["On nebi došao.", "On ne bi došao."],
          ["Ona nezna.", "Ona ne zna."],
          ["Ja nebih rekao.", "Ja ne bih rekao."],
        ],
        neg: [
          "Nemam vremena.",
          "Neću doći.",
          "Dali su mu knjigu.",
          "Riječ „nemogu” je pogrešna.",
          "Posjeti nemogu.hr sada.",
        ],
      },
    },
  ],
  [
    "englishContractionNormalization",
    {
      fr_FR: {
        pos: [
          ["Cest vrai.", "C'est vrai."],
          ["Hier jai faim.", "Hier j'ai faim."],
          ["Aujourdhui il pleut.", "Aujourd'hui il pleut."],
          ["Il dit quil vient.", "Il dit qu'il vient."],
          ["L’homme dit daccord.", "L’homme dit d’accord."],
        ],
        neg: [
          "C'est vrai.",
          "Le livre dont il parle.",
          "Quelle belle journée.",
          "Un nest d'oiseaux en anglais.",
          "Le mot « cest » est fautif.",
        ],
      },
    },
  ],
  [
    "englishProperNounCapitalization",
    {
      de_DE: {
        pos: [
          ["Wir sehen uns am montag.", "Wir sehen uns am Montag."],
          ["Im märz ist es kalt.", "Im März ist es kalt."],
          ["Ab 1. august frei.", "Ab 1. August frei."],
          ["Frohe weihnachten!", "Frohe Weihnachten!"],
          ["Bis freitag dann.", "Bis Freitag dann."],
        ],
        neg: [
          "Wir sehen uns am Montag.",
          "Ich arbeite montags.",
          "Der montagmorgen war lang.",
          "Ein august wirkender Mann.",
          "Das Wort „montag“ ist klein geschrieben.",
        ],
      },
    },
  ],
  [
    "englishPhraseCorrections",
    {
      de_DE: {
        pos: [
          ["Das ist nicht der Standart für uns.", "Das ist nicht der Standard für uns."],
          ["Die Zahlen wiederspiegeln den Trend.", "Die Zahlen widerspiegeln den Trend."],
          ["Er kommt nähmlich später.", "Er kommt nämlich später."],
          ["Wir planen im vorraus.", "Wir planen im voraus."],
          ["Meines Wissens nach ist das erledigt.", "Meines Wissens ist das erledigt."],
          ["Schick mir deine Addresse.", "Schick mir deine Adresse."],
        ],
        neg: [
          "Die Standarte wehte im Wind.",
          "Sie spiegeln die Stimmung wider.",
          "Wir gehen voraus.",
          "Meinem Wissen nach ist das erledigt.",
          "Das Wort „Standart“ ist falsch.",
          "Die Datei standart.txt fehlt.",
        ],
      },
      fr_FR: {
        pos: [
          ["Le language de la loi est précis.", "Le langage de la loi est précis."],
          ["Il reste parmis nous.", "Il reste parmi nous."],
          ["Je vais l'apeller ce soir.", "Je vais l'appeler ce soir."],
          ["Quelque soit le prix, on achète.", "Quel que soit le prix, on achète."],
          ["C'est comme même bizarre.", "C'est quand même bizarre."],
          ["La connection est lente.", "La connexion est lente."],
        ],
        neg: [
          "Quelques amis sont venus.",
          "Parmi nous, il y a un médecin.",
          "Il est venu comme toujours, en fait.",
          "Sa valise est lourde.",
          "Le mot « parmis » est fautif.",
          "Quel que soit le prix, on achète.",
        ],
      },
    },
  ],
  [
    "englishClosedCompounds",
    {
      de_DE: {
        pos: [
          ["Wir haben das selbe Problem.", "Wir haben dasselbe Problem."],
          ["Nichts desto trotz machen wir weiter.", "Nichtsdestotrotz machen wir weiter."],
          ["Das Spiel ist zuende.", "Das Spiel ist zu Ende."],
          ["Das kostet zu mindest zehn Euro.", "Das kostet zumindest zehn Euro."],
          ["Irgend jemand hat angerufen.", "Irgendjemand hat angerufen."],
        ],
        neg: [
          "Wir haben dasselbe Problem.",
          "Am selben Tag kam er.",
          "Zur selben Zeit regnete es.",
          "Der Zug fährt zuerst nach Bonn.",
          "Er sagt nichts, desto besser.",
          "Irgendwo in der Stadt.",
        ],
      },
      fr_FR: {
        pos: [
          ["Il habite au dessus du café.", "Il habite au-dessus du café."],
          ["C'est à dire que non.", "C'est-à-dire que non."],
          ["Regarde là bas.", "Regarde là-bas."],
          ["Je préfère celui ci.", "Je préfère celui-ci."],
          ["Vis à vis de la loi, rien ne change.", "Vis-à-vis de la loi, rien ne change."],
        ],
        neg: [
          "Il habite au-dessus du café.",
          "Je préfère celui-ci.",
          "Celle là-bas est rouge.",
          "Au-delà du pont.",
          "C'est à Paris que je vis.",
        ],
      },
    },
  ],
  [
    "stylePhrasing",
    {
      de_DE: {
        pos: [
          ["Er ist bereits schon da.", "Er ist bereits da."],
          ["Bereits schon am Morgen regnete es.", "Bereits am Morgen regnete es."],
          ["Man fand eine tote Leiche.", "Man fand eine Leiche."],
          ["Das ist ein runder Kreis.", "Das ist ein Kreis."],
          ["Das Bad wurde neu renoviert.", "Das Bad wurde renoviert."],
        ],
        neg: [
          "Er ist bereits da.",
          "Er ist schon da.",
          "Er hat bereits, schon wieder, gewonnen.",
          "Das neu renovierte Bad ist schön.",
          "Das Wort „bereits schon“ ist doppelt.",
        ],
      },
      fr_FR: {
        pos: [
          ["Au jour d'aujourd'hui, tout change.", "Aujourd'hui, tout change."],
          ["Nous allons sortir dehors.", "Nous allons sortir."],
          ["Il faut prévoir à l'avance.", "Il faut prévoir."],
          ["Il faut collaborer ensemble.", "Il faut collaborer."],
          ["Il est parti, puis ensuite il a appelé.", "Il est parti, puis il a appelé."],
        ],
        neg: [
          "Aujourd'hui, tout change.",
          "Il faut monter en haut de la tour.",
          "Nous allons sortir.",
          "Il est parti, puis, ensuite, il a appelé.",
          "Le mot « au jour d'aujourd'hui » est lourd.",
        ],
      },
    },
  ],
];

describe.each(EXTENSIONS)("%s", (ruleId, byLanguage) => {
  test("runs exactly in English and its fixture languages", () => {
    for (const lang of ["en_US", ...Object.keys(byLanguage)]) {
      expect(runsInReviewLanguage(ruleId, lang)).toBe(true);
    }
    expect(runsInReviewLanguage(ruleId, "auto_detect")).toBe(false);
    expect(reviewLanguageScope(ruleId)).toBe("all");
    // Optional style advice runs once the user turns it on.
    expect(reviewRuleIds({ codeMode: false, overrides: { [ruleId]: true } })).toContain(ruleId);
  });
  for (const [lang, fixture] of Object.entries(byLanguage)) {
    test(`${lang}: at least 5 positives and 5 negatives`, () => {
      expect(fixture.pos.length).toBeGreaterThanOrEqual(5);
      expect(fixture.neg.length).toBeGreaterThanOrEqual(5);
    });
    test.each(fixture.pos)(`${lang} repairs %p individually`, (input, expected) => {
      const found = findings(ruleId, input, lang);
      expect(found).toHaveLength(1);
      expect(found[0].bulk.eligible).toBe(false);
      expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    });
    test.each(fixture.neg)(`${lang} keeps %p`, (input) => {
      expect(findings(ruleId, input, lang).map((d) => d.original)).toEqual([]);
    });
  }
});

test("English word lists never run on other languages' text", () => {
  // French "dont" is a word, not "don't"; "monday" is not a German noun.
  expect(findings("englishContractionNormalization", "Le livre dont il parle.", "fr_FR")).toEqual(
    [],
  );
  expect(findings("englishProperNounCapitalization", "I met him on monday.", "de_DE")).toEqual([]);
  expect(findings("englishAlotCorrection", "I like it alot.", "pl_PL")).toEqual([]);
  expect(findings("englishDoubledDegree", "This is more better.", "fr_FR")).toEqual([]);
});

test("new language punctuation findings stay individual-only; older ones keep Fix all", () => {
  const bulk = (text: string, lang: string) =>
    findings("commaPeriodSpacing", text, lang).map((d) => [d.original, d.bulk.eligible]);
  expect(bulk("¿ Qué pasa?", "es_ES")).toEqual([["¿ ", false]]);
  expect(bulk("Τι κάνεις ; Καλά.", "el_GR")).toEqual([[" ;", false]]);
  expect(bulk("كيف حالك ؟ بخير ؛ شكرا", "ar_SA")).toEqual([
    [" ؟", false],
    [" ؛", false],
  ]);
  expect(bulk("Hello , world .", "en_US")).toEqual([
    [" ,", true],
    [" .", true],
  ]);
});
