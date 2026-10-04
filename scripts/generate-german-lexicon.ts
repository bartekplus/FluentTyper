// Derives the German noun lexicon behind Review's noun-casing check from the Hunspell dictionary
// the extension ships (de_DE.dic/.aff). The dictionary lists nouns capitalized and every other
// word lowercase, so a lowercase noun form can be told apart from a verb or adjective that
// happens to share its spelling ("die kosten" / "kosten", "der griff" / "griff").
// Writes src/core/domain/grammar/review/german/germanLexicon.generated.ts.
// Usage: bun run generate:lexicons german
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BLOOM_ALPHABET,
  bloomBits,
  bloomHas,
  decodeBits,
} from "../src/core/domain/grammar/implementations/helpers/EnglishLexicon";
import { encodeWordGraph } from "../src/core/domain/grammar/review/wordGraph";
import { applyAffix, bloom, frontCode, ngramRows, parseAffixRules } from "./lexiconTools";

const root = resolve(import.meta.dir, "..");
export const GERMAN_LEXICON_SOURCES = {
  dic: resolve(root, "resources_js/de_DE/hunspell/de_DE.dic"),
  aff: resolve(root, "resources_js/de_DE/hunspell/de_DE.aff"),
  out: resolve(root, "src/core/domain/grammar/review/german/germanLexicon.generated.ts"),
  gender: resolve(root, "src/core/domain/grammar/review/german/germanGender.generated.ts"),
  usage: resolve(root, "src/core/domain/grammar/review/german/germanUsage.generated.ts"),
  trie: resolve(root, "resources_js/de_DE/ngrams_db/ngrams.trie"),
  counts: resolve(root, "resources_js/de_DE/ngrams_db/ngrams.counts"),
};

// The igerman98 suffix flags that spell finite verb endings; the others spell noun and
// adjective endings. The bare entry of a verb is its infinitive (also the 1st/3rd plural).
const FINITE_FLAGS = "IXYZW";
// Hunspell control flags: ONLYINCOMPOUND, NEEDAFFIX and FORBIDDENWORD.
const COMPOUND_ONLY = "o";
const NEED_AFFIX = "h";
const FORBIDDEN = "d";
// The cascades' first levels set how often an unknown word reads as a noun (2^-8) or a
// noun as an infinitive; a verb read falsely only costs a finding, so its filter is looser.
const NOUN_GOLOMB_BITS = 8;
const INFINITIVE_GOLOMB_BITS = 6;
const VERB_BITS_PER_WORD = 8;
const ADJECTIVE_BITS_PER_WORD = 12;

type Reading = "finite" | "infinitive" | "other";

/** Lowercase noun forms, and every reading of each lowercase standalone word. */
export function deriveGermanLexicon(dic: string, aff: string) {
  const rules = parseAffixRules(aff);
  // Suffixes that only spell a compound piece are left out.
  const suffixes = rules.filter((r) => r.kind === "SFX" && !r.classes.includes(COMPOUND_ONLY));
  // Only the un- and ver- prefixes spell standalone words; the others spell compound pieces.
  const wordPrefixes = rules.filter((r) => r.kind === "PFX" && (r.flag === "U" || r.flag === "V"));
  const nouns = new Set<string>();
  const lower = new Map<string, Set<Reading>>();
  const adjectives = new Set<string>();
  // Forms read as some other word by an entry that is no adjective ("zeit", "paar", "mit").
  const plainOther = new Set<string>();
  const read = (form: string, reading: Reading) => {
    let readings = lower.get(form);
    if (!readings) lower.set(form, (readings = new Set()));
    readings.add(reading);
  };
  for (const line of dic.split("\n").slice(1)) {
    if (!line || /^\s/.test(line)) continue;
    const [word, flags = ""] = line.trim().split("/");
    if (flags.includes(COMPOUND_ONLY) || flags.includes(FORBIDDEN)) continue;
    const capitalized = /^[A-ZÄÖÜ]/.test(word);
    const forms: [string, Reading][] = [];
    // An inflecting adjective: its bare lemma ("klein", "original").
    if (!capitalized && flags.includes("A")) adjectives.add(word);
    // A capitalized compound head ("Rasen/hij") is still a noun on its own.
    if (capitalized || !flags.includes(NEED_AFFIX)) {
      const verb = /[IXY]/.test(flags) && /n$/.test(word);
      const finiteStem = !verb && flags.includes("Z");
      forms.push([word, verb ? "infinitive" : finiteStem ? "finite" : "other"]);
    }
    for (const rule of suffixes) {
      const form = flags.includes(rule.flag) ? applyAffix(word, rule) : null;
      if (form !== null) forms.push([form, FINITE_FLAGS.includes(rule.flag) ? "finite" : "other"]);
    }
    for (const [form, reading] of forms) {
      if (capitalized) {
        if (/^[A-ZÄÖÜ][a-zäöüß]+$/.test(form)) nouns.add(form.toLowerCase());
        continue;
      }
      read(form, reading);
      if (reading === "other" && !flags.includes("A")) plainOther.add(form);
      for (const rule of wordPrefixes)
        if (flags.includes(rule.flag)) read(rule.add + form, reading);
    }
  }
  const nounOnly: string[] = [];
  const finite: string[] = [];
  const infinitive: string[] = [];
  const ambiguous: string[] = [];
  for (const noun of [...nouns].sort()) {
    const readings = lower.get(noun);
    if (!readings) nounOnly.push(noun);
    else if (readings.has("other")) ambiguous.push(noun);
    else if (readings.has("infinitive")) infinitive.push(noun);
    else finite.push(noun);
  }
  const verbs = [...lower].filter(([, readings]) => readings.has("infinitive")).map(([w]) => w);
  return {
    nounOnly,
    finite,
    infinitive,
    ambiguous,
    // Noun forms whose other readings are adjective or verb forms ("alter", "spitze").
    adjectiveNouns: ambiguous.filter((w) => !plainOther.has(w)),
    // Noun forms that are also an adverb, preposition, numeral or other uninflected word
    // ("angst", "ehe", "kraft", "morgen").
    otherNouns: ambiguous.filter((w) => plainOther.has(w)),
    verbs: verbs.sort(),
    adjectives: [...adjectives].sort(),
    lowercaseWords: [...lower.keys()].sort(),
  };
}

/**
 * A Golomb-coded set: each word hashed into [0, n·2^r), sorted, and the gaps written as a
 * unary quotient and an r-bit remainder, six bits per character, lowest bit first. About
 * r + 1.5 bits a word for a false-positive rate of 2^-r. Written "g<r>.<n>.<count>.<bits>".
 */
