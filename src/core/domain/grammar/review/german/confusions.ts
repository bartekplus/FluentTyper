import { frameMatches, SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  deumlaut,
  germanAdjective,
  germanGender,
  germanInfinitive,
  germanPastInfinitives,
  germanVerbLike,
} from "./germanLexicon";
import { determinerFits } from "./articleGender";
import { anyCase as any, ci, gated as re, isGerman, likeTyped, VERB_GOVERNORS } from "./shared";
import { LOOKALIKE_FRAMES } from "./lookalikes";
import { IDIOM_FRAMES } from "./idiomFrames";
import { germanInfinitiveOf, isAuxiliary } from "./verbAgreement";

// Real words in a frame where only their look-alike fits: "ihr seit" (seid), "seid gestern"
// (seit), "ich freue mir" (mich), "mir dem Bus" (mit), ", das er kommt" (dass), "in denn
// Garten" (den). Each frame is narrowed to contexts where the typed word cannot be meant.

const W = "\\p{L}+";
// ci and any take either case of the first letter only: "\p{Lu}" in a frame keeps meaning a capital.

// Adjectives that comment on a "dass" clause after them: "Schön, dass du da bist".
const THAT_ADJECTIVES = new Set(
  (
    "gut schön super toll schade klasse prima wichtig komisch seltsam klar logisch " +
    "merkwürdig erstaunlich interessant traurig spannend praktisch blöd ärgerlich"
  ).split(" "),
);

// Adjectives with a dative object, which "mir" may open as an attribute (authored).
const DATIVE_ADJECTIVES =
  /(?:bekannt|vertraut|fremd|lieb|wichtig|verfügbar|zugänglich|nah|ähnlich|treu|dankbar|egal|bewusst|verständlich|peinlich|unheimlich|angenehm|unangenehm|zugetan|gewogen|überlegen|unterlegen|gleich|teuer|wert|zugeteilt|zugewiesen|anvertraut|geschenkt|gegeben|empfohlen)$/;

const MONTHS = "Januar|Februar|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember";

// A ship earlier in the clause, up to 60 characters before the word.
const SHIP_BEFORE = new RegExp(
  `(?:Schiff|Schiffe|Boot|Boote|U-Boot|Ölplattform|Armada|Flotte|Fregatte|Kreuzer|Tanker|Frachter|Zerstörer|Kriegsschiff)${E}[^.!?;\\n]{0,60}${S}$`,
  "u",
);

// Machines and vehicles one starts (authored).
const STARTED_THINGS =
  /(?<!\p{L})(?:Motor|Motoren|Auto|Autos|Wagen|Maschine|Maschinen|Rechner|Computer|PC|Laptop|Server|Generator|Fahrzeug|Fahrzeuge|Motorrad|Roller|Traktor|Rasenmäher|Triebwerk|Triebwerke|Turbine|Anlage|Aggregat|Kettensäge|Programm|Gerät|Geräte|Boot|Lkw|Bus)(?!\p{L})/u;

export type Frame = {
  regex: RegExp;
  fix: string | ((m: RegExpExecArray) => string | string[] | null);
  /** The fix sets its own case ("Berg ab" → "bergab"); else it takes the typed capital. */
  ownCase?: true;
};

// Countries and regions named with their article: "die Türkei", "der Vatikan", "die USA".
const COUNTRIES: Readonly<Record<string, "f" | "m" | "p" | "i">> = {
  Türkei: "f",
  Schweiz: "f",
  Ukraine: "f",
  Slowakei: "f",
  Mongolei: "f",
  Tschechei: "f",
  Vatikan: "m",
  Jemen: "m",
  Libanon: "m",
  Sudan: "m",
  Tschad: "m",
  Kongo: "m",
  Niederlande: "p",
  USA: "p",
  VAE: "p",
  Bahamas: "i",
  Malediven: "i",
  Seychellen: "i",
  Philippinen: "i",
};
/** The preposition and article a country needs after "aus", "in", "nach" or "von". */
function withArticle(prep: string, country: string): string[] | null {
  const kind = COUNTRIES[country];
  const p = prep.toLowerCase();
  const into = { f: "in die", m: "in den", p: "in die", i: "auf die" }[kind];
  const at = { f: "in der", m: "im", p: "in den", i: "auf den" }[kind];
  const from = { f: "aus der", m: "aus dem", p: "aus den", i: "von den" }[kind];
  const of = { f: "von der", m: "vom", p: "von den", i: "von den" }[kind];
  const forms = p === "aus" ? [from] : p === "nach" ? [into] : p === "von" ? [of] : [at, into];
  return forms.map((f) => `${f} ${country}`);
}
// Verbs whose perfect takes "sein": motion to a place, change of state, happening.
const SEIN_PARTICIPLES =
  "gegangen gekommen angekommen abgereist eingeschlafen gestorben verstorben verschwunden " +
  "gescheitert aufgefallen eingefallen erschienen entstanden davongekommen geblieben passiert " +
  "geschehen gewesen geworden aufgewacht aufgestanden gewachsen gestiegen gesunken gelungen " +
  "misslungen ertrunken gereist gerannt zurückgekehrt umgekommen ausgewandert eingewandert " +
  "eingetroffen hingefallen gestolpert explodiert";
const SEIN_FOR: Readonly<Record<string, string>> = {
  hat: "ist",
  hast: "bist",
  haben: "sind",
  habt: "seid",
  hatte: "war",
  hatten: "waren",
  hattest: "warst",
  hätte: "wäre",
  hätten: "wären",
};

// Words that say when: "seit gestern", "seit zwei Tagen", "seit dem letzten Mittwoch".
const TIME_WORDS =
  "gestern vorgestern wann langem kurzem jeher damals neuestem Jahren Monaten Wochen Tagen " +
  "Stunden Minuten Sekunden Jahrzehnten Jahrhunderten Ewigkeiten Generationen geraumer " +
  "einigen wenigen vielen mehreren letztem letzter über ca etwa Anfang Ende Mitte Beginn " +
  "Bestehen Gründung zwei drei vier fünf sechs sieben acht neun zehn elf zwölf zwanzig hundert";
const TIME_NOUN =
  "Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Jahr|Monat|Tag|Morgen|" +
  "Abend|Beginn|Anfang|Ende|Sommer|Winter|Frühling|Herbst|Krieg|Unfall|Umzug|Start|Woche|" +
  "Zeit|Nacht|Stunde|Saison|Kindheit|Jugend|Geburt|Schule|Studium";
const DATIVE_DETS =
  "dem einem einer meinem meiner deinem deiner seinem seiner ihrem ihrer unserem unserer " +
  "eurem eurer diesem dieser jedem jeder keinem keiner";
// Verbs that are reflexive with the accusative ("ich freue mich", never "mir").
const ACCUSATIVE_REFLEXIVE_1SG =
  "freue freu bedanke beeile kümmere entscheide irre schäme wundere ärgere beschwere erhole " +
  "verspäte konzentriere interessiere gewöhne verabschiede entschuldige verliebe frage";
const ACCUSATIVE_REFLEXIVE_FORMS =
  "freuen bedanken beeilen kümmern entscheiden irren schämen wundern ärgern beschweren " +
  "erholen verspäten konzentrieren verlieben verabschieden entschuldigen vertan geirrt " +
  "gefreut bedankt beeilt gekümmert geschämt gewundert geärgert beschwert erholt verspätet " +
  "verliebt verabschiedet";
// The clause verbs a "dass" clause follows ("Ich weiß, das er kommt").
const DASS_VERBS =
  "weiß wusste wussten wüsste weißt wissen sagt sagte sagten gesagt sage sagen schreibt schrieb " +
  "hofften glaubten dachten merkten " +
  "geschrieben hoffe hoffen hofft glaube glauben glaubt denke denkt dachte gedacht finde " +
  "findet meine meint heißt bedeutet klar sicher sehe sieht merke merkt zeigt zeigte " +
  "erwarte fürchte behauptet behauptete gewährleistet versprochen vergessen gehört bemerkt " +
  "erfahren verstanden möglich wichtig schade interessant überzeugt beklagt höre hören hört " +
  "bedeutet folgt fest beschwert erstaunt bewusst froh stolz besorgt gemerkt erkannt " +
  "festgestellt bewiesen Folge dessen";

/** A clause with its finite verb last and none before: "dem Mann ein Zahn fehlt". */
function subjectClause(clause: string): boolean {
  const tokens = clause.trim().split(/\s+/);
  const last = tokens.at(-1) ?? "";
  if (tokens.slice(0, -1).some((t) => isAuxiliary(t))) return false;
  if (isAuxiliary(last)) return true;
  const stem = /^(\p{Ll}+?)(?:e|t|et|en|te|ten)$/u.exec(last)?.[1];
  return !!stem && germanInfinitive(`${stem}en`);
}

const RANGE_NAMES =
  "Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Januar|Februar|März|April|Mai|" +
  "Juni|Juli|August|September|Oktober|November|Dezember";
const DETERMINERS =
  "der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|mein\\p{Ll}*|dein\\p{Ll}*|" +
  "sein\\p{Ll}*|ihr\\p{Ll}*|unser\\p{Ll}*|euer|eure\\p{Ll}*|dies\\p{Ll}*|jene\\p{Ll}*|alle\\p{Ll}*";
const AUXILIARIES = "hat|habe|haben|hatte|hatten|ist|sind|war|waren|wird|werden|wurde|wurden";
// A past participle: "gezwungen", "belohnt", "verlassen".
const PARTICIPLE = "(?:ge|be|ver|er|ent|zer)\\p{Ll}{2,}(?:t|en)";

// Adverbs after "da" + preposition that show the pronominal adverb: "da nach nicht" (danach).
/** A verb form: listed, regular present or past of a known verb, or a strong past. */
function verbForm(word: string): boolean {
  if (germanVerbLike(word) || isAuxiliary(word) || germanInfinitiveOf(word)) return true;
  if (germanPastInfinitives(word).length > 0) return true;
  const stem = /^(\p{Ll}{2,}?)(?:e|st|t|est|et|te|ten|test|tet)$/u.exec(word)?.[1];
  return !!stem && (germanInfinitive(`${stem}en`) || germanInfinitive(`${stem}n`));
}
const DA_ADVERBS = new Set(
  "nicht auch noch schon gar kaum nie nur immer sofort bitte doch ja selbst wohl eben erst bald".split(
    " ",
  ),
);
const DECONTRACTED: Readonly<Record<string, string>> = {
  zum: "zu",
  zur: "zu",
  am: "an",
  ans: "an",
  ins: "in",
  im: "in",
  vom: "von",
  beim: "bei",
  aufs: "auf",
  fürs: "für",
  übers: "über",
  ums: "um",
  durchs: "durch",
};

