import type { PhraseRow } from "./englishPhraseTables";
import { rows } from "./phraseTemplates";
import { TABLES as GREEK_TABLES } from "./greek/tables";
import { TABLES as SWEDISH_TABLES } from "./swedish/tables";
import { TABLES as ARABIC_TABLES } from "./arabic/tables";
import { PORTUGUESE_PHRASES, PORTUGUESE_STYLE, PORTUGUESE_WORDS } from "./portuguese/phrases";
import { POLISH_TABLES } from "./polish";
import * as french from "./french/phrases";

/**
 * The English phrase checks for the other review languages, by language code.
 * Same row format and matching as the English tables; a row is only here when
 * its typed form is never correct in that language, or is narrowed to a frame
 * where it cannot be. Merged words that are always two live in
 * `multilingualLexicon.ts` (`englishAlotCorrection`).
 */
export interface LanguagePhraseTables {
  /** Misspelled words (`englishPhraseCorrections`). */
  words?: readonly PhraseRow[];
  /** A wrong word form inside a fixed frame (`englishPhraseCorrections`). */
  phrases?: readonly PhraseRow[];
  /** Compounds written apart or without their hyphens (`englishClosedCompounds`). */
  compounds?: readonly PhraseRow[];
  /** Optional wording advice: pleonasms (`stylePhrasing`). */
  style?: readonly PhraseRow[];
}