function golomb(words: string[], r: number): { text: string; has: (word: string) => boolean } {
  const range = words.length * 2 ** r;
  const values = [...new Set(words.map((w) => bloomBits(w, range, 1)[0]))].sort((a, b) => a - b);
  const bits: number[] = [];
  let previous = 0;
  for (const value of values) {
    const gap = value - previous;
    previous = value;
    for (let q = Math.floor(gap / 2 ** r); q > 0; q--) bits.push(1);
    bits.push(0);
    for (let b = 0; b < r; b++) bits.push((gap >> b) & 1);
  }
  let payload = "";
  for (let i = 0; i < bits.length; i += 6) {
    let value = 0;
    for (let b = 0; b < 6; b++) value |= (bits[i + b] ?? 0) << b;
    payload += BLOOM_ALPHABET[value];
  }
  const set = new Set(values);
  return {
    text: `g${r}.${words.length}.${values.length}.${payload}`,
    has: (word) => set.has(bloomBits(word, range, 1)[0]),
  };
}

/**
 * A filter cascade (as in CRLite) that answers exactly for every word in `members` or
 * `others`: level 0 holds the members, level 1 the others level 0 lets through, level 2 the
 * members level 1 catches, and so on until a level lets nothing through. Levels are joined by
 * spaces and salt their words with their index. Level 0 is a Golomb-coded set, so words in
 * neither list read as members at a rate of 2^-r; the others are Bloom filters that start
 * with their hash count.
 */
function cascade(members: string[], others: string[], r: number): string {
  const levels: string[] = [];
  let include = members;
  let exclude = others;
  for (let level = 0; include.length > 0; level++) {
    const salted = include.map((w) => `${level}${w}`);
    let passes: (word: string) => boolean;
    if (level === 0) {
      const set = golomb(salted, r);
      levels.push(set.text);
      passes = (w) => set.has(`0${w}`);
    } else {
      // Later levels thin out the words the level before let through; a false yes costs a
      // word in the next level, so the more words would pass, the more bits each gets.
      const bitsPerWord = Math.max(3, 1.44 * Math.log2(exclude.length / include.length));
      const hashes = Math.max(1, Math.round(bitsPerWord * Math.LN2));
      const filter = bloom(salted, bitsPerWord, hashes);
      levels.push(`${hashes}${filter}`);
      const bits = decodeBits(filter);
      passes = (w) => bloomHas(bits, `${level}${w}`, hashes);
    }
    [include, exclude] = [exclude.filter(passes), include];
  }
  return levels.join(" ");
}

// Particles and prefixes that open a past form listed whole ("abfuhr", "verbrachte").
const PAST_PREFIX =
  /^(?:ab|an|auf|aus|bei|ein|fest|fort|her|hin|los|mit|nach|vor|weg|zu|zurück|zusammen|dar|da|empor|nieder|über|unter|um|durch|wider|wieder|hinter|voll|bereit|stand|statt|teil|frei|fehl|kennen|fern|hoch|heim|offen|ent|ver|be|er|ge|zer|miss|emp|ob|inne|preis|kund|wahr|gleich|klein|krank|pleite|liegen|sitzen|stehen|übrig|wund|rum|raus|runter|rüber|drüber)/;

/**
 * The strong past stems the dictionary lists with the past endings (flag Z: "fuhr", "hielt",
 * "stand"), without the ones a particle or prefix opens ("abfuhr") and the weak ones in -te.
 */
function deriveGermanPastStems(dic: string): string[] {
  const past = new Set<string>();
  for (const line of dic.split("\n")) {
    const [word, flags = ""] = line.trim().split("/");
    // "verkannt", "überbracht": participles the flag also serves.
    const participle = /^(?:aber|be|er|ver|über)\p{Ll}+t$/u.test(word);
    if (flags.includes("Z") && /^\p{Ll}{2,}$/u.test(word) && !/te$/.test(word) && !participle) {
      past.add(word);
    }
  }
  // "dahinging", "zurückgab": a particle and a listed stem.
  const opened = (w: string) =>
    [...past].some(
      (p) => p.length >= 3 && p !== w && w.endsWith(p) && /[aeiouäöü]/.test(w.slice(0, -p.length)),
    );
  return [...past]
    .filter((w) => {
      const prefix = PAST_PREFIX.exec(w)?.[0];
      if (prefix && prefix.length < w.length && past.has(w.slice(prefix.length))) return false;
      return !opened(w);
    })
    .sort();
}

export function buildGermanLexicon(dic: string, aff: string): string {
  const { nounOnly, finite, infinitive, verbs, adjectives, lowercaseWords } = deriveGermanLexicon(
    dic,
    aff,
  );
  const nouns = new Set([...nounOnly, ...finite, ...infinitive]);
  // Prettier's layout, so the committed file passes format:check as written.
  const line = (name: string, value: string) => {
    const one = `export const ${name} = ${JSON.stringify(value)};`;
    return one.length <= 100 ? one : `export const ${name} =\n  ${JSON.stringify(value)};`;
  };
  return [
    "// Generated by bun scripts/generate-german-lexicon.ts from de_DE.dic/.aff. Do not edit.",
    "// Lowercased noun forms that are no other word when lowercase, or only a finite verb form",
    "// or an infinitive (a filter cascade, exact on the dictionary's lowercase words); which of",
    "// those are infinitives (a cascade); the finite ones (front-coded); then every infinitive",
    "// and every adjective lemma (Bloom filters).",
    line(
      "NOUN_CASCADE",
      cascade(
        [...nouns].sort(),
        lowercaseWords.filter((w) => !nouns.has(w)),
        NOUN_GOLOMB_BITS,
      ),
    ),
    line("INFINITIVE_CASCADE", cascade(infinitive, nounOnly, INFINITIVE_GOLOMB_BITS)),
    line("FINITE_NOUNS", frontCode(finite, 10, "")),
    line("VERB_BLOOM", bloom(verbs, VERB_BITS_PER_WORD)),
    line("ADJECTIVE_BLOOM", bloom(adjectives, ADJECTIVE_BITS_PER_WORD)),
    "// Strong past stems (front-coded).",
    line("PAST_STEMS", frontCode(deriveGermanPastStems(dic), 10, "")),
    "",
  ].join("\n");
}

