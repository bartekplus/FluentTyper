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
          "Das Speichern geht durch das kopieren der Dateien.",
          "Das Speichern geht durch das Kopieren der Dateien.",
        ],
        [
          "Beim Lesen und schreiben hilft eine Brille.",
          "Beim Lesen und Schreiben hilft eine Brille.",
        ],
        ["Das Bild ist kaum etwas Wert.", "Das Bild ist kaum etwas wert."],
        ["Sie kam erst spät Nachts heim.", "Sie kam erst spätnachts heim."],
        ["Der arbeitslose bekam Hilfe.", "Der Arbeitslose bekam Hilfe."],
        ["Hallo meine liebe, wie geht es dir?", "Hallo meine Liebe, wie geht es dir?"],
        ["Wir feiern zu ehren unserer Gäste.", "Wir feiern zu Ehren unserer Gäste."],
        ["Du musst dir keine sorgen machen.", "Du musst dir keine Sorgen machen."],
        ["Das darf man nicht außer acht lassen.", "Das darf man nicht außer Acht lassen."],
        ["Es tut mir sehr Leid.", "Es tut mir sehr leid."],
        ["Das einzige, was zählt, ist Ehrlichkeit.", "Das Einzige, was zählt, ist Ehrlichkeit."],
        ["Die Noten sind mir völlig Wurst.", "Die Noten sind mir völlig wurst."],
        ["Bitte schicken sie mir die Unterlagen.", "Bitte schicken Sie mir die Unterlagen."],
        [
          "Diesmal klappt es, nicht wie beim letzten mal.",
          "Diesmal klappt es, nicht wie beim letzten Mal.",
        ],
        ["Ich sage es zum wiederholten mal.", "Ich sage es zum wiederholten Mal."],
        ["Sie antwortete mit einem knappen nein.", "Sie antwortete mit einem knappen Nein."],
        ["Wir sind sehr Dankbar für eure Hilfe.", "Wir sind sehr dankbar für eure Hilfe."],
        ["Die Daten dürfen nicht an dritte gehen.", "Die Daten dürfen nicht an Dritte gehen."],
        ["Er war der letzte, der ging.", "Er war der Letzte, der ging."],
        ["Bei dem Konzert stand die Halle Kopf.", "Bei dem Konzert stand die Halle kopf."],
        ["Am Workshop nehmen wir gerne Teil.", "Am Workshop nehmen wir gerne teil."],
        [
          "Das erste, worauf sie achtet, ist der Preis.",
          "Das Erste, worauf sie achtet, ist der Preis.",
        ],
        // A noun that is also an adjective form, where the ending rules out the adjective.
        ["Auch ich kann keine wunder bewirken.", "Auch ich kann keine Wunder bewirken."],
        ["Hier liegt wohl kein defekt vor.", "Hier liegt wohl kein Defekt vor."],
        ["Wir trafen uns an der bar.", "Wir trafen uns an der Bar."],
        ["Das war ein notwendiges übel.", "Das war ein notwendiges Übel."],
        ["Die Braut heiratet in weiß.", "Die Braut heiratet in Weiß."],
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
        [
          "Das Heilige Römische Reich deutscher Nation zerfiel 1806.",
          "Das Heilige Römische Reich Deutscher Nation zerfiel 1806.",
        ],
        ["Der wiener Kongress ordnete Europa neu.", "Der Wiener Kongress ordnete Europa neu."],
        ["Wir kaufen schweizer Käse.", "Wir kaufen Schweizer Käse."],
        // Adjectives that are no part of a name stay lowercase inside a sentence.
        ["Am Abend trinke ich Grünen Tee.", "Am Abend trinke ich grünen Tee."],
        [
          "Der Vortrag handelte von Künstlicher Intelligenz.",
          "Der Vortrag handelte von künstlicher Intelligenz.",
        ],
        ["Viele Liebe Grüße aus Bonn.", "Viele liebe Grüße aus Bonn."],
        [
          "Im Urlaub wanderten wir in der hohen Tatra.",
          "Im Urlaub wanderten wir in der Hohen Tatra.",
        ],
        ["Das Konzert war etwas ganz besonderes.", "Das Konzert war etwas ganz Besonderes."],
        ["Im Angebot war nichts wirklich passendes.", "Im Angebot war nichts wirklich Passendes."],
        ["Hallo Liebe Sabine, schön dich zu sehen.", "Hallo liebe Sabine, schön dich zu sehen."],
        // Nouns that are also uninflected words, after an article; nouns with no determiner.
        ["Wir hatten keine angst vor dem Gewitter.", "Wir hatten keine Angst vor dem Gewitter."],
        ["Er ist schon lange mein freund.", "Er ist schon lange mein Freund."],
        ["Am frühen morgen fuhren wir los.", "Am frühen Morgen fuhren wir los."],
        ["Sie vergoss keine tränen darüber.", "Sie vergoss keine Tränen darüber."],
        ["Gib dir bitte etwas mühe.", "Gib dir bitte etwas Mühe."],
        ["Die Milch steht im kühlschrank.", "Die Milch steht im Kühlschrank."],
        // An object after its verb, closed by the clause's end or a genitive.
        ["Die Neuigkeit machte die runde.", "Die Neuigkeit machte die Runde."],
        // The polite imperative.
        ["Nehmen sie bitte Platz!", "Nehmen Sie bitte Platz!"],
        ["Bitte warten sie hier!", "Bitte warten Sie hier!"],
        // A finite-verb-like noun after the clause's own finite verb, or ending a pair of nouns.
        ["Am Wochenende drehen wir filme.", "Am Wochenende drehen wir Filme."],
        ["Er kämpfte für Freiheit und ehre.", "Er kämpfte für Freiheit und Ehre."],
        // The object of "haben" that ends its clause.
        ["Wir hatten schulden bei der Bank.", "Wir hatten Schulden bei der Bank."],
        ["Ich habe fragen zum Vertrag.", "Ich habe Fragen zum Vertrag."],
        // After an inflected adjective with no determiner.
        ["Frische brötchen gibt es hier.", "Frische Brötchen gibt es hier."],
        ["Morgen soll es schönes wetter geben.", "Morgen soll es schönes Wetter geben."],
        [
          "Die Mannschaft leistete erbitterten widerstand.",
          "Die Mannschaft leistete erbitterten Widerstand.",
        ],
        ["Sie hat ihm die treue gehalten.", "Sie hat ihm die Treue gehalten."],
        [
          "Die Gegner haben uns in die enge getrieben.",
          "Die Gegner haben uns in die Enge getrieben.",
        ],
        ["Für die Prüfung brauchst du viel geduld.", "Für die Prüfung brauchst du viel Geduld."],
        // Adjectives used as nouns with no noun after them.
        ["Was habt ihr heute schönes erlebt?", "Was habt ihr heute Schönes erlebt?"],
        ["Wir müssen schlimmeres verhindern.", "Wir müssen Schlimmeres verhindern."],
        ["Sie hat beim Turnier ihr bestes gegeben.", "Sie hat beim Turnier ihr Bestes gegeben."],
        ["Das gute daran ist der Preis.", "Das Gute daran ist der Preis."],
        [
          "Nach dem Sturm haben wir das gröbste geschafft.",
          "Nach dem Sturm haben wir das Gröbste geschafft.",
        ],
        ["Ich bin mir nicht im klaren darüber.", "Ich bin mir nicht im Klaren darüber."],
      ],
      neg: [
        "Das sagen der Lehrer und die Eltern.",
        "Darauf lege ich viel Wert.",
        "Eines Abends kam er.",
        "Der verletzte Arm heilt.",
        "Wir ehren die Toten.",
        "Weil sie sich sorgen.",
        "Um acht Uhr geht es los.",
        "Das Leid der Tiere ist groß.",
        "Worin zeigt sich dieses Leidtun?",
        "Kommen sie bitte morgen?",
        "Dieser Vorschlag ist das beste, was wir haben.",
        "Sie fuhr 1990 als erstes nach der Wende gebautes Modell vom Band.",
        "Zum Abendbrot gibt es Käse und Wurst.",
        "Komm mal zu mir.",
        "Ja oder nein?",
        "Ich weiß das ja.",
        "Das ist Stolz.",
        "Das ist Englisch.",
        "Für die erste, die zweite und die dritte Gruppe gilt das.",
        "Das hier ist Wurst.",
        "Die Läufer lagen Kopf an Kopf.",
        "Ich nehme den größten Teil.",
        "Sie nahm am Ende Teil zwei.",
        "Der Weg wird kein leichter sein.",
        "Das dürfte fürs erste reichen.",
        "Ich schaue lieber fern.",
        "Er macht mit ihr halb und halb.",
        "Wir mieten ein fest installiertes Display.",
        "Er trinkt seinen Kaffee am liebsten schwarz.",
        "Sie hat ihm die Treue gehalten und ist geblieben.",
        "Das Wetter ist grau in grau.",
        "Die Ampel ist grün.",
        "Das ende ich jetzt sofort.",
        "Die alte wohnt nebenan, die junge zieht bald weg.",
        "Er hat das recht schnell erledigt.",
        "Ich habe das wohl falsch verstanden.",
        "Sie liebt ihn über alles.",
        "Das Zimmer, in dem leben drei Katzen, ist warm.",
        "Als die Truppe angriff, flohen alle.",
        "Diese stellen meiner Schwester ein Zimmer bereit.",
        "Ein über die Jahre gewachsenes Dorf liegt dort.",
        "Wenn Sie ein neues eingeben, wird es gespeichert.",
        "Den Zähler auf 0 setzen, um neu zu beginnen.",
        "Wir sind heute zuhause.",
        "Er stand vor Freude kopf.",
        "Das ist bei uns gang und gäbe.",
        "Ich düse gleich los.",
        "Auf dem Schild stand opus magnum geschrieben.",
        "Ich kaufe dir ein schönes neues.",
        "Das Verhältnis war nicht das beste.",
        "Sie ist nicht nur weltliches, sondern auch geistliches Oberhaupt.",
        "Er springt von einem Boot ins nächste.",
        "Das Produkt ist das einzige am Markt.",
        "Sie trinkt gern kaltes Wasser.",
        "Das ist ein Berliner Bär.",
        "Grüner Tee ist gesund.",
        "Was ist das wohl?",
        "Wir wollen frische kaufen.",
        "Ich habe vergessen.",
        "Neue kommen.",
        "So ist es halt.",
        "Ich weiß, dass er filme.",
        "Die Frage die ich mir da stelle, ist gut.",
        "Die Kosten, die bei 0,5% wegfallen würden, sind gering.",
        "Sie öffnet die Tür und tritt ein.",
        "Kommen sie heute?",
        "Die Kinder spielen, wenn sie wollen!",
        "Wir fragen sie morgen!",
        "Ich habe ihn fragen wollen.",
        "Ich weiß, dass neue kommen.",
        "Das Argument kann ich nicht gelten lassen.",
        "Dinge, die sich teilweise überlappen, zählen doppelt.",
        "Ich kann das null nachvollziehen.",
        "Ich habe die alte gekauft.",
        "Liebe Grüße aus Bonn.",
        "Frohes neues Jahr!",
        "Er hat einen englischen Garten angelegt.",
        "Die Burg hat einen schiefen Turm.",
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
        "Wie ihr das schafft, ist mir ein Rätsel.",
        "Ich frage mich, wo sie das kaufen.",
        "Wenn du das reparieren könntest, wäre ich froh.",
        "Ich verstehe nicht, wie das klappen soll.",
        "Ich mag es, wie sie das macht.",
        "Wir bauen morgen das Zelt auf.",
        "Die Preise steigen schnell weiter.",
        "Alle Angaben ohne Gewähr, Änderungen vorbehalten.",
        "Das sind die Lieder von denen ich sprach.",
      ],
    },
  ],
  [
    "germanPrepositionCase",
    {
      pos: [
        ["Er kam mit große Freude.", "Er kam mit großer Freude."],
        ["Das Brett mit neue Felder ist fertig.", "Das Brett mit neuen Feldern ist fertig."],
        ["Entsprechend meine Erwartung kam er spät.", "Entsprechend meiner Erwartung kam er spät."],
        ["Ich fahre mit eine Kollegin nach Hause.", "Ich fahre mit einer Kollegin nach Hause."],
        ["Wir spielen mit anderen Kinder.", "Wir spielen mit anderen Kindern."],
        ["Wir sprachen lange von Düfte und Farben.", "Wir sprachen lange von Düften und Farben."],
        [
          "Die Polizei handelte nach Erkenntnisse der Ermittler.",
          "Die Polizei handelte nach Erkenntnissen der Ermittler.",
        ],
        ["Er starrte sie mit ernsten Blick an.", "Er starrte sie mit ernstem Blick an."],
        ["Wir sehen uns in 10 Tage wieder.", "Wir sehen uns in 10 Tagen wieder."],
        ["Ich war schon bei drei Zahnärzte.", "Ich war schon bei drei Zahnärzten."],
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
        "Dem Plan entsprechend keine Farbe zu verwenden, war klug.",
        "Er arbeitet bei Ärzte ohne Grenzen.",
        "Das Jahr wird in 12 Monate eingeteilt.",
        "Er ist zu Tode erschrocken.",
        "Das Paket kommt von Müller.",
        "Wir grüßen mit freundlichen Grüßen.",
        "Die zu fällenden Bäume sind markiert.",
        "Das sind viel zu knappe Mittel.",
        "Sie geht mit ihren Freundinnen aus.",
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
        ["Aber dass ist nicht wahr.", "Aber das ist nicht wahr."],
        ["Das Haus, dass dort steht, ist alt.", "Das Haus, das dort steht, ist alt."],
        ["Wir sind schon soweit gelaufen.", "Wir sind schon so weit gelaufen."],
        ["Sie spielt sowohl Geige und auch Klavier.", "Sie spielt sowohl Geige als auch Klavier."],
        ["Wir sind fasst fertig.", "Wir sind fast fertig."],
        ["Mein Vornahme steht auf dem Ausweis.", "Mein Vorname steht auf dem Ausweis."],
        ["Wir zahlen den Wagen in 24 Ratten ab.", "Wir zahlen den Wagen in 24 Raten ab."],
        ["Im Keller wohnen Mäuse und Raten.", "Im Keller wohnen Mäuse und Ratten."],
        [
          "Am Sonntag gibt es einen ökonomischen Gottesdienst.",
          "Am Sonntag gibt es einen ökumenischen Gottesdienst.",
        ],
        ["Hast du die Haustür abgeschossen?", "Hast du die Haustür abgeschlossen?"],
        ["Sie hat mich in ihre Pläne eingewiesen.", "Sie hat mich in ihre Pläne eingeweiht."],
        ["Der Frachter wurde im Sturm versengt.", "Der Frachter wurde im Sturm versenkt."],
        ["Wo wart ihr den?", "Wo wart ihr denn?"],
        ["Sie spielt gern mir ihm Karten.", "Sie spielt gern mit ihm Karten."],
        ["Schön das Freunde vorbeischauen.", "Schön, dass Freunde vorbeischauen."],
        [
          "Sie gab mir den Tipp das Karten online günstiger sind.",
          "Sie gab mir den Tipp, dass Karten online günstiger sind.",
        ],
        ["Ich brauche diene Hilfe nicht.", "Ich brauche deine Hilfe nicht."],
        ["Wohin fährst du hin?", "Wohin fährst du?"],
        ["Heute läuft sie schneller wie gestern.", "Heute läuft sie schneller als gestern."],
        ["Mein Bruder ist größer wie ich.", "Mein Bruder ist größer als ich."],
        ["Das ist meine eigne Meinung.", "Das ist meine eigene Meinung."],
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
        "Ich weiß, dass er kommt.",
        "Soweit ich weiß, stimmt das.",
        "Er fasst jeden Gegenstand vorsichtig an.",
        "Ich diene meinem Land.",
        "Ich zeige der Nachbarin das Zimmer.",
        "Er hat durchs Fenster geschossen.",
        "Die Vornahme der Messung dauert lange.",
        "In 12 Ratten fand man das Virus.",
        "Die Raten und Zinsen steigen.",
        "Er hat im Spiel zwei Tore geschossen.",
        "Der Arzt hat ihn in die Klinik eingewiesen.",
        "Die Hitze hat das Gras versengt.",
        "Kennst du den?",
        "Er hat mir ihr Auto geliehen.",
        "Es gab eine ökologische Trauerfeier.",
        "Toll das Kleid steht dir.",
        "Gut das Essen schmeckt.",
        "Er gab dem Lehrer das Heft zurück.",
        "Er kommt sowohl heute als auch morgen und auch übermorgen.",
        "Der Boden ist sauber wie ein Spiegel.",
        "Wir machen weiter wie bisher.",
        "Er wird im gleichen Maße besser wie sie.",
        "Das ist so gut wie neu.",
        "Die eignen sich gut.",
        "Der Kamm liegt im Bad.",
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
        ["Er reparierte den defekt Motor.", "Er reparierte den defekten Motor."],
        ["Er arbeitet mit voll Konzentration.", "Er arbeitet mit voller Konzentration."],
        ["Am Abend trinken sie gern rot Wein.", "Am Abend trinken sie gern Rotwein."],
        ["Im Herbst essen wir oft grün Kohl.", "Im Herbst essen wir oft Grünkohl."],
        ["Wir liefern die Daten in digital Form.", "Wir liefern die Daten in Digitalform."],
        ["Das Auto war schnelle.", "Das Auto war schnell."],
        ["Das Zimmer ist dunkle.", "Das Zimmer ist dunkel."],
        ["Er läuft schnelle als ich.", "Er läuft schneller als ich."],
        ["Der Unfall geschah ohne fremd Verschulden.", "Der Unfall geschah ohne Fremdverschulden."],
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
        "Am Ende hat das sicher Vorteile.",
        "Damit hat der wirklich Glück gehabt.",
        "Er ist müde.",
        "Das Essen war spitze.",
        "Wir sind viele.",
        "Wir nehmen die rote als Ersatz.",
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
        ["Die Zeit und Geldfrage ist entscheidend.", "Die Zeit- und Geldfrage ist entscheidend."],
        ["Die Material und Lohnkosten steigen.", "Die Material- und Lohnkosten steigen."],
        [
          "Ober und unterirdische Leitungen kreuzen sich.",
          "Ober- und unterirdische Leitungen kreuzen sich.",
        ],
        ["Sie war hin und her gerissen.", "Sie war hin- und hergerissen."],
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
        ["Wir senken die Ein/Auszahlungsgebühren.", "Wir senken die Ein-/Auszahlungsgebühren."],
        [
          "Die Landes und Kommunalpolitiker trafen sich.",
          "Die Landes- und Kommunalpolitiker trafen sich.",
        ],
      ],
      neg: [
        "Die Mutter und Tochter kamen zusammen.",
        "Er lief hin und her.",
        "Der Hund und die Katzenklappe sind neu.",
        "Bitte schicken Sie mir die Unterlagen bis Freitag.",
        "Im Spanischen steht das Pronomen nach Infinitiv oder Gerundium.",
        "Wir feiern Peters und Marias Hochzeitstag.",
        "Sie rotteten das Unkraut mit Stumpf und Stiel aus.",
        "Ein Fest für Jung und Alt.",
        "Die Firma und Kunden sind zufrieden.",
        "Wir sind für Umwelt und Naturschutz.",
        "Vor und nach dem Essen.",
        "Er ging ein und aus.",
        "Kunst und Kultur sind wichtig.",
        "Er lief hin und her.",
        "Die Vor- und Nachteile sind klar.",
        "Öffne den Ordner Ein/Ausgaben/2024 im Explorer.",
        "Die Seite liegt unter example.org/Ein/Ausgaben.",
      ],
    },
  ],
  [
    "germanAbbreviations",
    {
      pos: [
        ["Es passen max 4 Personen hinein.", "Es passen max. 4 Personen hinein."],
        ["Das Kloster wurde 800 n Chr. gegründet.", "Das Kloster wurde 800 n. Chr. gegründet."],
        ["Schmidt et al zeigen das.", "Schmidt et al. zeigen das."],
        ["Wir arbeiten idR bis vier.", "Wir arbeiten i. d. R. bis vier."],
        ["Er kam u.a mit Anna.", "Er kam u. a. mit Anna."],
        ["Sie ist Dipl-Ing. bei uns.", "Sie ist Dipl.-Ing. bei uns."],
        ["Es kostet 2 mio Euro.", "Es kostet 2 Mio. Euro."],
        ["Das gilt z B. für alle.", "Das gilt z.\u00a0B. für alle."],
      ],
      neg: [
        "Mad Max 3 lief im Kino.",
        "Die Variablen u a b sind gesetzt.",
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
        ["„Wir fahren morgen.“, sagte sie.", "„Wir fahren morgen“, sagte sie."],
        ["„Das stimmt nicht,“ meinte er.", "„Das stimmt nicht“, meinte er."],
        ["„Wo bist du?“ rief sie.", "„Wo bist du?“, rief sie."],
        [",,Gut“, sagte er.", "„Gut“, sagte er."],
        ['Er rief „Halt" und blieb stehen.', "Er rief „Halt“ und blieb stehen."],
        ["Das Album ”Blau“ kam 2010.", "Das Album „Blau“ kam 2010."],
      ],
      neg: [
        "Sie kennt den Film „Quo vadis?“.",
        "Der Operator „,“ trennt Werte.",
        "„Komm her!“, rief sie.",
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
        [
          "Mir geht es nur darum den Termin zu halten.",
          "Mir geht es nur darum, den Termin zu halten.",
        ],
        [
          "Es hängt davon ab rechtzeitig Bescheid zu geben.",
          "Es hängt davon ab, rechtzeitig Bescheid zu geben.",
        ],
        [
          "Sie hat nie daran gezweifelt das Ziel zu erreichen.",
          "Sie hat nie daran gezweifelt, das Ziel zu erreichen.",
        ],
        ["Ich bin es müde ständig zu warten.", "Ich bin es müde, ständig zu warten."],
        ["Sie hasst es morgens früh aufzustehen.", "Sie hasst es, morgens früh aufzustehen."],
        [
          "Er lief zum Bahnhof um den Zug zu erreichen.",
          "Er lief zum Bahnhof, um den Zug zu erreichen.",
        ],
        [
          "Wir kaufen den Tisch den du ausgesucht hast.",
          "Wir kaufen den Tisch, den du ausgesucht hast.",
        ],
        ["Stell dir mal vor wir gewinnen.", "Stell dir mal vor, wir gewinnen."],
        [
          "Sehr geehrte Frau Weber\nwir danken Ihnen.",
          "Sehr geehrte Frau Weber,\nwir danken Ihnen.",
        ],
        ["Gestern dachte ich mir ich rufe dich an.", "Gestern dachte ich mir, ich rufe dich an."],
        ["Ich finde es seltsam wie er redet.", "Ich finde es seltsam, wie er redet."],
      ],
      neg: [
        "Liebe Grüße\nAnna",
        "Er tat so, als ob er schliefe.",
        "Sie lachte, sodass alle mitlachten, und auch wenn es spät war, blieben wir.",
        "Ich komme, wenn möglich früher, und je nachdem ob es regnet.",
        "Zwei Tage nachdem sie abgereist war, kam der Brief.",
        "Es geht um das Recht zu schweigen.",
        "Er kümmert sich um den Garten, ohne Handschuhe zu tragen.",
        "Ich fange um acht Uhr zu arbeiten an.",
        "Ich glaube an dich und denke oft an dich.",
        "Kurz darauf fing es an zu regnen.",
        "Er versuchte danach das Fenster zu öffnen.",
        "Es gibt daran nichts zu verbessern.",
        "Ich freue mich darauf zu kommen.",
        "Es ist schwer das zu sagen.",
        "Es wird nicht leicht sein das zu erklären.",
        "Es geht um Geld zu verdienen und zu sparen.",
        "Der Preis der neuen Wohnung ist hoch.",
        "Die Zahl der hier lebenden Familien wächst.",
        "Er reichte der Kundin die frisch gedruckte Rechnung.",
        "Er stellte die Kiste vor die Tür.",
        "Sie ist genauso alt wie ich es war.",
        "Er sagte, wofür wir soweit ich weiß nichts zahlen.",
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
        [
          "Das Schloss stammt aus dem 16 Jahrhundert.",
          "Das Schloss stammt aus dem 16. Jahrhundert.",
        ],
        ["Wir treffen uns am 3 Oktober.", "Wir treffen uns am 3. Oktober."],
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
        ["Die Praxis ist von 8-12 Uhr besetzt.", "Die Praxis ist von 8 bis 12 Uhr besetzt."],
        ["Lies bitte von Seite 3–5.", "Lies bitte von Seite 3 bis 5."],
        ["Ein Lexikon von A–Z.", "Ein Lexikon von A bis Z."],
        ["Er wohnte zwischen 1990 - 1995 dort.", "Er wohnte zwischen 1990 und 1995 dort."],
      ],
      neg: [
        "Die 20 Minuten vergingen schnell.",
        "Er wohnt im Haus 12.",
        "Zwei halbe Millionen ergeben eine ganze.",
        "Wir rechnen mit Kosten von 20–30 Euro.",
        "Die Strecke zwischen A und B ist kurz.",
        "Er fährt einen Wagen von A-Klasse.",
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
        ["Für was brauchst du das?", "Wofür brauchst du das?"],
        ["Ich weiß nicht, um was es geht.", "Ich weiß nicht, worum es geht."],
        ["Nach dem Regen gehen wir wieder raus.", "Nach dem Regen gehen wir wieder heraus."],
        ["Die Kinder sitzen den ganzen Tag rum.", "Die Kinder sitzen den ganzen Tag herum."],
        ["Kannst du die Datei runterladen?", "Kannst du die Datei herunterladen?"],
        ["Wir sind auf den Trick reingefallen.", "Wir sind auf den Trick hereingefallen."],
        ["Sie hat sich langsam rangetastet.", "Sie hat sich langsam herangetastet."],
        ["Das ist nur zum Rumprobieren gedacht.", "Das ist nur zum Herumprobieren gedacht."],
      ],
      neg: [
        "Er kämpft gegen was Neues.",
        "In was für einem Haus wohnst du?",
        "Wir sind gekommen, um was zu essen.",
        "Sie stand an der Spitze der Rangliste.",
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
    "germanRecommendedSpelling",
    {
      pos: [
        ["Sie schrieb eine Biographie.", "Sie schrieb eine Biografie."],
        ["Das Telephon klingelt.", "Das Telefon klingelt."],
        ["Er erzählte phantastische Geschichten.", "Er erzählte fantastische Geschichten."],
        ["Auf Grund der Hitze blieben wir drinnen.", "Aufgrund der Hitze blieben wir drinnen."],
        ["Die Analyse erfolgte an Hand der Daten.", "Die Analyse erfolgte anhand der Daten."],
        ["Ich bin heute zuhause.", "Ich bin heute zu Hause."],
        ["Das Ergebnis wird morgen bekanntgegeben.", "Das Ergebnis wird morgen bekannt gegeben."],
      ],
      neg: [
        "Der Graph hat sieben Kanten.",
        "Graphen leitet Strom sehr gut.",
        "Die Phonetik ist ein Teilgebiet.",
        "Mein Zuhause ist klein.",
        "Er stellte sich in Stand 4 auf.",
        "Die Bekanntmachung hängt aus.",
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
        ["Morgen will ich ein Fahrrad kaufe.", "Morgen will ich ein Fahrrad kaufen."],
        ["Ich musst gestern lange warten.", "Ich musste gestern lange warten."],
        ["Ich möchten Sie um Geduld bitten.", "Ich möchte Sie um Geduld bitten."],
        ["Er möchte später Arzt werde.", "Er möchte später Arzt werden."],
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
        "Das Haus wird gebaut.",
        "Das wird leicht.",
        "Ich will das Buch, das du hast.",
        "Weil sie die Arbeit planen kann als auch den Bericht vorlegt, bleibt sie.",
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
        ["Wir haben ein großer Haus gekauft.", "Wir haben ein großes Haus gekauft."],
        ["Es geht um kein Vertrag.", "Es geht um keinen Vertrag."],
        ["Der Fahrrad steht im Keller.", "Das Fahrrad steht im Keller."],
        ["Die Idee als solches ist gut.", "Die Idee als solche ist gut."],
        ["Dazu bedarf es einem neuen Gesetz.", "Dazu bedarf es eines neuen Gesetzes."],
        ["Er enthielt sich dem Urteil.", "Er enthielt sich des Urteils."],
        ["Dem Vertrag als solche fehlt nichts.", "Dem Vertrag als solchem fehlt nichts."],
        ["Er lehnt den Vorschlag als solches ab.", "Er lehnt den Vorschlag als solchen ab."],
        ["Sie vertraute ihren Freund blind.", "Sie vertraute ihrem Freund blind."],
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
        "Er ist ein guter Freund.",
        "Ich wünsche dir einen schönen Tag.",
        "Was ist das für ein Lärm?",
        "Er dehnte nach und nach seinen Einfluss aus.",
        "Sie gilt in der Branche als solche Expertin.",
        "Sie ist in der Stadt als solche bekannt.",
        "Er gedachte den Vertrag zu kündigen.",
        "Die Kiste enthielt den Brief.",
        "Das Werk als solches überzeugt.",
        "Weder ich noch mein Freund können Auto fahren.",
        "Das Morgen gehört uns.",
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
        "Sie schlief beim Zeitung lesen ein.",
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
    ["Sie schlief beim Zeitung lesen ein.", "Sie schlief beim Zeitunglesen ein."],
    ["Vielen Dank für das Fenster putzen!", "Vielen Dank für das Fensterputzen!"],
    ["Danke fürs Auto waschen.", "Danke fürs Autowaschen."],
    ["Wir gehen heute in's Kino.", "Wir gehen heute ins Kino."],
    ["Habt ihr euch gut unter halten?", "Habt ihr euch gut unterhalten?"],
    ["Der Damm hat dem Hochwasser stand gehalten.", "Der Damm hat dem Hochwasser standgehalten."],
    ["Bitte prüfe deine Spam-Emails.", "Bitte prüfe deine Spam-E-Mails."],
    ["Schreib mir eine E mail.", "Schreib mir eine E-Mail."],
    ["Wie lautet deine E-Mail Adresse?", "Wie lautet deine E-Mail-Adresse?"],
    ["Wir verabreden uns zum Karten spielen.", "Wir verabreden uns zum Kartenspielen."],
    ["Beim Joggen gehen ist sie ausgerutscht.", "Beim Joggengehen ist sie ausgerutscht."],
    ["Tipps zum selber Bauen.", "Tipps zum Selberbauen."],
    ["Er freute sich, das zulesen.", "Er freute sich, das zu lesen."],
    ["Ist es klug unter zu tauchen?", "Ist es klug unterzutauchen?"],
    ["Nach dem er angekommen war, aßen wir.", "Nachdem er angekommen war, aßen wir."],
    ["So weit ich weiß, stimmt das.", "Soweit ich weiß, stimmt das."],
    ["Er tat es ihr zu Liebe.", "Er tat es ihr zuliebe."],
    ["Den Berichten zu Folge war es kalt.", "Den Berichten zufolge war es kalt."],
    ["Das kam ihm zu gute.", "Das kam ihm zugute."],
    [
      "Nachdem sie das vor geschlagen hatte, war es still.",
      "Nachdem sie das vorgeschlagen hatte, war es still.",
    ],
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
    "Ich muss noch beim Vermieter anrufen.",
    "Darf ich per E-Mail Adressen schicken?",
    "Die Schale hat Kupfer-Email.",
    "Das Schiff ging unter.",
    "Es stand geschrieben.",
    "Wir bleiben unter uns.",
    "Ich fahre zum Baumarkt einkaufen.",
    "Bring das Wasser zum Kochen.",
    "Das bringt mich zum Lachen.",
    "Wir müssen die Suppe zum Kochen bringen.",
    "Zum Arzt gehen ist manchmal nötig.",
    "Nach dem Essen gehen wir spazieren.",
    "Er stellt das Gerät zur Verfügung.",
    "Du kannst mit dem Lehrer sprechen, wenn du willst.",
    "Wir sollten, statt zu reden, zuhören.",
    "Er bat mich, zuzuhören.",
    "Bitte, zuhören!",
    "Die Sonne ging unter zu dieser Zeit.",
    "Ich fand den Schlüssel, nach dem ich suchte.",
    "Es wurde zu Liebe statt zu Hass aufgerufen.",
    "Die Spannung steigt von Folge zu Folge.",
    "Er hat zu gute Noten.",
    "Er hält Kontakt zu Nichte und Neffe.",
    "So weit, so gut.",
    "Er war zu gelassen, um sich zu ärgern.",
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
  ["Freund", "m", false],
  ["Schulweg", "m", false],
])("%s has gender %p (plural form: %p)", (word, gender, plural) => {
  expect(germanGender(word)).toEqual({ gender: gender as never, plural });
});

test.each([
  "Kinder",
  "See",
  "Teil",
  "Heirat",
  "Armut",
  "Legende",
  "Kuchen",
  "Kirchen",
  "Menschen",
  "Xyzzy",
])("%s has no single gender", (word) => {
  expect(germanGender(word)).toBeNull();
});

test.each([
  ["zugriff", "finite"],
  ["kosten", "infinitive"],
  ["vertrag", "finite"],
  ["zeit", "noun"],
  ["kühlschrank", "noun"],
  ["vorstellung", "noun"],
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

// A clause inside a sentence is set off on both sides.
test.each([
  ["Die Lehrerin die nebenan wohnt grüßt nie.", "Die Lehrerin, die nebenan wohnt, grüßt nie."],
  ["Der Bus fährt soweit ich weiß stündlich.", "Der Bus fährt, soweit ich weiß, stündlich."],
  ["Ist das Paket das gestern kam beschädigt?", "Ist das Paket, das gestern kam, beschädigt?"],
])("germanCommas sets off the clause in %p", (input, output) => {
  expect(fixed("germanCommas", input)).toBe(output);
  expect(findings("germanCommas", output)).toEqual([]);
});

test.each([
  ["germanQuotes", "Auf dem Plakat stand “I love my city” in großen Buchstaben."],
  ["germanNounCasing", "With 15 million people on the list, this is huge."],
  ["germanNounCasing", "Danke fürs schnelle Nachsehen."],
  ["germanPrepositionCase", "Sie brauchen hier zu unsere Kundennummer."],
] as Array<[CatalogRuleId, string]>)("%s leaves %p alone", (ruleId, input) => {
  expect(findings(ruleId, input)).toEqual([]);
});
