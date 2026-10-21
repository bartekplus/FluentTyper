import type { Fixer } from "../../engine/reviewRules";
import { germanGender } from "./germanLexicon";

// Fixed phrases with a wrong article, preposition or ending, in frames where only the fix fits
// (run by confusions.ts). Authored frames; the first named group with a value is the typed text.

// The verbs each idiom needs somewhere in its sentence, and its fix (authored).
type IdiomFix = string | ((typed: string) => string[]);
/** A verb's forms from its stems: a stem with a verb ending, or a participle with "ge-". */
const verb = (stems: string) =>
  new RegExp(`(?<!\\p{L})(?:ge)?(?:${stems})(?:e|st|t|te|test|ten|tet|en|est|et)?(?!\\p{L})`, "iu");
const HALTEN = verb("halt|hält|hielt");
const IDIOM_VERBS: Readonly<Record<string, [RegExp, IdiomFix]>> = {
  Punkt: [verb("bring|bracht|bräch"), "den"],
  Kopf: [verb("stell"), "den"],
  Plan: [verb("ruf|rief"), "den"],
  PlanBare: [verb("ruf|rief"), "auf den Plan"],
  Teppich: [verb("kehr"), "den"],
  Leim: [
    verb("geh|ging|gangen"),
    (typed) => [`${typed.slice(0, 3)} den`, `${typed[0] === "A" ? "Aus" : "aus"} dem`],
  ],
  Strömen: [verb("regn|gieß|goss|gossen|schütt"), "in"],
  Schach: [HALTEN, "in"],
  Strang: [verb("zieh|zog|zogen"), "einem"],
  Strenge: [verb("schlag|schlug|schläg|schlagen"), "Stränge"],
  Zaun: [HALTEN, "Zaum"],
  Zaum: [verb("brech|brach|brich|brochen"), "Zaun"],
  Angriff: [verb("nehm|nimm|nahm|nommen"), "in Angriff"],
  Auge: [verb("behalt|behält|behielt|fass|fasst"), "im"],
};

/** The sentence around a match, cut at its ends or 200 characters away. */
function sentenceAround(m: RegExpExecArray): string {
  const text = m.input;
  const head = text.slice(Math.max(0, m.index - 200), m.index);
  const start = Math.max(...[".", "!", "?", "\n"].map((c) => head.lastIndexOf(c))) + 1;
  const tail = text.slice(m.index, m.index + 200);
  const end = /[.!?\n]/.exec(tail.slice(1))?.index ?? tail.length;
  return head.slice(start) + tail.slice(0, end + 2);
}

/** The named frame fixes of grammar/rules/de.yaml (`fixer:`). */
export const FIXERS = {
  deDem: (m) => {
    const g = m.groups!;
    const after = m.input.slice(m.index + m[0].length, m.index + m[0].length + 12);
    const key =
      g.noun ??
      (g.t2
        ? "Leim"
        : g.t3
          ? /^\s*Schach/.test(after)
            ? "Schach"
            : "Strömen"
          : g.t4
            ? "Strang"
            : g.t5
              ? "Strenge"
              : g.t6
                ? "Zaun"
                : g.t7
                  ? "Zaum"
                  : g.t8
                    ? "Angriff"
                    : "PlanBare");
    const [verb, fix] = IDIOM_VERBS[key];
    if (!verb.test(sentenceAround(m))) return null;
    return typeof fix === "string" ? fix : fix(g.t2);
  },
  deIn2: (m) => (IDIOM_VERBS.Auge[0].test(sentenceAround(m)) ? "im" : null),
  deMein: (m) => `${m.groups!.target.slice(0, -1)}m`,
  deVv2: (m) => ({ vom: "von", zum: "zu", beim: "bei" })[m.groups!.target.toLowerCase()]!,
  deMehrer: (m) => {
    if (m.groups!.t2) return "mehreren";
    // A singular noun in -n ("mit andere Garten") needs another ending.
    return germanGender(m.groups!.noun.toLowerCase())?.plural === false
      ? null
      : `${m.groups!.target}n`;
  },
  deAnders: (m) => {
    const gender = germanGender(m.groups!.noun.toLowerCase());
    if (!gender || gender.plural) return null;
    return gender.gender === "n" ? "anderes" : gender.gender === "m" ? "anderer" : null;
  },
  deP3: (m) => (/übersetz/.test(sentenceAround(m)) ? null : `${m.groups!.target}r`),
  deHertz: (m) => (m.groups!.t2 ? "Hertz" : "Herz"),
  deIhn: (m) =>
    /(?<!\p{L})(?:an|zu|nach|vor|bei|mit|ab|aus|ein|hinterher)[ \t]*[.!?,;:]/u.test(
      sentenceAround(m),
    )
      ? null
      : { ihn: "ihm", mich: "mir", dich: "dir" }[m.groups!.target]!,
  deWw2: (m) => `${m.groups!.target}s`,
  deHh2: (m) => (m.groups!.t2 ? "Zeigen" : "heute"),
  deWar: (m) => {
    const clause = m.input
      .slice(Math.max(0, m.index - 80), m.index)
      .split(/[.!?,;:\n]/)
      .at(-1)!;
    return /(?<!\p{L})(?:nehme|nimmst|nimmt|nehmt|nahm|nahmst|nahmen)(?!\p{L})/u.test(clause)
      ? "wahr"
      : null;
  },
} satisfies Record<string, Fixer>;