// Determiners whose form shows one gender of a singular noun, or rules one out. "der", "die"
// and "den" also serve other cases and the plural, so "den" only counts before a noun that no
// dative plural spells and "die" only marks a form that may be plural.
const FEMININE_DETERMINERS = ["eine", "einer", "jede"];
const MASCULINE_DETERMINERS = ["einen", "jeden"];
const NEUTER_DETERMINERS = ["das", "dieses", "jedes"];
const NOT_FEMININE_DETERMINERS = [
  "ein",
  "einem",
  "eines",
  "dem",
  "des",
  "kein",
  "keinem",
  "keines",
];
// Masculine and neuter nouns in these endings are often their own plural ("der Lehrer",
// "die Lehrer"; "das Gebirge", "die Gebirge"), and a noun + s may be an -s plural
// ("des Autos", "die Autos").
const OWN_PLURAL = /(?:e|er|el|en|chen|lein)$/;
const CLEAR_MAJORITY = 20;

/**
 * "det word count" lines for every determiner + word bigram of the n-gram database the extension
 * ships (resources_js/de_DE/ngrams_db, lowercased).
 */
export function readGermanDeterminerBigrams(): string {
  const determiners = [
    ...FEMININE_DETERMINERS,
    ...MASCULINE_DETERMINERS,
    ...NEUTER_DETERMINERS,
    ...NOT_FEMININE_DETERMINERS,
    "den",
    "die",
  ];
  return ngramRows(
    GERMAN_LEXICON_SOURCES.trie,
    GERMAN_LEXICON_SOURCES.counts,
    (key) => key.startsWith("2 ") && determiners.includes(key.slice(2).split(" ")[0]),
  );
}