const FRAMES: readonly Frame[] = [
  // "ihr seit zufrieden" → seid; a time word after it is the preposition ("bei ihr seit 2010").
  {
    regex: re(
      `(?<=(?<![\\p{L}])${ci("ihr")}${S})(?<target>seit)${E}(?!${S}(?:${TIME_WORDS.replace(/ /g, "|")}|${DATIVE_DETS.replace(/ /g, "|")}|den|\\p{N}|\\p{Lu}))`,
    ),
    fix: "seid",
  },
  // "wenn ihr zufrieden seit." → seid: "seit" never closes a clause.
  { regex: re(`(?<target>seit)(?=[ \\t]*[.!?,;])`), fix: "seid" },
  // "Seit ihr schon fertig?", "Seit bitte leise!"
  {
    regex: re(
      `(?<=(?:^|[.!?:]\\s{1,8}|\\n)[„"]?)(?<target>Seit)(?=${S}(?:ihr${S}[^,.!?\\n]*\\?|(?:bitte|mir|uns|ruhig|leise|vorsichtig|wachsam|still|willkommen|nett|brav|froh|dankbar|gespannt|bereit|gegrüßt|nicht|doch|bloß|mal)${E}[^,\\n]*[!.]))`,
    ),
    fix: "Seid",
  },
  // "seid gestern", "seid zwei Tagen", "Seid dem letzten Mittwoch" → seit (no "ihr" around).
  {
    regex: re(
      `(?=${ci("seid")}${E})(?<!(?<![\\p{L}])[iI]hr${S}(?:\\p{L}{1,40}${S}){0,2})(?<target>${ci("seid")})${E}(?!${S}ihr${E})(?=${S}(?:(?:${TIME_WORDS.replace(/ /g, "|")}|ein${S}paar|mehr${S}als|\\p{N}+)${E}|(?:dem|einem|diesem|dieser|der|einer|letztem|letzter|letzten|vergangenem|vergangenen|vorigem|vorigen)${S}(?:\\p{Ll}+${S})?(?:${TIME_NOUN})${E}))`,
    ),
    fix: "seit",
  },
  // "Seid du weg bist" → Seit: "seid" takes no subject but "ihr" ("Seid du und Maria …" is
  // one).
  {
    regex: re(
      `(?<target>${ci("seid")})(?=${S}(?:ich|du|er|es|wir|man)${E}(?![ \\t]*(?:,|und${E}|oder${E})))`,
    ),
    fix: (m) => (m.groups!.target[0] === "S" ? "Seit" : "seit"),
  },
  // "mir dem Bus", "mir einer gewissen Routine" → mit; "Mir wem redest du?"
  {
    regex: re(
      `(?<target>${ci("mir")})(?=${S}(?:${DATIVE_DETS.replace(/ dieser| jeder| keiner/g, "").replace(/ /g, "|")})${S}(?:\\p{Ll}+${S}){0,2}\\p{Lu})`,
    ),
    fix: "mit",
  },
  { regex: re(`(?<=(?:^|[.!?]\\s{1,8}))(?<target>Mir)(?=${S}wem${E})`), fix: "Mit" },
  // "tut mit leid", "gefällt mit gut", "Sag mit bitte", "Kann mit jemand" → mir.
  {
    regex: re(
      `(?:${any("tut tat täte")})${S}(?<target>mit)(?=${S}(?:\\p{Ll}+${S})?leid${E})|` +
        `(?:${any("gefällt gefiel fällt fiel")})${S}(?<t2>mit)(?=${S}(?:gut|sehr|nicht|besser|schon|auch|auf|ein)${E}|[ \\t]*[.!?,])|` +
        `(?:${any("sag sagt gib gebt zeig zeigt schick schickt hilf helft bring bringt erklär erklärt")})${S}(?<t3>mit)(?=${S}bitte${E})|` +
        `(?:${any("kann könnte")})${S}(?<t4>mit)(?=${S}(?:bitte${S})?jemand${E})`,
    ),
    fix: "mir",
  },
  // "ich freue mir", "bedanke ich mir" → mich.
  {
    regex: re(
      `(?:${ACCUSATIVE_REFLEXIVE_1SG.replace(/ /g, "|")})${S}(?:ich${S})?(?<target>mir)${E}`,
    ),
    fix: "mich",
  },
  // "Ich würde mir sehr freuen", "Ich habe mir vertan", "möchte mir bei Ihnen bedanken".
  {
    regex: re(
      `(?<![\\p{L}](?:bei|mit|zu|von|an|vor|nach|aus|außer|gegenüber)${S})(?<target>mir)${E}(?=(?:${S}(?:sehr|so|riesig|total|wirklich|echt|herzlich|herzlichst|wahnsinnig|schon|auch|nicht|leider|immer|darum|darüber|dafür|bei|Ihnen|dir|euch|dafür|vielmals|nochmals|gleich))*${S}(?:${ACCUSATIVE_REFLEXIVE_FORMS.replace(/ /g, "|")})${E}[ \\t]*(?:[.!?,;]|$))`,
    ),
    fix: "mich",
  },
  // "mich Sorgen", "mich Bescheid", "mich erlaubt", "hat mich geholfen" → mir.
  {
    regex: re(
      `(?<!(?<![\\p{L}])(?:${any("lass lasst lassen ließ ließen über für gegen um durch ohne an auf")})${S})(?<target>mich)(?=${S}(?:Sorgen|Bescheid|erlaubt|erlauben|geholfen|helfen|sagen|gesagt|gedankt|vorstellen,${S}dass|wünschen,${S}dass)${E})`,
    ),
    fix: "mir",
  },
  {
    regex: re(`(?:${any("wünsche wünscht wünschte")})${S}(?<target>mich)(?=,${S}dass${E})`),
    fix: "mir",
  },
  // "mir unterstützt", "mir (bitte) zurückrufen" → mich.
  {
    regex: re(`(?<target>mir)(?=${S}(?:bitte${S})?(?:unterstützt|zurückrufen|anrufen)${E})`),
    fix: "mich",
  },
  // "Ich weiß, das er kommt" → dass; "Das er kommt, weiß ich." → Dass.
  // "Ich glaube kaum, das das reicht", "Nicht, das ich wüsste", "Sie wusste das er kommt".
  {
    regex: re(
      `(?<=(?:(?:${DASS_VERBS.replace(/ /g, "|")})(?:${S}(?:nicht|kaum|auch|schon|nur|sehr|genau|wohl))?|Nicht),${S})(?<target>das)(?=${S}(?:ich|du|er|sie|es|wir|man|alle|das|der|die|den|dem)${E})|` +
        // Without the comma: "überzeugt das er", "sicher das der Zug" → "überzeugt, dass".
        `(?<t2>(?<verb>${DASS_VERBS.replace(/ /g, "|")})${S}das)(?=${S}(?:(?:ich|du|er|sie|es|wir|man)${S}\\p{Ll}|(?:der|die|den|dem|ein|eine|einen|mein\\p{Ll}*|dein\\p{Ll}*|sein\\p{Ll}*|unser\\p{Ll}*)${S}\\p{Lu}))`,
    ),
    fix: (m) => {
      if (!m.groups!.t2) return "dass";
      // "sagt das die Startseite zur Zeit": no verb at the end, so "das" is the object.
      const rest = m.input.slice(m.index + m[0].length, m.index + m[0].length + 160);
      const clause = rest.split(/[.,;:!?()\n]/)[0].trim();
      return /(?:^|\s)\p{Ll}\p{L}*$/u.test(clause) ? `${m.groups!.verb}, dass` : null;
    },
  },
  {
    regex: re(
      `(?<=(?:^|[.!?]\\s{1,8}|\\n))(?<target>Das)(?=${S}(?:ich|du|er|sie|es|wir|man)${S}\\p{Ll})`,
    ),
    fix: "Dass",
  },
  // "Das dem Mann ein Zahn fehlt, ist bedauerlich": a subject clause, its verb last.
  {
    regex: re(
      `(?<=(?:^|[.!?]\\s{1,8}|\\n))(?<target>Das)(?=${S}(?:dem|der|den|die|ein\\p{Ll}*|mein\\p{Ll}*|dein\\p{Ll}*|sein\\p{Ll}*|ihr\\p{Ll}*|unser\\p{Ll}*|alle|alles|jemand|niemand|hier|so)${S}(?<clause>[^.!?\\n,]*\\p{Ll}),${S}(?:ist|war|wäre|freut|ärgert|stört|wundert|zeigt|bedeutet|macht|liegt|hat|gefällt|beweist|spricht|überrascht)${E})`,
    ),
    fix: (m) => (subjectClause(m.groups!.clause) ? "Dass" : null),
  },
  // "Gut das du da bist" → "Gut, dass": an adjective that opens a sentence before a clause.
  {
    regex: re(
      `(?<=(?:^|[.!?]\\s{1,8}|\\n))(?<target>(?<adj>(?:(?:${any("sehr wirklich echt ganz")})${S})?(?:${any("gut schön super toll schade klasse prima wichtig komisch seltsam klar logisch merkwürdig erstaunlich interessant")}))${S}das)(?=${S}(?!(?:ist|war|wäre|wird|kann|muss|soll|hat|hatte|sei|bleibt)${E})(?:nicht|jetzt|erst|selbst|fast|endlich|\\p{Ll}+(?<!t))${E}[^.!?\\n,]*\\p{Ll}[ \\t]*[.!?…])`,
    ),
    fix: (m) => `${m.groups!.adj}, dass`,
  },
  // "Toll das Menschen helfen", "einen Hinweis das Meilen gutgeschrieben werden": "das" before
  // a noun it cannot be the article of (a plural, or a masculine or feminine noun), after an
  // adjective or a noun it cannot refer back to, opens a "dass" clause that ends in its verb.
  {
    regex: re(
      `(?<target>(?<head>\\p{L}+)${S}das)(?=${S}(?<next>\\p{Lu}\\p{Ll}+)${E}(?<rest>[^.!?\\n,;:]{0,80}\\p{Ll})[ \\t]*(?:[.!?,;:]|$))`,
    ),
    fix: (m) => {
      const { head, next, rest } = m.groups!;
      // "das Menschen", "das Autos": a plural form of a known noun, or a masculine or feminine.
      const noun = germanGender(next);
      const pluralForm =
        (!noun || noun.plural) &&
        ["en", "n", "e", "er", "s"].some(
          (end) =>
            next.endsWith(end) &&
            next.length - end.length >= 3 &&
            germanGender(next.slice(0, -end.length)) !== null,
        );
      if (!pluralForm && (!noun || noun.gender === "n" || noun.gender === "x")) return null;
      // The clause needs a verb at its end: "toll das Menschen helfen".
      const last = /\p{Ll}+$/u.exec(rest)![0];
      if (
        ![germanVerbLike, germanInfinitive, isAuxiliary].some((f) => f(last)) &&
        !/\p{Ll}{2}t$/u.test(last)
      )
        return null;
      const before = m.input.slice(Math.max(0, m.index - 40), m.index);
      if (THAT_ADJECTIVES.has(head.toLowerCase())) {
        // "Wirklich toll das …", "Das ist super das …": a predicative adjective.
        const adjective = /^\p{Ll}/u.test(head) || /(?:^|[.!?\n])[ \t]*$/u.test(before);
        const placed =
          /(?:^|[.!?\n])[ \t]*(?:(?:sehr|wirklich|echt|ganz|so)[ \t]+)?$|(?:ist|war|wäre|finde|fand)[ \t]+(?:(?:sehr|wirklich|echt|ganz|so|doch|ja)[ \t]+)?$/iu.test(
            before,
          );
        return adjective && placed ? `${head}, dass` : null;
      }
      // "den Hinweis das …": a masculine or feminine noun "das" cannot refer back to.
      const own = germanGender(head);
      if (!own || own.gender === "n" || own.gender === "x" || own.plural) return null;
      if (
        !/(?<!\p{L})(?:d(?:er|ie|en|em)|k?eine[mnr]?|(?:mein|dein|sein|ihr|unser)e[mnr]?)[ \t]+$/iu.test(
          before,
        )
      )
        return null;
      return `${head}, dass`;
    },
  },
  // "immer wider", "ist wider da" → wieder; "wider Willen", "wider die Natur" stay.
  {
    regex: re(
      `(?<!${ci("für")}${S}und${S})(?<target>wider)(?=${S}(?!(?:den|die|das|dem|des|ein|eine|einen|einem|eines|einer|jede|jeden|jedes|jeder|alle|allen|alles|aller|besseres|besseren|bessere|kein\\p{Ll}*|mein\\p{Ll}*|dein\\p{Ll}*|sein\\p{Ll}*|ihr\\p{Ll}*|unser\\p{Ll}*|eur\\p{Ll}*|diese\\p{Ll}*|jegliche\\p{Ll}*|solche\\p{Ll}*)${E})\\p{Ll}+${E}(?!${S}\\p{Lu})|[ \\t]*(?:[.!?,;]|$))`,
    ),
    // "Das spiegelt sich wider", "Der Ruf hallte wider": the particle of a separable verb.
    fix: (m) =>
      /(?<!\p{L})(?:spiegel|hall|kling|klang|schein|schien)\p{Ll}*[^.!?;\n]*$/u.test(
        m.input.slice(Math.max(0, m.index - 80), m.index),
      )
        ? null
        : "wieder",
  },
  // "wieder Erwarten" → wider; "wieder erwarten wir" is the verb.
  { regex: re(`(?<target>${ci("wieder")})(?=${S}Erwarten${E})`), fix: "wider" },
  // "in denn Garten" → den; "Was ist den los?", "mehr den je", "es sei den" → denn.
  {
    regex: re(
      `(?<=(?:${any("in an auf für durch gegen um ohne über unter vor hinter neben zwischen")})${S})(?<target>denn)(?=${S}(?:\\p{Ll}+${S})?\\p{Lu})`,
    ),
    fix: "den",
  },
  {
    regex: re(
      `(?<=(?:\\p{L}er|[mM]ehr)${S})(?<target>den)(?=${S}je${E})|(?<=${ci("es")}${S}sei${S})(?<t2>den)${E}|` +
        `(?<target3>den)(?=${S}(?:los|eigentlich|überhaupt|bitte|nun|jetzt|genau|wirklich)${E}[^.!\\n]*\\?)`,
    ),
    fix: "denn",
  },
  {
    regex: re(
      `(?<=(?:^|[.!?]\\s{1,8}|\\n))(?<target>Den)(?=${S}(?:ich|du|er|wir|ihr|man)${S}\\p{Ll})`,
    ),
    fix: "Denn",
  },
  // "Den das macht keinen Sinn", "Den die können warten": a demonstrative subject and its verb
  // after a sentence-opening "den" ("Den das Kind sah" has a noun, not a verb).
  {
    regex: re(
      `(?<=(?:^|[.!?]\\s{1,8}|\\n))(?<target>Den)(?=${S}(?:das|die|diese|dieser|dieses)${S}(?<verb>\\p{Ll}+(?:t|en))${E}(?!${S}\\p{Lu}))`,
    ),
    fix: (m) => (germanAdjective(m.groups!.verb.replace(/e?n$/, "")) ? null : "Denn"),
  },
  // "einen schonen Tag", "Die schone Frau" → schön-; "ganz schon teuer" → schön.
  {
    regex: re(
      `(?<=[\\p{L}]${S})(?<target>schon(?:e|en|er|es|em))(?=${S}(?:\\p{Ll}+(?:e|en|er|es|em)${S})?\\p{Lu})`,
    ),
    fix: (m) => m.groups!.target.replace("schon", "schön"),
  },
  {
    regex: re(
      `(?<=${ci("ganz")}${S})(?<target>schon)(?=${S}\\p{Ll}+${E}(?!${S}(?:wieder|da|fertig)))`,
    ),
    fix: "schön",
  },
  // "korrekt zu seien" → sein; "gut zu seien Haustieren" → seinen.
  {
    regex: re(
      `(?<!und${S})(?<=zu${S})(?<target>seien)${E}(?!${S}(?:sie|wir|die|es|alle)${E})(?<noun>${S}\\p{Lu})?`,
    ),
    fix: (m) => (m.groups!.noun ? "seinen" : "sein"),
  },
  // "vor etwas zwei Jahren", "etwas 24 bis 25 Millionen" → etwa.
  {
    regex: re(
      `(?<target>${ci("etwas")})(?=${S}(?:\\p{N}+(?:[.,]\\p{N}+)?|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|zwanzig|hundert|tausend)${S}(?:bis|Prozent|%|Jahre|Jahren|Monate|Monaten|Wochen|Tage|Tagen|Stunden|Minuten|Millionen|Milliarden|Euro|Meter|Kilometer|km|Leute|Menschen|Personen|Mal)${E})`,
    ),
    fix: "etwa",
  },
  // "Ja schneller …, desto" → Je; "aller 3 Monate" → alle; "immer wen ich" → wenn.
  {
    regex: re(
      `(?<=(?:^|[.!?]\\s{1,8}|\\n))(?<target>Ja)(?=${S}\\p{Ll}+er${E}[^.!?\\n]*,${S}(?:desto|umso)${E})`,
    ),
    fix: "Je",
  },
  {
    regex: re(
      `(?<target>aller)(?=${S}(?:\\p{N}+|zwei|drei|vier|fünf|sechs|acht|zehn|zwölf)${S}(?:Jahre|Monate|Wochen|Tage|Stunden|Minuten)${E})`,
    ),
    fix: "alle",
  },
  {
    regex: re(
      `(?<=(?:${any("immer selbst")}|${ci("jedes")}${S}Mal)${S})(?<target>wen)(?=${S}(?:ich|du|er|sie|es|wir|ihr|man)${E})`,
    ),
    fix: "wenn",
  },
  // "aus Türkei", "in USA", "nach Niederlande" → with the article; "Made in USA" stays.
  {
    regex: re(
      `(?<!Made${S})(?<target>(?<prep>${any("aus in nach von")})${S}(?<country>${Object.keys(COUNTRIES).join("|")}))${E}`,
    ),
    fix: (m) => withArticle(m.groups!.prep, m.groups!.country),
  },
  // "Sie hat gegangen", "Die Gäste haben heute angekommen" → ist / sind.
  {
    regex: re(
      `(?<target>${any("hat hast haben habt hatte hatten hattest hätte hätten habe")})${E}(?=(?:${S}[^\\s,.;:!?]+){0,5}?${S}(?:${SEIN_PARTICIPLES.replace(/ /g, "|")})[ \\t]*(?:[.,;:!?]|$))`,
    ),
    fix: (m) => {
      const typed = m.groups!.target.toLowerCase();
      // Words in between that change the structure: an infinitive's "zu", another verb.
      const rest = m.input
        .slice(m.index + m[0].length, m.index + m[0].length + 80)
        .split(/[.,;:!?]/)[0];
      if (
        /(?<!\p{L})(?:zu|lassen|sehen|hören|worden|wird|werden|und|oder|aber|sondern|bin|bist|ist|sind|seid|war|waren|wäre|sei)(?!\p{L})/u.test(
          rest,
        )
      )
        return null;
      if (/(?<!\p{L})zu\s+$/u.test(m.input.slice(Math.max(0, m.index - 4), m.index))) return null;
      // "nachdem ich angefangen habe in …": the end of the clause before (missing comma).
      if (
        /(?<!\p{L})\p{Ll}{4,}(?:en|t)\s+$/u.test(m.input.slice(Math.max(0, m.index - 20), m.index))
      )
        return null;
      if (typed !== "habe") return SEIN_FOR[typed];
      // "Ich habe … angekommen" → bin; reported speech "Er habe … " → sei.
      const before = m.input.slice(Math.max(0, m.index - 6), m.index);
      return /(?<!\p{L})ich\s*$/iu.test(before) || /^\s+ich(?!\p{L})/iu.test(rest) ? "bin" : "sei";
    },
  },
  // "seine eigne Meinung" → eigene: "eignen" (to suit) takes no article before a noun.
  {
    regex: re(
      `(?:${any("der die das den dem des ein eine einen einem einer eines kein keine keinen keinem keiner mein meine meinen meinem meiner sein seine seinen seinem seiner ihre ihren ihrem ihrer unser unsere unseren unserem dein deine deinen deinem eure euren zwei drei vier")}|\\p{N}+)${S}(?<target>eign(?:e|en|er|es|em))(?=${S}\\p{Lu})`,
    ),
    fix: (m) => m.groups!.target.replace(/^eign/, "eigen"),
  },
  // "Ich kamm dir helfen" → kann or kam: "Kamm" (comb) is a noun, so lowercase it is the verb.
  {
    regex: re(`(?<noun>\\p{L}+)${S}(?<target>kamm)(?=${S}\\p{Ll})`),
    fix: (m) =>
      /^(?:der|den|dem|des|einen|einem|eines|ein|kein|mein|dein|sein)$/i.test(m.groups!.noun)
        ? null
        : ["kann", "kam"],
  },
  // "besser wie du", "klüger wie Computer" → als: a comparative takes "als" ("so gut wie" stays;
  // "sauber wie", "teuer wie": lemmas in -er are no comparatives).
  {
    regex: re(`(?<noun>\\p{Ll}+er|anders)${S}(?<target>wie)${E}`),
    fix: (m) => {
      const word = m.groups!.noun;
      const before = m.input.slice(Math.max(0, m.index - 12), m.index);
      if (/(?:^|[^\p{L}])(?:so|ein|eine|einer)\s+$/u.test(before)) return null;
      // "im gleichen Maße besser wie sie", "genauso … wie": a comparison of equals.
      const clause = m.input
        .slice(Math.max(0, m.index - 60), m.index)
        .split(/[.!?;,]/)
        .at(-1)!;
      if (/(?:^|[^\p{L}])(?:genauso|ebenso|gleiche[mnrs]?|gleich|so)(?!\p{L})/u.test(clause))
        return null;
      // "weiter wie bisher", "später wie sein Vater", "eher wie": adverbs of time and manner.
      if (
        /^(?:weiter|später|früher|eher|öfter|immer|wieder|aber|oder|über|unter|hinter|wider)$/.test(
          word,
        )
      )
        return null;
      if (/^(?:besser|lieber|mehr|weniger|anders)$/.test(word)) return "als";
      const stem = word.slice(0, -2);
      const plain = deumlaut(stem);
      // "klüger" (klug), "größer" (groß): an umlaut the lemma lacks marks the comparative.
      const comparative =
        (plain !== stem && germanAdjective(plain)) ||
        (!germanAdjective(word) &&
          [stem, `${stem}e`].some((s) => s.length >= 2 && germanAdjective(s)));
      return comparative ? "als" : null;
    },
  },
  // "sowohl Fahrrad und auch Auto" → als auch.
  {
    regex: re(`(?<target>(?:und|oder)${S}auch)${E}`),
    fix: (m) => {
      const before = m.input.slice(Math.max(0, m.index - 80), m.index);
      const at = before.search(/(?<!\p{L})sowohl(?!\p{L})(?![^]*(?<!\p{L})als(?!\p{L}))/u);
      return at >= 0 && !/[.!?;]/.test(before.slice(at)) ? "als auch" : null;
    },
  },
  // "Ich bin fasst fertig", "in fasst allen Fällen" → fast: no subject before the verb.
  {
    regex: re(
      `(?:${any("bin bist ist sind seid war waren wäre wären hätte hätten habe hat hatte hatten in zu mit von bei für")})${S}(?<target>fasst)${E}`,
    ),
    fix: "fast",
  },
  // "Ich brauche diene Hilfe" → deine: "diene" (I serve) needs "ich" before a noun object.
  {
    regex: re(`(?<noun>\\p{Ll}+)${S}(?<target>diene)(?=${S}\\p{Lu})`),
    fix: (m) => (/^(?:ich|und|oder|gern|gerne)$/.test(m.groups!.noun) ? null : "deine"),
  },
  // "Wohin gehst du hin?" → the direction is said twice.
  {
    regex: re(
      `(?:[Ww]ohin|[Ww]oher)${S}\\p{Ll}+(?:${S}\\p{Ll}+){0,3}?(?<target>[ \\t]+(?:hin|her))(?=[ \\t]*\\?)`,
    ),
    fix: "",
  },
  // "ein ökonomischer Gottesdienst", "eine ökonomische Trauerfeier" → ökumenisch: a service of
  // several churches.
  {
    regex: re(
      `(?<target>[Öö]konomisch(?<end>e[mnrs]?)?)(?=${S}(?=\\p{Lu})\\p{L}{0,20}?(?:[Gg]ottesdienst|[Aa]ndacht|[Tt]rauerfeier|[Gg]ebet|[Kk]irchentag|[Ss]egnung)\\p{Ll}*${E})|` +
        // An ecological funeral or prayer may be meant; an ecological service hardly.
        `(?<t2>[Öö]kologisch(?<end2>e[mnrs]?)?)(?=${S}(?=\\p{Lu})\\p{L}{0,20}?[Gg]ottesdienst\\p{Ll}*${E})`,
    ),
    fix: (m) => `ökumenisch${m.groups!.end ?? m.groups!.end2 ?? ""}`,
  },
  // "die Tür abgeschossen", "der verschossene Umschlag" → schließen: a door, window or lid
  // is shut, not shot.
  {
    regex: re(
      `(?<=(?:[Tt]ür|[Tt]üren|[Ff]enster|[Ss]chublade|[Ss]chubladen|[Ss]chrank|[Kk]iste|[Dd]eckel|[Uu]mschlag|[Bb]riefumschlag|[Tt]resor|[Ss]afe|[Pp]forte|[Ff]ensterladen)(?:${S}(?:nicht|schon|noch|wieder|nie|gut|richtig|sofort|endlich|luftdicht|fest|ab|zu)){0,3}${S})(?<target>(?:ab|ver|zu)?geschossen|schießen|schoss|schossen)${E}|` +
        `(?<t2>[Vv]erschossene[mnrs]?)(?=${S}(?:Tür|Briefumschlag|Umschlag|Schublade|Kiste|Behälter|Raum|Schrank)${E})`,
    ),
    fix: (m) =>
      // "durchs Fenster geschossen", "auf die Tür geschossen": shot through or at it.
      /(?<!\p{L})(?:durch|durchs|aus|auf|aufs|gegen|in|ins|an|ans|über|unter|zwischen|hinter)\s+(?:\p{Ll}+\s+){0,3}\p{Lu}\p{Ll}+(?:\s+\p{Ll}+){0,3}\s*$/u.test(
        m.input.slice(Math.max(0, m.index - 60), m.index),
      )
        ? null
        : (m.groups!.target ?? m.groups!.t2)
            .replace(/schossen/, "schlossen")
            .replace(/schießen/, "schließen")
            .replace(/^schoss$/, "schloss"),
  },
  // "Wenn du mich in das Geheimnis einweist" → einweihst: one is let into a secret.
  {
    regex: re(
      `(?=einweis|eingewiesen)(?<=${S}in${S}(?:\\p{L}{1,20}${S}){0,2}(?:Geheimnis|Geheimnisse|Plan|Pläne|Vorhaben|Mysterium|Mysterien)(?:${S}\\p{L}{1,20}){0,3}${S})(?<target>einweis(?:t|e|en|test|tet)|eingewiesen)${E}`,
    ),
    fix: (m) =>
      ({
        einweist: "einweihst",
        einweise: "einweihe",
        einweisen: "einweihen",
        einweistest: "einweihtest",
        einweistet: "einweihtet",
        eingewiesen: "eingeweiht",
      })[m.groups!.target] ?? null,
  },
  // "Das U-Boot wurde versengt" → versenkt: a ship is sunk. The ship is looked for in code,
  // on the 80 characters before: a 60-character window in a lookbehind is slow without the JIT.
  {
    regex: re(`(?<target>versengt(?:e|en)?)${E}`),
    fix: (m) =>
      SHIP_BEFORE.test(m.input.slice(Math.max(0, m.index - 80), m.index)) &&
      // "Das Feuer hat die Planke am Schiff versengt": something burned it.
      !/(?:Feuer|Flamme|Hitze|Sonne|Glut|Brand|Blitz|Funken|Fackel|Lötlampe)/u.test(
        m.input
          .slice(Math.max(0, m.index - 80), m.index)
          .split(/[.!?;\n]/)
          .at(-1)! + m.input.slice(m.index, m.index + 40).split(/[.!?;\n]/)[0],
      )
        ? m.groups!.target.replace("versengt", "versenkt")
        : null,
  },
  // "Was machst du den?", "Wer seid ihr den?" → denn: the particle before the question mark.
  {
    regex: re(`(?<=(?:du|ihr|Sie|er|sie|es|man|wir|ich)${S})(?<target>den)(?=[ \\t]*\\?)`),
    // Only in a w-question whose object is the w-word or whose verb is "sein": "Kennst du
    // den?", "Wo bekomme ich den?" ask about something.
    fix: (m) => {
      const question =
        /(?:^|[.!?\n]\s*)(Was|Wer|Wen|Wie|Wo|Wann|Warum|Wieso|Weshalb|Woher|Wohin)\s+(\p{Ll}+)[^.!?\n]*$/u.exec(
          m.input.slice(Math.max(0, m.index - 80), m.index),
        );
      if (!question) return null;
      const copula = /^(?:bin|bist|ist|sind|seid|war|warst|wart|waren|wäre|wärst)$/.test(
        question[2],
      );
      return /^(?:Was|Wer|Wen)$/.test(question[1]) || copula ? "denn" : null;
    },
  },
  // "zu Verfügung stehen", "zu Genüge", "zu Schule gehen" → zur: feminine nouns these fixed
  // phrases take with the article ("von Schule zu Schule" keeps "zu").
  {
    regex: re(
      `(?<target>zu)(?<![\\p{L}](?:Schule|Arbeit)${S}zu)(?=${S}(?:Verfügung|Genüge|Kenntnis|Rede|Wehr|Schule(?=${S}(?:geh|ging|gegangen|komm|kam|gekommen|fahr|fuhr|gefahren|bring|bracht|gebracht))|Arbeit(?=${S}(?:geh|ging|gegangen|fahr|fuhr|gefahren|komm|kam|gekommen))|Welt(?=${S}(?:komm|kam|gekommen|bring|bracht|gebracht)))${E})`,
    ),
    fix: "zur",
  },
  // "Hast du ihm das Buch gegen?", "dass ihnen wenig gegen wurde" → gegeben: the preposition
  // cannot close a question or stand before the auxiliary that ends the clause.
  {
    regex: re(
      `(?<target>gegen)(?<=(?:\\p{Lu}\\p{Ll}{1,30}|das|es|wenig|viel|alles|etwas)${S}gegen)(?=[ \\t]*\\?|${S}(?:hast|hat|habe|haben|habt|hatte|hatten|wurde|wurden|werden|worden|wird)${E})`,
    ),
    fix: (m) =>
      // A form of "haben" or "werden" in the sentence ("Hast du …", "dass … wurde").
      /(?<!\p{L})(?:hast|hat|habe|haben|habt|hatte|hatten|wurde|wurden|werden|worden|wird)(?!\p{L})/iu.test(
        m.input.slice(Math.max(0, m.index - 80), m.index + 30),
      )
        ? "gegeben"
        : null,
  },
  // "Er war stehts bemüht" → stets; "wie stehts?", "stehts gut?" are "steht's" with the
  // apostrophe left out, which is allowed.
  {
    regex: re(`(?<target>[Ss]tehts)${E}`),
    fix: (m) => {
      const before = m.input.slice(Math.max(0, m.index - 12), m.index);
      const after = m.input.slice(m.index + 6, m.index + 60);
      if (/(?:^|[.!?:\n„"]|wie|so)[ \t]*$/iu.test(before) || /^[^.!?\n]*\?/.test(after))
        return null;
      return "stets";
    },
  },
  // "Er starte mich an", "Die Frauen starten uns an" → starrte, starrten: "anstarten" is no
  // verb, so a form of "starten" with "an" closing the clause is one of "anstarren".
  {
    regex: re(
      `(?<target>[Ss]tart(?:e|en|et|ete|eten))(?=(?:${S}\\p{L}+){1,4}${S}an[ \\t]*[.!?,;])`,
    ),
    // "den Motor an": a machine is started (colloquial "anstarten"), not stared at.
    fix: (m) =>
      STARTED_THINGS.test(m.input.slice(m.index, m.index + 80).split(/[.!?,;\n]/)[0])
        ? null
        : ({
            starte: "starrte",
            starten: "starrten",
            startet: "starrt",
            startete: "starrte",
            starteten: "starrten",
          }[m.groups!.target.toLowerCase()] ?? null),
  },
  // "biss Ende Juli", "von 5 biss 6 Uhr" → bis: the past of "beißen" before a time or number.
  {
    regex: re(
      `(?<target>[Bb]iss)(?=${S}(?:\\d|Ende|Anfang|Mitte|[Aa]uf${S}[Ww]eiteres|zum|zur|morgen|übermorgen|heute|später|bald|dahin|jetzt|nächste[mnrs]?|Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|${MONTHS}|März))`,
    ),
    fix: "bis",
  },
  // "Die Idee hat sich bewehrt" → bewährt: "sich bewähren" proves itself; "bewehren" arms
  // or reinforces something.
  {
    regex: re(
      `(?<target>bewehr(?:t|en|te|ten|e|st))(?<=(?:sich|mich|dich|uns|euch)(?:${S}(?:nicht|immer|gut|sehr|schon|bereits|bestens|wieder|stets|auch)){0,3}${S}bewehr\\p{Ll}{0,3})${E}|(?<t2>bewehr(?:t|en|te|ten))(?=${S}sich${E})`,
    ),
    fix: (m) => (m.groups!.target ?? m.groups!.t2).replace("bewehr", "bewähr"),
  },
  // "in dem ersten Schrieben", "im schrieben vom 3.6." → Schreiben: the letter, after an
  // article that no subject pronoun is.
  {
    regex: re(
      `(?<target>[Ss]chrieben)(?<=(?:[Ii]m|[Dd]em|[Ee]inem|[Ii]hrem|[Ss]einem|[Mm]einem|[Uu]nserem|[Dd]iesem|[Dd]ieses|[Ii]hr|[Ss]ein|[Mm]ein|[Ee]in)(?:${S}\\p{Ll}{1,30}(?:e|en|em))?${S}[Ss]chrieben)${E}`,
    ),
    fix: "Schreiben",
  },
  // "mit von der Partei", "eine Partei Schach" → Partie: the game, not the political party.
  {
    regex: re(
      `(?<target>Partei)(?<=mit${S}von${S}der${S}Partei)(?=[ \\t]*[.!?,;]|${S}(?:sein|ist|bin|bist|sind|seid|war|waren|wäre)${E})|(?<t2>Partei)(?=${S}(?:Schach|Skat|Billard|Tennis|Golf|Poker|Dame|Mühle|Tischtennis)${E})`,
    ),
    fix: "Partie",
  },
  // "Nachdem Frühstück wurde ich müde", "Seitdem Kampf bin ich müde" → Nach dem, Seit dem: a
  // masculine or neuter noun with no article, then the main clause's verb and more words (a
  // subordinate clause ends with its verb: "Nachdem Geld fehlte, …").
  {
    regex: re(
      `(?<target>[Nn]achdem|[Ss]eitdem|[Aa]ußerdem)(?=${S}(?<noun>\\p{Lu}\\p{Ll}{2,})(?:${S}\\p{Ll}+${S}\\p{L}|[ \\t]*\\?))`,
    ),
    fix: (m) => {
      const { target, noun } = m.groups!;
      const reading = germanGender(noun);
      if (!reading || reading.gender === "f" || (reading.plural && /[^n]$/.test(noun))) return null;
      const verb = /^[ \t]+\p{Lu}\p{Ll}+[ \t]+(\p{Ll}+)/u.exec(
        m.input.slice(m.index + target.length),
      )?.[1];
      if (
        verb &&
        !isAuxiliary(verb) &&
        !germanVerbLike(verb) &&
        !germanPastInfinitives(verb).length &&
        !/\p{Ll}{2,}t$/u.test(verb)
      )
        return null;
      return `${target.slice(0, -3)} dem`;
    },
  },
  // "ins Komma fallen", "im Komma liegen" → Koma; "ohne Punkt und Koma" → Komma.
  {
    regex: re(
      `(?<target>Komma)(?<=(?:[Ii]ns|[Ii]m|[Aa]us${S}dem|[Ii]n${S}ein|[Ii]n${S}einem)${S}Komma)(?=${S}(?:fall|fiel|gefallen|lieg|lag|gelegen|versetz|gesunken|sank|erwach|geholt)\\p{Ll}*${E}|[ \\t]*[.!?,;])|(?<t2>Koma)(?<=Punkt${S}und${S}Koma)${E}`,
    ),
    fix: (m) => (m.groups!.target ? "Koma" : "Komma"),
  },
  // "eine wage Ahnung", "erinnere mich wage" → vage; "ich wage es" is the verb.
  {
    regex: re(
      `(?<target>wage)(?<=(?:eine|einer|nur|sehr|ganz|ziemlich)${S}wage)(?=${S}(?:Ahnung|Vorstellung|Erinnerung|Idee|Vermutung|Hoffnung|Andeutung|Aussage|Angabe)${E})|(?<t2>wage)(?<=(?:erinnere|erinnerst|erinnert|erinnern|erinnerte|erinnerten)${S}(?:mich|dich|sich|uns|euch|ihn|sie|es)${S}wage)${E}`,
    ),
    fix: "vage",
  },
  // "die Art und Wiese", "auf seine Weiße" → Weise.
  {
    regex: re(
      `(?<target>Wiese|Weiße|Waise|Weisse)(?<=[Aa]rt${S}und${S}\\p{L}{5,6})${E}|(?<t2>Weiße|Weisse)(?<=(?:auf|in)${S}(?:seine|ihre|meine|deine|unsere|eure|diese|jene|andere|gleiche|eine|keine)${S}\\p{L}{5,6})${E}`,
    ),
    fix: "Weise",
  },
  // "in Sichtweise", "außer Sichtweise" → Sichtweite; "eine subjektive Sichtweite" → Sichtweise.
  {
    regex: re(
      `(?<target>Sichtweise)(?<=(?:in|außer|aus|auf)${S}Sichtweise)(?=[ \\t]*[.!?,;]|${S}(?:kommen|kam|gekommen|bleiben|blieb|geblieben|ist|war|sein)${E})|(?<t2>Sichtweite)(?<=(?:subjektive|persönliche|eigene|andere|einseitige)${S}Sichtweite)${E}`,
    ),
    fix: (m) => (m.groups!.target ? "Sichtweite" : "Sichtweise"),
  },
  // "Die Tür ist gelegt wurden" → worden: the passive perfect after a form of "sein" in the
  // same clause, its participle right before.
  {
    regex: re(
      `(?<target>wurden|wurde|würden)(?<=(?:ge\\p{Ll}{2,30}(?:t|en)|\\p{Ll}{2,30}iert|(?:be|er|ver|ent|zer)\\p{Ll}{2,30}t)${S}w\\p{Ll}{3,5})(?=[ \\t]*[.!?,;])`,
    ),
    fix: (m) => {
      const clause = m.input
        .slice(Math.max(0, m.index - 120), m.index)
        .split(/[.!?;:,\n]/)
        .at(-1)!;
      const words = clause.match(/\p{L}+/gu) ?? [];
      const sein = words.findIndex((w) =>
        /^(?:ist|sind|war|waren|seid|bist|bin|sei|wäre|wären|gewesen)$/.test(w),
      );
      if (sein < 0) return null;
      // Another clause after "sein": a relative pronoun after a noun ("ein Haus das gebaut
      // wurde"), a conjunction ("als neue Bäume gepflanzt wurden") or a modal.
      const relative = words
        .slice(sein + 1)
        .some(
          (w, i, rest) =>
            /^(?:als|wie|bis|dass|weil|wenn|ob|da|und|oder|kann|können|muss|müssen|soll|sollen|darf|dürfen|will|wollen)$/.test(
              w,
            ) ||
            (/^(?:der|die|das|den|dem|denen|welche[mnrs]?)$/.test(w) &&
              /^\p{Lu}/u.test(rest[i - 1] ?? words[sein])),
        );
      return relative ? null : "worden";
    },
  },
  // "im Merz", "am 8. Merz", "Anfang Merz", "von Merz bis April" → März (Merz is a name).
  {
    regex: re(
      `(?<target>Merz)(?<=(?:\\d{1,2}\\.|[Ii]m|[Aa]nfang|[Ee]nde|[Mm]itte)${S}Merz)${E}|(?<t2>Merz)(?<=(?:[Vv]on|[Aa]b|[Ss]eit)${S}Merz)(?=${S}(?:bis|-|–)${S}(?:${MONTHS})${E})|(?<t3>Merz)(?<=(?:${MONTHS})${S}(?:bis|-|–)${S}Merz)${E}`,
    ),
    fix: "März",
  },
  // "Du verbringst Zeit mir ihr", "mir ihm zu essen" → mit: two dative pronouns in a row.
  { regex: re(`(?<target>mir)(?=${S}(?:ihm|ihnen)${E}|${S}ihr[ \t]*[.!?,;])`), fix: "mit" },
  // "mir großer Sorgfalt", "mir viel gutem Willen", "mir einigen Zeilen" → mit: an article-less
  // phrase in a dative-only form (a feminine -er, an -em, a plural -en before a plural in -n),
  // where an object of "mir" would be nominative or accusative.
  {
    regex: re(
      `(?<target>mir)(?<!(?:^|[^\\p{L}])(?:[Dd](?:er|ie|as|en|em|es|enen|eren|essen)|[Aa]ll(?:en|er|e)|[Ww]elche[mnrs]?|[Dd]iese[mnrs]?|[Jj]ene[mnrs]?|[Ss]olche[mnrs]?|mit|von|bei|zu|aus|nach|seit|in|an|auf|unter|vor|für|über|durch)${S}mir)(?=${S}(?<adj>\\p{Ll}{3,}(?:em|er|en))${S}(?<noun>\\p{Lu}\\p{Ll}{2,})${E})`,
    ),
    fix: (m) => {
      const { adj, noun } = m.groups!;
      const stem = adj.slice(0, -2);
      const quantity = /^(?:einig|viel|wenig|mehrer|beid|zahlreich|verschieden|ander)$/.test(stem);
      // "die mir keinen Nutzen bringen": a determiner.
      if (/^(?:k?ein|[dms]ein|ihr|unser|eur|dies|jen|jed|welch|solch|manch|all)$/.test(stem)) {
        return null;
      }
      // "mir bekannten Leuten", "mir vertrauter Stimme": an adjective that takes "mir".
      if (DATIVE_ADJECTIVES.test(stem)) return null;
      if (!quantity && !germanAdjective(stem)) return null;
      const reading = germanGender(noun);
      // "-em" is dative alone.
      if (adj.endsWith("em")) return "mit";
      if (adj.endsWith("er")) return reading?.gender === "f" && !reading.plural ? "mit" : null;
      // "-en": a dative plural, not "mir einigen Kummer" (masculine accusative).
      return /e?n$/.test(noun) && reading?.gender !== "m" && reading?.gender !== "n" ? "mit" : null;
    },
  },
  // "Sein Vornahme ist Jan", "mit Nachnahmen heißen" → Vorname, Nachnamen: "die Vornahme" (an
  // undertaking) takes no masculine determiner and is nobody's name.
  {
    regex: re(
      `(?<=(?:[Ss]ein|[Mm]ein|[Dd]ein|[Kk]ein|[Ee]uer|[Uu]nser|[Ee]in|[Dd]er${S}(?:erste|zweite|volle|richtige|eigene))${S})(?<target>(?:Vor|Nach|Ruf|Familien|Spitz|Mädchen)nahme)${E}|` +
        `(?<=mit${S})(?<t2>(?:Vor|Nach|Ruf|Familien)nahmen)(?=${S}\\p{Lu}\\p{Ll}+|[^.!?\\n]{0,40}heiß)|(?=(?:Vor|Nach)nahmen)(?<=heiß\\p{Ll}{0,6}${S}(?:\\p{L}{1,20}${S}){0,2}mit${S})(?<t3>(?:Vor|Nach)nahmen)${E}`,
    ),
    fix: (m) => (m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3).replace("nahme", "name"),
  },
  // "Ich zahle in 6 Ratten" → Raten; "Mäuse und Raten" → Ratten.
  {
    regex: re(
      `(?<=in${S}(?:\\d{1,3}|zwei|drei|vier|fünf|sechs|zehn|zwölf)(?:${S}(?:monatlichen|wöchentlichen|gleichen|kleinen))?${S})(?<target>Ratten)${E}|` +
        `(?<=(?:Maus|Mäuse|Mäusen|Flöhe|Kakerlaken|Schaben|Milben|Tauben)${S}und${S})(?<t2>Raten?)${E}|(?<t3>Raten?)(?=${S}und${S}(?:Maus|Mäuse|Flöhe|Kakerlaken|Schaben|Milben|Tauben)${E})`,
    ),
    fix: (m) => {
      if (m.groups!.target) {
        // "in 6 Ratten wurde das Virus gefunden": only where the sentence pays.
        const before = m.input
          .slice(Math.max(0, m.index - 60), m.index)
          .split(/[.!?\n]/)
          .at(-1)!;
        const after = m.input.slice(m.index, m.index + 60).split(/[.!?\n]/)[0];
        return /zahl|überweis|finanzier|stotter|kauf|tilg|monatlich|€|Euro/u.test(before + after)
          ? "Raten"
          : null;
      }
      const typed = m.groups!.t2 ?? m.groups!.t3;
      return typed === "Rate" ? "Ratte" : "Ratten";
    },
  },
  // "Aber dass ist richtig", "Er sagt, dass sei falsch" → das: a conjunction never stands
  // right before the finite verb. "Das Kind, dass dort spielt" → das: a relative clause after
  // a noun, with no subject of its own before its verb.
  {
    regex: re(
      `(?<target>[Dd]ass)(?=${S}(?:ist|sind|war|wäre|sei|hat|hast|hatte|hätte|kann|kannst|muss|musst|soll|sollte|wird|würde|scheint|scheinst|bleibt|klingt|stimmt|geht)${E})|` +
        `(?<=\\p{Lu}\\p{Ll}+,${S})(?<t2>dass)(?=${S}(?:(?:nicht|dort|hier|gerade|schon|noch|nie|immer|sehr|zu|auch|kaum|oft)${S}){0,3}(?:\\p{Ll}+${S}){0,2}\\p{Ll}+(?:t|te)[ \\t]*[.!?,;])`,
    ),
    fix: (m) => {
      if (m.groups!.target) return "das";
      // The relative "das" needs a neuter noun before the comma, and the clause no subject.
      const noun = /(\p{Lu}\p{Ll}+),[ \t]+$/u.exec(
        m.input.slice(Math.max(0, m.index - 40), m.index),
      )![1];
      const reading = germanGender(noun);
      if (!reading || (reading.gender !== "n" && reading.gender !== "x")) return null;
      const clause = /^[^.!?,;]*/.exec(m.input.slice(m.index + 4))![0];
      if (
        /(?<!\p{L})(?:ich|du|er|sie|es|wir|ihr|man|der|die|den|dem|ein|eine)(?!\p{L})/u.test(clause)
      )
        return null;
      return "das";
    },
  },
  // "schon soweit gekommen", "Soweit, so gut" → so weit: the distance, not the conjunction.
  {
    regex: re(
      `(?<target>[Ss]oweit)(?=,${S}so${S}gut|${S}(?:gekommen|gegangen|gelaufen|gefahren|entfernt|weg|weggelaufen)${E}|[ \\t]*[.!?])`,
    ),
    fix: (m) => (m.groups!.target[0] === "S" ? "So weit" : "so weit"),
  },
  // "ich bin vorsorgt", "Eine Pumpe vorsorgt das Haus" → versorgt: "vorsorgen" splits its
  // particle in a main clause and makes no passive ("es wird vorgesorgt").
  {
    regex: re(
      `(?<=(?:${any("bin bist ist sind seid war waren wird werden wurde wurden bleibt")})${S}(?:(?:bereits|schon|gut|bestens|nicht|endlich|immer|ausreichend|nun)${S})?)(?<target>vorsorgt)${E}|(?<t2>vorsorgt)(?=${S}(?:${any("das die den dem der ein eine einen sich uns euch mich dich ihn sie es")})${E})`,
    ),
    fix: "versorgt",
  },
  // "dienen Tisch", "Diene Tochter" → deinen, deine: a verb form before a bare singular noun
  // that the possessive fits ("Wir dienen Gott", "dienen Staat und Volk" stay).
  {
    regex: re(
      `(?<target>[Dd]ienen?)(?=${S}(?<noun>\\p{Lu}\\p{Ll}+)${E}(?!${S}(?:und|oder|sowie)${E}|[ \\t]*,))`,
    ),
    fix: (m) => {
      const noun = m.groups!.noun;
      const reading = germanGender(noun);
      if (!reading || reading.plural || /^Gott(?:es)?$/.test(noun)) return null;
      const possessive = m.groups!.target.replace(/ien/, "ein");
      return determinerFits(possessive, noun) ? possessive : null;
    },
  },
  // "Sag Bescheid, wen das fertig ist" → wenn: "wen" (whom) needs a verb that takes it, and a
  // clause that ends in a form of "sein" after an adjective takes none.
  {
    regex: re(
      `(?<=(?:,|${any("Bescheid sagen sag sagt Bescheid")})${S})(?<target>wen)(?=(?:${S}[^\\s,.;:!?]+){1,3}?${S}\\p{Ll}+${S}(?:ist|sind|war|waren|wäre|wären|wird|werden|bist|bin)[ \\t]*(?:[.,;:!?]|$))`,
    ),
    fix: "wenn",
  },
  // "Es gibt keine Features, sonder nur …" → sondern.
  { regex: re(`(?<=,${S})(?<target>sonder)(?=${S}${W})`), fix: "sondern" },
  // "Das gilt insofern, als dass …" → als: "insofern" and "insoweit" take a plain "als".
  {
    regex: re(`(?<=,${S})(?<target>als${S}dass)${E}`),
    fix: (m) => {
      const sentence = m.input
        .slice(Math.max(0, m.index - 120), m.index)
        .split(/[.!?;\n]/)
        .at(-1)!;
      return /(?<!\p{L})[Ii]ns(?:ofern|oweit)(?!\p{L})/u.test(sentence) ? "als" : null;
    },
  },
  // "zwischen 9 bis 12 Uhr", "seit Montag bis Mittwoch": a range runs "zwischen … und" or
  // "von … bis".
  {
    regex: re(
      `(?<target>(?<prep>${any("zwischen seit")})${S}(?<a>\\d{1,4}(?:[.:]\\d{1,2})?|${RANGE_NAMES})${S}bis${S}(?<b>\\d{1,4}(?:[.:]\\d{1,2})?|${RANGE_NAMES}))${E}`,
    ),
    fix: (m) => {
      const { prep, a, b } = m.groups!;
      // "seit 3000 bis 4000 Jahren": "for 3000 to 4000 years", a span with no start.
      const after = m.input.slice(m.index + m[0].length, m.index + m[0].length + 20);
      if (
        /^seit$/i.test(prep) &&
        /^[ \t]+(?:Jahr|Monat|Woche|Tag|Stunde|Minute|Jahrzehnt|Jahrhundert)\p{Ll}*n(?!\p{L})/u.test(
          after,
        )
      )
        return null;
      return [`zwischen ${a} und ${b}`, `von ${a} bis ${b}`];
    },
  },
  // "Da durch hat er gelernt", "Was da nach kam", "Wenn Sie da für bezahlen", "Das kommt da
  // durch, dass …" → dadurch, danach, dafür: before a verb or an adverb, not "da durch die
  // Tür", "da für dich", "Da mit viel Mühe …".
  {
    regex: re(
      `(?<target>${ci("da")}${S}(?<prep>durch|nach|für|mit|von|bei|gegen))(?=,${S}dass${E}|${S}\\p{Ll}+${E})`,
    ),
    fix: (m) => {
      const { prep } = m.groups!;
      const after = m.input.slice(m.index + m[0].length);
      const next = /^[ \t]+(\p{Ll}+)/u.exec(after)?.[1] ?? "";
      if (next) {
        // "da durch steigen", "da mit machen": the particle of the verb after it.
        if (germanInfinitive(prep + next) || germanVerbLike(prep + next)) return null;
        if (!verbForm(next) && !DA_ADVERBS.has(next)) return null;
      }
      return `${m.groups!.target[0] === "D" ? "Da" : "da"}${prep}`;
    },
  },
  // "Er wahr schnell", "Wahr sie pünktlich?" → war: "wahr" (true) after a subject or opening a
  // question before one.
  {
    regex: re(
      `(?<=(?<![\\p{L}])(?:[Ii]ch|[Ee]r)${S})(?<target>wahr)(?=${S}\\p{Ll})|(?<=(?:^|[.!?]\\s{1,8}|\\n))(?<t2>Wahr)(?=${S}(?:ich|du|er|sie|es|wir|ihr|der|die|das)${E}[^.!?\\n,]*\\?)`,
    ),
    fix: (m) => (m.groups!.t2 ? "War" : "war"),
  },
  // "Er fuhr zu Hause", "Er ist zu Hause gegangen", "mit Hause" → nach Hause: a way home.
  {
    regex: re(
      `(?<=(?:${any("fuhr fuhren fahre fährt fahren ging gingen gehe geht gehen lief liefen laufe läuft laufen flog flogen fliegt fliegen rannte rannten radelte radelten")})${S})(?<target>zu)(?=${S}Hause[ \\t]*[.,;!?])|(?<t2>zu)(?=${S}Hause${S}(?:gefahren|gegangen|gelaufen|geflogen|gerannt|geradelt|fahren|gehen|laufen|fliegen)${E})|(?<t3>mit|auf)(?=${S}Hause${E})`,
    ),
    fix: "nach",
  },
  // "Ich kann im 18 Uhr" → um: a clock time.
  {
    // "im 18 Uhr Flieger", "im 9:16 Format": a noun after the number takes the "im".
    regex: re(`(?<target>im)(?=${S}\\d{1,2}(?::\\d{2}|${S}Uhr${E})(?!(?:${S}Uhr)?${S}\\p{Lu}))`),
    fix: "um",
  },
  // "Ich habe all Geräte ausgeschaltet" → alle: "all" before a bare noun.
  {
    regex: re(`(?<target>[Aa]ll)(?=${S}(?<noun>\\p{Lu}\\p{Ll}{2,})${E})`),
    fix: (m) => {
      const noun = m.groups!.noun;
      if (!germanGender(noun) || /^(?:Inclusive|Star|Stars|You)$/.test(noun)) return null;
      return m.groups!.target[0] === "A" ? "Alle" : "alle";
    },
  },
  // "zur unserer Wohnung", "Am dem Bild", "ins mein Büro": a contracted article before another
  // determiner; "zum einen", "am einen Ende" stay.
  {
    regex: re(
      `(?<target>${any("zum zur am ans ins im vom beim aufs fürs übers ums durchs")})(?=${S}(?:d(?:er|ie|as|en|em|es)|(?:mein|dein|sein|ihr|unser|eur|dies|jen)(?:e|er|es|en|em)?|euer)${E})`,
    ),
    fix: (m) => DECONTRACTED[m.groups!.target.toLowerCase()],
  },
  // "Ich verbiete mir diesen Ton" → verbitte: "sich etwas verbitten" refuses something; "mir
  // verbieten, … zu" forbids oneself to do it.
  {
    regex: re(
      `(?<=(?<![\\p{L}])[Ii]ch${S})(?<target>verbiete)(?=${S}(?:mir|uns)${S}(?:${DETERMINERS}|jede\\p{Ll}*|solche\\p{Ll}*|derart|so\\p{Ll}*|\\p{Lu}))(?![^.!?\\n]*(?:,|\\bzu\\b))`,
    ),
    fix: "verbitte",
  },
  // "Ich habe bereist alles erledigt" → bereits: after an auxiliary, the participle "bereist"
  // ends its clause.
  {
    regex: re(`(?<target>bereist)(?=${S}(?!(?:und|oder|sowie|${AUXILIARIES})${E})[\\p{L}\\p{N}])`),
    fix: (m) => {
      const clause = m.input
        .slice(Math.max(0, m.index - 80), m.index)
        .split(/[.,;:!?\n]/)
        .at(-1)!;
      const words = clause.match(/\p{L}+/gu) ?? [];
      return words.some((w) => isAuxiliary(w.toLowerCase())) ? "bereits" : null;
    },
  },
  // "Sie ließ das Buch fallen lies." → ließ: "lies" (read!) after an infinitive at a clause end.
  {
    regex: re(`(?<=\\p{Ll}(?:en|ern|eln)${S})(?<target>lies)(?=[ \\t]*[.,;!?])`),
    fix: (m) => {
      const inf = /(\p{Ll}+)[ \t]+$/u.exec(m.input.slice(Math.max(0, m.index - 40), m.index))?.[1];
      return inf && germanInfinitive(inf) ? "ließ" : null;
    },
  },
  // "Er soll belohnt erden", "Wir erden gezwungen" → werden: "erden" (to ground) takes an
  // object, not a participle.
  {
    regex: re(
      `(?<=${PARTICIPLE}${S})(?<target>erden|erde)(?=[ \\t]*[.,;!?])|(?<t2>erden|erde)(?=${S}${PARTICIPLE}${E})`,
    ),
    fix: (m) => `w${m.groups!.target ?? m.groups!.t2}`,
  },
  // "die genaue Urzeit", "Datum und Urzeit" → Uhrzeit; "vor Uhrzeiten" → Urzeiten.
  {
    regex: re(
      `(?<=(?:${any("genaue exakte aktuelle richtige welche")}|Datum${S}und)${S})(?<target>Urzeit)${E}|(?<t2>Urzeit)(?=${S}und${S}Datum${E})`,
    ),
    fix: "Uhrzeit",
  },
  { regex: re(`(?<=(?:${any("vor seit")})${S})(?<target>Uhrzeiten)${E}`), fix: "Urzeiten" },
  // "mit einem paar Schuhen" → Paar: "ein paar" (a few) does not inflect.
  { regex: re(`(?<=(?:einem|eines)${S})(?<target>paar)${E}`), fix: "Paar" },
  // "nur lehre Versprechen" → leere: "lehren" (teach) after a determiner before a noun.
  {
    regex: re(
      `(?<=(?:${any("nur keine diese seine ihre deine meine alle")})${S})(?<target>lehren?)(?=${S}\\p{Lu}\\p{Ll}+${E})`,
    ),
    fix: (m) => m.groups!.target.replace("lehr", "leer"),
  },
  // "Ich freue ich", "Ich würde ich freuen", "Wir freuen und auf …": the reflexive object.
  {
    regex: re(
      `(?<=[Ii]ch${S}(?:${any("freue bedanke beeile erinnere entschuldige kümmere melde würde werde möchte will muss")})${S})(?<target>ich)(?=${S}(?:\\p{Ll}+${S})?(?:freuen|bedanken|beeilen|erinnern|entschuldigen|kümmern|melden|auf|bei|für|um|sehr|schon|riesig|darauf|daran)${E})|(?<=[Ww]ir${S}(?:freuen|bedanken|beeilen|erinnern|entschuldigen|kümmern|melden)${S})(?<t2>und)(?=${S}(?:auf|bei|für|um|sehr|schon|riesig|herzlich\\p{Ll}*)${E})`,
    ),
    fix: (m) => (m.groups!.t2 ? "uns" : "mich"),
  },
  // "Wir bedenken uns herzlich", "mich noch bedenken für" → bedanken.
  {
    regex: re(
      `(?<target>bedenke|bedenken|bedenkt)(?=${S}(?:mich|dich|uns|euch|sich)${S}(?:\\p{Ll}+${S})?(?:herzlich\\p{Ll}*|für|bei)${E})|(?<=(?:mich|dich|uns|euch|sich)${S}(?:noch${S})?)(?<t2>bedenken)(?=${S}für${E})`,
    ),
    fix: (m) => (m.groups!.target ?? m.groups!.t2).replace("denk", "dank"),
  },
  // "Das ist seht groß", "eine seht gute Leistung" → sehr: "seht" (you see) after no "ihr".
  {
    regex: re(
      `(?<=(?:${any("ist war sind waren wird wäre eine ein einen einem einer so nicht")})${S})(?<target>seht)(?=${S}\\p{Ll}+${E})`,
    ),
    fix: "sehr",
  },
  // "Da hätte ich fasst einen Infarkt bekommen" → fast: a second finite verb after the subject.
  {
    regex: re(
      `(?<=(?:${any("hätte hätten wäre wären hatte war habe bin ist hat würde")})${S}(?:ich|er|sie|es|wir)${S})(?<target>fasst)${E}`,
    ),
    fix: "fast",
  },
  // "Das Event ist leide schon vorbei" → leider.
  {
    regex: re(`(?<=(?:${any("ist war sind waren wird")})${S})(?<target>leide)${E}`),
    fix: "leider",
  },
  // "Es wäre schon, wenn …" → schön; "Das ist schön sehr teuer" → schon.
  {
    regex: re(
      `(?<=(?:${any("wäre ist war wären")})${S})(?<target>schon)(?=,${S}(?:wenn|dass)${E})|(?<t2>schön)(?=${S}sehr${E})`,
    ),
    fix: (m) => (m.groups!.t2 ? "schon" : "schön"),
  },
  // "Viele Grüße mach München", "Er ging mach Frankreich" → nach.
  {
    regex: re(
      `(?<=(?:${any("grüße grüßen ging gingen fuhr fuhren flog flogen zog zogen kam kamen reiste reisten")})${S})(?<target>mach)(?=${S}\\p{Lu}\\p{Ll}+${E})`,
    ),
    fix: "nach",
  },
  // "Ich lieber dich" → liebe.
  { regex: re(`(?<=[Ii]ch${S})(?<target>lieber)(?=${S}(?:dich|euch|ihn)${E})`), fix: "liebe" },
  // "Ich hohle dir die Sterne", "Hohl mir mal …" → hole, Hol.
  {
    regex: re(
      `(?<=(?:[Ii]ch|ich)${S})(?<target>hohle)(?=${S}(?:dir|dich|mir|uns|euch|ihn|ihm|sie|es|das|die|den)${E})|(?<=(?:^|[.!?]\\s{1,8}|\\n))(?<t2>Hohl)(?=${S}(?:mir|uns|ihm|ihr)${E})|(?<=(?:^|[.!?]\\s{1,8}|\\n)[Dd]ann${S})(?<t3>hohle)(?=${S}ich${E})`,
    ),
    fix: (m) => (m.groups!.t2 ? "Hol" : "hole"),
  },
  // "Wird sind gleich fertig!" → Wir.
  {
    regex: re(
      `(?<=(?:^|[.!?]\\s{1,8}|\\n))(?<target>Wird)(?=${S}(?:sind|haben|hatten|waren|können|müssen|wollen|sollen|dürfen|werden|würden|gehen|kommen|freuen)${E})`,
    ),
    fix: "Wir",
  },
  // "einen neun Termin" → neuen: a singular ein-word before a number word.
  {
    // "einen neun Meter langen Tisch": a measure before an adjective.
    regex: re(
      `(?<=(?<![\\p{L}])(?:${any("einen einem einer eines")})${S})(?<target>neun)(?=${S}\\p{Lu}\\p{Ll}+${E}(?!${S}\\p{Ll}+(?:e|en|er|es|em)${E}))`,
    ),
    fix: "neuen",
  },
  // "aus meiner Sich" → Sicht.
  {
    regex: re(
      `(?<=(?:${any("meiner deiner seiner ihrer unserer eurer aus")})${S})(?<target>Sich)${E}`,
    ),
    fix: "Sicht",
  },
  // "Hallo Her Blum" → Herr.
  {
    regex: re(
      `(?<=(?:Hallo|Tag|Abend|Morgen|geehrter|[Ll]ieber)[ \\t,]{1,8})(?<target>Her|Heer)(?=${S}\\p{Lu}\\p{Ll}+${E})`,
    ),
    fix: "Herr",
  },
  // "Seit Mär", "am 18. Mär" → März: "Mär" (a tale) after a date word.
  {
    regex: re(
      `(?<=(?:${any("seit im anfang ende mitte")}|\\d{1,2}\\.)${S})(?<target>Mär)(?![\\p{L}.])`,
    ),
    fix: "März",
  },
  // "Im Julie" → Juli.
  {
    regex: re(`(?<=(?:${any("im seit anfang ende mitte monat")})${S})(?<target>Julie)(?![\\p{L}])`),
    fix: "Juli",
  },
  // "Damit machen Sie mir eine große Freunde" → Freude: "eine" before a plural.
  {
    regex: re(`(?<=(?:eine|einer)${S}(?:\\p{Ll}+e${S})?)(?<target>Freunde)${E}`),
    fix: "Freude",
  },
  // "Die Unterscheide sind immens" → Unterschiede.
  {
    regex: re(`(?<=(?:${any("die der den alle große")})${S})(?<target>Unterscheide)${E}`),
    fix: "Unterschiede",
  },
  // "mich bist nächste Woche melden" → bis: "bist" with no "du" before a time.
  {
    regex: re(
      `(?<!(?:[Dd]u|bist)${S})(?<target>bist)(?=${S}(?:morgen|übermorgen|heute|nächste\\p{Ll}*|spätestens|zum|Ende|Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|\\d))(?!${S}\\S+${S}du${E})`,
    ),
    fix: "bis",
  },
  // "Das Auto weißt einige Kratzer auf" → weist: "weißt" (you know) without "du".
  {
    regex: re(
      `(?<target>weißt)(?=${S}[^.!?,;\\n]{1,60}?${S}(?:auf|hin|zurück|ab|an|aus)[ \\t]*[.!?,;])`,
    ),
    fix: (m) =>
      /(?<!\p{L})[Dd]u(?!\p{L})/u.test(m.input.slice(Math.max(0, m.index - 60), m.index + 60))
        ? null
        : "weist",
  },
  // "Ich mache das der Umwelt zur Liebe" → zuliebe.
  {
    regex: re(
      `(?<=(?:dem|der|den)${S}\\p{Lu}\\p{Ll}+${S})(?<target>zur${S}Liebe)(?=[ \\t]*[.,!?;])`,
    ),
    fix: "zuliebe",
  },
  // "eine 30tätige Testversion" → 30-tägige.
  {
    // "seit 2010 tätig" is active since 2010: apart, only an attribute before its noun.
    regex: re(
      `(?<target>(?<n>\\d+)(?:-?[Tt]ätig(?<end>e|en|er|es|em)?|${S}[Tt]ätig(?<e2>e|en|er|es|em)(?=${S}\\p{Lu})))${E}`,
    ),
    fix: (m) => `${m.groups!.n}-tägig${m.groups!.end ?? m.groups!.e2 ?? ""}`,
  },
  // "von Harz 4", "Harz IV" → Hartz IV; "im Hartz" → Harz (the mountains).
  {
    regex: re(
      `(?<target>Harz${S}(?:4|IV))${E}|(?<=(?:im|dem)${S})(?<t2>Hartz)(?!${S}(?:4|IV)${E})${E}`,
    ),
    fix: (m) => (m.groups!.t2 ? "Harz" : "Hartz IV"),
  },
  // Idioms with a look-alike noun: "in Schacht halten" (Schach), "auf Trapp halten" (Trab).
  {
    regex: re(
      `(?<=in${S})(?<target>Schacht)(?=${S}(?:zu${S})?(?:halten|hält|hielt|hielten|gehalten)${E}|[ \\t]*[.!?,](?<=(?:halten|hält|hielt|hielten)${S}(?:\\p{L}+${S}){0,3}in${S}Schacht[ \\t]*[.!?,]))|(?<=auf${S})(?<t2>Trapp)(?=${S}(?:zu${S})?(?:halten|hält|hielt|hielten|gehalten|sein|ist|war|bringen|gebracht)${E}|[ \\t]*[.!?,])`,
    ),
    fix: (m) => (m.groups!.t2 ? "Trab" : "Schach"),
  },
  // "Viele Erfolg!", "viele Spaß" → viel; "Viele Dank" → Vielen Dank.
  {
    regex: re(
      `(?<target>[Vv]iele)(?=${S}(?:Erfolg|Spaß|Glück|Vergnügen|Geduld|Kraft)${E})|(?<t2>[Vv]iele${S}Danke?)${E}`,
    ),
    fix: (m) => (m.groups!.t2 ? "vielen Dank" : "viel"),
  },
  // "100 Doller" → Dollar.
  {
    regex: re(`(?<=(?:\\d|Millionen|Milliarden|paar|viele)${S}(?:US-)?)(?<target>Doller)${E}`),
    fix: "Dollar",
  },
  // "Finanztips", "Geheimtip" → -tipp: the German noun has a double p.
  {
    regex: re(
      `(?<target>(?<head>(?:Geheim|Insider|Spar|Reise|Profi|Experten|Garten|Koch|Buch|Lese|Film|Wett|Anlage|Gesundheits|Spiel)tip)(?<s>s)?)${E}`,
    ),
    fix: (m) => `${m.groups!.head}p${m.groups!.s ?? ""}`,
  },
  // "das Gesetzt gebrochen" → Gesetz.
  {
    regex: re(
      `(?<=(?:${any("das dem des ein kein neues neue neuen dieses diesem jedes")})${S})(?<target>Gesetzt)${E}`,
    ),
    fix: "Gesetz",
  },
  // "Er hat das Thema versanden" → verstanden: "versanden" (silt up) after "haben".
  {
    regex: re(`(?<target>versanden)(?=[ \\t]*(?:[.,;:!?]|$))`),
    fix: (m) => {
      const clause = m.input
        .slice(Math.max(0, m.index - 100), m.index)
        .split(/[.,;:!?\n]/)
        .at(-1)!;
      return /(?<!\p{L})(?:hat|habe|haben|hatte|hatten|hast|habt)(?!\p{L})/u.test(clause)
        ? "verstanden"
        : null;
    },
  },
  // "Der Mann schient hungrig zu sein" → scheint.
  {
    regex: re(
      `(?<target>schient)(?=${S}(?:\\p{Ll}+${S}){0,3}(?:zu${S}\\p{Ll}+|\\p{Ll}+zu\\p{Ll}+en)${E})`,
    ),
    fix: "scheint",
  },
  // "Er hat sofort regiert" → reagiert: governing is not done "sofort".
  {
    regex: re(
      `(?<=(?:${any("sofort schnell prompt gelassen verärgert empfindlich allergisch sauer")})${S})(?<target>regiert)${E}|(?<t2>regiert)(?=${S}(?:sofort|prompt|gelassen|verärgert|allergisch)${E})`,
    ),
    fix: "reagiert",
  },
  // "Die Briefe wurden schon verendet" → versendet: "verenden" (to die) has no passive.
  {
    regex: re(
      `(?<=(?:wurde|wurden|worden)${S}(?:\\p{Ll}+${S}){0,2})(?<target>verendet|geendet)(?=[ \\t]*[.,;!?])|(?<t2>verendet|geendet)(?=${S}worden${E})`,
    ),
    fix: (m) =>
      (m.groups!.target ?? m.groups!.t2) === "geendet" ? "gesendet" : ["versendet", "verwendet"],
  },
  // "Er war beleibt bei Jung und Alt" → beliebt.
  { regex: re(`(?<target>beleibt)(?=${S}(?:bei|unter)${E})`), fix: "beliebt" },
  // "Alarm ausgelost" → ausgelöst.
  {
    regex: re(
      `(?<=(?:\\p{L}*[Aa]larm|Panik|Reaktion|Diskussion|Debatte|Explosion)${S}(?:\\p{L}+${S}){0,2})(?<target>ausgelost)${E}`,
    ),
    fix: "ausgelöst",
  },
  // "Sie trinkt gerne Wien" → Wein.
  {
    regex: re(
      `(?<=(?:${any("trinkt trinke trinken trank tranken")}|Glas|Flasche|Schoppen)${S}(?:gerne?${S}|ein${S}Glas${S})?)(?<target>Wien)${E}`,
    ),
    fix: "Wein",
  },
  // "dabei beenden lassen" → bewenden.
  {
    regex: re(`(?<=dabei${S}(?:nicht${S})?)(?<target>beenden)(?=${S}lassen${E}|[ \\t]*[.!?])`),
    fix: "bewenden",
  },
  // "Versuch mal, das zu schrieben" → schreiben: "ie" for "ei" after "zu" at a clause end.
  {
    regex: re(`(?<=(?<![\\p{L}])zu${S})(?<target>\\p{Ll}{4,}en)(?=[ \\t]*[.!?,;])`),
    fix: (m) => {
      // "schrieben" → "schreiben", "berieten" → "bereiten": the vowels swapped.
      const word = m.groups!.target;
      if (germanInfinitive(word) || !word.includes("ie")) return null;
      const swapped = word.replace("ie", "ei");
      return germanInfinitive(swapped) ? swapped : null;
    },
  },
  // "hätten zugreife müssen" → zugreifen; "LanguageTool abonnier haben" → abonniert.
  {
    regex: re(
      `(?<target>\\p{Ll}{3,}e)(?=${S}(?:müssen|können|sollen|dürfen|wollen)[ \\t]*[.!?,;])|(?<t2>\\p{Ll}{3,}ier)(?=${S}(?:haben|hat|habe|hatte|hätte|hast)${E})`,
    ),
    fix: (m) => {
      const { target, t2 } = m.groups!;
      if (t2) return germanInfinitive(`${t2}en`) ? `${t2}t` : null;
      return germanInfinitive(`${target}n`) && !germanAdjective(target) && !germanGender(target)
        ? `${target}n`
        : null;
    },
  },
  // "Er hat niemanden Bescheid gegeben" → niemandem: the one who receives is dative.
  {
    regex: re(
      `(?<target>[Nn]iemanden|[Jj]emanden)(?=${S}\\p{Lu}\\p{Ll}+${S}(?:gegeben|geben|gibt|gab|verlieh|verleiht|verliehen|geliehen|geschenkt|schenkt|schenkte)${E})`,
    ),
    fix: (m) => m.groups!.target.replace(/n$/, "m"),
  },
  // "Sagt und Bescheid" → uns.
  {
    regex: re(
      `(?<=(?:${any("sagt sag gebt gib")})${S})(?<target>und)(?=${S}(?:(?:doch|bitte)${S})*Bescheid${E})`,
    ),
    fix: "uns",
  },
  // "Dann gab des ein Fest" → es: "des" before no noun.
  {
    regex: re(`(?<target>des)(?=${S}(?:ein|eine|ihm|ihr|mir|dir|uns|nicht)${E})`),
    fix: "es",
  },
  // "Das habe ich jetzt erste gesehen" → erst.
  {
    regex: re(
      `(?<=(?:${any("jetzt gerade eben heute gestern")})${S})(?<target>erste)(?=${S}\\p{Ll}+[ \\t]*[.,;!?])`,
    ),
    fix: "erst",
  },
  // "einen fischen Salat" → frischen.
  {
    regex: re(
      `(?<=(?:${any("einen einem eines einer den dem")})${S}(?:\\p{Ll}+(?:en|em|er|es)${S})?)(?<target>fischen)(?=${S}\\p{Lu}\\p{Ll}+${E})`,
    ),
    fix: "frischen",
  },
  // "Der Vertreib der Wohnungen" → Vertrieb.
  {
    regex: re(`(?<=(?:${any("der den dem des im vom zum")})${S})(?<target>Vertreib)${E}`),
    fix: "Vertrieb",
  },
  // "Mit Entsetzten", "zu unserem Entsetzten" → Entsetzen.
  {
    regex: re(
      `(?<=(?:${any("mit meinem unserem seinem ihrem deinem eurem großem großen blankem")})${S})(?<target>Entsetzten)${E}`,
    ),
    fix: "Entsetzen",
  },
  // "War für eine Überraschung!" → Was.
  {
    regex: re(`(?<=(?:^|[.!?]\\s{1,8}|\\n))(?<target>War)(?=${S}für${S}ein\\p{Ll}*${E})`),
    fix: "Was",
  },
  // "Über dm Herd" → dem.
  {
    regex: re(
      `(?<=(?:${any("über mit von zu nach bei aus auf in an vor hinter unter")})${S})(?<target>dm)(?=${S}\\p{Lu}\\p{Ll}+${E})`,
    ),
    fix: "dem",
  },
  // "Weist du, ob …" → Weißt: "weisen" takes an object.
  {
    regex: re(`(?<target>[Ww]eist)(?=${S}du,${S}(?:ob|dass|wie|wo|was|warum|wer|wann)${E})`),
    fix: (m) => (m.groups!.target[0] === "W" ? "Weißt" : "weißt"),
  },
  // "mein YouTube-Chanel" → Channel: a compound part, not the brand.
  {
    regex: re(`(?<target>(?<pre>\\p{L}+)-Chanel(?<s>s)?)${E}`),
    fix: (m) => `${m.groups!.pre}-Channel${m.groups!.s ?? ""}`,
  },
  // "Wir dürfen nichts dem Zufall überlasen" → überlassen: the past of "überlesen" is no
  // infinitive or participle, which an auxiliary earlier in the clause calls for.
  {
    regex: re(`(?<target>überlasen)(?=[ \\t]*(?:[.,;:!?]|$))`),
    fix: (m) => {
      const clause = m.input
        .slice(Math.max(0, m.index - 120), m.index)
        .split(/[.,;:!?\n]/)
        .at(-1)!;
      const words = clause.match(/\p{L}+/gu) ?? [];
      return words.some((w) => VERB_GOVERNORS.has(w.toLowerCase())) ? "überlassen" : null;
    },
  },
];

function confusions(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const { regex, fix, ownCase } of [...FRAMES, ...LOOKALIKE_FRAMES, ...IDIOM_FRAMES]) {
    const owner = (m: RegExpExecArray) => {
      const groups = m.indices!.groups!;
      const name = Object.keys(groups).find((k) => k !== "noun" && groups[k]);
      return name ? groups[name][0] : -1;
    };
    for (const m of frameMatches(ctx, regex, owner)) {
      const name = Object.keys(m.groups!).find((k) => k !== "noun" && m.groups![k]);
      if (!name) continue;
      const [start, end] = m.indices!.groups![name];
      const typed = m.groups![name];
      if (ctx.dictionary.has(typed.toLowerCase())) continue;
      const fixed = typeof fix === "string" ? fix : fix(m);
      const replacements = fixed === null ? [] : [fixed].flat().filter((r) => r !== typed);
      if (replacements.length === 0) continue;
      findings.push({
        ruleId: "germanConfusedWords",
        messageKey: "review_msg_contextual_grammar",
        range: { start, end },
        alternatives: replacements.map((replacement) =>
          ownCase ? replacement : likeTyped(typed, replacement),
        ),
        ...(replacements.length > 1 ? { requiresChoice: true as const } : {}),
        context: { start: Math.max(0, start - 60), end: Math.min(ctx.text.length, end + 40) },
      });
    }
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanConfusedWords"], detect: confusions },
];
