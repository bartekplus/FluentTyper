import { frameMatches, SPACE, WORD_END, WORD_START } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { germanInfinitive } from "./germanLexicon";
import { isGerman } from "./shared";
import { isAuxiliary } from "./verbAgreement";

// Real words in a frame where only their look-alike fits: "ihr seit" (seid), "seid gestern"
// (seit), "ich freue mir" (mich), "mir dem Bus" (mit), ", das er kommt" (dass), "in denn
// Garten" (den). Each frame is narrowed to contexts where the typed word cannot be meant.

const S = SPACE;
const E = WORD_END;
const W = "\\p{L}+";
const re = (source: string) => new RegExp(`${WORD_START}(?:${source})`, "gdu");
// Case-insensitive on the first letter only, so "\p{Lu}" in a frame keeps meaning a capital.
const ci = (word: string) => `[${word[0]}${word[0].toUpperCase()}]${word.slice(1)}`;
const any = (words: string) => words.split(" ").map(ci).join("|");

type Frame = {
  regex: RegExp;
  fix: string | ((m: RegExpExecArray) => string | string[] | null);
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
  "Abend|Beginn|Anfang|Ende|Sommer|Winter|Frühling|Herbst|Krieg|Unfall|Umzug|Start";
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
      `(?<=(?:^|[.!?:]\\s+|\\n)[„"]?)(?<target>Seit)(?=${S}(?:ihr${S}[^,.!?\\n]*\\?|(?:bitte|mir|uns|ruhig|leise|vorsichtig|wachsam|still|willkommen|nett|brav|froh|dankbar|gespannt|bereit|gegrüßt)${E}[^,\\n]*[!.]))`,
    ),
    fix: "Seid",
  },
  // "seid gestern", "seid zwei Tagen", "Seid dem letzten Mittwoch" → seit (no "ihr" around).
  {
    regex: re(
      `(?<!(?<![\\p{L}])[iI]hr${S}(?:\\p{L}+${S}){0,2})(?<target>${ci("seid")})${E}(?!${S}ihr${E})(?=${S}(?:(?:${TIME_WORDS.replace(/ /g, "|")}|ein${S}paar|mehr${S}als|\\p{N})${E}|(?:dem|einem|diesem|letztem)${S}(?:\\p{Ll}+${S})?(?:${TIME_NOUN})))`,
    ),
    fix: "seit",
  },
  // "mir dem Bus", "mir einer gewissen Routine" → mit; "Mir wem redest du?"
  {
    regex: re(
      `(?<target>${ci("mir")})(?=${S}(?:${DATIVE_DETS.replace(/ dieser| jeder| keiner/g, "").replace(/ /g, "|")})${S}(?:\\p{Ll}+${S}){0,2}\\p{Lu})`,
    ),
    fix: "mit",
  },
  { regex: re(`(?<=(?:^|[.!?]\\s+))(?<target>Mir)(?=${S}wem${E})`), fix: "Mit" },
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
      `(?<=(?:^|[.!?]\\s+|\\n))(?<target>Das)(?=${S}(?:ich|du|er|sie|es|wir|man)${S}\\p{Ll})`,
    ),
    fix: "Dass",
  },
  // "Das dem Mann ein Zahn fehlt, ist bedauerlich": a subject clause, its verb last.
  {
    regex: re(
      `(?<=(?:^|[.!?]\\s+|\\n))(?<target>Das)(?=${S}(?:dem|der|den|die|ein\\p{Ll}*|mein\\p{Ll}*|dein\\p{Ll}*|sein\\p{Ll}*|ihr\\p{Ll}*|unser\\p{Ll}*|alle|alles|jemand|niemand|hier|so)${S}(?<clause>[^.!?\\n,]*\\p{Ll}),${S}(?:ist|war|wäre|freut|ärgert|stört|wundert|zeigt|bedeutet|macht|liegt|hat|gefällt|beweist|spricht|überrascht)${E})`,
    ),
    fix: (m) => (subjectClause(m.groups!.clause) ? "Dass" : null),
  },
  // "Gut das du da bist" → "Gut, dass": an adjective that opens a sentence before a clause.
  {
    regex: re(
      `(?<=(?:^|[.!?]\\s+|\\n))(?<target>(?<adj>(?:(?:${any("sehr wirklich echt ganz")})${S})?(?:${any("gut schön super toll schade klasse prima wichtig komisch seltsam klar logisch merkwürdig erstaunlich interessant")}))${S}das)(?=${S}(?!(?:ist|war|wäre|wird|kann|muss|soll|hat|hatte|sei|bleibt)${E})(?:nicht|jetzt|erst|selbst|fast|endlich|\\p{Ll}+(?<!t))${E}[^.!?\\n,]*\\p{Ll}[ \\t]*[.!?…])`,
    ),
    fix: (m) => `${m.groups!.adj}, dass`,
  },
  // "immer wider", "ist wider da" → wieder; "wider Willen", "wider die Natur" stay.
  {
    regex: re(
      `(?<!${ci("für")}${S}und${S})(?<target>wider)(?=${S}(?!(?:den|die|das|dem|des|ein|eine|einen|einem|eines|einer|jede|jeden|jedes|jeder|alle|allen|alles|aller|besseres|besseren|bessere|kein\\p{Ll}*|mein\\p{Ll}*|dein\\p{Ll}*|sein\\p{Ll}*|ihr\\p{Ll}*|unser\\p{Ll}*|eur\\p{Ll}*|diese\\p{Ll}*|jegliche\\p{Ll}*|solche\\p{Ll}*)${E})\\p{Ll}+${E}(?!${S}\\p{Lu})|[ \\t]*(?:[.!?,;]|$))`,
    ),
    fix: "wieder",
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
    regex: re(`(?<=(?:^|[.!?]\\s+|\\n))(?<target>Den)(?=${S}(?:ich|du|er|wir|ihr|man)${S}\\p{Ll})`),
    fix: "Denn",
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
      `(?<=(?:^|[.!?]\\s+|\\n))(?<target>Ja)(?=${S}\\p{Ll}+er${E}[^.!?\\n]*,${S}(?:desto|umso)${E})`,
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
  // "Es gibt keine Features, sonder nur …" → sondern.
  { regex: re(`(?<=,${S})(?<target>sonder)(?=${S}${W})`), fix: "sondern" },
];

function confusions(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const { regex, fix } of FRAMES) {
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
          /^\p{Lu}/u.test(typed)
            ? replacement[0].toUpperCase() + replacement.slice(1)
            : replacement,
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