// Everyday nouns with one gender (authored), keyed like the generated lists: upper case where
// the form may also be its plural ("die Onkel"). Two-gender words ("See", "Kunde", "Junge", "Post")
// and "Uhr" ("um ein Uhr") stay out.
const AUTHORED_GENDERS: Record<string, string> = {
  f:
    "oma mama tante schwester nichte cousine enkelin nachbarin königin prinzessin kollegin " +
    "kundin ärztin adresse kasse nase angst liebe milch wurst suppe banane birne lampe " +
    "insel wolke sonne blume ente ziege kuh maus wäsche musik pizza geige schokolade torte " +
    "hose jacke treppe gabel schere seife socke pflanze bahn polizei feuerwehr oper trompete " +
    "flöte mathe physik chemie party hochzeit " +
    // Everyday nouns the n-gram counts are too thin for.
    "seite natur energie lage gewalt technik alternative technologie tat homepage linie ebene " +
    "effizienz breite sorge branche post kritik zentrale union hälfte transparenz kompetenz " +
    "industrie saison kategorie temperatur religion fotografie ziffer intelligenz expertise " +
    "anschrift bibel architektur absprache bühne pandemie box lehre palette summe theorie " +
    "präsenz akzeptanz masse not schau ästhetik existenz reichweite rente philosophie " +
    "konkurrenz harmonie recherche stufe pauschale klinik spitze rubrik szene schrift taufe " +
    "sünde apotheke republik toleranz fantasie strafe wolle gnade kita gegend kanzlei " +
    "batterie laune debatte mode schulter last website webseite software hardware app " +
    "firma familie frage antwort woche stunde minute sekunde nacht stadt welt kirche schule " +
    "straße wohnung küche tür wand decke tasche flasche tasse karte rechnung bank regierung " +
    "partei wahl politik wirtschaft umwelt luft erde küste grenze region gemeinde behörde " +
    "nachricht zeitung zeitschrift serie folge geschichte sprache kultur kunst farbe form " +
    "größe höhe länge tiefe menge zahl nummer liste tabelle grafik datei plattform methode " +
    "strategie idee meinung ansicht absicht aufgabe übung note klasse hand haut brust stimme " +
    "zunge lippe stirn niere leber lunge medizin tablette salbe spritze diät nahrung speise " +
    "mahlzeit soße sahne kartoffel tomate gurke zwiebel möhre karotte kirsche erdbeere orange " +
    "zitrone traube nuss bohne erbse linse nudel marmelade reise fahrt ankunft strecke " +
    "autobahn brücke ampel kreuzung kurve haltestelle station tankstelle garage miete kaution " +
    "etage terrasse wiese rose tulpe eiche tanne buche birke katze gans henne biene fliege " +
    "mücke ameise spinne schlange eule taube möwe ratte kröte schnecke muschel freude " +
    "hoffnung trauer wut ruhe stille pause feier geburt ehe person gruppe jugend zukunft " +
    "vergangenheit gegenwart dauer frist phase mitte nähe richtung ecke kante oberfläche " +
    "fläche kugel kiste dose schachtel tüte packung rolle scheibe platte schüssel pfanne " +
    "kanne vase kerze brille kette bluse mütze krawatte matratze couch kommode lieferung " +
    "bestellung ware marke qualität sicherheit gesundheit krankheit arbeit freizeit " +
    // Frequent n-gram words that show no gender (wave 10).
    "lust heimat justiz literatur eleganz mathematik armut ausdauer sehnsucht dynamik " +
    "distanz bibliothek optik disziplin figur logistik elektronik sauna relevanz panik " +
    "muskulatur abwehr schicht statistik konsequenz vernunft haft jagd reflexion bilanz " +
    "thematik moral diagnostik show formel leinwand konferenz demenz detektei logik " +
    "gestalt tastatur scham sportart ethik villa problematik tendenz informatik akupunktur " +
    "resonanz insolvenz liga klausel propaganda frucht burg norm furcht story jury " +
    "frequenz essenz konsistenz elektrik zahlungsart keramik instanz allianz signatur " +
    "hektik agenda versandart chronik fracht grammatik korrespondenz wurzel kammer zucht " +
    "eifersucht pracht pädagogik taktik schriftart romantik demut diktatur methodik flora " +
    "kosmetik ohnmacht staffel fauna kost fabrik symbolik heirat sklaverei provinz " +
    "assistenz mimik zensur bäckerei skala mechanik tugend akustik rhetorik konjunktur " +
    "pfarrei unschuld lobby druckerei klausur safari gymnastik dominanz fischerei genetik " +
    "obhut aura aussaat kluft prozedur inventur notiz metapher privatsphäre hitze hygiene " +
    "erkenntnis kenntnis kälte weile wirbelsäule gastronomie empathie magie toilette " +
    "psychologie arthrose vorfreude ehefrau domain",
  m:
    "bruder opa papa neffe nachbar held bär affe löwe hase funke friede buchstabe same wille " +
    "name glaube vorname nachname vogel fisch fluss regen schrank stift könig prinz fuß arm " +
    "hals apfel tee saft salat hunger durst hass plan mittag " +
    "euro stress bestandteil anschluss frieden anlass ansatz halt download hinblick herbst " +
    "diebstahl verzug einklang tarif transfer beschluss auftritt staub standard verdacht typ " +
    "streit betrug krebs schmuck kern schnitt lohn abschied nachwuchs tanz lieferant " +
    "durchschnitt ausblick komplex tag monat abend preis kauf verkauf " +
    "vertrag termin besuch gast freund kollege chef mensch mann sohn vater hund baum wald " +
    "berg weg platz park hof raum boden tisch stuhl sessel teppich vorhang ofen herd " +
    "kühlschrank bildschirm link zugang zugriff test versuch erfolg grund zweck sinn zweifel " +
    "wunsch traum gedanke eindruck rat hinweis vorschlag beitrag bericht brief text satz " +
    "begriff titel inhalt umfang bereich punkt schritt prozess ablauf zeitraum zeitpunkt " +
    "anfang beginn schluss ausgang eingang zug bus flug hafen bahnhof flughafen verkehr unfall " +
    "schaden lärm schnee wind sturm nebel himmel mond stern sommer winter frühling urlaub " +
    "ausflug spaß ärger schlaf kaffee wein reis zucker honig knopf ring schuh rock pullover " +
    "gürtel stoff kopf zahn mund bauch körper puls arzt patient schmerz husten schnupfen " +
    "schirm kalender schreibtisch " +
    // Frequent n-gram words that show no gender (wave 10).
    "absatz herr gegensatz alkohol bescheid onlineshop pkw abfall schatz chat präsident " +
    "vormittag auszug zoll humor roman podcast dollar trick ausfall umstand notar gesang " +
    "rauch abruf sonnenschein umtausch rost schwanz trost katalog wolf kontrast maßstab " +
    "anblick spruch gemeinderat papst chor schwung witz einbruch betriebsrat streik karton " +
    "moderator klient abbruch senat bruch haarausfall dampf anhang kandidat stall fakt " +
    "kanton therapeut sektor stadtrat zorn turm pfad journalist essig mord beirat " +
    "einspruch ehemann aushang bauherr investor stromausfall alarm durchfall pfeil draht " +
    "student ehrgeiz kamin blitz psalm schein helm sturz monitor ausschnitt mandant " +
    "protest kontinent singular stamm diesel profit frust teich schlaganfall kerl sack zoo " +
    "schrott dreck frost spezialist bräutigam aufzug spargel unsinn befehl planet " +
    "durchgang anreiz herzinfarkt hahn appell beleg paragraph korb aufbruch betreff " +
    "schlauch vulkan architekt akteur stier auftakt rundfunk deal hagel altar stau ozean " +
    "umschlag durchbruch ansporn ausbruch pavillon kakao takt kapitän zuspruch bart doktor " +
    "knoblauch pfeffer prophet bodenbelag neid hang landwirt friseur ruhm gruß innenhof " +
    "landrat verbund fleiß ingenieur hausrat detektiv hirsch mentor scheck anstoß unmut " +
    "fuhrpark kummer verfall anstrich index konsument anzug whirlpool anschlag knecht " +
    "aufschwung polizist asphalt bock direktor graf kompost kurier lieferschein elan " +
    "referent soldat sarg befund pokal bachelor chip leuchtturm käfig pastor krimi " +
    "zwilling busch einwand favorit aufruhr steg abdruck auslauf ast dozent kalk marmor " +
    "skandal anlauf ausspruch steinbruch pilot aufschlag entzug generator aufsatz abflug " +
    "schlamm umlauf dieb frosch nerv selbstmord lehm abgrund assistent kilometer " +
    "zentimeter millimeter quadratmeter sound mix salon tabak wortschatz ultraschall professor dank code",
  M:
    "onkel enkel kaiser haufen rücken käse laden politiker berater träger begleiter makler " +
    "koffer musiker lehrer schüler fahrer computer drucker rechner server browser keller " +
    "teller löffel schlüssel spiegel sessel kuchen kragen knochen muskel daumen finger",
  n:
    "schaf heft pech " +
    "prozent casino holz personal impressum jahrhundert level obst fach vitamin schloss gas " +
    "fett metall kapital silber futter heim haus kind auto fahrrad buch bild foto video spiel " +
    "lied wort jahr land dorf feld meer wasser feuer licht geld brot ei fleisch gemüse " +
    "getränk bier glas bett sofa regal dach büro krankenhaus hotel restaurant kino museum " +
    "konzert problem thema system programm projekt ziel ergebnis ereignis verhältnis gefühl " +
    "gesicht auge ohr herz blut bein haar kinn gehirn gesetz urteil gericht angebot produkt " +
    "geschäft konto datum material papier eisen gold öl salz mehl tier pferd schwein huhn " +
    "rind insekt boot schiff flugzeug motorrad taxi ticket paket geschenk spielzeug werkzeug " +
    "zelt handy smartphone tablet internet netz netzwerk passwort profil formular dokument " +
    "protokoll semester studium zeugnis " +
    // Frequent n-gram words that show no gender (wave 10).
    "wochenende vorfeld equipment labor talent quiz geschick kriterium fieber gehör kolleg " +
    "stichwort jubiläum königreich asyl mobbing augenmerk organ szenario stadion flair " +
    "album kilogramm unglück benzin experiment inventar limit ritual dasein laub atelier " +
    "magazin abwasser kloster kennwort interieur kilo schach kupfer kasino unkraut eiweiß " +
    "protein magnesium parkett orchester lexikon tattoo quartier siegel drama dilemma " +
    "meeting handicap exemplar sekretariat denkmal mikrofon gremium klinikum armband " +
    "platin laminat hirn jahrzehnt besteck horn horoskop schema diagramm implantat depot " +
    "investment timing visier sponsoring glied pulver saatgut mandat stativ lamm plenum " +
    "areal pseudonym referat dreieck terrain cockpit panorama gemüt polyester apartment " +
    "cello komma plakat aquarium porzellan beet heu gefäß mobiliar picknick territorium " +
    "duo gebäck kalzium nikotin gramm watt volt camping gedicht nest schwert manuskript " +
    "thermometer kompliment symptom abbild fass",
  N: "lager vorhaben kapitel gewerbe knie fenster zimmer gebäude theater mittel examen ufer muster",
};

const NUMBER_WORDS =
  /^(?:null|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)(?:er|ern)?$|(?:zig|ßig)(?:er|ern)$/;

/**
 * Noun genders the n-gram counts show, for lowercase forms that are only nouns. A form is
 * feminine when only feminine determiners precede it, masculine or neuter when only that
 * gender's and the shared ones do, "x" (masculine or neuter) when only the shared ones do; a
 * form seen with determiners of two genders is left out. Upper case marks a masculine or neuter
 * form that may also be a plural ("die Lehrer"): its ending allows it or "die" precedes it.
 */