export const LANGUAGE_PHRASE_TABLES: Readonly<Record<string, LanguagePhraseTables>> = {
  de: {
    words: [
      ...rows(`
Standart = Standard
Standarts = Standards
standartmäßig = standardmäßig
wiederspiegeln = widerspiegeln
wiederspiegelt = widerspiegelt
wiederspiegelte = widerspiegelte
nähmlich = nämlich
`),
      [["Rythmus", "Rhytmus"], "Rhythmus"],
      ...rows(`
vorraus = voraus
vorrausgesetzt = vorausgesetzt
Vorraussetzung = Voraussetzung
Vorraussetzungen = Voraussetzungen
vorraussichtlich = voraussichtlich
Addresse = Adresse
Maschiene = Maschine
Maschienen = Maschinen
Wiederstand = Widerstand
Widerholung = Wiederholung
Reperatur = Reparatur
entgültig = endgültig
Ergebniss = Ergebnis
vieleicht = vielleicht
interresant = interessant
Terasse = Terrasse
Rückrad = Rückgrat
Stehgreif = Stegreif
dilletantisch = dilettantisch
Agression = Aggression
Karierre = Karriere
tollerant = tolerant
Wehrmutstropfen = Wermutstropfen
seperat = separat
Rethorik = Rhetorik
Reflektion = Reflexion
Reflektionen = Reflexionen
`),
      // Adjectives that only stand before a noun, used as their adverb: "Bisherig ist nichts
      // passiert" (Bisher).
      ...rows(`
bisherig = bisher; bisherige
vorherig = vorher; vorherige
seitherig = seither; seitherige
jetzig = jetzt; jetzige
obig = oben; obige
damalig = damals; damalige
dortig = dort; dortige
hiesig = hier; hiesige
jeweilig = jeweils; jeweilige
sofortig = sofort; sofortige
sonstig = sonst; sonstige
einstig = einst; einstige
etwaig = etwa; etwaige
Presche = Bresche
Häckchen = Häkchen
Supergau = Super-GAU
Supergaus = Super-GAUs
Kaffe = Kaffee
geragt = gefragt
zugegebenerweise = zugegebenermaßen
zwingendermaßen = gezwungenermaßen; zwingend
versehentlicherweise = versehentlich; aus Versehen
Lebensweißheit = Lebensweisheit
Lebensweißheiten = Lebensweisheiten
Gruessen = Grüßen
`),
      [["Gruesse", "Grueße"], "Grüße"],
      // An abbreviation in capitals: the row sets the casing ("Wlan" → "WLAN").
      ["Wlan", "WLAN"],
      ...rows(`
Vollmilchsau = Wollmilchsau
Mittelohrenzündung = Mittelohrentzündung
Mittelohrenzündungen = Mittelohrentzündungen
Waldnussöl = Walnussöl
Gebrauchtspur = Gebrauchsspur
Gebrauchtspuren = Gebrauchsspuren
Apartheit = Apartheid
Impflicht = Impfpflicht
Halbachtstellung = Habachtstellung
`),
    ],
    phrases: [
      // The genitive of "dieser" and "jeder" before a masculine or neuter noun ends in -es.
      ["diesen Jahres", "dieses Jahres"],
      ["diesen Monats", "dieses Monats"],
      ["diesen Jahrhunderts", "dieses Jahrhunderts"],
      ["jeden Jahres", "jedes Jahres"],
      ["jeden Monats", "jedes Monats"],
      // Idioms with a look-alike word.
      ...rows(`
Strick durch die Rechnung = Strich durch die Rechnung
am eigenen Laib = am eigenen Leib
am ganzen Lieb = am ganzen Leib
Lieb und Seele = Leib und Seele
in der Nahe = in der Nähe
Haare wachen = Haare waschen
erschwerten Bedienungen = erschwerten Bedingungen
Schlaf ins Gesicht = Schlag ins Gesicht
im Feien = im Freien
ins Feie = ins Freie
Feien und Hansestadt = Freien und Hansestadt
in aller Stile = in aller Stille
Schal und Rauch = Schall und Rauch
schalen und walten = schalten und walten
schalten und waten = schalten und walten
zum Abbeißen = zum Anbeißen
entgegen lassen = entgehen lassen
`),
      [["aus dem Eff Eff", "aus dem FF"], "aus dem Effeff"],
      // Genitive or "nach" with the dative: the two are blended.
      ["meines Wissens nach", ["meines Wissens", "meinem Wissen nach"]],
      ["unseres Wissens nach", ["unseres Wissens", "unserem Wissen nach"]],
      // Look-alike words inside fixed phrases.
      ...rows(`
Gesetz den Fall = Gesetzt den Fall
letztes Endes = letzten Endes
Vielen danke = Vielen Dank
zu Neige = zur Neige
Was lange wehrt = Was lange währt
Feuer und Flame = Feuer und Flamme
wieder Willen = wider Willen
wieder besseres Wissen = wider besseres Wissen
das Für und Wieder = das Für und Wider
für und wieder = für und wider
Angaben ohne Gewehr = Angaben ohne Gewähr
zu späht = zu spät
ich siehe = ich sehe
wider einmal = wieder einmal
im Enddefekt = im Endeffekt
auf jeden Falls = auf jeden Fall
in aller Regeln = in aller Regel
Hallo Heer = Hallo Herr
`),
      // The letter salutation's plural: "Sehr geehrte Damen und Herren".
      [
        ["geehrte Damen und Herrn", "geehrte Dame und Herren", "geehrte Dame und Herrn"],
        "geehrte Damen und Herren",
      ],
      ...rows(`
geehrte Damen und Heeren = geehrte Damen und Herren
geehrter Heer = geehrter Herr
größer wie = größer als
schneller wie = schneller als
älter wie = älter als
kleiner wie = kleiner als
`),
      // Fixed pairs whose first part is shortened and takes a hyphen.
      ...rows(`
niet und nagelfest = niet- und nagelfest
sang und klanglos = sang- und klanglos
hieb und stichfest = hieb- und stichfest
hieb und stichfeste = hieb- und stichfeste
Hals und Beinbruch = Hals- und Beinbruch
Maul und Klauenseuche = Maul- und Klauenseuche
Dreh und Angelpunkt = Dreh- und Angelpunkt
Buß und Bettag = Buß- und Bettag
`),
      // "im" already holds the article: "im der Stadt" is "in der Stadt".
      ...rows(`
im der = in der
im dem = in dem
im den = in den
im das = in das
im die = in die
im einem = in einem
im einer = in einer
im eine = in eine
im meinem = in meinem
im meiner = in meiner
im unserem = in unserem
im diesem = in diesem
im dieser = in dieser
`),
      // Months and seasons take "im" ("im Mai"), and a few fixed phrases; "in August
      // Strindbergs Stück" names a man.
      ...rows(`
in Januar = im Januar
in Februar = im Februar
in März = im März
in April = im April
in Juni = im Juni
in Juli = im Juli
in September = im September
in Oktober = im Oktober
in November = im November
in Dezember = im Dezember
in Frühling = im Frühling
in Sommer = im Sommer
in Herbst = im Herbst
in Winter = im Winter
in Begriff = im Begriff
in Nu = im Nu
`),
      // One million is singular.
      ["eine Millionen", "eine Million"],
      ["einer Millionen", "einer Million"],
      ["eine Milliarden", "eine Milliarde"],
      ["einer Milliarden", "einer Milliarde"],
      ["eine Billionen", "eine Billion"],
      // "Mitglied" is neuter and has no feminine form.
      ["Mitgliederinnen und Mitglieder", "Mitglieder"],
      ["Mitglieder und Mitgliederinnen", "Mitglieder"],
      [["Mitgliederinnen", "Mitglieder:innen", "Mitglieder*innen"], "Mitglieder"],
      ["Mitgliederin", "Mitglied"],
      // "alle naselang" (very often) is one word.
      ["alle Nase lang", "alle naselang"],
      ["alle Nasen lang", "alle nasenlang"],
      ["Covid19", "Covid-19"],
      ["Corona Virus", "Coronavirus"],
      ["Corona Viren", "Coronaviren"],
      // Fixed phrases with a wrong word, case or ending.
      ...rows(`
Streu vom Weizen = Spreu vom Weizen
das Heu vom Weizen = die Spreu vom Weizen
Spreu von Weizen = Spreu vom Weizen
gang und gebe = gang und gäbe
in Bauch und Bogen = in Bausch und Bogen
in Baum und Bogen = in Bausch und Bogen
in Busch und Bogen = in Bausch und Bogen
mit Stumpf und Stil = mit Stumpf und Stiel
mit Sumpf und Stiel = mit Stumpf und Stiel
mit Rum bekleckert = mit Ruhm bekleckert
Rum und Ehre = Ruhm und Ehre
eh und jeh = eh und je
auf weitem Flur = auf weiter Flur
nie und immer = nie und nimmer
Licht unter den Schemel = Licht unter den Scheffel
einen Apfel und ein Eis = einen Apfel und ein Ei
zum Vorscheinen = zum Vorschein
Gesetzt dem Fall = Gesetzt den Fall
Zeit verrennt = Zeit verrinnt
Schmerz zugeführt = Schmerz zugefügt
Schmerzen zugeführt = Schmerzen zugefügt
dritte Rad am Wagen = fünfte Rad am Wagen
drittes Rad am Wagen = fünftes Rad am Wagen
zweigleisiges Schwert = zweischneidiges Schwert
zweigleisige Schwert = zweischneidige Schwert
meines Erachtens nach = meines Erachtens; meinem Erachten nach
unseres Erachtens nach = unseres Erachtens; unserem Erachten nach
in gewisser Maßen = gewissermaßen; in gewisser Weise
um wie viele Uhr = um wie viel Uhr
im Anbetracht = in Anbetracht
zu Last = zur Last
ein ander Mal = ein anderes Mal
ein anders mal = ein anderes Mal
auf jedem Fall = auf jeden Fall
jeden das Seine = jedem das Seine
zu genüge = zur Genüge
aus tiefsten Herzen = aus tiefstem Herzen
von ganzen Herzen = von ganzem Herzen
mit schweren Herzen = mit schwerem Herzen
wider besseren Wissens = wider besseres Wissen
außer Lande = außer Landes
kein Geringer als = kein Geringerer als
auf der Schliche = auf der Spur
vorm Aussterben bedroht = vom Aussterben bedroht
Gefahr im Vollzug = Gefahr im Verzug
Brief und Segel = Brief und Siegel
Schloss und Regel = Schloss und Riegel
Zeit und Muse = Zeit und Muße
Zünglein an der Wage = Zünglein an der Waage
Ende vom Lid = Ende vom Lied
auf lange Sucht = auf lange Sicht
aufs Trapez gebracht = aufs Tapet gebracht
aufs Trapez bringen = aufs Tapet bringen
auf hohem Nivea = auf hohem Niveau
Eis am Stil = Eis am Stiel
im großen Stiel = im großen Stil
auf einem schmalen Grad = auf einem schmalen Grat
des Messers Scheide = des Messers Schneide
zur Ruhe gebetet = zur Ruhe gebettet
zur letzten Ruhe gebetet = zur letzten Ruhe gebettet
auf Rosen gebetet = auf Rosen gebettet
Qual der Wal = Qual der Wahl
baff erstaunt = bass erstaunt
nach wir vor = nach wie vor
das Armen in der Kirche = das Amen in der Kirche
die Harre = die Haare
auf der Jagt = auf der Jagd
ein und das gleiche = ein und dasselbe
ein und der gleiche = ein und derselbe
ein und die gleiche = ein und dieselbe
ein und die gleichen = ein und dieselben
hin uns wieder = hin und wieder
Fiele Grüße = Viele Grüße
fiel Spaß = viel Spaß
fiel Glück = viel Glück
fiel Erfolg = viel Erfolg
Vielen Dan = Vielen Dank
viel Spaße = viel Spaß
Liebe Gruß = Liebe Grüße
Best Grüße = Beste Grüße
in der Hohle = in der Höhle
`),
    ],
    compounds: [
      ...rows(`
aufwiedersehen = auf Wiedersehen
zuende = zu Ende
nichts desto trotz = nichtsdestotrotz
nichts desto weniger = nichtsdestoweniger
das selbe = dasselbe
der selbe = derselbe
die selbe = dieselbe
den selben = denselben
dem selben = demselben
des selben = desselben
zu erst = zuerst
zu mindest = zumindest
in so fern = insofern
in wie fern = inwiefern
irgend etwas = irgendetwas
irgend jemand = irgendjemand
irgend wann = irgendwann
irgend wo = irgendwo
irgend wie = irgendwie
irgend welche = irgendwelche
in zwischen = inzwischen
über haupt = überhaupt
in Mitten = inmitten
statt dessen = stattdessen
aller Hand = allerhand
an statt = anstatt
jeden Falls = jedenfalls
meinet wegen = meinetwegen
deinet wegen = deinetwegen
seinet wegen = seinetwegen
ihret wegen = ihretwegen
seit her = seither
seid her = seither
`),
    ],
    style: [
      ["bereits schon", ["bereits", "schon"]],
      ["neu renoviert", "renoviert"],
      // Doubled meaning: the acronym already names the noun, or the adjective is implied.
      ...rows(`
schon bereits = schon; bereits
PIN-Nummer = PIN
TAN-Nummer = TAN
ISBN-Nummer = ISBN
LCD-Display = LCD
HIV-Virus = HIV
ABS-System = ABS
SMS-Nachricht = SMS
finanziellen Geldprobleme = Geldprobleme
zurück erstatten = erstatten
Rückantwort = Antwort
Gratisgeschenk = Geschenk
Zukunftsprognose = Prognose
einander gegenseitig = einander
plötzlich auf einmal = plötzlich; auf einmal
vielleicht eventuell = vielleicht; eventuell
bald demnächst = bald; demnächst
nur ausschließlich = nur; ausschließlich
also folglich = also; folglich
meistens immer = meistens; immer
immer meistens = meistens; immer
ebenso auch = ebenso; auch
auch ebenfalls = auch; ebenfalls
ebenfalls auch = ebenfalls; auch
sowie und = sowie; und
scheint anscheinend = scheint
scheinen anscheinend = scheinen
inmitten in = inmitten
von woher = woher; von wo
nochmals wiederholen = wiederholen
als wie = als
für umsonst = umsonst
so dermaßen = so; dermaßen
überhaupt gar nicht = überhaupt nicht; gar nicht
überhaupt gar nichts = überhaupt nichts; gar nichts
mit ohne = ohne
nochmal wiederholen = wiederholen
innen hohl = hohl
juristisch illegal = illegal
juristisch legal = legal
kausal verursacht = verursacht
zeitlich synchron = synchron
exakt genauso = genauso; exakt so
entstammt aus = entstammt; stammt aus
entstammen aus = entstammen; stammen aus
`),
      // The recommended one of two allowed spellings (Duden).
      ...rows(`
mit Hilfe = mithilfe
in Frage = infrage
zu Grunde = zugrunde
zu Stande = zustande
im Stande = imstande
zu Rate = zurate
zu Schulden = zuschulden
zu Gunsten = zugunsten
zu Lasten = zulasten
von Seiten = vonseiten
auf Seiten = aufseiten
hier zu Lande = hierzulande
so dass = sodass
so genannte = sogenannte
so genannten = sogenannten
Hand voll = Handvoll
kennen lernen = kennenlernen
kennen zu lernen = kennenzulernen
`),
      // "Sinn machen" is borrowed from English; "Sinn ergeben" is the German phrase.
      ...rows(`
macht Sinn = ergibt Sinn
machen Sinn = ergeben Sinn
Sinn macht = Sinn ergibt
Sinn machen = Sinn ergeben
machte Sinn = ergab Sinn
macht keinen Sinn = ergibt keinen Sinn
macht es Sinn = ergibt es Sinn
machte keinen Sinn = ergab keinen Sinn
machte es Sinn = ergab es Sinn
macht das Sinn = ergibt das Sinn
macht das keinen Sinn = ergibt das keinen Sinn
machte das keinen Sinn = ergab das keinen Sinn
macht wenig Sinn = ergibt wenig Sinn
macht mehr Sinn = ergibt mehr Sinn
machen keinen Sinn = ergeben keinen Sinn
Sinn gemacht = Sinn ergeben
`),
      // More doubled meanings: two words for one idea, an acronym that names its noun.
      ...rows(`
exakt genau = exakt; genau
genau exakt = genau; exakt
auf einmal plötzlich = auf einmal; plötzlich
ungefähr etwa = ungefähr; etwa
etwa ungefähr = etwa; ungefähr
kostenlos gratis = kostenlos; gratis
eventuell vielleicht = eventuell; vielleicht
`),
      // "wegen" with a personal pronoun is spoken German; writing joins the pronoun's form.
      ...rows(`
wegen mir = meinetwegen
wegen ihr = ihretwegen
wegen denen = derentwegen
wegen dir = deinetwegen
wegen ihm = seinetwegen
wegen uns = unseretwegen
wegen euch = euretwegen
vielleicht möglicherweise = vielleicht; möglicherweise
möglicherweise vielleicht = möglicherweise; vielleicht
eventuell möglicherweise = eventuell; möglicherweise
möglicherweise eventuell = möglicherweise; eventuell
fast beinahe = fast; beinahe
beinahe fast = beinahe; fast
nahezu fast = nahezu; fast
immer stets = immer; stets
stets immer = stets; immer
sofort umgehend = sofort; umgehend
umgehend sofort = umgehend; sofort
sofort unverzüglich = sofort; unverzüglich
unverzüglich sofort = unverzüglich; sofort
erneut wieder = erneut; wieder
wieder erneut = wieder; erneut
oft häufig = oft; häufig
häufig oft = häufig; oft
ausschließlich nur = ausschließlich; nur
lediglich nur = lediglich; nur
`),
      // "Sankt" means "heilig": "der heilige Sankt Martin".
      ["heilige Sankt", ["Sankt", "heilige"]],
      ["heiligen Sankt", ["Sankt", "heiligen"]],
      ["heiliger Sankt", ["Sankt", "heiliger"]],
      // Spoken words and their written forms.
      ...rows(`
drauf und dran = kurz davor
schlecht drauf = schlecht gelaunt
knutschen = küssen
knutscht = küsst
knutschte = küsste
knutschten = küssten
geknutscht = geküsst
knutschend = küssend
nur lediglich = nur; lediglich
gleichzeitig zugleich = gleichzeitig; zugleich
zugleich gleichzeitig = zugleich; gleichzeitig
danach anschließend = danach; anschließend
anschließend danach = anschließend; danach
zusätzlich außerdem = zusätzlich; außerdem
außerdem zusätzlich = außerdem; zusätzlich
neu erneuert = erneuert
gemeinsame Schnittmenge = Schnittmenge
einvernehmlicher Konsens = Konsens
einvernehmlichen Konsens = Konsens
Einzelindividuum = Individuum
Lebensbiografie = Biografie
aufoktroyieren = oktroyieren
aufoktroyiert = oktroyiert
IBAN-Nummer = IBAN
IT-Technik = IT
ABM-Maßnahme = ABM
GPS-System = GPS
LED-Diode = LED
RAM-Speicher = RAM
PDF-Format = PDF
Stundenkilometer = Kilometer pro Stunde
Stundenkilometern = Kilometern pro Stunde
täglicher Alltag = Alltag
täglichen Alltag = Alltag
täglichem Alltag = Alltag
zirka etwa = zirka; etwa
circa etwa = circa; etwa
zusätzlich hinzu = hinzu
immer jederzeit = jederzeit; immer
kleines Mäuschen = Mäuschen
zeitlich verzögert = verzögert
erhöhter Bluthochdruck = Bluthochdruck
erhöhtem Bluthochdruck = Bluthochdruck
ODF-Format = ODF
Marionettenpuppe = Marionette
Marionettenpuppen = Marionetten
Gesichtsvisier = Visier
Gesichtsvisiere = Visiere
`),
    ],
  },
  fr: {
    words: [
      ...rows(`
language = langage
languages = langages
connection = connexion
connections = connexions
dévelopement = développement
parmis = parmi
`),
      [["apeller", "appeller"], "appeler"],
      ...rows(`
rapeller = rappeler
addresse = adresse
apartement = appartement
cauchemard = cauchemar
dilemne = dilemme
occurence = occurrence
malgrès = malgré
néamoins = néanmoins
notament = notamment
pécunier = pécuniaire
infractus = infarctus
aréoport = aéroport
comission = commission
professionel = professionnel
traditionel = traditionnel
`),
    ],
    phrases: [
      // "quel" agrees with the subject after "être": the writer picks the gender.
      ["quelque soit", ["quel que soit", "quelle que soit"]],
      [
        ["quelque soient", "quelques soient"],
        ["quels que soient", "quelles que soient"],
      ],
      ["en faite", "en fait"],
      ["sa va", "ça va"],
      ...french.PHRASES,
    ],
    compounds: [
      ...rows(`
vis à vis = vis-à-vis
au delà = au-delà
au dessus = au-dessus
au dessous = au-dessous
là bas = là-bas
c'est à dire = c'est-à-dire
celui ci = celui-ci
celle ci = celle-ci
ceux ci = ceux-ci
celles ci = celles-ci
celui là = celui-là
celle là = celle-là
ceux là = ceux-là
celles là = celles-là
`),
      ...french.COMPOUNDS,
    ],
    // "monter en haut de la tour" names a destination: left out.
    style: [
      ...rows(`
au jour d'aujourd'hui = aujourd'hui
sortir dehors = sortir
reculer en arrière = reculer
prévoir à l'avance = prévoir
collaborer ensemble = collaborer
s'entraider mutuellement = s'entraider
comme par exemple = comme; par exemple
puis ensuite = puis; ensuite
car en effet = car; en effet
`),
      ...french.STYLE,
    ],
  },
  es: {
    // "vistes" (present of "vestir") and "iva" (the tax) are words: left out.
    words: [
      ["haiga", "haya"],
      ["haigas", "hayas"],
      ["haigan", "hayan"],
      ["haigamos", "hayamos"],
      [["nadien", "nadies", "naide"], "nadie"],
      ...rows(`
dijistes = dijiste
hicistes = hiciste
fuistes = fuiste
tuvistes = tuviste
estuvistes = estuviste
pudistes = pudiste
vinistes = viniste
preveer = prever
mounstro = monstruo
mounstros = monstruos
dentrífico = dentífrico
cocreta = croqueta
andé = anduve
andó = anduvo
satisfació = satisfizo
conducí = conduje
traducí = traduje
exhuberante = exuberante
expontáneo = espontáneo
idiosincracia = idiosincrasia
aereopuerto = aeropuerto
vagamundo = vagabundo
`),
      // "ser" in the imperfect keeps its accent: "éramos", "érase".
      ["eramos", "éramos"],
      // Adverbs whose plain spelling is only a form of a rare verb ("ademar", "jamar", "ojalar").
      ["ademas", "además"],
      ["jamas", "jamás"],
      ["ojala", "ojalá"],
      // Irregular participles built as if regular: "rompido" -> "roto", "volvido" -> "vuelto".
      ...(
        [
          ["rompid", "rot"],
          ["escribid", "escrit"],
          ["describid", "descrit"],
          ["inscribid", "inscrit"],
          ["cubrid", "cubiert"],
          ["descubrid", "descubiert"],
          ["morid", "muert"],
          ["ponid", "puest"],
          ["componid", "compuest"],
          ["volvid", "vuelt"],
          ["devolvid", "devuelt"],
          ["envolvid", "envuelt"],
          ["resolvid", "resuelt"],
          ["hacid", "hech"],
          ["deshacid", "deshech"],
          ["satisfacid", "satisfech"],
        ] as const
      ).flatMap(([typed, fixed]) =>
        ["o", "a", "os", "as"].map((end): PhraseRow => [`${typed}${end}`, `${fixed}${end}`]),
      ),
    ],
    // Existential "haber" is singular; "hubieron de" and "habían llegado" are not matched.
    phrases: [
      ...rows(`
hubieron muchos = hubo muchos
hubieron muchas = hubo muchas
hubieron varios = hubo varios
hubieron varias = hubo varias
habían muchos = había muchos
habían muchas = había muchas
habían varios = había varios
habían varias = había varias
`),
      // "los años treintas", "los noventas": decades are invariable.
      ...[
        "veinte",
        "treinta",
        "cuarenta",
        "cincuenta",
        "sesenta",
        "setenta",
        "ochenta",
        "noventa",
      ].flatMap((decade): PhraseRow[] => [
        [`años ${decade}s`, `años ${decade}`],
        [`los ${decade}s`, `los ${decade}`],
      ]),
      // "de" set phrases with the neighbouring key's "se": no clitic goes before these.
      ...["antemano", "repente", "inmediato", "nuevo", "verdad", "momento"].map(
        (word): PhraseRow => [`se ${word}`, `de ${word}`],
      ),
      // "ves" (you see) where the noun "vez" belongs; none of these frames takes the verb.
      ...(
        [
          "tal ~",
          "cada ~",
          "otra ~",
          "una ~",
          "alguna ~",
          "ninguna ~",
          "rara ~",
          "cierta ~",
          "a la ~",
          "a su ~",
          "en ~ de",
          "de ~ en cuando",
          "primera ~",
          "segunda ~",
          "tercera ~",
          "última ~",
          "única ~",
          "próxima ~",
          "enésima ~",
          "milésima ~",
          "aquella ~",
          "la ~ pasada",
          "la ~ anterior",
          "la ~ siguiente",
          "la ~ primera",
          "la ~ última",
          "esta ~",
          "esa ~",
          "da la ~",
        ] as const
      ).map((form): PhraseRow => [form.replace("~", "ves"), form.replace("~", "vez")]),
      ["ala vez", "a la vez"],
      ["erase una vez", "érase una vez"],
      // The future of "ver" keeps its accent: "ya verás", "él verá".
      ...rows(`
ya vera = ya verá
tú veras = tú verás
él vera = él verá
ella vera = ella verá
usted vera = usted verá
correo electrónica = correo electrónico
`),
      // Feminine nouns with a stressed first "a" take "el": "el agua", "el alma".
      // ("la arma", "la habla" and "la ancla" may be a pronoun and its verb; "la alma máter".)
      ...[
        "agua",
        "aula",
        "área",
        "águila",
        "hambre",
        "hacha",
        "hada",
        "haba",
        "alga",
        "ave",
        "acta",
        "aria",
        "arca",
        "ala",
        "hampa",
      ].map((noun): PhraseRow => [`la ${noun}`, `el ${noun}`]),
      ...rows(`
tú ere = tú eres
de echo = de hecho
vamos haber = vamos a ver
hay de mí = ay de mí
halla lo que halla = haya lo que haya
hola de calor = ola de calor
hola de frío = ola de frío
de arriba a bajo = de arriba abajo
`),
      [["hacia a bajo", "hacia a abajo"], "hacia abajo"],
      ["el en torno", "el entorno"],
      ["su en torno", "su entorno"],
      ...["industriales", "tóxicos", "orgánicos", "radiactivos", "sólidos", "plásticos"].map(
        (kind): PhraseRow => [`deshechos ${kind}`, `desechos ${kind}`],
      ),
      // Fixed phrases with the stressed "sí" (itself) and "aun" (even).
      ["de por si", "de por sí"],
      ["fuera de si", "fuera de sí"],
      ...["en", "por", "de", "para"].flatMap((prep) =>
        ["mismo", "misma", "mismos", "mismas"].map((same): PhraseRow => [
          `${prep} si ${same}`,
          `${prep} sí ${same}`,
        ]),
      ),
      ["eso si que", "eso sí que"],
      ["aún cuando", "aun cuando"],
      ["yo que sé", "yo qué sé"],
      // Conjunctive phrases that need (or refuse) "de" before "que".
      ...rows(`
a pesar que = a pesar de que
a sabiendas que = a sabiendas de que
en caso que = en caso de que
pese que = pese a que
a no ser de que = a no ser que
a medida de que = a medida que
una vez de que = una vez que
`),
      [
        ["en la medida de que", "en medida de que", "en medida que", "en medida en que"],
        "en la medida en que",
      ],
      // "detrás mío": the adverb takes "de" and a pronoun.
      ...[
        "detrás",
        "delante",
        "encima",
        "debajo",
        "enfrente",
        "cerca",
        "atrás",
        "adelante",
        "arriba",
        "abajo",
      ].flatMap((adverb): PhraseRow[] => [
        [[`${adverb} mío`, `${adverb} mía`], `${adverb} de mí`],
        [[`${adverb} tuyo`, `${adverb} tuya`], `${adverb} de ti`],
        [[`${adverb} nuestro`, `${adverb} nuestra`], `${adverb} de nosotros`],
        [[`${adverb} vuestro`, `${adverb} vuestra`], `${adverb} de vosotros`],
        [
          [`${adverb} suyo`, `${adverb} suya`],
          [`${adverb} de él`, `${adverb} de ella`, `${adverb} de usted`],
        ],
      ]),
      // Fixed noun phrases whose inner noun keeps its number.
      ...[
        ...rows(`
puntos de vistas = puntos de vista
punto de vistas = punto de vista
fines de semanas = fines de semana
salas de esperas = salas de espera
dolores de cabezas = dolores de cabeza
cuartos de baños = cuartos de baño
campos de batallas = campos de batalla
estados de ánimos = estados de ánimo
números de teléfonos = números de teléfono
silla de rueda = silla de ruedas
sillas de rueda = sillas de ruedas
abrir y cerrar de ojo = abrir y cerrar de ojos
encogió de hombro = encogió de hombros
encogerse de hombro = encogerse de hombros
miles de persona = miles de personas
millones de persona = millones de personas
cientos de persona = cientos de personas
fracción de segundos = fracción de segundo
fracciones de segundos = fracciones de segundo
golpe de estados = golpe de estado
golpes de estados = golpes de estado
medios de comunicaciones = medios de comunicación
puntos de partidas = puntos de partida
millones de euro = millones de euros
miles de euro = miles de euros
pérdida de tiempos = pérdida de tiempo
pérdidas de tiempos = pérdidas de tiempo
metros de distancias = metros de distancia
kilómetros de distancias = kilómetros de distancia
puertas de embarques = puertas de embarque
días de semanas = días de semana
`),
      ].map(([typed, fixed]): PhraseRow => [typed, fixed]),
      // "miles", "cientos", "millares" are masculine nouns: "los miles de personas".
      ...["miles", "cientos", "millares", "centenares"].flatMap((amount): PhraseRow[] => [
        [`las ${amount}`, `los ${amount}`],
        [`unas ${amount}`, `unos ${amount}`],
      ]),
      ["estado unidos", "estados unidos"],
      // "estar de acuerdo" keeps the noun singular.
      ...["estoy", "estás", "está", "estamos", "estáis", "están", "estaba", "estaban", "estar"].map(
        (form): PhraseRow => [`${form} de acuerdos`, `${form} de acuerdo`],
      ),

      // Set phrases with a word swapped for a sound-alike or a wrong link word.
      ["loor de multitudes", "olor de multitudes"],
      ["obediencia de vida", "obediencia debida"],
      [["cuota de nieve", "cuotas de nieve"], "cota de nieve"],
      ...rows(`
al igual de = al igual que
al igual del = al igual que el
por tal de = con tal de
tal es así que = tanto es así que
sin en cambio = sin embargo; en cambio
ni si quiera = ni siquiera
debido que = debido a que
sin ecuánime = sine qua non
`),
      // "surtir efecto" (to take effect), not "surgir" (to arise).
      ...["surge", "surgen", "surgió", "surgieron", "surgir"].map((form): PhraseRow => [
        `${form} efecto`,
        `${form.replace("surg", "surt")} efecto`,
      ]),
      // The relative "cual" after its article never takes the accent.
      ...rows(`
el cuál = el cual
la cuál = la cual
lo cuál = lo cual
del cuál = del cual
al cuál = al cual
los cuáles = los cuales
las cuáles = las cuales
sean cuáles sean = sean cuales sean
tal o cuál = tal o cual
`),
      // "el porque" may be "él porque"; these determiners only take the noun "porqué".
      ["un porque", "un porqué"],
      ["su porque", "su porqué"],
      [["qué se yo", "que se yo"], "qué sé yo"],
      // Set phrases with a letter swapped: "sin embargo", "a lo largo", "huso horario".
      ["sin embrago", "sin embargo"],
      ["a lo lardo", "a lo largo"],
      ["uso horario", "huso horario"],
      ["usos horarios", "husos horarios"],
      ["más aya", "más allá"],
      ...["debido", "gracias", "frente", "junto"].map((word): PhraseRow => [
        `${word} aun`,
        `${word} a un`,
      ]),
      // "dar abasto" (to cope) is one word.
      ...["doy", "das", "da", "damos", "dan", "daba", "dábamos", "daban", "dar"].map(
        (form): PhraseRow => [`${form} a basto`, `${form} abasto`],
      ),
      // Greetings keep their plural: "buenos días", "buenas tardes", "buenas noches".
      [["buen días", "buenas días"], "buenos días"],
      [["buena tardes", "buenas tarde", "buenos tardes"], "buenas tardes"],
      [["buena noches", "buenas noche", "buenos noches"], "buenas noches"],
      [["de todas modos", "de todo modos"], "de todos modos"],
      [["de todos formas", "de toda formas"], "de todas formas"],
      ["de todos maneras", "de todas maneras"],
      // A stressed a- feminine noun keeps "el" and "un" only: "toda el agua", "esta aula".
      ...[
        "área",
        "aula",
        "águila",
        "hambre",
        "hacha",
        "hada",
        "alma",
        "ave",
        "asma",
        "aria",
      ].flatMap((noun): PhraseRow[] => [
        [`todo el ${noun}`, `toda el ${noun}`],
        [`este ${noun}`, `esta ${noun}`],
        [`ese ${noun}`, `esa ${noun}`],
        [`aquel ${noun}`, `aquella ${noun}`],
      ]),
      ["todo el agua", "toda el agua"],
      ["mucho hambre", "mucha hambre"],
      // "límite" set after a noun as its label: "fecha límite", "caso límite".
      ...["fecha", "fechas", "hora", "caso", "casos", "situación", "velocidad", "edad", "peso"].map(
        (noun): PhraseRow => [`${noun} limite`, `${noun} límite`],
      ),
      ...["llueve", "llovía", "llovió", "lloviendo", "llover", "lloverá"].map((form): PhraseRow => [
        `${form} a cantaros`,
        `${form} a cántaros`,
      ]),
      // "dar ánimo": a form of "dar" takes the noun, never a second verb.
      ...["da", "dan", "dio", "dieron", "daba", "daban", "dar", "darle", "darles", "daría"].map(
        (form): PhraseRow => [`${form} animo`, `${form} ánimo`],
      ),
      ["a feliz termino", "a feliz término"],
      // A quantity of people or things counts a plural: "un montón de personas".
      ...[
        "número",
        "puñado",
        "montón",
        "conjunto",
        "cantidad",
        "multitud",
        "infinidad",
        "sinnúmero",
        "centenar",
        "millar",
        "abarrotado",
        "abarrotada",
      ].flatMap((amount): PhraseRow[] => [
        [`${amount} de persona`, `${amount} de personas`],
        [`${amount} de cosa`, `${amount} de cosas`],
      ]),
      // "mortandad" is a mass death; the rate is "mortalidad".
      ["mortandad infantil", "mortalidad infantil"],
      ["tasa de mortandad", "tasa de mortalidad"],
      ["índice de mortandad", "índice de mortalidad"],
      // "revestir importancia" (to be important), not "revertir" (to revert).
      ...[
        ["revierte", "reviste"],
        ["revierten", "revisten"],
        ["revertía", "revestía"],
        ["revertían", "revestían"],
        ["revirtió", "revistió"],
      ].flatMap(([typed, fixed]): PhraseRow[] =>
        ["importancia", "gravedad", "mucha importancia", "gran importancia", "una gran"].map(
          (object): PhraseRow => [`${typed} ${object}`, `${fixed} ${object}`],
        ),
      ),
      ["se vulva a", "se vuelva a"],
      ["que vulva a", "que vuelva a"],
      ["con a sin", "con o sin"],
      // "llevar a cabo" (to carry out) and "dar lugar a" (to give rise to).
      ...[
        "llevar",
        "llevarlo",
        "llevarla",
        "lleva",
        "llevó",
        "llevamos",
        "llevaron",
        "llevado",
      ].map((form): PhraseRow => [`${form} acabo`, `${form} a cabo`]),
      ...["dar", "da", "dan", "dio", "daría", "darán", "dará"].map((form): PhraseRow => [
        `${form} a lugar a`,
        `${form} lugar a`,
      ]),
      [["per capita", "por capita", "por cápita"], "per cápita"],
      // The impersonal "hace" of time and weather lost its "h": "ace mucho tiempo".
      ...["mucho", "tiempo", "años", "meses", "días", "falta", "frío", "calor"].map(
        (next): PhraseRow => [`ace ${next}`, `hace ${next}`],
      ),
      ["haz click", "haz clic"],
      ["hacer click", "hacer clic"],
      ["doble click", "doble clic"],
      ...["nuestros", "sus", "vuestros"].map((owner): PhraseRow => [
        `${owner} deshechos`,
        `${owner} desechos`,
      ]),
      ["hechas cuenta", "echas cuenta"],
      // "afrontar" (to face), not "afrentar" (to insult), before a difficulty.
      ...[
        ["afrentar", "afrontar"],
        ["afrenta", "afronta"],
        ["afrentan", "afrontan"],
        ["afrentó", "afrontó"],
      ].flatMap(([typed, fixed]): PhraseRow[] =>
        ["problemas", "dificultades", "retos", "desafíos", "muchos problemas"].map(
          (object): PhraseRow => [`${typed} ${object}`, `${fixed} ${object}`],
        ),
      ),
      // "desternillarse de risa" (to split one's sides).
      ...["destornillarse", "destornilló", "destornillaba", "destornillé", "destornillando"].map(
        (form): PhraseRow => [`${form} de risa`, `${form.replace("destorn", "destern")} de risa`],
      ),
      ...rows(`
alta cargo = alto cargo
altas cargos = altos cargos
al igual a lo que = al igual que
apunto de caramelo = a punto de caramelo
plasma convaleciente = plasma de convaleciente
se cayo = se cayó
le cayo = le cayó
`),
      ...["las", "unas", "esas", "estas", "muchas", "algunas", "otras"].map((det): PhraseRow => [
        `${det} persones`,
        `${det} personas`,
      ]),
      ["se lo tajo", "se lo trajo"],
      ["se tarta de", "se trata de"],
      ["si te no", "si no te"],
      // A comparative takes "mucho", not "muy": "mucho mejor".
      ...rows(`
muy mejor = mucho mejor
muy peor = mucho peor
muy mayor de lo que = mucho mayor de lo que
muy menor de lo que = mucho menor de lo que
de basa en = se basa en
de basan en = se basan en
al fines de = a fines de
`),
      // "dar el alta" (to discharge): the noun "alta" takes "el".
      ...["dar", "dio", "dieron", "dan", "daban", "darle", "darán"].map((form): PhraseRow => [
        `${form} la alta`,
        `${form} el alta`,
      ]),
      // "insistir en que" (never "de que"), "desconfiar de", "enfrentarse a" or "con".
      ...[
        "insisto",
        "insistes",
        "insiste",
        "insistimos",
        "insisten",
        "insistía",
        "insistían",
        "insistió",
        "insistieron",
        "insista",
        "insistas",
        "insistan",
        "insistir",
        "insistiendo",
      ].flatMap((form): PhraseRow[] => [
        [`${form} de que`, `${form} en que`],
        [`${form} más de que`, `${form} más en que`],
      ]),
      ...[
        "desconfío",
        "desconfías",
        "desconfía",
        "desconfiamos",
        "desconfían",
        "desconfiaba",
        "desconfiaban",
        "desconfió",
        "desconfiaron",
        "desconfíe",
        "desconfíes",
        "desconfíen",
        "desconfiar",
      ].flatMap((form): PhraseRow[] => [
        [`${form} en el`, `${form} del`],
        ...["la", "los", "las", "él", "ella", "ellos", "ellas", "nadie"].map((next): PhraseRow => [
          `${form} en ${next}`,
          `${form} de ${next}`,
        ]),
      ]),
      ...[
        "se enfrenta",
        "se enfrentan",
        "se enfrentó",
        "se enfrentaron",
        "se enfrentaba",
        "se enfrentaban",
        "se enfrentará",
        "se enfrentarán",
        "me enfrenté",
        "nos enfrentamos",
        "enfrentarse",
        "enfrentarme",
        "enfrentarnos",
      ].map((form): PhraseRow => [`${form} ante`, [`${form} a`, `${form} con`]]),
      // A rate counts one unit: "litros por metro cuadrado".
      ...["metro", "kilómetro", "centímetro"].flatMap((unit): PhraseRow[] => [
        [`por ${unit}s cuadrados`, `por ${unit} cuadrado`],
        [`por ${unit}s cúbicos`, `por ${unit} cúbico`],
      ]),
    ],
    compounds: [
      [["todo poderoso", "todo-poderoso"], "todopoderoso"],
      [["todo poderosa", "todo-poderosa"], "todopoderosa"],
      [["todo poderosos", "todo-poderosos"], "todopoderosos"],
      [["todo poderosas", "todo-poderosas"], "todopoderosas"],
      [["rifi rafe", "rifi-rafe"], "rifirrafe"],
      ...rows(`
tam bien = también
porsupuesto = por supuesto
asique = así que
con tigo = contigo
con migo = conmigo
medio ambiental = medioambiental
medio ambientales = medioambientales
social demócrata = socialdemócrata
social demócratas = socialdemócratas
corona virus = coronavirus
salva conducto = salvoconducto
tele trabajo = teletrabajo
video juego = videojuego
video juegos = videojuegos
video conferencia = videoconferencia
video conferencias = videoconferencias
foto periodismo = fotoperiodismo
cara duras = caraduras
ultra violeta = ultravioleta
ultra violetas = ultravioleta
estado unidenses = estadounidenses
estado unidense = estadounidense
a contra corriente = a contracorriente
a contra pie = a contrapié
boca bajo = boca abajo; bocabajo
el hazme reír = el hazmerreír
un hazme reír = un hazmerreír
cuál quier = cualquier
cual quier = cualquier
cual quiera = cualquiera
cuales quiera = cualesquiera
`),
    ],
    style: [
      // The 2010 spelling drops the accent of "solo" and the demonstrative pronouns.
      ["sólo", "solo"],
      ...[
        ...rows(`
éste = este
ésta = esta
éstos = estos
éstas = estas
ése = ese
ésa = esa
ésos = esos
ésas = esas
aquél = aquel
aquélla = aquella
aquéllos = aquellos
aquéllas = aquellas
`),
      ].map(([typed, fixed]): PhraseRow => [typed, fixed]),
      ...rows(`
subir arriba = subir
bajar abajo = bajar
salir afuera = salir
entrar adentro = entrar
en relación a = en relación con; con relación a
en relación al = en relación con el; con relación al
en base a = con base en; sobre la base de
en base al = con base en el; sobre la base del
`),
      // "Han relacionado a los dos casos" takes the personal "a": the masculine singular is read
      // only after "estar".
      ...[
        "relacionada",
        "relacionados",
        "relacionadas",
        "está relacionado",
        "estaba relacionado",
      ].flatMap((form): PhraseRow[] => [
        [`${form} a`, `${form} con`],
        [`${form} al`, `${form} con el`],
      ]),
      ["orografía del terreno", "orografía"],
      ["de gratis", "gratis"],
      // Phrases that say the same thing twice.
      ...rows(`
volver a repetir = repetir
lapso de tiempo = lapso
erario público = erario
accidente fortuito = accidente
réplica exacta = réplica
prever de antemano = prever
planear de antemano = planear
reiterar de nuevo = reiterar
colofón final = colofón
monopolio exclusivo = monopolio
sorpresa inesperada = sorpresa
hemorragia de sangre = hemorragia
vigente en la actualidad = vigente
ambos dos = ambos
ambas dos = ambas
a la mayor brevedad posible = a la mayor brevedad
`),
      [["más óptimo", "muy óptimo"], "óptimo"],
      [["más óptima", "muy óptima"], "óptima"],
      ["bajo mi punto de vista", "desde mi punto de vista"],
      ["bajo su punto de vista", "desde su punto de vista"],
      // The 2010 spelling writes "o" between figures too.
      ["ó", "o"],
    ],
  },
  pt: {
    words: [
      ...rows(`
seje = seja
esteje = esteja
menas = menos
excessão = exceção
excessões = exceções
previlégio = privilégio
beneficiente = beneficente
mortandela = mortadela
asterístico = asterisco
impecilho = empecilho
cabeleleiro = cabeleireiro
mendingo = mendigo
advinhar = adivinhar
própio = próprio
discusão = discussão
ancioso = ansioso
iorgute = iogurte
apezar = apesar
`),
      ...PORTUGUESE_WORDS,
    ],
    // Existential "haver" is singular.
    phrases: [
      ["houveram muitos", "houve muitos"],
      ["houveram muitas", "houve muitas"],
      ["houveram vários", "houve vários"],
      ["houveram várias", "houve várias"],
      ...PORTUGUESE_PHRASES,
    ],
    style: PORTUGUESE_STYLE,
  },
  pl: {
    // Feminine "poszłam" is correct; only the masculine blends are listed.
    words: [
      ...rows(`
wziąść = wziąć
poszłem = poszedłem
przyszłem = przyszedłem
wyszłem = wyszedłem
weszłem = wszedłem
doszłem = doszedłem
włanczać = włączać
włanczam = włączam
wyłanczać = wyłączać
wyłanczam = wyłączam
orginalny = oryginalny
orginalnie = oryginalnie
orginał = oryginał
rozumię = rozumiem
umię = umiem
bierzę = biorę
nadzieji = nadziei
przyjacielami = przyjaciółmi
cudzysłowiu = cudzysłowie
`),
      ...POLISH_TABLES.words,
    ],
    // "półtora" goes with masculine and neuter nouns, "półtorej" with feminine ones.
    phrases: [
      ...rows(`
półtorej roku = półtora roku
półtorej miesiąca = półtora miesiąca
półtorej tygodnia = półtora tygodnia
półtora godziny = półtorej godziny
półtora minuty = półtorej minuty
w każdym bądź razie = w każdym razie
`),
      ...POLISH_TABLES.phrases,
    ],
    compounds: [
      ...rows(`
z pośród = spośród
z pod = spod
z nad = znad
z przed = sprzed
z za = zza
w śród = wśród
po za tym = poza tym
po mimo = pomimo
na przeciwko = naprzeciwko
z tąd = stąd
z kąd = skąd
z nikąd = znikąd
`),
      [["spowrotem", "zpowrotem"], "z powrotem"],
      ...POLISH_TABLES.compounds,
    ],
    style: [
      ...rows(`
w dniu dzisiejszym = dziś; dzisiaj
cofać się do tyłu = cofać się
cofnąć się do tyłu = cofnąć się
wracać z powrotem = wracać
wrócić z powrotem = wrócić
fakt autentyczny = fakt
`),
      ...POLISH_TABLES.style,
    ],
  },
  hr: {
    words: [
      ...rows(`
uopče = uopće
opčenito = općenito
zakljućak = zaključak
ćestitam = čestitam
ljepo = lijepo
djete = dijete
gdije = gdje
`),
    ],
    compounds: [
      ["bi smo", "bismo"],
      ["bi ste", "biste"],
      ["sobzirom", "s obzirom"],
    ],
  },
  sv: SWEDISH_TABLES,
  el: GREEK_TABLES,
  ar: ARABIC_TABLES,
};
