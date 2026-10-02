import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { germanInfinitive } from "./germanLexicon";
import { englishLine, isGerman, wordSet } from "./shared";
import { germanInfinitiveOf, isAuxiliary } from "./verbAgreement";

// A question that ends in a full stop: "Wann kommst du." → "?", "Hast du Zeit." → "?",
// "Er ist schon weg, oder." → "?". Opt-in: a w-word or a verb first is a question in most
// sentences, but not in all ("Wie gesagt.", "Kommt ein Mann in eine Bar.").

const W_WORDS = wordSet(
  "wer wen wem wessen was wann wo wohin woher warum wieso weshalb weswegen wie welche " +
    "welcher welchen welchem welches womit wofür woran worauf worüber wovon wozu inwiefern",
);
// A preposition before the w-word: "Ab wann", "Mit wem", "An welchem Tag".
const W_PREPOSITIONS = wordSet("ab bis seit mit von an auf für in aus bei nach zu um über");
// Words that may stand between the w-word and its verb: "Wie viel kostet das".
const DEGREES = wordSet("viel viele lange oft spät alt groß weit hoch teuer schnell sehr");
// A sentence that is only a w-word and particles: "Warum eigentlich nicht."
const PARTICLES = wordSet(
  "denn eigentlich nicht überhaupt endlich bloß nur schon noch genau dann jetzt nun so",
);
const SUBJECTS = wordSet("ich du er sie es wir ihr man Sie");
const DETERMINERS =
  /^(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|mein\p{Ll}*|dein\p{Ll}*|sein\p{Ll}*|ihr\p{Ll}*|unser\p{Ll}*|euer|eure\p{Ll}*|dies\p{Ll}*|jemand|man)$/u;
const OPENERS = wordSet("Und Aber Oder Na Also");
// Particles of statements and exclamations: "Kann ich jedenfalls behaupten.", "Hat er doch".
const STATEMENT = wordSet("doch ja jedenfalls halt eben wohl");
const PLURAL_2 = wordSet("seid habt werdet könnt müsst sollt wollt dürft mögt wisst");
const PARTICIPLE_PREFIX = /^(?:ge|be|er|ver|ent|zer|miss)\p{Ll}+(?:t|en)$/u;
const TAG = /,[ \t]*(?:oder(?:[ \t]+nicht)?|nicht[ \t]+wahr|gell|gelle)[ \t]*$/u;

/** A finite verb form: listed, a "du" form, or a regular present form of a known verb. */
function finite(token: string): boolean {
  if (isAuxiliary(token) || germanInfinitiveOf(token)) return true;
  if (!/^\p{Ll}+$/u.test(token) || PARTICIPLE_PREFIX.test(token)) return false;
  const stem = /^(.+?)(?:st|t|et|est)$/u.exec(token)?.[1];
  return !!stem && germanInfinitive(`${stem}en`);
}

function isQuestion(words: string[]): boolean {
  let i = OPENERS.has(words[0]) ? 1 : 0;
  const first = words[i];
  if (!first) return false;
  const low = first.toLowerCase();
  // "Hast du Zeit.", "Kann das Problem gelöst werden.": an auxiliary or modal first.
  if (isAuxiliary(low) && /^\p{Lu}/u.test(first) && i === 0) {
    const next = words[1] ?? "";
    // "Seid leise." is an order, "Seid ihr da." a question; "Kannst es dir schönreden."
    // drops its "du".
    if (PLURAL_2.has(low) && next !== "ihr") return false;
    if (/st$/.test(low) && low !== "ist" && next !== "du") return false;
    const rest = words.slice(2);
    return (
      (SUBJECTS.has(next) || DETERMINERS.test(next)) &&
      !rest.some((w) => STATEMENT.has(w) || isAuxiliary(w))
    );
  }
  if (W_PREPOSITIONS.has(low) && W_WORDS.has(words[i + 1]?.toLowerCase() ?? "")) i++;
  else if (!W_WORDS.has(low)) return false;
  i++;
  // "An welchem Tag starb er": the noun after "welch-".
  if (/^welch/.test(words[i - 1].toLowerCase()) && /^\p{Lu}/u.test(words[i] ?? "")) i++;
  if (DEGREES.has(words[i] ?? "")) i++;
  const rest = words.slice(i);
  // "Was bin ich doch für ein Glückspilz": an exclamation.
  if (rest.length === 0 || rest.some((w) => STATEMENT.has(w) || w === "für")) return false;
  if (rest.every((w) => PARTICLES.has(w))) return true;
  if (!finite(rest[0])) return false;
  // "Was zählt ist Erfolg", "Wer A sagt muss B sagen": a second finite verb.
  return !rest.slice(1).some((w) => isAuxiliary(w) && !/en$/.test(w));
}

function questions(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  const ends = /(?<=\p{L})\.(?=[ \t]*(?:\n|$)|[ \t]+\p{Lu})/gu;
  ends.lastIndex = ctx.from;
  for (let m = ends.exec(ctx.scanText); m && m.index < ctx.to; m = ends.exec(ctx.scanText)) {
    const at = m.index;
    const window = Math.max(0, at - 300);
    const start = window + ctx.text.slice(window, at).search(/[^.!?\n]*$/);
    const sentence = ctx.text.slice(start, at);
    if (englishLine(ctx.text, at) || namedExampleBefore(ctx.text, start)) continue;
    // "Hast du Mt. Fuji gesehen?": an abbreviation, the sentence goes on.
    if (/(?:^|\s)\p{Lu}\p{Ll}?$/u.test(sentence)) continue;
    // "egal, ob er kommt, oder nicht.": the alternative of an "ob" clause.
    const tagged = TAG.test(sentence) && !/(?<!\p{L})ob(?!\p{L})/u.test(sentence);
    if (!tagged) {
      // Clauses joined or quoted: "Wer bremst, verliert.", "Er fragte: Wann …".
      if (/[,;:"„“”«»()]/.test(sentence)) continue;
      const words = sentence.match(/\p{L}+/gu) ?? [];
      // A one-letter abbreviation before the dot: "z. B."
      if (words.length < 2 || /(?:^|\s)\p{L}$/u.test(sentence)) continue;
      if (!isQuestion(words)) continue;
    }
    findings.push({
      ruleId: "germanQuestionMarks",
      messageKey: "review_msg_german_question_mark",
      range: { start: at, end: at + 1 },
      alternatives: ["?"],
      context: { start, end: at + 1 },
    });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanQuestionMarks"], detect: questions },
];