export function buildGermanGender(dic: string, aff: string, bigrams: string): string {
  // Any infinitive is also a neuter noun ("das Wagen"): those forms are left out.
  // Noun forms that are also an uninflected word count too ("freund", "weg"), but not the ones
  // that are also adjective forms ("alter", "wert", which would name the gender of "Schalter"
  // and "Schwert" as compound heads) or numbers ("die Vier", "ein vierter").
  const { nounOnly, finite, infinitive, ambiguous, lowercaseWords, verbs } = deriveGermanLexicon(
    dic,
    aff,
  );
  const verbForms = new Set(finite);
  const nouns = new Set([
    ...nounOnly,
    ...finite,
    ...deriveNounsAfterArticles(dic, aff).filter((w) => !NUMBER_WORDS.test(w)),
  ]);
  // Words the dictionary lacks (compounds such as "kühlschrank"), unless they look like
  // adjective forms; the clear majority below must still show one gender.
  const listed = new Set([...lowercaseWords, ...infinitive, ...ambiguous, ...nouns]);
  const unlisted = (word: string) =>
    !listed.has(word) && /^[a-zäöüß]{4,}$/.test(word) && !ADJECTIVE_LIKE.test(word);
  const counts = new Map<string, Map<string, number>>();
  for (const line of bigrams.split("\n")) {
    const [det, word, count] = line.split(" ");
    if (!word || (!nouns.has(word) && !unlisted(word))) continue;
    let row = counts.get(word);
    if (!row) counts.set(word, (row = new Map()));
    row.set(det, Number(count));
  }
  const lists: Record<string, string[]> = { f: [], m: [], M: [], n: [], N: [], x: [], X: [] };
  for (const [word, row] of counts) {
    const sum = (dets: string[]) => dets.reduce((total, det) => total + (row.get(det) ?? 0), 0);
    // "jeden Tages", "dieses Jahres": a genitive, not the accusative or the neuter.
    const genitive = word.endsWith("s");
    const feminine = sum(FEMININE_DETERMINERS);
    const masculine =
      sum(genitive ? ["einen"] : MASCULINE_DETERMINERS) +
      (/(?:en|rn|ln|s)$/.test(word) ? 0 : sum(["den"]));
    // "das macht", "das würde": the pronoun before a verb form spelled like a noun.
    const verbForm = verbForms.has(word);
    const neuter =
      sum(genitive ? ["das"] : NEUTER_DETERMINERS) - (verbForm ? (row.get("das") ?? 0) : 0);
    const notFeminine = sum(NOT_FEMININE_DETERMINERS);
    // One gender's evidence must outweigh the others' twentyfold: "auf der einen Seite" puts
    // an adjective "einen" before a feminine noun now and then.
    const clear = (own: number, others: number) => own > 0 && own >= others * CLEAR_MAJORITY;
    let gender: string;
    if (clear(feminine, masculine + neuter + notFeminine)) gender = "f";
    else if (clear(masculine, feminine + neuter)) gender = "m";
    else if (clear(neuter, feminine + masculine)) gender = "n";
    else if (clear(notFeminine, feminine) && !masculine && !neuter) gender = "x";
    else continue;
    const sPlural = word.endsWith("s") && nouns.has(word.slice(0, -1));
    const plural = gender !== "f" && (OWN_PLURAL.test(word) || sPlural || row.has("die"));
    lists[plural ? gender.toUpperCase() : gender].push(word);
  }
  // "der Kinder": the genitive plural of a neuter noun in -er, not a masculine; "Spieler"
  // (spielen) and "Eigentümer" name a person.
  const neuter = new Set([...lists.n, ...lists.N]);
  const infinitives = new Set(verbs);
  for (const key of Object.keys(lists)) {
    lists[key] = lists[key].filter((word) => {
      const stem = /^(\p{Ll}{3,})er$/u.exec(word)?.[1];
      if (!stem || /tüm$/.test(stem)) return true;
      const plain = stem.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u");
      const stems = [stem, plain];
      return !stems.some((s) => neuter.has(s)) || stems.some((s) => infinitives.has(`${s}en`));
    });
  }
  // Common nouns the n-gram counts are too thin for, added where they show no gender.
  const known = new Set(Object.values(lists).flat());
  for (const [key, words] of Object.entries(AUTHORED_GENDERS)) {
    for (const word of words.split(" ")) if (!known.has(word)) lists[key].push(word);
  }
  const line = (name: string, value: string) => {
    const one = `export const ${name} = ${JSON.stringify(value)};`;
    return one.length <= 100 ? one : `export const ${name} =\n  ${JSON.stringify(value)};`;
  };
  return [
    "// Generated by bun scripts/generate-german-lexicon.ts from de_DE.dic/.aff and the de_DE",
    "// n-gram database. Do not edit.",
    '// Noun forms by the gender their determiners show, front-coded: "x" is masculine or neuter;',
    "// upper case, the form may also be a plural.",
    line("GENDERS", Object.keys(lists).join("")),
    ...Object.values(lists).map((words, i) => line(`GENDER_${i}`, frontCode(words.sort(), 10, ""))),
    "",
  ].join("\n");
}

/** Every word, bigram and trigram of the n-gram database as "w1 [w2 [w3]] count" lines (lowercased). */
export function readGermanNgrams(): string {
  return ngramRows(
    GERMAN_LEXICON_SOURCES.trie,
    GERMAN_LEXICON_SOURCES.counts,
    (key) => key.startsWith("1 ") || key.startsWith("2 ") || key.startsWith("3 "),
  );
}

// Determiners that never stand alone as a pronoun, so the word after them heads or opens a noun
// phrase; "der", "die", "das", "dem", "den" and dies-words also are pronouns ("die gut passen").
const EIN_STEMS = ["ein", "kein", "mein", "dein", "sein", "ihr", "unser", "eur"];
const NOUN_DETERMINERS = [
  "des",
  "im",
  "am",
  "zum",
  "zur",
  "vom",
  "beim",
  "ins",
  ...EIN_STEMS.flatMap((stem) => ["e", "en", "em", "er", "es"].map((end) => stem + end)),
  "ein",
  "kein",
  "mein",
  "dein",
  "unser",
  "euer",
];
const DETERMINER_STEMS =
  /^(?:ein|kein|mein|dein|sein|ihr|unser|eu|dies|jen|jed|welch|manch|solch|all|d)$/;
