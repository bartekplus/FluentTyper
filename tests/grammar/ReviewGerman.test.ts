import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  buildGermanGender,
  buildGermanLexicon,
  buildGermanUsage,
  deriveGermanLexicon,
  GERMAN_LEXICON_SOURCES,
  readGermanDeterminerBigrams,
  readGermanNgrams,
} from "../../scripts/generate-german-lexicon";
import {
  germanGender,
  germanNounOverAdjective,
  germanNounReading,
  germanVerbLike,
  germanVerbObjectCase,
} from "../../src/core/domain/grammar/review/german/germanLexicon";
import { tokensAfter } from "../../src/core/domain/grammar/review/german/shared";
import { GERMAN_WORST_CASES, slowestGermanChunkMs } from "./germanWorstCase.fixture";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
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
        ["Bis ende Mai ist die Halle geschlossen.", "Bis Ende Mai ist die Halle geschlossen."],
        ["Wir sind schon auf dem weg.", "Wir sind schon auf dem Weg."],
        ["Der Schuss ging ins aus.", "Der Schuss ging ins Aus."],
        ["Die beiden sind ein ungleiches paar.", "Die beiden sind ein ungleiches Paar."],
        // Nouns that are also adjective forms (germanNounOverAdjective).
        ["Im alter wird man gelassener.", "Im Alter wird man gelassener."],
        ["Sein hohes alter sieht man ihm nicht an.", "Sein hohes Alter sieht man ihm nicht an."],
        ["Er stand ganz oben auf der spitze.", "Er stand ganz oben auf der Spitze."],
        ["Darauf legt sie keinen großen wert.", "Darauf legt sie keinen großen Wert."],
        ["Gibt es dazu eine alternative?", "Gibt es dazu eine Alternative?"],
        ["Die wüste ist nachts kalt.", "Die Wüste ist nachts kalt."],
        // Noun or verb forms in noun frames.
        [
          "Die grenzen unseres Gartens sind markiert.",
          "Die Grenzen unseres Gartens sind markiert.",
        ],
        ["Die klingen dieser Messer waren stumpf.", "Die Klingen dieser Messer waren stumpf."],
        ["Dieser anstieg kam für alle überraschend.", "Dieser Anstieg kam für alle überraschend."],
        ["Der angriff der Gegner scheiterte.", "Der Angriff der Gegner scheiterte."],
        ["Nach mehreren versuche gab er auf.", "Nach mehreren Versuche gab er auf."],
        ["In den räumen war es stickig.", "In den Räumen war es stickig."],
        ["Er hat keinen großen unterschied bemerkt.", "Er hat keinen großen Unterschied bemerkt."],
        ["Die rolle, für die sie probt, ist klein.", "Die Rolle, für die sie probt, ist klein."],
        // Names of several words (names.ts).
        ["Mein Opa erzählte vom zweiten Weltkrieg.", "Mein Opa erzählte vom Zweiten Weltkrieg."],
        ["Sie spendet jedes Jahr dem roten Kreuz.", "Sie spendet jedes Jahr dem Roten Kreuz."],
        [
          "Wir wandern gern in der sächsischen Schweiz.",
          "Wir wandern gern in der Sächsischen Schweiz.",
        ],
        ["Die Lage im nahen Osten bleibt ernst.", "Die Lage im Nahen Osten bleibt ernst."],
        ["Das Konzert war etwas ganz besonderes.", "Das Konzert war etwas ganz Besonderes."],
        ["Im Angebot war nichts wirklich passendes.", "Im Angebot war nichts wirklich Passendes."],
        ["Hallo Liebe Sabine, schön dich zu sehen.", "Hallo liebe Sabine, schön dich zu sehen."],
      ],
      neg: [
        "Das ende ich jetzt sofort.",
        "Die alte wohnt nebenan, die junge zieht bald weg.",
        "Er hat das recht schnell erledigt.",
        "Ich habe das wohl falsch verstanden.",
        "Sie liebt ihn über alles.",
        "Das Zimmer, in dem leben drei Katzen, ist warm.",
        "Als die Truppe angriff, flohen alle.",
        "Diese stellen meiner Schwester ein Zimmer bereit.",
        "Mit dem leben wir schon lange.",
        "Das sage ich dir morgen.",
        "Das ist mir recht.",
        "Ein rotes Kreuz markiert den Treffpunkt.",
        "Er hat ein neues Testament aufgesetzt.",
        "Wir fahren an die nahe Ostsee.",
        "Das ist etwas ganz anderes.",
        "Hallo Liebe, wie geht es dir?",
        "Er wohnt im aus Holz gebauten Haus.",
        "Wir bleiben ein paar Tage.",
        "Ich räume den Müll weg.",
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
        ["Seid er umgezogen ist, schreibt er öfter.", "Seit er umgezogen ist, schreibt er öfter."],
        ["Das Café hat seid letzten Montag zu.", "Das Café hat seit letzten Montag zu."],
        ["Er wartet seid 45 Minuten.", "Er wartet seit 45 Minuten."],
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
        ["Am Abend trinken sie gern rot Wein.", "Am Abend trinken sie gern Rotwein."],
        ["Im Herbst essen wir oft grün Kohl.", "Im Herbst essen wir oft Grünkohl."],
        ["Die Mannschaft ist in best Form.", "Die Mannschaft ist in Bestform."],
        ["Er fordert einen höheren mindest Lohn.", "Er fordert einen höheren Mindestlohn."],
        [
          "Sie spielt seit Jahren im national Kader.",
          "Sie spielt seit Jahren im nationalen Kader.",
        ],
        ["Wir sprachen mit freundlich Nachbarn.", "Wir sprachen mit freundlichen Nachbarn."],
        ["Er schneidet mit scharf Messern.", "Er schneidet mit scharfen Messern."],
        ["Sie hat eine sehr klar Meinung.", "Sie hat eine sehr klare Meinung."],
        ["Das ist keine gut Lösung.", "Das ist keine gute Lösung."],
        [
          "Wir kamen mit einer riesig Verspätung an.",
          "Wir kamen mit einer riesigen Verspätung an.",
        ],
        ["Das klein Kind schläft.", "Das kleine Kind schläft."],
        ["Liebe Herr Becker, vielen Dank.", "Lieber Herr Becker, vielen Dank."],
        ["Sehr geehrter Frau Schulz,", "Sehr geehrte Frau Schulz,"],
        ["Er wohnt im alt Haus am Ende der Straße.", "Er wohnt im alten Haus am Ende der Straße."],
        ["Wir kaufen nur bei dem lokalem Händler.", "Wir kaufen nur bei dem lokalen Händler."],
        ["Die Daten kommen in echt Zeit.", "Die Daten kommen in Echtzeit."],
        ["Sie trägt eine rund Brille.", "Sie trägt eine runde Brille."],
        ["Mein klein Haus ist gemütlich.", "Mein kleines Haus ist gemütlich."],
        ["Wir flogen in ein parallel Universum.", "Wir flogen in ein paralleles Universum."],
      ],
      neg: [
        "Lieber Frau Becker als Herrn Schulz.",
        "Wir grüßen die liebe Frau Schulz.",
        "Das macht einem richtig Spaß.",
        "Wir halten es für wichtig Sport zu treiben.",
        "Er holt sich bei ihr Rat.",
        "Mit maximal Tempo fuhr er los.",
        "Sie kommt an genügend Geld.",
        "Der weiß Bescheid.",
        "Das weiß Gott allein.",
        "Halb Europa schaut zu.",
        "Er hat schnell Hilfe geholt.",
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
        [
          "Wir prüfen die Gewinn und Verlustrechnung.",
          "Wir prüfen die Gewinn- und Verlustrechnung.",
        ],
        ["Er ist gelernter Groß und Einzelhändler.", "Er ist gelernter Groß- und Einzelhändler."],
      ],
      neg: [
        "Sie rotteten das Unkraut mit Stumpf und Stiel aus.",
        "Ein Fest für Jung und Alt.",
        "Die Firma und Kunden sind zufrieden.",
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
        [
          "Die Renovierung kostet eine halbe Millionen.",
          "Die Renovierung kostet eine halbe Million.",
        ],
      ],
      neg: [
        "Zwei halbe Millionen ergeben eine ganze.",
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
    "germanColloquial",
    {
      pos: [
        ["Nach dem Regen gehen wir wieder raus.", "Nach dem Regen gehen wir wieder heraus."],
        ["Die Kinder sitzen den ganzen Tag rum.", "Die Kinder sitzen den ganzen Tag herum."],
        ["Kannst du die Datei runterladen?", "Kannst du die Datei herunterladen?"],
        ["Wir sind auf den Trick reingefallen.", "Wir sind auf den Trick hereingefallen."],
        ["Sie hat sich langsam rangetastet.", "Sie hat sich langsam herangetastet."],
        ["Das ist nur zum Rumprobieren gedacht.", "Das ist nur zum Herumprobieren gedacht."],
      ],
      neg: [
        "Der Zug muss noch rangieren.",
        "Wir reinigen das Bad.",
        "Das war rein zufällig.",
        "Im Glas ist Rum.",
        "Der Bach rauscht leise.",
        "Er wollte ans Telefon rangehen.",
        "Sie hat sich an ihn rangemacht.",
        "Man kann bequem rein- und rausschlüpfen.",
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
        ["Mit wessen Rad fuhr er.", "Mit wessen Rad fuhr er?"],
        ["Ist Anna schon da.", "Ist Anna schon da?"],
        [
          "Kann mir jemand sagen, wo der Bahnhof ist.",
          "Kann mir jemand sagen, wo der Bahnhof ist?",
        ],
        ["Wie lange dauert das noch.", "Wie lange dauert das noch?"],
      ],
      neg: [
        "Wie besprochen. Bis morgen.",
        "Was mich stört ist der Lärm.",
        "Wer zuerst kommt, mahlt zuerst.",
        "Wie wunderbar.",
        "Habt Geduld.",
        "Hätte ich das gewusst wäre ich gekommen.",
        "Er fragte: Wann kommst du.",
        "Kann Spuren von Sesam enthalten.",
        "Werde Ihre Mail morgen lesen.",
        "Wie schön das ist!",
      ],
    },
  ],
  [
    "germanVerbAgreement",
    {
      pos: [
        ["Wir muss morgen früh los.", "Wir müssen morgen früh los."],
        ["Die Gäste war sehr zufrieden.", "Die Gäste waren sehr zufrieden."],
        ["Die Lehrerinnen hat geholfen.", "Die Lehrerinnen haben geholfen."],
        ["Du kann gern mitkommen.", "Du kannst gern mitkommen."],
        ["Ich hat keine Ahnung.", "Ich habe keine Ahnung."],
        ["Morgen werde wir es sehen.", "Morgen werden wir es sehen."],
        ["Ihr wartest schon lange.", "Ihr wartet schon lange."],
        ["Er fährst morgen.", "Er fährt morgen."],
        ["Die Brücke ist seit Jahren gesperrt ist.", "Die Brücke ist seit Jahren gesperrt."],
        ["Ich glaube, dass sie hat keine Zeit hat.", "Ich glaube, dass sie keine Zeit hat."],
      ],
      neg: [
        "Die Nachbarin hat geholfen.",
        "Die Polizei war schnell da.",
        "Sie werden bald Eltern werden.",
        "Wir kaufen, was es zu kaufen gibt.",
        "Es ist, wie es ist.",
        "Das kann sein Fehler sein.",
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
        ["Wir haben neue Projekt gestartet.", "Wir haben neues Projekt gestartet."],
        ["Mit große Freude haben wir zugesagt.", "Mit großer Freude haben wir zugesagt."],
        ["Die Haus Tür klemmt.", "Die Haustür klemmt."],
        ["Wo liegt der Auto Schlüssel?", "Wo liegt der Autoschlüssel?"],
        ["Der Vorsitzender eröffnete die Sitzung.", "Der Vorsitzende eröffnete die Sitzung."],
        // The one object of a dative or an accusative verb.
        ["Kannst du bitte den Nachbarssohn helfen?", "Kannst du bitte dem Nachbarssohn helfen?"],
        ["Sie vertraut ihren alten Lehrer.", "Sie vertraut ihrem alten Lehrer."],
        ["Der Hund gehorcht seinen Besitzer.", "Der Hund gehorcht seinem Besitzer."],
        ["Weil wir den Trainer danken.", "Weil wir dem Trainer danken."],
        ["Morgen besuchen wir dem Großvater.", "Morgen besuchen wir den Großvater."],
        ["Kennst du diesem Fahrer?", "Kennst du diesen Fahrer?"],
      ],
      neg: [
        "Ich helfe den Kindern beim Lesen.",
        "Wir danken den Gästen für ihr Kommen.",
        "Er hilft den Schrank tragen.",
        "Ich sehe den Mann winken.",
        "Ich kenne ihn nur dem Namen nach.",
        "Sie beantwortet dem Kunden seine Frage.",
        "Der Film gefällt dem Publikum.",
        "Wir folgen dem Fluss bis zur Brücke.",
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
        "Er hat früher Bier getrunken.",
        "Sie schenkte der Mutter Blumen.",
        "Ein Bekannter hat angerufen.",
        "Der Lehrer hat angerufen.",
        "Er war Schüler einer Berliner Schule.",
        "Schönes Wetter heute!",
        "Gute Nacht und bis morgen.",
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
    ["Die Sitzung hat zulange gedauert.", "Die Sitzung hat zu lange gedauert."],
    ["Beim Rasen mähen trage ich Ohrenschützer.", "Beim Rasenmähen trage ich Ohrenschützer."],
    ["Zum Brot backen braucht man Geduld.", "Zum Brotbacken braucht man Geduld."],
    ["Vielen Dank für das Fenster putzen!", "Vielen Dank für das Fensterputzen!"],
    ["Er freute sich, das zulesen.", "Er freute sich, das zu lesen."],
    [
      "Es wundert mich zusehen, wie schnell das geht.",
      "Es wundert mich zu sehen, wie schnell das geht.",
    ],
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
    "Beim Buffet greife ich gern zu, wenn ich zulange, wird es teuer.",
    "Beim Bäcker kaufen wir Brötchen.",
    "Sie war beim Training laufen.",
    "Wir gehen zum Essen holen.",
    "Du kannst mit dem Lehrer sprechen, wenn du willst.",
    "Wir sollten, statt zu reden, zuhören.",
    "Er bat mich, zuzuhören.",
    "Bitte, zuhören!",
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

test("German tokens keep hyphenated compounds whole and a dangling hyphen apart", () => {
  expect(tokensAfter("Grammatik-Regeln sollten - wie Vor- und Nachteile", 0, 9)).toEqual([
    "Grammatik-Regeln",
    "sollten",
    "-",
    "wie",
    "Vor",
    "-",
    "und",
    "Nachteile",
  ]);
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

// Needs python3 with marisa-trie and numpy, as above.
const ngrams = readGermanNgrams();
test.skipIf(ngrams === null)(
  "the committed noun and verb usage tables match de_DE.dic/.aff and the n-gram counts",
  async () => {
    const [dic, aff, committed] = await Promise.all(
      [GERMAN_LEXICON_SOURCES.dic, GERMAN_LEXICON_SOURCES.aff, GERMAN_LEXICON_SOURCES.usage].map(
        (path) => readFile(path, "utf8"),
      ),
    );
    expect(buildGermanUsage(dic, aff, ngrams!)).toBe(committed);
  },
);

test("German usage tables read nouns over adjectives and verb object cases", () => {
  for (const word of ["alter", "spitze", "wert", "wüste"]) {
    expect(germanNounOverAdjective(word)).toBe(true);
  }
  for (const word of ["alte", "kleine", "gut", "schnell"]) {
    expect(germanNounOverAdjective(word)).toBe(false);
  }
  expect(["hilft", "half", "dankte", "gehört"].map(germanVerbObjectCase)).toEqual(
    Array(4).fill("dative"),
  );
  expect(["fragt", "besuchte", "kennst", "trifft"].map(germanVerbObjectCase)).toEqual(
    Array(4).fill("accusative"),
  );
  expect(["gibt", "zeigt", "kauft"].map(germanVerbObjectCase)).toEqual([null, null, null]);
});

test.each([
  ["Lehrer", "m", true],
  ["Grundschullehrer", "m", true],
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
  slowestGermanChunkMs(GERMAN_WORST_CASES.join("\n"));
  for (const text of GERMAN_WORST_CASES) expect(slowestGermanChunkMs(text)).toBeLessThan(100);
});

// Without the JIT, a lookbehind with an unbounded quantifier goes quadratic on a run of
// spaces (seconds per chunk); bounded ones stay near linear.
test("no German chunk goes quadratic with the regex JIT off", () => {
  const run = Bun.spawnSync(["bun", "tests/grammar/germanWorstCase.fixture.ts"], {
    env: { ...process.env, BUN_JSC_useRegExpJIT: "0" },
  });
  expect(run.exitCode).toBe(0);
  expect(Number(run.stdout.toString())).toBeLessThan(400);
}, 60_000);

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
