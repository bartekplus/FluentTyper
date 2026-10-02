import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  buildGermanGender,
  buildGermanLexicon,
  deriveGermanLexicon,
  GERMAN_LEXICON_SOURCES,
  readGermanDeterminerBigrams,
} from "../../scripts/generate-german-lexicon";
import {
  germanGender,
  germanNounReading,
  germanVerbLike,
} from "../../src/core/domain/grammar/review/german/germanLexicon";
import {
  REVIEW_SUPPORTED_RULE_IDS,
  reviewRuleIds,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  detectReviewDiagnostics,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

// German-only Review checks (src/core/domain/grammar/review/german/).

function findings(ruleId: CatalogRuleId, text: string, lang = "de_DE", userDictionary = []) {
  return detectReviewDiagnostics(
    { id: "de", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules: [ruleId], lang, userDictionary, insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

function fixed(ruleId: CatalogRuleId, text: string): string {
  const found = findings(ruleId, text);
  return applyEdits(
    text,
    found.flatMap((d) => d.alternatives[0].edits),
  );
}

type Fixture = { pos: Array<[string, string]>; neg: string[] };

const RULES: Array<[CatalogRuleId, Fixture]> = [
  [
    "germanNounCasing",
    {
      pos: [
        [
          "Wir haben gestern den vertrag unterschrieben.",
          "Wir haben gestern den Vertrag unterschrieben.",
        ],
        ["Ich habe heute keine zeit für so etwas.", "Ich habe heute keine Zeit für so etwas."],
        ["Die kosten sind dieses Jahr gestiegen.", "Die Kosten sind dieses Jahr gestiegen."],
        ["Er kam nach drei tagen zurück.", "Er kam nach drei Tagen zurück."],
        ["Beim laufen höre ich gern Musik.", "Beim Laufen höre ich gern Musik."],
        ["Sie hat mit großer mühe gewonnen.", "Sie hat mit großer Mühe gewonnen."],
        ["Der griff ist locker.", "Der Griff ist locker."],
        ["Wir rechnen mit hohen kosten.", "Wir rechnen mit hohen Kosten."],
        ["Das passiert in vielen fällen.", "Das passiert in vielen Fällen."],
        ["Die Post kam 2 tage später.", "Die Post kam 2 Tage später."],
        ["Wir grillen heute im freien.", "Wir grillen heute im Freien."],
        ["Er wünscht dir alles gute.", "Er wünscht dir alles Gute."],
        ["Gibt es etwas neues?", "Gibt es etwas Neues?"],
        [
          "Wir sollten uns auf das schlimmste einstellen.",
          "Wir sollten uns auf das Schlimmste einstellen.",
        ],
        ["Kannst du das auf deutsch sagen?", "Kannst du das auf Deutsch sagen?"],
        ["Das war ganz allein meine schuld.", "Das war ganz allein meine Schuld."],
        ["Er ist Schuld daran, dass wir warten.", "Er ist schuld daran, dass wir warten."],
        ["Meinst du das im ernst?", "Meinst du das im Ernst?"],
        ["Du solltest das Ernst nehmen.", "Du solltest das ernst nehmen."],
        ["Am Ende hielt sie ihn im arm.", "Am Ende hielt sie ihn im Arm."],
        ["Zum dank gab es Kuchen.", "Zum Dank gab es Kuchen."],
        ["An der Ampel nach Links abbiegen.", "An der Ampel nach links abbiegen."],
        ["Das ist uns durchaus Recht.", "Das ist uns durchaus recht."],
        ["Uns wurde Angst und Bange.", "Uns wurde angst und bange."],
        ["Er warnte zurecht vor dem Sturm.", "Er warnte zu Recht vor dem Sturm."],
        ["Wir kommen gut zu recht.", "Wir kommen gut zurecht."],
        ["Seine aussagen waren widersprüchlich.", "Seine Aussagen waren widersprüchlich."],
        ["Die kosten steigen jedes Jahr.", "Die Kosten steigen jedes Jahr."],
        ["Das gerät, mit dem wir messen, ist neu.", "Das Gerät, mit dem wir messen, ist neu."],
        ["Es gab ein ziemlich seltsames verhalten.", "Es gab ein ziemlich seltsames Verhalten."],
      ],
      neg: [
        "Die Schuld liegt bei mir.",
        "Er nimmt das Leben ernst.",
        "Ernst zu nehmende Einwände gab es keine.",
        "Ich halte das für Ernst.",
        "Dank deiner Hilfe hat es geklappt.",
        "Die Seite mit Links zum Thema fehlt.",
        "Ich gebe dir Recht.",
        "Sie hat Recht.",
        "Wir haben Angst vor Gewittern.",
        "Er schnitt den Kuchen zu recht kleinen Stücken.",
        "Wir kommen zurecht.",
        "Die Riesen kamen aus dem Wald.",
        "Die würden das nie glauben.",
        "Diese stellen meiner Schwester ein Zimmer zur Verfügung.",
        "Ihr fahrt morgen los?",
        "Wir hoffen, in einer Stadt zu leben, in der man atmen kann.",
        "Die kosten viel zu viel.",
        "Das stelle ich mir anders vor.",
        "Kannst du das ändern?",
        "Schuhe, die passen, sind selten.",
        "Von der leben sie seit Jahren.",
        "Die meisten kommen später.",
        "Wir versuchen, das zu ändern.",
        "Das tat weh.",
        "Es geht um die deutsche Sprache.",
        "Ich möchte das öffnen können.",
        "Er hat den Vertrag unterschrieben.",
        "Alle liefen kreuz und quer.",
        "Wenn man eine stellen darf, ist es gut.",
        "Er fragt, ob ich mit komme.",
        "Wir grillen im freien Feld.",
        "Das war am besten.",
        "Er liebt sie über alles liebe Grüße.",
        "Es gibt etwas neues Wissen.",
        "Sie arbeitet im privaten und beruflichen Umfeld.",
        "Er ist als erstes und einziges Kind geboren.",
      ],
    },
  ],
  [
    "germanPrepositionCase",
    {
      pos: [
        ["Ich fahre mit eine Kollegin nach Hause.", "Ich fahre mit einer Kollegin nach Hause."],
        ["Wir sprechen später mit diesen Mann.", "Wir sprechen später mit diesem Mann."],
        ["Das Paket kam von das Amt.", "Das Paket kam von dem Amt."],
        ["Wegen dem Regen bleiben wir drinnen.", "Wegen des Regens bleiben wir drinnen."],
        ["Trotz einem Fehler hat er gewonnen.", "Trotz eines Fehlers hat er gewonnen."],
        ["Der Brief ist für deiner Tante.", "Der Brief ist für deine Tante."],
        ["Komm doch zu mich rüber.", "Komm doch zu mir rüber."],
        ["Wir warten seit den letzten Monat.", "Wir warten seit dem letzten Monat."],
        ["Er wohnt bei seine alte Oma.", "Er wohnt bei seiner alten Oma."],
        ["Das gilt gemäß des Vertrages.", "Das gilt gemäß dem Vertrag."],
        ["Sie kam mit drei Koffer an.", "Sie kam mit drei Koffern an."],
        ["Mit neue Lösungen geht es.", "Mit neuen Lösungen geht es."],
      ],
      neg: [
        "Das ist mit die beste Idee.",
        "Er ist der Sache wegen dem Bruder begegnet.",
        "Er half, ohne dem Nachbarn etwas zu sagen.",
        "Seit seine Mutter krank ist, kocht er.",
        "Während die Kinder schlafen, lesen wir.",
        "Was für einer Arbeit gehst du nach?",
        "Sie sah ab und zu einen Hund.",
        "Meiner Meinung nach keinen Grund zur Sorge.",
        "Wir rechnen mit keinen Problemen.",
        "Er spricht mit ihr Deutsch.",
        "Das ist der Grund, wegen dem Anna geht.",
        "Man darf bis zu drei Bücher ausleihen.",
        "Seit 2010 Lehrer, jetzt Rektor.",
        "Sie kam mit großer Freude.",
      ],
    },
  ],
  [
    "germanConfusedWords",
    {
      pos: [
        ["Ich glaube, ihr seit müde.", "Ich glaube, ihr seid müde."],
        ["Wir wohnen hier seid drei Jahren.", "Wir wohnen hier seit drei Jahren."],
        ["Sie kommt mir einem Freund.", "Sie kommt mit einem Freund."],
        ["Ich freue mir auf den Urlaub.", "Ich freue mich auf den Urlaub."],
        ["Er sagt, das er später kommt.", "Er sagt, dass er später kommt."],
        ["Wir gehen in denn Park.", "Wir gehen in den Park."],
        ["Wo bleibt sie den eigentlich?", "Wo bleibt sie denn eigentlich?"],
        ["Heute ist es kälter den je.", "Heute ist es kälter denn je."],
        ["Das war ein schoner Abend.", "Das war ein schöner Abend."],
        ["Mein Onkel kommt aus Schweiz.", "Mein Onkel kommt aus der Schweiz."],
        ["Wir fliegen nach Niederlande.", "Wir fliegen in die Niederlande."],
        ["Der Zug hat pünktlich angekommen.", "Der Zug ist pünktlich angekommen."],
        [
          "Mach dir keine Gedanken, das tut mit leid.",
          "Mach dir keine Gedanken, das tut mir leid.",
        ],
        ["Wir wussten das sie recht hatte.", "Wir wussten, dass sie recht hatte."],
        ["Ich hoffe kaum, das der Bus noch fährt.", "Ich hoffe kaum, dass der Bus noch fährt."],
        ["Das ein Fehler passiert ist, ärgert mich.", "Dass ein Fehler passiert ist, ärgert mich."],
        ["Schön das ihr gekommen seid.", "Schön, dass ihr gekommen seid."],
        ["Bis morgen, wir sehen uns wider.", "Bis morgen, wir sehen uns wieder."],
        ["Sie kam immer wider zu spät.", "Sie kam immer wieder zu spät."],
      ],
      neg: [
        "Er handelte wider besseres Wissen.",
        "Wir wogen das Für und Wider ab.",
        "Das alles war schön, ist aber vorbei.",
        "Gut, das reicht.",
        "Schön das Wetter heute.",
        "Und wieder erwarten wir Regen.",
        "Ihr seid gestern gekommen.",
        "Sie wohnt bei ihr seit 2015.",
        "Lass mich sagen, was ich denke.",
        "Er hat über mich gesagt, dass ich nett bin.",
        "Das Buch, das er liest, ist alt.",
        "Wo bekomme ich den?",
        "Wir müssen die Umwelt schonen.",
        "Nur ab und zu seien sie dort gewesen.",
        "Seid heute bitte pünktlich!",
        "Gott sei Dank ist mir dieser Fehler aufgefallen.",
        "Das Hemd ist Made in USA.",
        "Wir haben gesungen und sind gegangen.",
        "Er hat uns kommen sehen.",
        "Es hat mir gut gefallen.",
      ],
    },
  ],
  [
    "germanAdjectiveForms",
    {
      pos: [
        ["Das war eine lang Woche.", "Das war eine lange Woche."],
        ["Wir suchen einen neu Mitarbeiter.", "Wir suchen einen neuen Mitarbeiter."],
        ["Das klein Kind schläft.", "Das kleine Kind schläft."],
        ["Er wohnt im alt Haus am Ende der Straße.", "Er wohnt im alten Haus am Ende der Straße."],
        ["Wir kaufen nur bei dem lokalem Händler.", "Wir kaufen nur bei dem lokalen Händler."],
        ["Die Daten kommen in echt Zeit.", "Die Daten kommen in Echtzeit."],
        ["Sie trägt eine rund Brille.", "Sie trägt eine runde Brille."],
      ],
      neg: [
        "Er ist ein völlig Fremder.",
        "Sie haben direkt Hilfe bekommen.",
        "Auf gut Deutsch gesagt.",
        "Ich meine wirklich Radio.",
        "Der Plan fand allgemein Anklang.",
        "Das Schloss, in dem ständig Soldaten wohnten.",
        "Die letzte Bahn fährt um zehn.",
        "Mein kleines Haus ist alt.",
        "Das hat sicher Potenzial.",
      ],
    },
  ],
  [
    "germanSuspendedHyphen",
    {
      pos: [
        ["Wir prüfen die Vor und Nachteile genau.", "Wir prüfen die Vor- und Nachteile genau."],
        ["Achte auf die Groß und Kleinschreibung.", "Achte auf die Groß- und Kleinschreibung."],
        ["Das Autohaus hat Neu und Gebrauchtwagen.", "Das Autohaus hat Neu- und Gebrauchtwagen."],
        [
          "Ich habe versucht, mich an und abzumelden.",
          "Ich habe versucht, mich an- und abzumelden.",
        ],
        ["Die Ein und Ausfahrt ist frei.", "Die Ein- und Ausfahrt ist frei."],
      ],
      neg: [
        "Wir sind für Umwelt und Naturschutz.",
        "Vor und nach dem Essen.",
        "Er ging ein und aus.",
        "Kunst und Kultur sind wichtig.",
        "Er lief hin und her.",
        "Die Vor- und Nachteile sind klar.",
      ],
    },
  ],
  [
    "germanAbbreviations",
    {
      pos: [
        ["Wir arbeiten idR bis vier.", "Wir arbeiten i. d. R. bis vier."],
        ["Er kam u.a mit Anna.", "Er kam u. a. mit Anna."],
        ["Sie ist Dipl-Ing. bei uns.", "Sie ist Dipl.-Ing. bei uns."],
        ["Es kostet 2 mio Euro.", "Es kostet 2 Mio. Euro."],
        ["Das gilt z B. für alle.", "Das gilt z.\u00a0B. für alle."],
      ],
      neg: [
        "Das gilt z. B. für alle.",
        "Er ging so. Dann kam er.",
        "Sie ist Dipl.-Ing. bei uns.",
        "Es kostet 2 Mio. Euro.",
        "Die Datei heißt d.h.txt.",
        "Wir sehen uns um 3 Uhr.",
      ],
    },
  ],
  [
    "germanAbbreviationSpacing",
    {
      pos: [
        ["Das gilt z.B. für alle.", "Das gilt z.\u00a0B. für alle."],
        ["Ich bin Dr.med. Weber.", "Ich bin Dr.\u00a0med. Weber."],
        ["Das heißt, d.h. wir warten.", "Das heißt, d.\u00a0h. wir warten."],
        ["Er kommt i.d.R. pünktlich.", "Er kommt i.\u00a0d.\u00a0R. pünktlich."],
        ["Die Zinsen sind 2 % p.a. hoch.", "Die Zinsen sind 2 % p.\u00a0a. hoch."],
      ],
      neg: [
        "Das gilt z. B. für alle.",
        "Die Seite web.de lädt.",
        "Er ging so. Dann kam er.",
        "Das ist u. a. wichtig.",
        "Ich bin Dr. med. Weber.",
      ],
    },
  ],
  [
    "germanQuotes",
    {
      pos: [
        ["Er sagte: “Hallo“.", "Er sagte: „Hallo“."],
        ["Sie las „Faust”.", "Sie las „Faust“."],
        [",,Gut“, sagte er.", "„Gut“, sagte er."],
        ['Er rief „Halt" und blieb stehen.', "Er rief „Halt“ und blieb stehen."],
        ["Das Album ”Blau“ kam 2010.", "Das Album „Blau“ kam 2010."],
      ],
      neg: [
        "„Hallo“, sagte er.",
        'Ein 16"-Monitor reicht.',
        'Er schrieb "Hallo".',
        "Das ist ein „Gefällt mir“-Button.",
        "Sie nennt es »Kunst«.",
      ],
    },
  ],
  [
    "germanCommas",
    {
      pos: [
        ["Wir blieben drinnen weil es stürmte.", "Wir blieben drinnen, weil es stürmte."],
        ["Sie weiß nicht ob der Laden offen hat.", "Sie weiß nicht, ob der Laden offen hat."],
        [
          "Er sparte jeden Cent um ein Rad zu kaufen.",
          "Er sparte jeden Cent, um ein Rad zu kaufen.",
        ],
        ["Um pünktlich zu sein nahm sie das Taxi.", "Um pünktlich zu sein, nahm sie das Taxi."],
        ["Ich glaube der Zug ist schon weg.", "Ich glaube, der Zug ist schon weg."],
        ["Meinst du das reicht für heute?", "Meinst du, das reicht für heute?"],
        ["Er fragte wie spät es sei.", "Er fragte, wie spät es sei."],
        ["Das war kein Zufall sondern Absicht.", "Das war kein Zufall, sondern Absicht."],
        ["Gut dass du angerufen hast.", "Gut, dass du angerufen hast."],
        ["Er fährt los auch wenn es schneit.", "Er fährt los, auch wenn es schneit."],
        [
          "Nachdem sie gegessen hatte ist sie gegangen.",
          "Nachdem sie gegessen hatte, ist sie gegangen.",
        ],
        ["Sag mal kannst du kochen?", "Sag mal, kannst du kochen?"],
        ["Anna behauptet der Film sei langweilig.", "Anna behauptet, der Film sei langweilig."],
      ],
      neg: [
        "Er tat so, als ob er schliefe.",
        "Sie lachte, sodass alle mitlachten, und auch wenn es spät war, blieben wir.",
        "Ich komme, wenn möglich früher, und je nachdem ob es regnet.",
        "Zwei Tage nachdem sie abgereist war, kam der Brief.",
        "Es geht um das Recht zu schweigen.",
        "Er kümmert sich um den Garten, ohne Handschuhe zu tragen.",
        "Ich fange um acht Uhr zu arbeiten an.",
        "Ich glaube an dich und denke oft an dich.",
        "Ich finde den Vorschlag gut.",
        "Ich bin erstaunt ob deiner Geduld.",
        "Die Drüsen sondern ein Sekret ab.",
        "Weißt du was? Wir gehen.",
        "Er weiß so viel wie ich.",
        "Das Fenster muss geöffnet werden können.",
        "Er tat so als ob er schliefe.",
        "Für meinen Bruder habe ich ein Geschenk.",
        "Wenn behauptet wird, es sei so, glaube ich es.",
        "Findet ihr das nicht übertrieben?",
        "Alle meine Freunde sind da.",
      ],
    },
  ],
  [
    "germanNumbers",
    {
      pos: [
        ["Das kostet vier und dreißig Euro.", "Das kostet vierunddreißig Euro."],
        ["Es kamen fünf hundert Gäste.", "Es kamen fünfhundert Gäste."],
        ["Ich habe zehn mal angerufen.", "Ich habe zehnmal angerufen."],
        ["Wir warteten zwei an halb Stunden.", "Wir warteten zweieinhalb Stunden."],
        ["Sie zählte bis Zwanzig.", "Sie zählte bis zwanzig."],
        ["Wir haben drei Lösung gefunden.", "Wir haben drei Lösungen gefunden."],
        ["Das Projekt kostet 4 Milliarde Euro.", "Das Projekt kostet 4 Milliarden Euro."],
      ],
      neg: [
        "Es dauerte zwei, drei Tage.",
        "Zwischen vier und dreißig Grad ist es angenehm.",
        "Das ist ein hundert Jahre alter Baum.",
        "Vier mal fünf ist zwanzig.",
        "Noch einmal zwei Tage sind zu viel.",
        "Sie bekam eine Drei.",
        "Er hat einige Erfahrung damit.",
        "Wir lasen Tausend und eine Nacht.",
      ],
    },
  ],
  [
    "germanQuestionMarks",
    {
      pos: [
        ["Wohin fährst du morgen.", "Wohin fährst du morgen?"],
        ["Kannst du mir kurz helfen.", "Kannst du mir kurz helfen?"],
        ["Wieso denn nicht.", "Wieso denn nicht?"],
        ["Das passt so, oder.", "Das passt so, oder?"],
        ["Mit wem gehst du hin.", "Mit wem gehst du hin?"],
      ],
      neg: [
        "Wie besprochen. Bis morgen.",
        "Was mich stört ist der Lärm.",
        "Wer zuerst kommt, mahlt zuerst.",
        "Wie wunderbar.",
        "Habt Geduld.",
        "Hätte ich das gewusst wäre ich gekommen.",
        "Er fragte: Wann kommst du.",
      ],
    },
  ],
  [
    "germanVerbAgreement",
    {
      pos: [
        ["Wir muss morgen früh los.", "Wir müssen morgen früh los."],
        ["Du kann gern mitkommen.", "Du kannst gern mitkommen."],
        ["Ich hat keine Ahnung.", "Ich habe keine Ahnung."],
        ["Morgen werde wir es sehen.", "Morgen werden wir es sehen."],
        ["Ihr wartest schon lange.", "Ihr wartet schon lange."],
        ["Er fährst morgen.", "Er fährt morgen."],
      ],
      neg: [
        "Er habe keine Zeit, sagte sie.",
        "Sie hast du gestern getroffen?",
        "Ihr habe ich das Buch geliehen.",
        "Es sind schon alle da.",
        "Du und ich sind ein gutes Team.",
        "Sei du doch still!",
        "Ich weiß du kannst das.",
        "Ich wollt' dir nur danken.",
        "Wir selbst haben es gebaut.",
        "Ich glaube, dass ich haben will, was du hast.",
      ],
    },
  ],
  [
    "germanArticleGender",
    {
      pos: [
        ["Der Fahrrad steht im Keller.", "Das Fahrrad steht im Keller."],
        ["Sie kam mit dem Tochter ihres Nachbarn.", "Sie kam mit der Tochter ihres Nachbarn."],
        ["Er hat eine neues Fahrrad gekauft.", "Er hat ein neues Fahrrad gekauft."],
        ["Die Wald hinter dem Haus ist dicht.", "Der Wald hinter dem Haus ist dicht."],
        ["Ich gehe heute zum Schule.", "Ich gehe heute zur Schule."],
        ["Sie wohnt jetzt im Großstadt.", "Sie wohnt jetzt in der Großstadt."],
        ["Ich habe gestern ein Brief bekommen.", "Ich habe gestern einen Brief bekommen."],
        ["Wenn du ein Termin brauchst, ruf an.", "Wenn du einen Termin brauchst, ruf an."],
      ],
      neg: [
        "Der Mann, der Auto fährt, wohnt hier.",
        "Ich gebe der Lehrerin das Heft.",
        "Die Lehrer haben heute frei.",
        "Das ist der Wagen meiner Eltern.",
        "Ich bin ein Mensch, der gern liest.",
        "Er wurde ein guter Arzt.",
        "Auf der einen Seite stimmt das.",
        "Die Hälfte der Zimmer war frei.",
        "Sie hat der Freundin geholfen.",
        "Mit den Autos fahren wir los.",
        "Ich kenne das Buch des Autors.",
      ],
    },
  ],
];

describe.each(RULES)("%s", (ruleId, { pos, neg }) => {
  test.each(pos)("repairs %p", (input, output) => {
    expect(findings(ruleId, input)).toHaveLength(1);
    expect(fixed(ruleId, input)).toBe(output);
    expect(findings(ruleId, output)).toHaveLength(0);
  });
  test.each(neg)("leaves %p alone", (input) => {
    expect(findings(ruleId, input)).toEqual([]);
  });
  test("runs in German only", () => {
    const [input] = pos[0];
    for (const lang of ["en_US", "fr_FR", "auto_detect"]) {
      expect(findings(ruleId, input, lang)).toEqual([]);
    }
  });
});

describe("germanCompounds", () => {
  test.each([
    ["Es ist schwer, die Kosten ab zu schätzen.", "Es ist schwer, die Kosten abzuschätzen."],
    ["Wir werden alles bereit stellen.", "Wir werden alles bereitstellen."],
    ["Wir sehen uns am Freitag Abend.", "Wir sehen uns am Freitagabend."],
    ["Das ist ein 12 seitiger Bericht.", "Das ist ein 12-seitiger Bericht."],
    ["Die 4. Klässler spielen draußen.", "Die Viertklässler spielen draußen."],
    ["Ich schreibe dir eine Email.", "Ich schreibe dir eine E-Mail."],
    ["Das ist meine eMail-Adresse.", "Das ist meine E-Mail-Adresse."],
    ["Er ist US Bürger.", "Er ist US-Bürger."],
    ["Ruf an, wenn du ab fährst.", "Ruf an, wenn du abfährst."],
    ["Sie hat das Paket ab geschickt.", "Sie hat das Paket abgeschickt."],
    ["Ob er es zu gibt, weiß niemand.", "Ob er es zugibt, weiß niemand."],
    ["Du musst gut auf passen.", "Du musst gut aufpassen."],
  ])("repairs %p", (input, output) => {
    expect(findings("germanCompounds", input)).toHaveLength(1);
    expect(fixed("germanCompounds", input)).toBe(output);
  });
  test.each([
    "Er fing an zu lachen.",
    "Sie hat nicht vor zu gehen.",
    "Es macht mir nichts aus zu warten.",
    "Er kam, um zu helfen.",
    "Wir müssen den Weg zurück finden.",
    "Die Vase ist aus Email.",
    "Sie kommt Dienstag Abend vorbei.",
    "Er ging der Reihe nach zu holen.",
    "Das wusste ich von Anfang an.",
    "Sie war viel zu gelassen.",
    "Das dauert zu lange.",
    "Wir wollten immer hin.",
    "Er ist mir über den weg gelaufen.",
    "Ich weiß, wo ich hin muss.",
  ])("leaves %p alone", (input) => {
    expect(findings("germanCompounds", input)).toEqual([]);
  });
});

describe("German quotation marks inside quotations and straight quotes", () => {
  test.each([
    ["„Er rief „Stopp“ und blieb stehen.“", "„Er rief ‚Stopp‘ und blieb stehen.“"],
    ["»Sie las »Faust« im Zug.«", "»Sie las ›Faust‹ im Zug.«"],
  ])("nests %p", (input, output) => {
    expect(fixed("germanQuotes", input)).toBe(output);
  });
  test.each(["„Er rief „Stopp und ging.", "„Er rief ‚Stopp‘.“", "«Er rief «Stopp» laut»"])(
    "leaves %p alone",
    (input) => {
      expect(findings("germanQuotes", input)).toEqual([]);
    },
  );
  test.each([
    ['Er nannte es "Kunst" und lachte.', "Er nannte es „Kunst“ und lachte."],
    ['"Gut", sagte sie.', "„Gut“, sagte sie."],
  ])("makes straight quotes German in %p", (input, output) => {
    expect(fixed("germanStraightQuotes", input)).toBe(output);
  });
  test.each(['Ein 27"-Bildschirm.', 'Er sagte "Gut und ging.', 'Sie sang "Let it be" leise.'])(
    "leaves straight %p alone",
    (input) => {
      expect(findings("germanStraightQuotes", input)).toEqual([]);
    },
  );
});

describe("germanDates", () => {
  test.each([
    ["Wir treffen uns Freitag den 3. Mai 2024.", "Wir treffen uns Freitag, den 3. Mai 2024."],
    ["Die Feier ist am Montag, 2.9.2024.", "Die Feier ist am Montag, 2.9.2024."],
    ["Die Feier ist am Dienstag, 2.9.2024.", "Die Feier ist am Montag, 2.9.2024."],
    ["Ich bin vom 3.6 bis zum 9.6. weg.", "Ich bin vom 3.6. bis zum 9.6. weg."],
  ])("repairs %p", (input, output) => {
    expect(fixed("germanDates", input)).toBe(output);
  });
  test.each(["Wir sehen uns am 31. April.", "Das war der 30.02.2023.", "Der 29.2.2023 fiel aus."])(
    "warns about the impossible date in %p",
    (input) => {
      const [warning, ...rest] = findings("germanDates", input);
      expect(rest).toEqual([]);
      expect(warning.warningOnly).toBe(true);
    },
  );
  test.each([
    "Der 29.2.2024 war ein Donnerstag.",
    "Siehe Abschnitt 7.1 und 7.3 im Vertrag.",
    "Python 3.12.1 ist erschienen.",
    "Pi ist ungefähr 3.14.",
    "Sonntag, den 23. Oktober 4004 v. Chr.",
    "Am Freitag, 3. Mai 2024 regnete es.",
  ])("leaves %p alone", (input) => {
    expect(findings("germanDates", input)).toEqual([]);
  });
});

test("a word in the user's dictionary keeps its casing", () => {
  expect(
    findings("germanNounCasing", "Wir haben den vertrag.", "de_DE", ["vertrag"] as never),
  ).toEqual([]);
});

test("the committed lexicon matches de_DE.dic/.aff (bun run generate:german-lexicon)", async () => {
  const [dic, aff, committed] = await Promise.all(
    [GERMAN_LEXICON_SOURCES.dic, GERMAN_LEXICON_SOURCES.aff, GERMAN_LEXICON_SOURCES.out].map(
      (path) => readFile(path, "utf8"),
    ),
  );
  expect(buildGermanLexicon(dic, aff)).toBe(committed);
  // The cascades read every lowercase dictionary word exactly.
  const { nounOnly, finite, infinitive, lowercaseWords } = deriveGermanLexicon(dic, aff);
  const wrong: string[] = [];
  const check = (words: string[], reading: string | null) => {
    for (const w of words) if (germanNounReading(w) !== reading) wrong.push(w);
  };
  const nouns = new Set([...nounOnly, ...finite, ...infinitive]);
  check(
    lowercaseWords.filter((w) => !nouns.has(w)),
    null,
  );
  check(nounOnly, "noun");
  check(finite, "finite");
  check(infinitive, "infinitive");
  // Only the authored extra nouns read otherwise.
  expect(wrong.sort()).toEqual(["eile", "mühe", "träne", "weile", "zeit"]);
});

// Needs python3 with marisa-trie and numpy (scripts/requirements.txt) to read the n-gram trie.
const bigrams = readGermanDeterminerBigrams();
test.skipIf(bigrams === null)(
  "the committed noun genders match de_DE.dic/.aff and the n-gram counts",
  async () => {
    const [dic, aff, committed] = await Promise.all(
      [GERMAN_LEXICON_SOURCES.dic, GERMAN_LEXICON_SOURCES.aff, GERMAN_LEXICON_SOURCES.gender].map(
        (path) => readFile(path, "utf8"),
      ),
    );
    expect(buildGermanGender(dic, aff, bigrams!)).toBe(committed);
  },
);

test.each([
  ["Auto", "n", false],
  ["Frau", "f", false],
  ["Tisch", "m", false],
  ["Lehrerin", "f", false],
  ["Haustür", "f", false],
  ["Schreibtisch", "m", false],
  ["Freiheit", "f", false],
  ["Brötchen", "n", true],
  ["Zimmer", "x", true],
])("%s has gender %p (plural form: %p)", (word, gender, plural) => {
  expect(germanGender(word)).toEqual({ gender: gender as never, plural });
});

test.each(["See", "Teil", "Heirat", "Armut", "Legende", "Kuchen", "Kirchen", "Menschen", "Xyzzy"])(
  "%s has no single gender",
  (word) => {
    expect(germanGender(word)).toBeNull();
  },
);

test.each([
  ["zugriff", "finite"],
  ["kosten", "infinitive"],
  ["vertrag", "finite"],
  ["zeit", "noun"],
  ["gute", null],
  ["morgen", null],
  ["schnell", null],
])("%s reads as %p", (word, reading) => {
  expect(germanNounReading(word)).toBe(reading as never);
});

test.each([
  ["arbeiten", true],
  ["gebe", true],
  ["machte", true],
  ["schönen", false],
])("%s may be a verb: %p", (word, verb) => {
  expect(germanVerbLike(word)).toBe(verb);
});

test("no German chunk stalls on repeated determiners and lowercase nouns", () => {
  const slowest = (text: string) => {
    const prepared = prepareReview(
      { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      {
        lang: "de_DE",
        enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
        userDictionary: [],
        insertSpaceAfterAutocomplete: true,
      },
    );
    let ms = 0;
    for (const chunk of reviewChunks(prepared)) {
      const start = performance.now();
      scanReviewChunk(prepared, chunk);
      ms = Math.max(ms, performance.now() - start);
    }
    return ms;
  };
  const inputs = [
    "die kosten die kosten ".repeat(400),
    "mit den schönen hohen ".repeat(400),
    "ihr seit mir dem seid den mich ".repeat(300),
    `der ${"\t ".repeat(3_000)}vertrag`,
    "ich glaube weil um zu wissen was ob sondern ".repeat(300),
    "Wir habe. Sollte wir du kann ich hast ".repeat(300),
    "mir ist zu recht Ernst nach Links riesen Dank im arm die schuld ".repeat(250),
    "zwei und zwanzig hundert tausend mal drei an halb viele Lösung ".repeat(250),
    "Der Auto mit dem Frau eine sehr schönes Haus ich habe ein Tisch ".repeat(250),
    `Ich ${"habe ein schöne neue ".repeat(400)}Haustürschlüsselbundanhänger.`,
    `Wann ${"kommst du ".repeat(2_000)}. Wie viel kostet das. Hast du Zeit, oder.`,
  ];
  slowest(inputs.join("\n"));
  for (const text of inputs) expect(slowest(text)).toBeLessThan(100);
});

test("the clean German corpus has no findings from the default rules", () => {
  const text = readFileSync("tests/fixtures/native-review-corpus/german-clean.txt", "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  const found = detectReviewDiagnostics(
    { id: "clean", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      enabledRules: reviewRuleIds({ codeMode: false }),
      lang: "de_DE",
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics;
  expect(found.map((d) => `${d.ruleId}: ${d.original} @ ${d.range.start}`)).toEqual([]);
});

test.each([
  ["germanQuotes", "Auf dem Plakat stand “I love my city” in großen Buchstaben."],
  ["germanNounCasing", "With 15 million people on the list, this is huge."],
  ["germanNounCasing", "Danke fürs schnelle Nachsehen."],
  ["germanPrepositionCase", "Sie brauchen hier zu unsere Kundennummer."],
] as Array<[CatalogRuleId, string]>)("%s leaves %p alone", (ruleId, input) => {
  expect(findings(ruleId, input)).toEqual([]);
});