const PRONOUN_DETERMINERS = ["der", "die", "das", "den", "dem", "diese", "dieser", "dieses"];
/** Whether an adjective with this ending may follow the determiner (weak or mixed ending). */
function endingFits(det: string, ending: string): boolean {
  const bare = /^(?:ein|kein|mein|dein|sein|ihr|unser|euer)$/.test(det);
  if (ending === "er" || ending === "es") return bare;
  if (ending === "en") return det !== "ins" && det !== "das" && !bare;
  if (ending === "e") return /^(?:d(?:er|ie|as)|dies(?:e|er|es)|\p{Ll}+e)$/u.test(det) && !bare;
  return false;
}
// Words after a noun that no attributive adjective is followed by: a genitive or a new phrase,
// a preposition, a conjunction, a finite verb.
const AFTER_NOUN = new Set(
  (
    "der des die das dem den ein eine einer eines von vom auf für mit im in an am bei zu zur " +
    "zum über unter vor nach aus gegen und oder ist sind war waren wird werden hat haben hatte " +
    "kann können muss soll gilt geht steht liegt bleibt"
  ).split(" "),
);
// "die gut passen", "die hinter der Tür": after a pronoun the word may be an adverb or a
// preposition, so only a genitive after it counts.
const AFTER_PRONOUN = new Set("des eines meines seines ihres unseres dieses".split(" "));
// Noun-phrase evidence must outweigh the adjective or adverb uses threefold, over at least
// this many counted n-grams (the database drops n-grams seen fewer than about 60 times).
const NOUN_MAJORITY = 3;
const MIN_EVIDENCE = 60;
// A form in -e seen only after feminine or plural determiners, this often, is a feminine or
// plural noun ("die Spitze", "der Wüste"): an adjective in -e also follows "das".
const FEMININE_EVIDENCE = 150;

/**
 * Lowercase noun forms whose only other reading is an adjective form ("alter", "spitze", "wert")
 * and that the n-gram counts show as nouns after a determiner far more often than as adjectives
 * or adverbs: a determiner whose adjective ending the form cannot have ("im alter", "ein wertes"),
 * an article or preposition after "determiner + form" ("den wert des"), only feminine or plural
 * determiners before a form in -e. Adjective evidence: an adjective after the form ("gut
 * gemachte", an adverb) or a noun after "determiner + form" ("eine kleine stadt").
 */
function deriveNounsOverAdjectives(dic: string, aff: string, ngrams: string) {
  const { adjectiveNouns, nounOnly, finite, adjectives } = deriveGermanLexicon(dic, aff);
  const candidates = new Set(adjectiveNouns);
  const nouns = new Set([...nounOnly, ...finite]);
  const lemmas = new Set(adjectives);
  // Determiners inflect like adjectives ("dieser", "ihres") and are listed as such.
  const adjectiveForm = (w: string) => {
    const m = /^(\p{Ll}+?)(?:e|en|er|es|em)$/u.exec(w);
    if (!m || DETERMINER_STEMS.test(m[1])) return false;
    return lemmas.has(m[1]) || lemmas.has(`${m[1]}e`) || /^ge\p{Ll}+t$/u.test(m[1]);
  };
  const nounDets = new Set(NOUN_DETERMINERS);
  const pronounDets = new Set(PRONOUN_DETERMINERS);
  const noun = new Map<string, number>();
  const adjective = new Map<string, number>();
  const det = new Map<string, Map<string, number>>();
  const add = (map: Map<string, number>, word: string, count: number) =>
    map.set(word, (map.get(word) ?? 0) + count);
  for (const line of ngrams.split("\n")) {
    const parts = line.split(" ");
    const count = Number(parts.pop());
    if (parts.length === 2) {
      const [a, b] = parts;
      if (candidates.has(a) && adjectiveForm(b)) add(adjective, a, count);
      if (candidates.has(b) && (nounDets.has(a) || pronounDets.has(a))) {
        let row = det.get(b);
        if (!row) det.set(b, (row = new Map()));
        row.set(a, count);
      }
    } else if (parts.length === 3) {
      const [a, b, c] = parts;
      if (!candidates.has(b) || !(nounDets.has(a) || pronounDets.has(a))) continue;
      if (nouns.has(c) || adjectiveForm(c)) add(adjective, b, count);
      else if ((nounDets.has(a) ? AFTER_NOUN : AFTER_PRONOUN).has(c)) add(noun, b, count);
    }
  }
  for (const [word, row] of det) {
    const ending = /(?:en|em|er|es|e)$/.exec(word)?.[0] ?? "";
    // An uninflected form after any determiner may be an adverb ("ein gut gemachter").
    if (!ending) continue;
    for (const [d, count] of row)
      if (nounDets.has(d) && !endingFits(d, ending)) add(noun, word, count);
    if (ending !== "e") continue;
    const neuter = ["das", "dieses", "ein", "kein"].some((d) => row.has(d));
    const feminine = neuter ? 0 : [...row.values()].reduce((sum, count) => sum + count, 0);
    if (feminine >= FEMININE_EVIDENCE) add(noun, word, feminine);
  }
  return [...candidates]
    .filter((w) => {
      const n = noun.get(w) ?? 0;
      return n >= MIN_EVIDENCE && n >= NOUN_MAJORITY * (adjective.get(w) ?? 0);
    })
    .sort();
}

// Verbs whose one object is a dative ("helfen", "danken") or an accusative ("fragen",
// "besuchen"), with no second object that would let the other case in ("ich gebe dem Mann den
// Ball"); verbs that also take a free dative ("ich kaufe dem Kind ein Eis") are left out.
// Each line: the infinitive, then any strong forms; the weak endings are spelled from the
// stem, and only forms the dictionary knows are kept (authored).
const DATIVE_VERBS = [
  "helfen hilf hilfst hilft half halfst halfen halft",
  "gefallen gefällst gefällt gefiel gefielst gefielen gefielt",
  "widersprechen widersprich widersprichst widerspricht widersprach widersprachen",
  "danken",
  "antworten",
  "gehorchen",
  "vertrauen",
  "misstrauen",
  "gratulieren",
  "begegnen",
  "schaden",
  "nützen",
  "ähneln",
  "drohen",
  "folgen",
  "applaudieren",
  "schmeicheln",
  "kondolieren",
  "gehören",
];
const ACCUSATIVE_VERBS = [
  "kennen kannte kanntest kannten kanntet",
  "treffen triff triffst trifft traf trafst trafen",
  "fragen",
  "besuchen",
  "lieben",
  "hassen",
  "verwünschen",
  "beantworten",
  "vermissen",
  "begleiten",
  "beobachten",
  "unterstützen",
  "kritisieren",
  "loben",
  "beleidigen",
  "verletzen",
  "heiraten",
  "küssen",
  "umarmen",
  "bewundern",
  "respektieren",
  "enttäuschen",
  "ignorieren",
  "verteidigen",
  "betreuen",
  "informieren",
  "verklagen",
  "anlügen",
];
const DATIVE_OBJECTS = ["ihm", "mir", "dir", "einem", "dem"];
const ACCUSATIVE_OBJECTS = ["ihn", "mich", "dich", "einen"];

