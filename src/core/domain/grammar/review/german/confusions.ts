import { frameMatches, SPACE, WORD_END, WORD_START } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { isGerman } from "./shared";

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

type Frame = { regex: RegExp; fix: string | ((m: RegExpExecArray) => string | null) };

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
  "weiß wusste wüsste weißt wissen sagt sagte sagten gesagt sage sagen schreibt schrieb " +
  "geschrieben hoffe hoffen hofft glaube glauben glaubt denke denkt dachte gedacht finde " +
  "findet meine meint heißt bedeutet klar sicher sehe sieht merke merkt zeigt zeigte " +
  "erwarte fürchte behauptet behauptete gewährleistet versprochen vergessen gehört bemerkt " +
  "erfahren verstanden möglich wichtig schade interessant";

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
  {
    regex: re(
      `(?<=(?:${DASS_VERBS.replace(/ /g, "|")}),${S})(?<target>das)(?=${S}(?:ich|du|er|sie|es|wir|man|alle)${E})`,
    ),
    fix: "dass",
  },
  {
    regex: re(
      `(?<=(?:^|[.!?]\\s+|\\n))(?<target>Das)(?=${S}(?:ich|du|er|sie|es|wir|man)${S}\\p{Ll})`,
    ),
    fix: "Dass",
  },
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
      const replacement = typeof fix === "string" ? fix : fix(m);
      if (!replacement || replacement === typed) continue;
      findings.push({
        ruleId: "germanConfusedWords",
        messageKey: "review_msg_contextual_grammar",
        range: { start, end },
        alternatives: [
          /^\p{Lu}/u.test(typed)
            ? replacement[0].toUpperCase() + replacement.slice(1)
            : replacement,
        ],
        context: { start: Math.max(0, start - 60), end: Math.min(ctx.text.length, end + 40) },
      });
    }
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanConfusedWords"], detect: confusions },
];
