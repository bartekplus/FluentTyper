import { describe, expect, test } from "bun:test";
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
  germanListedNoun,
  germanNounOverAdjective,
  germanNounReading,
  germanPastInfinitives,
  germanVerbLike,
  germanVerbObjectCase,
} from "../../src/core/domain/grammar/review/german/germanLexicon";
import { tokensAfter } from "../../src/core/domain/grammar/review/german/shared";
import { GERMAN_WORST_CASES } from "./germanWorstCase.fixture";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";
import { scan, slowestChunkMs } from "./reviewHarness";

// German-only Review checks (src/core/domain/grammar/review/german/).

function findings(ruleId: CatalogRuleId, text: string, lang = "de_DE", userDictionary = []) {
  return scan(text, { enabledRules: [ruleId], lang, userDictionary }).filter(
    (d) => d.ruleId === ruleId,
  );
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
        [
          "Das Fest war etwas besonderes und alle kamen.",
          "Das Fest war etwas Besonderes und alle kamen.",
        ],
        ["Wir träumen von etwas großem.", "Wir träumen von etwas Großem."],
        ["Wir zahlen im voraus.", "Wir zahlen im Voraus."],
        ["Im übrigen bin ich einverstanden.", "Im Übrigen bin ich einverstanden."],
        ["Wir halten nach einem Taxi ausschau.", "Wir halten nach einem Taxi Ausschau."],
        ["Ein knistern war zu hören.", "Ein Knistern war zu hören."],
        ["Um Himmels Willen, pass auf!", "Um Himmels willen, pass auf!"],
        ["Sie malte Zeit ihres Lebens Landschaften.", "Sie malte zeit ihres Lebens Landschaften."],
        ["Das Dorf liegt mitten im nirgendwo.", "Das Dorf liegt mitten im Nirgendwo."],
        ["Daran bist du selbst Schuld.", "Daran bist du selbst schuld."],
        ["Sie war die erste, die ankam.", "Sie war die Erste, die ankam."],
        ["Im Rennen wurde er zweiter.", "Im Rennen wurde er Zweiter."],
        ["Ich mag das putzen der Fenster nicht.", "Ich mag das Putzen der Fenster nicht."],
        [
          "Durch das sortieren von Belegen spart man Zeit.",
          "Durch das Sortieren von Belegen spart man Zeit.",
        ],
        ["Er zitterte vor ärger.", "Er zitterte vor Ärger."],
        ["Mit großem bedauern sagen wir ab.", "Mit großem Bedauern sagen wir ab."],
        ["Wir nehmen davon abstand.", "Wir nehmen davon Abstand."],
        ["Sie leistete keinen widerstand.", "Sie leistete keinen Widerstand."],
        ["Gib uns bitte rechtzeitig bescheid.", "Gib uns bitte rechtzeitig Bescheid."],
        ["Die Vorräte gehen zur neige.", "Die Vorräte gehen zur Neige."],
        ["Tust du mir einen gefallen?", "Tust du mir einen Gefallen?"],
        ["Meine Tochter lernt gerade spanisch.", "Meine Tochter lernt gerade Spanisch."],
        ["Kannst du polnisch lesen?", "Kannst du Polnisch lesen?"],
        ["Der Hof verkauft Eier und fette.", "Der Hof verkauft Eier und Fette."],
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
        "Ich kann das öffnen von hier aus.",
        "Sie spricht ihn gerade englisch an.",
        "Wir sprechen gerade deutsch miteinander.",
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
        "Er war im ganzen Land bekannt.",
        "Das war die schönste Zeit meines Lebens.",
        "Rechts steht die erste.",
        "Er erhielt die erste, das ganze Fach umfassende Professur.",
        "Um es noch ärger zu machen, regnete es.",
        "Wir bedauern das sehr.",
        "Er verbrachte viel Zeit seines Lebens im Ausland.",
        "Er tat es um den Willen der Eltern.",
        "Ich folge dir und nehme den Zug.",
        "Wir haben uns lange deutsch unterhalten.",
        "Der Vertrag ist englisch abgefasst.",
        "Es gab Brot und frisch gepressten Saft.",
        "Ihr wurde die Vorfahrt genommen.",
        "Das hat uns allen sehr gefallen.",
        "Wir nutzen die Pause und ziehen weiter.",
        "Im folgenden Abschnitt steht mehr.",
        "Ich kenne keinen, der es einem leihen würde.",
        "Die Kommandeure beamten die Crew an Bord.",
      ],
    },
  ],
  [
    "germanPrepositionCase",
    {
      pos: [
        ["Er kam mit große Freude.", "Er kam mit großer Freude."],
        ["Ein Saal mit bequeme Sitzreihen.", "Ein Saal mit bequemen Sitzreihen."],
        ["Ein Haus mit energiesparende Heizung.", "Ein Haus mit energiesparender Heizung."],
        [
          "Von dieses Gipfelkreuzen aus sieht man weit.",
          "Von diesen Gipfelkreuzen aus sieht man weit.",
        ],
        ["Ich rufe wegen unseren Termins an.", "Ich rufe wegen unseres Termins an."],
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
        ["Er fährt mir großer Geschwindigkeit.", "Er fährt mit großer Geschwindigkeit."],
        ["Die Räume stehen allen zu Verfügung.", "Die Räume stehen allen zur Verfügung."],
        ["Hast du ihr den Schlüssel gegen?", "Hast du ihr den Schlüssel gegeben?"],
        ["Wir sehen uns Anfang Merz.", "Wir sehen uns Anfang März."],
        ["Sie war stehts freundlich.", "Sie war stets freundlich."],
        ["Das Kind starte uns mit großen Augen an.", "Das Kind starrte uns mit großen Augen an."],
        ["Das Büro ist biss Montag geschlossen.", "Das Büro ist bis Montag geschlossen."],
        ["Das Verfahren hat sich bestens bewehrt.", "Das Verfahren hat sich bestens bewährt."],
        [
          "In Ihrem letzten Schrieben fehlte die Anlage.",
          "In Ihrem letzten Schreiben fehlte die Anlage.",
        ],
        ["Wir spielen eine Partei Skat.", "Wir spielen eine Partie Skat."],
        ["Nachdem Konzert gingen wir essen.", "Nach dem Konzert gingen wir essen."],
        ["Der Patient liegt im Komma.", "Der Patient liegt im Koma."],
        ["Ich habe nur eine wage Vorstellung davon.", "Ich habe nur eine vage Vorstellung davon."],
        ["Mir gefällt die Art und Wiese nicht.", "Mir gefällt die Art und Weise nicht."],
        ["Das Ufer kam in Sichtweise.", "Das Ufer kam in Sichtweite."],
        ["Das Fenster ist gestern repariert wurden.", "Das Fenster ist gestern repariert worden."],
        ["Wir grüßen mir herzlichem Dank.", "Wir grüßen mit herzlichem Dank."],
        ["Sie kam mir einigen Freundinnen.", "Sie kam mit einigen Freundinnen."],
        ["Ich spiele gern mir ihr.", "Ich spiele gern mit ihr."],
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
        "Wir starten den Motor an.",
        "Er startete das alte Auto wieder an.",
        "Das Feuer hat die Planke am Schiff versengt, sagte er.",
        "Einen Teil der mir bekannten Wege kenne ich.",
        "Wir wechselten von Schule zu Schule.",
        "Was hast du gegen ihn?",
        "Friedrich Merz hielt eine Rede.",
        "Wir starten morgen an der Küste.",
        "Der Hund biss ihn ins Bein.",
        "Der Beton wird mit Stahl bewehrt.",
        "Die schrieben uns gestern.",
        "Die Partei hat die Wahl verloren.",
        "Nachdem Geld fehlte, gingen wir heim.",
        "Hier fehlt ein Komma.",
        "Ich wage es nicht.",
        "Das ist meine Sichtweise.",
        "Es ist mehr gebaut worden, als geplant wurde.",
        "Das ist ein Haus das gebaut wurde.",
        "Na, wie stehts?",
        "Ich gab mir unbekannten Leuten Auskunft.",
        "Er sprach mit mir vertrauter Stimme.",
        "Sie hat mir einigen Kummer bereitet.",
        "Das hat mir großen Spaß gemacht.",
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
        ["Der Händler kauft alt Gold an.", "Der Händler kauft Altgold an."],
        ["Zum Frühstück gibt es frisch Käse.", "Zum Frühstück gibt es Frischkäse."],
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
        "Ich habe ein wenig Geld gespart.",
        "Die Lieferung erfolgt frei Haus.",
        "Er kommt aus gutem Haus.",
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
        ["Weil du zu spät gekommen ist, warten wir.", "Weil du zu spät gekommen bist, warten wir."],
        [
          "Ob wir das Spiel gewonnen hat, weiß keiner.",
          "Ob wir das Spiel gewonnen haben, weiß keiner.",
        ],
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
        "Weil wir glauben Peter hat recht.",
        "Weil ich glaube es ist so.",
        "Als wir ankamen, war es dunkel.",
        "Weil wir das Haus gekauft haben, sind wir froh.",
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
        ["Das Wille zählt am Ende.", "Der Wille zählt am Ende."],
        ["Das Name stand auf der Liste.", "Der Name stand auf der Liste."],
        ["Ich schenke den Freund ein Porträt.", "Ich schenke dem Freund ein Porträt."],
        ["Sie bringt ihren Vater einen Kaffee.", "Sie bringt ihrem Vater einen Kaffee."],
        ["Am Abend machten wir uns auf dem Heimweg.", "Am Abend machten wir uns auf den Heimweg."],
        ["Ich hatte schon solche Problem.", "Ich hatte schon solches Problem."],
        ["Danach wurden weitere Gebiet gekauft.", "Danach wurden weiteres Gebiet gekauft."],
        ["Es geht um kein Vertrag.", "Es geht um keinen Vertrag."],
        ["Das Geschenk ist für ein Lehrer.", "Das Geschenk ist für einen Lehrer."],
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
        "Wir treffen uns um ein Uhr am Bahnhof.",
        "Ich habe mich auf dem Weg verlaufen.",
        "Wir machten uns auf dem Heimweg Gedanken.",
        "Wir zeigen den Film ein zweites Mal.",
        "Wir zeigen den Gästen ein Video.",
        "Er nennt den Mann einen Lügner.",
        "Schlagende Wetter sind im Bergbau gefürchtet.",
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
    ["Sonntags ist Zeit zum Wäsche falten.", "Sonntags ist Zeit zum Wäschefalten."],
    ["Er übt abends zum Geige spielen.", "Er übt abends zum Geigespielen."],
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
    ["Wir warteten, bis der Bus ab fuhr.", "Wir warteten, bis der Bus abfuhr."],
    [
      "Die Gläser, die im Regal bereit standen, waren sauber.",
      "Die Gläser, die im Regal bereitstanden, waren sauber.",
    ],
    ["Sie hat den Antrag schon unter schrieben.", "Sie hat den Antrag schon unterschrieben."],
    ["Ich weiß nicht, wann er an rief.", "Ich weiß nicht, wann er anrief."],
    // A compound noun written as two words, the first no noun of its own there.
    ["Im Kurs sitzen acht Kinder Gruppen.", "Im Kurs sitzen acht Kindergruppen."],
    ["Er hat einen Pflege Fall in der Familie.", "Er hat einen Pflegefall in der Familie."],
    ["Sie hat drei Kinder Zimmer eingerichtet.", "Sie hat drei Kinderzimmer eingerichtet."],
    ["Wir lesen die Zeitungs Artikel gern.", "Wir lesen die Zeitungsartikel gern."],
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
    "Versuch einmal, das Gedicht zu lasen.",
    "Den Karren vor sich her schiebend, ging er heim.",
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
    "Wir zeigen den Kunden Produkte aus der Region.",
    "Sie schenkte einem Freund Bücher.",
    "Er gab dem Kind Wasser.",
    "Wir kauften drei Kilo Äpfel.",
    "Sie nahm einen Löffel Zucker.",
    "Er bekam einen Tag Urlaub.",
    "Wir haben Game Boys gesammelt.",
    "Die Firma Schmidt Bau GmbH baut hier.",
    "Der Mensch ist ein Lebewesen.",
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
  test.each([
    "Wir sehen uns am 31. April.",
    "Das war der 30.02.2023.",
    "Der 29.2.2023 fiel aus.",
    "Der Termin 32.13.2020 fällt aus.",
    // A full date with a zero day or month.
    "Am 0.5.2020 begann es.",
    "Am 1.0.2020 begann es.",
    "Am 00.05.2020 begann es.",
  ])("warns about the impossible date in %p", (input) => {
    const [warning, ...rest] = findings("germanDates", input);
    expect(rest).toEqual([]);
    expect(warning.warningOnly).toBe(true);
  });
  test.each([
    "Der 29.2.2024 war ein Donnerstag.",
    "Siehe Abschnitt 7.1 und 7.3 im Vertrag.",
    "Python 3.12.1 ist erschienen.",
    // After a version word, a dotted number is a version, also when it has the shape of a date.
    "Version 32.13.2020 wurde veröffentlicht.",
    "Fassung 31.11.2025 liegt bei.",
    // No part can be a day or a month: the dotted number is not a date.
    "Der Code 45.67.2020 gilt.",
    "Pi ist ungefähr 3.14.",
    // With no year, "0.5." and "1.0." are decimals or versions.
    "Der Wert ist 0.5. Danach steigt er.",
    "Wir nutzen 1.0. Danach kommt 2.0.",
    "Installiere Version 1.0.2020 jetzt.",
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

test("the committed lexicon matches de_DE.dic/.aff (bun run generate:lexicons german)", async () => {
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

test("nouns the dictionary lacks read from the n-gram supplement", () => {
  // Compounds the counts show, read by their head; the dictionary itself lists none of them.
  expect(germanNounReading("abfahrtszeiten")).toBe("noun");
  expect(germanNounReading("pflegefall")).toBe("noun");
  expect(germanListedNoun("pflegefall")).toBeNull();
  expect(germanNounReading("wochenende")).toBe("noun");
  // Genders the determiners show for nouns the dictionary lacks.
  expect(germanGender("unterstützung")?.gender).toBe("f");
  expect(germanGender("kühlschrank")?.gender).toBe("m");
  expect(findings("germanNounCasing", "Wir prüfen die abfahrtszeiten.")).toHaveLength(1);
  // Authored genders for everyday nouns the counts are too thin for.
  expect(germanGender("seite")?.gender).toBe("f");
  expect(germanGender("schirm")?.gender).toBe("m");
  expect(germanGender("prozent")?.gender).toBe("n");
  // "Kuchen" is no diminutive: masculine, and its own plural.
  expect(germanGender("kuchen")).toEqual({ gender: "m", plural: true });
  // A compass point heads no compound by its last letters ("Lohnkosten").
  expect(germanGender("lohnkosten")).toBeNull();
  expect(findings("germanArticleGender", "Ich habe mein Schirm vergessen.")).toHaveLength(1);
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

test("the committed noun genders match de_DE.dic/.aff and the n-gram counts", async () => {
  const [dic, aff, committed] = await Promise.all(
    [GERMAN_LEXICON_SOURCES.dic, GERMAN_LEXICON_SOURCES.aff, GERMAN_LEXICON_SOURCES.gender].map(
      (path) => readFile(path, "utf8"),
    ),
  );
  expect(buildGermanGender(dic, aff, readGermanDeterminerBigrams())).toBe(committed);
});

test("the committed noun and verb usage tables match de_DE.dic/.aff and the n-gram counts", async () => {
  const [dic, aff, committed] = await Promise.all(
    [GERMAN_LEXICON_SOURCES.dic, GERMAN_LEXICON_SOURCES.aff, GERMAN_LEXICON_SOURCES.usage].map(
      (path) => readFile(path, "utf8"),
    ),
  );
  expect(buildGermanUsage(dic, aff, readGermanNgrams())).toBe(committed);
}, 30_000);

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
  ["Vorsicht", "f", false],
  ["Herkunft", "f", false],
  ["Geduld", "f", false],
])("%s has gender %p (plural form: %p)", (word, gender, plural) => {
  expect(germanGender(word)).toEqual({ gender: gender as never, plural });
});

test.each([
  ["fuhr", "fahren"],
  ["standen", "stehen"],
  ["schrieb", "schreiben"],
  ["griffen", "greifen"],
  ["litt", "leiden"],
  ["kam", "kommen"],
])("%s is a past form of %s", (form, infinitive) => {
  expect(germanPastInfinitives(form)).toContain(infinitive);
});

test.each(["Kinder", "See", "Teil", "Anmut", "Zierrat", "Legende", "Kirchen", "Menschen", "Xyzzy"])(
  "%s has no single gender",
  (word) => {
    expect(germanGender(word)).toBeNull();
  },
);

// Authored: a "-rat" or "-mut" head no longer decides these.
test.each([
  ["Heirat", "f"],
  ["Armut", "f"],
  ["Professor", "m"],
  ["Fass", "n"],
  ["Wochenende", "n"],
])("%s is %s", (word, gender) => {
  expect(germanGender(word)?.gender).toBe(gender);
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

test('German Review leaves coordinated verbs, "im selben" and formula variables alone', () => {
  expect(findings("germanCommas", "Wir hoffen und wir bangen, aber es hilft nichts.")).toEqual([]);
  // "selben" is no noun even where the word after it is misspelled.
  expect(findings("germanNounCasing", "Wir sitzen alle im selben bot.")).toEqual([]);
  expect(findings("capitalizeSentenceStart", "b = 3 · y + 1")).toEqual([]);
});

test("no German chunk stalls on repeated determiners and lowercase nouns", () => {
  slowestChunkMs(GERMAN_WORST_CASES.join("\n"), "de_DE");
  for (const text of GERMAN_WORST_CASES) expect(slowestChunkMs(text, "de_DE")).toBeLessThan(100);
});

// The case after a preposition needs the noun's gender. When the gender is unknown ("Laptop"
// and "Joghurt" have two), every possible article is offered and none is preselected.
test.each([
  ["Ich arbeite mit die Laptop.", ["dem Laptop", "der Laptop"]],
  ["Wir essen mit die Joghurt.", ["dem Joghurt", "der Joghurt"]],
  ["Wir fahren mit die Tunnel.", ["dem Tunnel", "der Tunnel", "den Tunneln"]],
  ["Ich kam mit eine Laptop.", ["einem Laptop", "einer Laptop"]],
  ["Wegen die Laptop bleiben wir.", ["des Laptops", "der Laptop"]],
])("germanPrepositionCase offers every gender for %p", (input, previews) => {
  const [finding, ...rest] = findings("germanPrepositionCase", input);
  expect(rest).toEqual([]);
  expect(finding.alternatives.map((a) => a.preview)).toEqual(previews);
  expect(finding.requiresChoice).toBe(true);
  expect(finding.bulk.eligible).toBe(false);
});

// A known gender or a plural form decides; a masculine noun never gets the feminine "der".
test.each([
  ["Ich spreche mit die Professor.", ["dem Professor"]],
  ["Ich spreche mit die Lehrer.", ["dem Lehrer", "den Lehrern"]],
  ["Ich spiele mit die Kinder.", ["den Kindern"]],
  ["Wir kamen mit die Mütter.", ["den Müttern"]],
  ["Wir kamen mit eine Freundin.", ["einer Freundin"]],
  ["Wegen die Kinder bleiben wir.", ["der Kinder"]],
  ["Wegen eine Lehrer bleiben wir.", ["eines Lehrers"]],
])("germanPrepositionCase reads the gender for %p", (input, previews) => {
  const [finding, ...rest] = findings("germanPrepositionCase", input);
  expect(rest).toEqual([]);
  expect(finding.alternatives.map((a) => a.preview)).toEqual(previews);
  expect(finding.requiresChoice ?? false).toBe(previews.length > 1);
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

describe("German wave 9 frames", () => {
  test.each([
    ["germanConfusedWords", "Den das ergibt keinen Sinn.", "Denn das ergibt keinen Sinn."],
    ["germanConfusedWords", "Den die wissen schon Bescheid.", "Denn die wissen schon Bescheid."],
    ["germanConfusedWords", "Wir sind gut vorsorgt.", "Wir sind gut versorgt."],
    [
      "germanConfusedWords",
      "Die Anlage vorsorgt die Stadt mit Strom.",
      "Die Anlage versorgt die Stadt mit Strom.",
    ],
    ["germanConfusedWords", "Wir brauchen dienen Rat.", "Wir brauchen deinen Rat."],
    ["germanConfusedWords", "Diene Mutter hat angerufen.", "Deine Mutter hat angerufen."],
    [
      "germanConfusedWords",
      "Sag mir Bescheid, wen das Essen fertig ist.",
      "Sag mir Bescheid, wenn das Essen fertig ist.",
    ],
    [
      "germanArticleGender",
      "Mir gehört das Haus, der dort steht.",
      "Mir gehört das Haus, das dort steht.",
    ],
    [
      "germanArticleGender",
      "Ich habe einen Hund, die viel bellt.",
      "Ich habe einen Hund, der viel bellt.",
    ],
    [
      "germanArticleGender",
      "Die Lampe, das dort hängt, ist neu.",
      "Die Lampe, die dort hängt, ist neu.",
    ],
    ["germanAbbreviations", "Dr. Frau Weber kommt gleich.", "Frau Dr. Weber kommt gleich."],
    [
      "germanAbbreviations",
      "Heute spricht Professor Herr Lang.",
      "Heute spricht Herr Professor Lang.",
    ],
    ["germanColloquial", "Das macht für uns wenig Sinn.", "Das ergibt für uns wenig Sinn."],
    ["germanColloquial", "Es braucht keinen Sinn zu machen.", "Es braucht keinen Sinn zu ergeben."],
    ["germanColloquial", "Haben Sie die Infos gelesen?", "Haben Sie die Informationen gelesen?"],
    [
      "germanNounCasing",
      "Sie scheuten weder Kosten noch mühen.",
      "Sie scheuten weder Kosten noch Mühen.",
    ],
    [
      "germanNounCasing",
      "Das kann ich nicht mit meinem gewissen vereinbaren.",
      "Das kann ich nicht mit meinem Gewissen vereinbaren.",
    ],
    [
      "germanNounCasing",
      "Sie hatte ein schlechtes gewissen.",
      "Sie hatte ein schlechtes Gewissen.",
    ],
    ["germanNounCasing", "Am Ende hatte er das nachsehen.", "Am Ende hatte er das Nachsehen."],
  ] as Array<[CatalogRuleId, string, string]>)("%s repairs %p", (ruleId, input, output) => {
    expect(findings(ruleId, input)).toHaveLength(1);
    expect(fixed(ruleId, input)).toBe(output);
  });
  test.each([
    ["germanConfusedWords", "Den das Kind sah, kannte ich."],
    ["germanConfusedWords", "Den die Polizei sucht, ist weg."],
    ["germanConfusedWords", "Wenn man rechtzeitig vorsorgt, hat man Ruhe."],
    ["germanConfusedWords", "Wir dienen Gott."],
    ["germanConfusedWords", "Sie dienen Staat und Volk."],
    ["germanConfusedWords", "Die Spenden dienen Schulen."],
    ["germanConfusedWords", "Ich weiß, wen das betrifft."],
    ["germanArticleGender", "Die Frau, der ich half, war dankbar."],
    ["germanArticleGender", "Wir kennen den Weg, das wissen alle."],
    ["germanArticleGender", "Er las ein Buch über die Stadt, das ihm gefiel."],
    ["germanArticleGender", "Das Haus, die alte Scheune und der Garten gehören uns."],
    ["germanArticleGender", "Er erhielt den Auftrag, das heißt, er fing sofort an."],
    ["germanAbbreviations", "Frau Dr. Weber kommt gleich."],
    ["germanColloquial", "Was macht den Sinn des Lebens aus?"],
    ["germanColloquial", "Sie studiert an der Uni Hamburg."],
    ["germanColloquial", "Wir hören gern NDR Info."],
    ["germanNounCasing", "Kannst du das nachsehen?"],
    ["germanNounCasing", "Er hat einen gewissen Charme."],
    ["germanNounCasing", "Die Kosten und Mühen lohnen sich."],
  ] as Array<[CatalogRuleId, string]>)("%s leaves %p alone", (ruleId, input) => {
    expect(findings(ruleId, input)).toEqual([]);
  });
});

describe("German wave 10 frames", () => {
  test.each([
    ["germanQuotes", "Sie rief: „ Komm sofort her!“", "Sie rief: „Komm sofort her!“"],
    ["germanQuotes", "Er nannte es „gut gemacht “.", "Er nannte es „gut gemacht“."],
    ["germanQuotes", "Das Buch ( ein Roman) liegt hier.", "Das Buch (ein Roman) liegt hier."],
    [
      "germanQuotes",
      "Wir fahren morgen (wenn es nicht regnet ).",
      "Wir fahren morgen (wenn es nicht regnet).",
    ],
    ["germanQuotes", "»Ich bleibe hier «, sagte sie.", "»Ich bleibe hier«, sagte sie."],
    ["measurementUnitFormatting", "Der Download hat 250MB.", "Der Download hat 250 MB."],
    ["measurementUnitFormatting", "Die Leitung bringt 2.500kW.", "Die Leitung bringt 2.500 kW."],
    ["measurementUnitFormatting", "Das Dach hat 30 ° Neigung.", "Das Dach hat 30° Neigung."],
    ["currencySpacing", "Das Haus kostet 350.000€.", "Das Haus kostet 350.000 €."],
    ["currencySpacing", "Wir zahlen 1.200$ im Monat.", "Wir zahlen 1.200 $ im Monat."],
    ["germanArticleGender", "Herzliche Dank für die Antwort.", "Herzlicher Dank für die Antwort."],
    ["germanArticleGender", "Wir sprachen über ein Skandal.", "Wir sprachen über einen Skandal."],
    [
      "germanColloquial",
      "Die Wattzahl der Lampe ist gering.",
      "Die Leistung der Lampe ist gering.",
    ],
    ["germanColloquial", "Der Koffer wiegt 23 Kilo.", "Der Koffer wiegt 23 Kilogramm."],
    [
      "germanColloquial",
      "Der Zug fuhr schneller als 200 Kilometer.",
      "Der Zug fuhr schneller als 200 Kilometer pro Stunde.",
    ],
    ["germanColloquial", "Jetzt musst du minus rechnen.", "Jetzt musst du subtrahieren."],
    ["germanColloquial", "Plus-Rechnen fällt ihm leicht.", "Addition fällt ihm leicht."],
    ["germanQuestionMarks", "Wie oft regnete es.", "Wie oft regnete es?"],
    ["germanQuestionMarks", "Wo aber finden wir das.", "Wo aber finden wir das?"],
    ["germanQuestionMarks", "Wann kommst du endlich!", "Wann kommst du endlich?"],
    [
      "germanQuestionMarks",
      "Kann die Arbeit bis morgen erledigt werden.",
      "Kann die Arbeit bis morgen erledigt werden?",
    ],
    ["germanQuestionMarks", "Sie kommt morgen, richtig.", "Sie kommt morgen, richtig?"],
    ["germanTypography", "Die Fläche ist 3 x 4 Meter groß.", "Die Fläche ist 3 × 4 Meter groß."],
    ["germanTypography", "Es gilt 7*8 = 56.", "Es gilt 7×8 = 56."],
    ["germanTypography", "Die Formel lautet a * b + c.", "Die Formel lautet a × b + c."],
    [
      "germanRecommendedSpelling",
      "Sie warf mir einen viel sagenden Blick zu.",
      "Sie warf mir einen vielsagenden Blick zu.",
    ],
    ["germanRecommendedSpelling", "Das Kind ist hoch begabt.", "Das Kind ist hochbegabt."],
    [
      "germanPrepositionCase",
      "Er wohnt seit seine Kindheit hier.",
      "Er wohnt seit seiner Kindheit hier.",
    ],
    ["germanPrepositionCase", "Seit seine Jugend malt er.", "Seit seiner Jugend malt er."],
    [
      "germanPrepositionCase",
      "Wir prüfen das anhand ihren Unterlagen.",
      "Wir prüfen das anhand ihrer Unterlagen.",
    ],
    [
      "germanPrepositionCase",
      "Anlässlich dem Jubiläum feiern wir.",
      "Anlässlich des Jubiläums feiern wir.",
    ],
    ["germanVerbAgreement", "Ich weiß, warum du gehen muss.", "Ich weiß, warum du gehen musst."],
    ["germanVerbAgreement", "Sag mir, wann du kommen kann.", "Sag mir, wann du kommen kannst."],
    [
      "germanConfusedWords",
      "Die Regel gilt insoweit, als dass alle zustimmen.",
      "Die Regel gilt insoweit, als alle zustimmen.",
    ],
    [
      "germanConfusedWords",
      "Wir haben ihm die Wahl überlasen.",
      "Wir haben ihm die Wahl überlassen.",
    ],
    ["germanTypography", "Beim Atmen entsteht CO2.", "Beim Atmen entsteht CO₂."],
    ["germanTypography", "Die Pflanze gibt O² ab.", "Die Pflanze gibt O₂ ab."],
    ["germanRecommendedSpelling", "Meine Todo Liste ist lang.", "Meine To-do-Liste ist lang."],
    ["germanRecommendedSpelling", "Die ToDos sind erledigt.", "Die To-dos sind erledigt."],
    [
      "germanCompounds",
      "Er will das Geheimnis nicht preis geben.",
      "Er will das Geheimnis nicht preisgeben.",
    ],
    [
      "germanConfusedWords",
      "Wir sind zwischen 9 bis 12 Uhr im Büro.",
      "Wir sind zwischen 9 und 12 Uhr im Büro.",
    ],
    [
      "germanConfusedWords",
      "Der Laden ist seit Montag bis Mittwoch zu.",
      "Der Laden ist zwischen Montag und Mittwoch zu.",
    ],
    ["germanConfusedWords", "Da durch hat er viel gelernt.", "Dadurch hat er viel gelernt."],
    ["germanConfusedWords", "Ich habe bereist alles erledigt.", "Ich habe bereits alles erledigt."],
    ["germanConfusedWords", "Sie wollte das Glas fallen lies.", "Sie wollte das Glas fallen ließ."],
    ["germanConfusedWords", "Er soll belohnt erden.", "Er soll belohnt werden."],
    ["germanConfusedWords", "Wann ist die genaue Urzeit?", "Wann ist die genaue Uhrzeit?"],
    ["germanConfusedWords", "Das ist vor Uhrzeiten passiert.", "Das ist vor Urzeiten passiert."],
    [
      "germanConfusedWords",
      "Mit einem paar Schuhen kommst du weit.",
      "Mit einem Paar Schuhen kommst du weit.",
    ],
    ["germanConfusedWords", "Das sind nur lehre Versprechen.", "Das sind nur leere Versprechen."],
    [
      "germanCompounds",
      "Ich habe ihm zu gute gehalten, dass er krank war.",
      "Ich habe ihm zugutegehalten, dass er krank war.",
    ],
    ["germanConfusedWords", "Wenn du da für zahlst, gern.", "Wenn du dafür zahlst, gern."],
    ["germanConfusedWords", "Er wahr sehr müde.", "Er war sehr müde."],
    ["germanConfusedWords", "Wahr er gestern hier?", "War er gestern hier?"],
    ["germanConfusedWords", "Sie ging zu Hause.", "Sie ging nach Hause."],
    ["germanConfusedWords", "Wir fahren auf Hause.", "Wir fahren nach Hause."],
    ["germanConfusedWords", "Ich komme im 8 Uhr.", "Ich komme um 8 Uhr."],
    [
      "germanConfusedWords",
      "Ich habe all Fenster geschlossen.",
      "Ich habe alle Fenster geschlossen.",
    ],
    ["germanConfusedWords", "Wir gehen zur unserer Oma.", "Wir gehen zu unserer Oma."],
    ["germanConfusedWords", "Ich verbiete mir diesen Ton!", "Ich verbitte mir diesen Ton!"],
    [
      "germanNounCasing",
      "Nach dem ewigen hin und her waren alle müde.",
      "Nach dem ewigen Hin und Her waren alle müde.",
    ],
    ["germanNounCasing", "Sie bekam eine drei in Physik.", "Sie bekam eine Drei in Physik."],
    ["germanCompounds", "Ich bin ihr über den weggelaufen.", "Ich bin ihr über den Weg gelaufen."],
    ["germanConfusedWords", "Ich freue ich auf das Fest.", "Ich freue mich auf das Fest."],
    ["germanConfusedWords", "Wir freuen und auf den Urlaub.", "Wir freuen uns auf den Urlaub."],
    [
      "germanConfusedWords",
      "Wir bedenken uns herzlich für die Hilfe.",
      "Wir bedanken uns herzlich für die Hilfe.",
    ],
    ["germanConfusedWords", "Der Film ist seht spannend.", "Der Film ist sehr spannend."],
    ["germanConfusedWords", "Da wäre ich fasst gestorben.", "Da wäre ich fast gestorben."],
    ["germanConfusedWords", "Das ist leide nicht möglich.", "Das ist leider nicht möglich."],
    ["germanConfusedWords", "Es wäre schon, wenn du kommst.", "Es wäre schön, wenn du kommst."],
    ["germanConfusedWords", "Liebe Grüße mach Berlin.", "Liebe Grüße nach Berlin."],
    ["germanConfusedWords", "Ich hohle dir einen Kaffee.", "Ich hole dir einen Kaffee."],
    ["germanConfusedWords", "Wird sind gleich fertig.", "Wir sind gleich fertig."],
    ["germanConfusedWords", "Wir haben einen neun Plan.", "Wir haben einen neuen Plan."],
    ["germanConfusedWords", "Aus meiner Sich ist das gut.", "Aus meiner Sicht ist das gut."],
    ["germanConfusedWords", "Hallo Her Meier, wie geht es?", "Hallo Herr Meier, wie geht es?"],
    ["germanConfusedWords", "Seit Mär ist es kalt.", "Seit März ist es kalt."],
    [
      "germanConfusedWords",
      "Das macht mir eine große Freunde.",
      "Das macht mir eine große Freude.",
    ],
    ["germanConfusedWords", "Die Unterscheide sind klein.", "Die Unterschiede sind klein."],
    ["germanConfusedWords", "Ich melde mich bist morgen.", "Ich melde mich bis morgen."],
    ["germanConfusedWords", "Der Tisch weißt Kratzer auf.", "Der Tisch weist Kratzer auf."],
    ["germanConfusedWords", "Ich tue das der Umwelt zur Liebe.", "Ich tue das der Umwelt zuliebe."],
    [
      "germanConfusedWords",
      "Wir testen eine 14tätige Version.",
      "Wir testen eine 14-tägige Version.",
    ],
    ["germanConfusedWords", "Wir wandern im Hartz.", "Wir wandern im Harz."],
    ["germanConfusedWords", "Wir halten ihn in Schacht.", "Wir halten ihn in Schach."],
    [
      "germanConfusedWords",
      "Die Kinder halten mich auf Trapp.",
      "Die Kinder halten mich auf Trab.",
    ],
    ["germanConfusedWords", "Viele Dank für das Geschenk.", "Vielen Dank für das Geschenk."],
    ["germanConfusedWords", "Viele Erfolg morgen!", "Viel Erfolg morgen!"],
    ["germanConfusedWords", "Das kostet 50 Doller.", "Das kostet 50 Dollar."],
    ["germanConfusedWords", "Das ist ein guter Geheimtip.", "Das ist ein guter Geheimtipp."],
    ["germanConfusedWords", "Er hat das Gesetzt gebrochen.", "Er hat das Gesetz gebrochen."],
    ["germanConfusedWords", "Sie hat die Aufgabe versanden.", "Sie hat die Aufgabe verstanden."],
    ["germanConfusedWords", "Er schient müde zu sein.", "Er scheint müde zu sein."],
    ["germanConfusedWords", "Sie hat sofort regiert.", "Sie hat sofort reagiert."],
    ["germanConfusedWords", "Er ist beleibt bei allen.", "Er ist beliebt bei allen."],
    ["germanConfusedWords", "Der Brand hat Alarm ausgelost.", "Der Brand hat Alarm ausgelöst."],
    ["germanConfusedWords", "Sie trinkt gerne Wien.", "Sie trinkt gerne Wein."],
    ["germanConfusedWords", "Versuch mal, das zu schrieben.", "Versuch mal, das zu schreiben."],
    ["germanConfusedWords", "Das hätten wir prüfe müssen.", "Das hätten wir prüfen müssen."],
    [
      "germanConfusedWords",
      "Er hat niemanden Bescheid gegeben.",
      "Er hat niemandem Bescheid gegeben.",
    ],
    ["germanConfusedWords", "Sagt und Bescheid!", "Sagt uns Bescheid!"],
    ["germanConfusedWords", "Dann gab des ein Fest.", "Dann gab es ein Fest."],
    [
      "germanConfusedWords",
      "Das habe ich gerade erste gelesen.",
      "Das habe ich gerade erst gelesen.",
    ],
    ["germanConfusedWords", "Er aß einen fischen Fisch.", "Er aß einen frischen Fisch."],
    ["germanConfusedWords", "Mit Entsetzten sah sie zu.", "Mit Entsetzen sah sie zu."],
    ["germanConfusedWords", "Weist du, wo er ist?", "Weißt du, wo er ist?"],
    ["germanConfusedWords", "Mein YouTube-Chanel ist neu.", "Mein YouTube-Channel ist neu."],
    ["germanConfusedWords", "Hallo, Heer Meier!", "Hallo, Herr Meier!"],
    ["germanCompounds", "Wir versuchten ab zu lenken.", "Wir versuchten abzulenken."],
    ["germanCompounds", "Sie bekam Angst, an zu rufen.", "Sie bekam Angst, anzurufen."],
    ["germanCompounds", "Das ist ihm kaum zu zu trauen.", "Das ist ihm kaum zuzutrauen."],
    ["germanCompounds", "Sie versprach, dort hin zu fahren.", "Sie versprach, dort hinzufahren."],
    [
      "germanCompounds",
      "Wir versuchten, damit zurecht zu kommen.",
      "Wir versuchten, damit zurechtzukommen.",
    ],
  ] as Array<[CatalogRuleId, string, string]>)("%s repairs %p", (ruleId, input, output) => {
    expect(findings(ruleId, input)).toHaveLength(1);
    expect(fixed(ruleId, input)).toBe(output);
  });
  test.each([
    ["germanQuotes", "Schade :( Aber morgen geht es (vielleicht) wieder."],
    ["germanQuotes", "« Bonjour » sagte er zur Begrüßung."],
    ["germanQuotes", "Siehe Punkt a ) weiter unten."],
    ["germanQuotes", "Der Preis ( in Euro steht dort."],
    ["germanQuotes", "Er sagte: „Komm her!“ (und ging)."],
    ["measurementUnitFormatting", "Draußen hat es 20 ° Celsius."],
    ["measurementUnitFormatting", "Das 5MB-Limit gilt weiter."],
    ["measurementUnitFormatting", "Heute sind es 25 °C."],
    ["measurementUnitFormatting", "Die Version 1.200b ist neu."],
    ["currencySpacing", "Die Formel $x = 3$ gilt."],
    ["germanArticleGender", "Halte durch mein Schatz!"],
    ["germanArticleGender", "Komm gut an, mein Liebling!"],
    ["germanColloquial", "Er wohnt zehn Kilometer entfernt."],
    ["germanColloquial", "Er lief schneller als 5 Kilometer pro Stunde."],
    ["germanColloquial", "Das Kilo kostet zwei Euro."],
    ["germanColloquial", "Lass uns mal rechnen."],
    ["germanColloquial", "Sie ist die 10 Kilometer schneller gelaufen."],
    ["germanQuestionMarks", "Wo sind die Schlüssel nur immer hin!"],
    ["germanQuestionMarks", "Wie schön ist das!"],
    ["germanQuestionMarks", "Warum hätte er das tun sollen!"],
    ["germanQuestionMarks", "Komm sofort her!"],
    ["germanTypography", "Der Wert 0x1F ist hexadezimal."],
    ["germanTypography", "Das ist *wichtig* hier."],
    ["germanTypography", "Liebe Kolleg*innen, willkommen."],
    ["germanArticleGender", "Liebe Kolleg*innen, willkommen."],
    ["germanArticleGender", "Die Lehrer:innen sind da."],
    ["germanRecommendedSpelling", "Es ist schwer, das zu sagen."],
    ["germanRecommendedSpelling", "Er hat viel gesagt."],
    ["germanPrepositionCase", "Seit die Mauer fiel, ist vieles anders."],
    ["germanPrepositionCase", "Er ist traurig, seit seine Oma starb."],
    ["germanPrepositionCase", "Seit seine Kinder in Berlin wohnen, ist es still."],
    ["germanPrepositionCase", "Wir prüfen das anhand der Unterlagen."],
    ["germanVerbAgreement", "Warum du gehen musst, weiß ich."],
    ["germanVerbAgreement", "Ich frage, wohin wir fahren wollen."],
    ["germanConfusedWords", "Er ist zu jung, als dass er das versteht."],
    ["germanConfusedWords", "Den Fehler, den wir überlasen, fand später der Chef."],
    ["germanConfusedWords", "Wir überlasen den Fehler."],
    ["germanTypography", "Ich höre gern MP3 und fahre einen Audi S3."],
    ["germanTypography", "Das ist ein B2B-Geschäft mit Vitamin B12."],
    ["germanRecommendedSpelling", "Die To-do-Liste ist fertig."],
    ["germanConfusedWords", "Seit 2010 bis heute hat sich viel getan."],
    ["germanConfusedWords", "Wir gingen da durch die Tür."],
    ["germanConfusedWords", "Du musst da durch klettern."],
    ["germanConfusedWords", "Seit 200 bis 300 Jahren steht das Haus."],
    ["germanConfusedWords", "Wir haben Italien bereist."],
    ["germanConfusedWords", "Er bereist 2018 ganz Asien."],
    ["germanConfusedWords", "Wir erden das Gerät."],
    ["germanConfusedWords", "Ich lehre Mathematik."],
    ["germanConfusedWords", "In dieser Urzeit lebten Saurier."],
    ["germanCompounds", "Er hat zu gute Noten."],
    ["germanConfusedWords", "Ich bin da für dich."],
    ["germanConfusedWords", "Da mit viel Mühe alles klappte, feierten wir."],
    ["germanConfusedWords", "Wahr ist, dass er kam."],
    ["germanConfusedWords", "Er ist zu Hause geblieben."],
    ["germanConfusedWords", "Im 18. Jahrhundert war das anders."],
    ["germanConfusedWords", "Er sitzt im 18 Uhr Zug."],
    ["germanConfusedWords", "Zum einen ist es teuer, zum anderen alt."],
    ["germanConfusedWords", "Am einen Ende steht ein Baum."],
    ["germanConfusedWords", "Ich verbiete mir, daran zu denken."],
    ["germanNounCasing", "Die Bäume schwanken hin und her."],
    ["germanNounCasing", "Es war eine drei Meter lange Schlange."],
    ["germanConfusedWords", "Ich glaube ich gehe jetzt."],
    ["germanConfusedWords", "Ich muss das noch bedenken."],
    ["germanConfusedWords", "Ihr seht gut aus."],
    ["germanConfusedWords", "Er fasst einen Entschluss."],
    ["germanConfusedWords", "Ich leide unter Kopfschmerzen."],
    ["germanConfusedWords", "Das ist schon gut so."],
    ["germanConfusedWords", "Mach Hausaufgaben!"],
    ["germanConfusedWords", "Er hielt die hohle Hand auf."],
    ["germanConfusedWords", "Wird es heute regnen?"],
    ["germanConfusedWords", "Die neun Kinder spielen."],
    ["germanConfusedWords", "Das Atelier mit seinen neun Meter hohen Hallen."],
    ["germanConfusedWords", "Gültig bis 15. Mär. 2020."],
    ["germanConfusedWords", "Er hat große Freunde."],
    ["germanConfusedWords", "Unterscheide genau!"],
    ["germanConfusedWords", "Du bist morgen dran."],
    ["germanConfusedWords", "Weißt du, wo das ist?"],
    ["germanConfusedWords", "Er ist seit 2010 tätig."],
    ["germanConfusedWords", "Er arbeitet in Schacht 3."],
    ["germanConfusedWords", "Viele Erfolge hatte er."],
    ["germanConfusedWords", "Der Tooltip zeigt Hilfe."],
    ["germanConfusedWords", "Gesetzt den Fall, er kommt."],
    ["germanConfusedWords", "Der Hafen wird versanden."],
    ["germanConfusedWords", "Der Arzt schient den Arm."],
    ["germanConfusedWords", "Der König regiert das Land."],
    ["germanConfusedWords", "Die Kuh ist verendet."],
    ["germanConfusedWords", "Wir haben die Gewinner ausgelost."],
    ["germanConfusedWords", "Wir fahren nach Wien."],
    ["germanConfusedWords", "Sie sind nicht zu finden."],
    ["germanConfusedWords", "Er hat niemanden gesehen."],
    ["germanConfusedWords", "Er nahm sich des Problems an."],
    ["germanConfusedWords", "Das sind jetzt erste Ergebnisse."],
    ["germanConfusedWords", "Ich habe jetzt erste reife Beeren gesehen."],
    ["germanConfusedWords", "Und alles dank des einen Gedankens."],
    ["germanConfusedWords", "Finanztip rät davon ab."],
    ["germanConfusedWords", "Die Fischer fischen Lachse."],
    ["germanConfusedWords", "Die Entsetzten flohen."],
    ["germanConfusedWords", "War für ihn das gut?"],
    ["germanConfusedWords", "Weist du ihn ab?"],
    ["germanConfusedWords", "Sie trägt Chanel."],
    ["germanCompounds", "Er fing an zu weinen."],
    ["germanCompounds", "Sie nahm sich vor zu schweigen."],
    ["germanCompounds", "Er versuchte es und fing an zu lachen."],
    ["germanCompounds", "Sie hörte auf zu reden."],
    ["germanCompounds", "Er bot an zu helfen."],
  ] as Array<[CatalogRuleId, string]>)("%s leaves %p alone", (ruleId, input) => {
    expect(findings(ruleId, input)).toEqual([]);
  });
});

describe("German wave 11 frames", () => {
  test.each([
    [
      "germanNounCasing",
      "Wir halten durch Dick und dünn zusammen.",
      "Wir halten durch dick und dünn zusammen.",
    ],
    [
      "germanNounCasing",
      "Über Kurz oder lang ziehen wir um.",
      "Über kurz oder lang ziehen wir um.",
    ],
    ["germanNounCasing", "Gäste kamen von Nah und Fern.", "Gäste kamen von nah und fern."],
    [
      "germanNounCasing",
      "Sie hat sich sorgen um ihn gemacht.",
      "Sie hat sich Sorgen um ihn gemacht.",
    ],
    [
      "germanNounCasing",
      "Im Kurs wurden viele fragen gestellt.",
      "Im Kurs wurden viele Fragen gestellt.",
    ],
    ["germanNounCasing", "Gibt es bedarf an Stühlen?", "Gibt es Bedarf an Stühlen?"],
    ["germanNounCasing", "Auf dem hinweg regnete es.", "Auf dem Hinweg regnete es."],
    [
      "germanNounCasing",
      "Nach seinem aus bei Bayern wechselte er.",
      "Nach seinem Aus bei Bayern wechselte er.",
    ],
    ["germanNounCasing", "Die Farbe grün beruhigt.", "Die Farbe Grün beruhigt."],
    [
      "germanNounCasing",
      "Er verspricht ihr das blaue vom Himmel.",
      "Er verspricht ihr das Blaue vom Himmel.",
    ],
    ["germanNounCasing", "Ihm sollte Angst und Bange sein.", "Ihm sollte angst und bange sein."],
    [
      "germanNounCasing",
      "Sie hat ihm angst und bange gemacht.",
      "Sie hat ihm Angst und Bange gemacht.",
    ],
    [
      "germanNounCasing",
      "Das Dreieck hat einen Rechten Winkel.",
      "Das Dreieck hat einen rechten Winkel.",
    ],
    ["germanNounCasing", "Der Geschmack des Grünen Tees.", "Der Geschmack des grünen Tees."],
    ["germanNounCasing", "Ich bin euch Allen dankbar.", "Ich bin euch allen dankbar."],
    ["germanNounCasing", "Hier ist Alles dabei.", "Hier ist alles dabei."],
    ["germanConfusedWords", "Der Lärm ging uns auf dem Keks.", "Der Lärm ging uns auf den Keks."],
    ["germanConfusedWords", "Sie erstarrte zur Salzkeule.", "Sie erstarrte zur Salzsäule."],
    [
      "germanConfusedWords",
      "Die Stürmer wollen Tore scheißen.",
      "Die Stürmer wollen Tore schießen.",
    ],
    ["germanConfusedWords", "Er redet ohne Punk und Komma.", "Er redet ohne Punkt und Komma."],
    ["germanConfusedWords", "Ich weis nicht, wo er ist.", "Ich weiß nicht, wo er ist."],
    ["germanConfusedWords", "Weiß du, wann der Zug fährt?", "Weißt du, wann der Zug fährt?"],
    ["germanConfusedWords", "Der Ausgang ist hinten link.", "Der Ausgang ist hinten links."],
    [
      "germanConfusedWords",
      "Er kauft sowohl Brot sowie auch Käse.",
      "Er kauft sowohl Brot als auch Käse.",
    ],
    [
      "germanConfusedWords",
      "Die Retter sind seit Stunden in Einsatz.",
      "Die Retter sind seit Stunden im Einsatz.",
    ],
    ["germanConfusedWords", "Wir trafen uns auf halben Weg.", "Wir trafen uns auf halbem Weg."],
    [
      "germanConfusedWords",
      "Ich fliege nach Vereinigte Staaten.",
      "Ich fliege in die Vereinigten Staaten.",
    ],
    ["germanCommas", "Du hast heute frei oder?", "Du hast heute frei, oder?"],
    ["germanCommas", "Wir sehen uns später nicht wahr?", "Wir sehen uns später, nicht wahr?"],
    ["germanCommas", "Der Plan ist glaube ich gut.", "Der Plan ist, glaube ich, gut."],
    [
      "germanCommas",
      "Das Spiel war teils spannend teils lang.",
      "Das Spiel war teils spannend, teils lang.",
    ],
    [
      "germanCommas",
      "Je länger ich warte desto nervöser werde ich.",
      "Je länger ich warte, desto nervöser werde ich.",
    ],
    ["germanCommas", "So weit so gut.", "So weit, so gut."],
    [
      "germanCompounds",
      "Wir haben es acht hundertmal versucht.",
      "Wir haben es achthundertmal versucht.",
    ],
    [
      "germanCompounds",
      "Er versuchte, es hinunter zu ziehen.",
      "Er versuchte, es hinunterzuziehen.",
    ],
    ["germanAdjectiveForms", "Sehen Sie den Beamter dort?", "Sehen Sie den Beamten dort?"],
    [
      "germanAdjectiveForms",
      "Ein Zollbeamte kontrollierte uns.",
      "Ein Zollbeamter kontrollierte uns.",
    ],
    [
      "germanTypography",
      "Das Stadion fasst 250000 Menschen.",
      "Das Stadion fasst 250.000 Menschen.",
    ],
    [
      "englishPhraseCorrections",
      "Wir haben alle Mitgliederinnen informiert.",
      "Wir haben alle Mitglieder informiert.",
    ],
  ] as Array<[CatalogRuleId, string, string]>)("%s repairs %p", (ruleId, input, output) => {
    expect(fixed(ruleId, input)).toBe(output);
    expect(findings(ruleId, output)).toEqual([]);
  });
  test.each([
    ["germanNounCasing", "Sie sorgen sich um die Kinder."],
    ["germanNounCasing", "Die Eltern sorgen für Ruhe und haben Zeit."],
    ["germanNounCasing", "Der Text bedarf einer Kürzung."],
    ["germanNounCasing", "Er sah über den Zaun hinweg."],
    ["germanNounCasing", "Er richtet sich nach dem aus, was sie sagt."],
    ["germanNounCasing", "Die Farbe ist grün."],
    ["germanNounCasing", "Sie ist mein Ein und Alles."],
    ["germanNounCasing", "Es war Allen Moyer."],
    ["germanNounCasing", "Fazit: Alles gut."],
    ["germanConfusedWords", "Der Fokus liegt auf dem Geist der Zeit."],
    ["germanConfusedWords", "Das macht er mir weis."],
    ["germanConfusedWords", "Ich weiß du kommst morgen."],
    ["germanConfusedWords", "Herr Weis kommt morgen."],
    ["germanConfusedWords", "Die Band spielt Punk für Fans."],
    ["germanConfusedWords", "Sie ging auf halben Wegen zurück."],
    ["germanConfusedWords", "Er lebt in den Vereinigten Staaten."],
    ["germanCommas", "Ist das nicht wahr?"],
    ["germanCommas", "Das ist nicht wahr?"],
    ["germanCommas", "Willst du Tee oder Kaffee?"],
    ["germanCommas", "Er ist, glaube ich, krank."],
    ["germanCommas", "Einerseits gut und andererseits schlecht."],
    ["germanCommas", "Sie standen zwischen Büchern einerseits und Heften andererseits."],
    ["germanCommas", "Das ist halb so schlimm."],
    ["germanCompounds", "Er ist ein tausendmal besserer Spieler."],
    ["germanAdjectiveForms", "Wir sprachen mit dem netten Beamten."],
    ["germanAdjectiveForms", "Ein Beamter kam."],
    ["germanTypography", "Sie wohnt in 10115 Berlin."],
    ["germanTypography", "Die Stadt hat 85000 Einwohner."],
    ["germanTypography", "Ihre Kundennummer lautet 4711123."],
  ] as Array<[CatalogRuleId, string]>)("%s leaves %p alone", (ruleId, input) => {
    expect(findings(ruleId, input)).toEqual([]);
  });
});