/** The finite forms of a verb line that the dictionary spells. */
function verbForms(line: string, words: Set<string>): string[] {
  const [infinitive, ...strong] = line.split(" ");
  const stem = /[lr]n$/.test(infinitive) ? infinitive.slice(0, -1) : infinitive.slice(0, -2);
  const short = stem.replace(/e([lr])$/, "$1");
  const endings = ["e", "st", "est", "t", "et", "te", "test", "ten", "tet", "ete", "eten"];
  const forms = [infinitive, ...strong, `${short}e`, ...endings.map((end) => stem + end)];
  return [...new Set(forms)].filter((form) => words.has(form));
}

/**
 * The verb forms of each case table, each verb kept only when the bigram counts do not show it
 * more often before the other case's pronouns ("hilft dir", not "hilft dich").
 */
function deriveGovernedVerbs(dic: string, aff: string, ngrams: string) {
  const words = new Set(deriveGermanLexicon(dic, aff).lowercaseWords);
  const counts = new Map<string, number>();
  for (const line of ngrams.split("\n")) {
    const parts = line.split(" ");
    if (parts.length === 3) counts.set(`${parts[0]} ${parts[1]}`, Number(parts[2]));
  }
  const evidence = (forms: string[], objects: string[]) =>
    forms.reduce(
      (sum, form) => sum + objects.reduce((s, o) => s + (counts.get(`${form} ${o}`) ?? 0), 0),
      0,
    );
  const table = (lines: string[], own: string[], other: string[]) =>
    lines
      .map((line) => verbForms(line, words))
      .filter((forms) => evidence(forms, other) <= evidence(forms, own))
      .flat()
      .sort();
  return {
    dative: table(DATIVE_VERBS, DATIVE_OBJECTS, ACCUSATIVE_OBJECTS),
    accusative: table(ACCUSATIVE_VERBS, ACCUSATIVE_OBJECTS, DATIVE_OBJECTS),
  };
}

// Uninflected words that also follow an article inside a longer phrase or as a pronoun ("ein
// über Jahre gewachsenes", "ein paar", "ein mehr oder weniger", "ein extra für ihn"): their noun
// forms are left to other checks (authored).
const NOT_NOUNS_AFTER_ARTICLES = new Set(
  (
    "abseits abwärts alias allein angesichts anfangs anti au aufwärts auseinander außen auswärts " +
    "bei binnen blanko brutto eingangs einwärts extra falls flugs gegen gen hoch hüben innen längs " +
    "links mal mangels mehr mit mittels namens neben netto nicht online paar piano quer rechts " +
    "rings samt schon selbst sofort sonder super teils trotz türkis vor vorab wegen wett wieder " +
    "zusammen zwecks zwischen über allzweck"
  ).split(" "),
);

/**
 * Noun forms that are also an uninflected word ("angst", "ehe", "kraft", "morgen") and read as
 * the noun after an article that is no pronoun ("keine angst", "seine ehe", "am morgen").
 */
function deriveNounsAfterArticles(dic: string, aff: string): string[] {
  return deriveGermanLexicon(dic, aff).otherNouns.filter((w) => !NOT_NOUNS_AFTER_ARTICLES.has(w));
}

// The n-gram counts a word must show after determiners, and the share of its counts that is,
// to be read as a noun the dictionary lacks.
const NGRAM_NOUN_EVIDENCE = 100;
const NGRAM_NOUN_SHARE = 0.5;
// Endings of adjective and participle forms, which follow a determiner too ("die
// umweltfreundlichste", "die eingereichten").
const ADJECTIVE_LIKE = /(?:lich|ig|isch|bar|sam|haft|los|voll|end|t|st)(?:e|en|er|es|em)?$/;

/**
 * Lowercase words the dictionary lists in no form (it builds compounds such as "vorstellung",
 * "kühlschrank" from parts) that the n-gram counts show mostly right after a determiner
 * ("die vorstellung", "im kühlschrank"): nouns.
 */
function deriveNgramNouns(dic: string, aff: string, ngrams: string): string[] {
  const { lowercaseWords, nounOnly, finite, infinitive, ambiguous } = deriveGermanLexicon(dic, aff);
  const known = new Set([...lowercaseWords, ...nounOnly, ...finite, ...infinitive, ...ambiguous]);
  const determiners = new Set([...NOUN_DETERMINERS, ...PRONOUN_DETERMINERS, "dieser", "diesen"]);
  const afterDeterminer = new Map<string, number>();
  const total = new Map<string, number>();
  for (const line of ngrams.split("\n")) {
    const parts = line.split(" ");
    if (parts.length !== 3) continue;
    const [a, b, count] = parts;
    if (known.has(b) || b.length < 4 || !/^[a-zäöüß]+$/.test(b) || ADJECTIVE_LIKE.test(b)) {
      continue;
    }
    total.set(b, (total.get(b) ?? 0) + Number(count));
    if (determiners.has(a)) afterDeterminer.set(b, (afterDeterminer.get(b) ?? 0) + Number(count));
  }
  return [...afterDeterminer]
    .filter(([w, n]) => n >= NGRAM_NOUN_EVIDENCE && n >= NGRAM_NOUN_SHARE * total.get(w)!)
    .map(([w]) => w)
    .sort();
}

// Noun forms that also spell an ending of other words ("kultur|elle", "lern|ende",
// "mein|test"), so no compound ends in them here.
const SUFFIX_HEADS = new Set(
  "elle ellen ende enden endes ender endem ente enten test tests".split(" "),
);
// Particles that open verbs and verb-made nouns rather than compounds ("Vorschau", "Abbau").
const COMPOUND_PARTICLES = new Set(
  (
    "ab an auf aus bei da durch ein empor fort gegen her hin hinter mit nach neben ob über um " +
    "unter vor weg wider zu zurück zusammen"
  ).split(" "),
);
// How often the n-gram counts must show a word for it to join the supplement: rarer compounds
// cost more bytes than the findings they add.
const SUPPLEMENT_MIN_COUNT = 20;
/** "abendessen|i": a supplement noun form and its reading (n noun, f finite, i infinitive). */
type SupplementEntry = `${string}|${"n" | "f" | "i"}`;

/**
 * Noun forms the dictionary lacks: words of the n-gram counts that split into a noun form the
 * dictionary lists (the head, which gives the reading) after a word that may open a compound —
 * a compound opener the dictionary marks, a noun, an adjective, a verb stem, or such a compound
 * itself ("fußball|spieler", "spät|schicht", "abfahrts|zeiten"); and the words that the counts
 * show mostly right after a determiner (deriveNgramNouns).
 */
export function deriveSupplementNouns(dic: string, aff: string, ngrams: string): SupplementEntry[] {
  const { lowercaseWords, nounOnly, finite, infinitive, ambiguous, otherNouns, adjectives, verbs } =
    deriveGermanLexicon(dic, aff);
  const known = new Set([...lowercaseWords, ...nounOnly, ...finite, ...infinitive, ...ambiguous]);
  const readings = new Map<string, "n" | "f" | "i">([
    ...nounOnly.map((w) => [w, "n"] as const),
    ...finite.map((w) => [w, "f"] as const),
    ...infinitive.map((w) => [w, "i"] as const),
  ]);
  const adjectiveSet = new Set(adjectives);
  const verbSet = new Set(verbs);
  // Entries the dictionary marks as compound openers ("Alt/hij", "Abfahrts/hij").
  const openers = new Set<string>();
  for (const line of dic.split("\n")) {
    const [word, flags = ""] = line.trim().split("/");
    if (/^[A-ZÄÖÜ]/.test(word) && flags.includes("j")) openers.add(word.toLowerCase());
  }
  const opens = (first: string, depth: number): boolean => {
    if (first.length < 3 || COMPOUND_PARTICLES.has(first)) return false;
    if (openers.has(first)) return true;
    for (const stem of new Set([first, first.replace(/(?:e?s|e?n)$/, "")])) {
      if (stem.length < 3) continue;
      if (readings.has(stem) || adjectiveSet.has(stem)) return true;
      if (verbSet.has(`${stem}en`) || verbSet.has(`${stem}n`)) return true;
    }
    return depth > 0 && split(first, depth - 1) !== null;
  };
  // "Jahres|zeit", "Wochen|ende": a head that is also an uninflected word or an ending, after
  // a noun with a linking -s, -es, -n or -en.
  const plainHeads = new Set([...otherNouns, "ende", "enden"]);
  const linkedNoun = (first: string) =>
    ["s", "es", "n", "en"].some(
      (end) =>
        first.endsWith(end) &&
        first.length - end.length >= 3 &&
        readings.has(first.slice(0, -end.length)),
    );
  const split = (word: string, depth: number) => {
    for (let i = 3; i <= word.length - 3; i++) {
      const head = word.slice(i);
      const first = word.slice(0, i);
      if (plainHeads.has(head) && linkedNoun(first)) return "n";
      const reading = readings.get(head);
      if (reading && !SUFFIX_HEADS.has(head) && opens(first, depth)) return reading;
    }
    return null;
  };
  const entries = new Map<string, "n" | "f" | "i">();
  for (const line of ngrams.split("\n")) {
    const parts = line.split(" ");
    const word = parts[0];
    if (parts.length !== 2 || Number(parts[1]) < SUPPLEMENT_MIN_COUNT) continue;
    if (!/^[a-zäöüß]{6,}$/.test(word) || known.has(word)) continue;
    const reading = split(word, 1);
    if (reading) entries.set(word, reading);
  }
  for (const word of deriveNgramNouns(dic, aff, ngrams))
    if (!entries.has(word)) entries.set(word, "n");
  return [...entries].map(([w, r]) => `${w}|${r}` as SupplementEntry).sort();
}

export function buildGermanUsage(dic: string, aff: string, ngrams: string): string {
  const { dative, accusative } = deriveGovernedVerbs(dic, aff, ngrams);
  const overAdjectives = new Set(deriveNounsOverAdjectives(dic, aff, ngrams));
  const { adjectiveNouns: either, otherNouns } = deriveGermanLexicon(dic, aff);
  const adjectiveNouns = either.filter((w) => !overAdjectives.has(w));
  const line = (name: string, value: string) => {
    const one = `export const ${name} = ${JSON.stringify(value)};`;
    return one.length <= 100 ? one : `export const ${name} =\n  ${JSON.stringify(value)};`;
  };
  return [
    "// Generated by bun scripts/generate-german-lexicon.ts from de_DE.dic/.aff and the de_DE",
    "// n-gram database. Do not edit.",
    "// Front-coded: noun forms that are also adjective or uninflected forms but read as nouns",
    "// after a determiner; finite forms of verbs whose object is a dative, then an accusative.",
    line(
      "NOUNS_OVER_ADJECTIVES",
      frontCode(
        [
          ...deriveNounsOverAdjectives(dic, aff, ngrams),
          ...deriveNounsAfterArticles(dic, aff),
        ].sort(),
        10,
        "",
      ),
    ),
    "// The other noun forms that are also adjective forms (wunder, defekt).",
    line("ADJECTIVE_NOUNS", frontCode(adjectiveNouns, 10, "")),
    "// The other noun forms that are also an adverb, preposition or numeral (angst, morgen).",
    line(
      "OTHER_NOUNS",
      frontCode(
        otherNouns.filter((w) => !overAdjectives.has(w)),
        10,
        "",
      ),
    ),
    "// Noun forms the dictionary lacks, with their readings (a word graph, review/wordGraph.ts).",
    line("SUPPLEMENT_NOUNS", encodeWordGraph(deriveSupplementNouns(dic, aff, ngrams))),
    line("DATIVE_VERBS", frontCode(dative, 10, "")),
    line("ACCUSATIVE_VERBS", frontCode(accusative, 10, "")),
    "",
  ].join("\n");
}

if (import.meta.main) {
  const [dic, aff] = await Promise.all([
    readFile(GERMAN_LEXICON_SOURCES.dic, "utf8"),
    readFile(GERMAN_LEXICON_SOURCES.aff, "utf8"),
  ]);
  const source = buildGermanLexicon(dic, aff);
  await writeFile(GERMAN_LEXICON_SOURCES.out, source);
  console.log(`wrote ${GERMAN_LEXICON_SOURCES.out} (${source.length} bytes)`);
  const bigrams = readGermanDeterminerBigrams();
  const gender = buildGermanGender(dic, aff, bigrams);
  await writeFile(GERMAN_LEXICON_SOURCES.gender, gender);
  console.log(`wrote ${GERMAN_LEXICON_SOURCES.gender} (${gender.length} bytes)`);
  const ngrams = readGermanNgrams();
  const usage = buildGermanUsage(dic, aff, ngrams);
  await writeFile(GERMAN_LEXICON_SOURCES.usage, usage);
  console.log(`wrote ${GERMAN_LEXICON_SOURCES.usage} (${usage.length} bytes)`);
}
