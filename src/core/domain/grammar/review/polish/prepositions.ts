import type { DetectContext, RawFinding } from "../reviewDetectors";
import { caseLike, findingAt, isPl, owned, userOrNamed } from "./shared";

/*
 * Prepositions with a vowel-extended form: "we" and "ze" before a hard
 * consonant cluster ("we wtorek", "ze Świecia"), "ode/beze/przeze/przede/nade/
 * pode" before "mnie/mną" — and the short form everywhere else.
 */

const RULE = "polishPrepositionForms" as const;
const MESSAGE = "review_msg_pl_preposition_form" as const;

const VOWEL = /^[aąeęioóuy]/iu;
const DIGRAPH = /^(?:ch|cz|dz|dź|dż|rz|sz)/iu;
/** The word opens with two consonants (digraphs count as one). */
function opensWithCluster(word: string): boolean {
  const rest = word.replace(DIGRAPH, "c");
  return !VOWEL.test(rest) && rest.length > 1 && !VOWEL.test(rest.slice(1));
}

const PREPOSITION =
  /(?<![\p{L}\p{N}_'’.-])(?<prep>w|we|z|ze|s|od|ode|bez|beze|przez|przeze|przed|przede|nad|nade|pod|pode|spod|spode)(?<sp>[ \t ]+)(?<quote>["„“«]?)(?<next>\p{L}+)/giu;

/** Short form -> long form, used before "mnie"/"mną" (and clusters for w/z). */
const LONG: Record<string, string> = {
  w: "we",
  z: "ze",
  od: "ode",
  bez: "beze",
  przez: "przeze",
  przed: "przede",
  nad: "nade",
  pod: "pode",
  spod: "spode",
};
const SHORT = Object.fromEntries(Object.entries(LONG).map(([short, long]) => [long, short]));
/** The long form's own fixed phrases: "we dwoje", "przede wszystkim", "ode złego", "spode łba". */
const LONG_KEPT =
  /^(?:mnie|mną|dwoje|troje|czworo|dnie|śnie|łzach|wszystkim|łba|złego|drzwi|krwi|mgle|lwie|lwa|lwem|sobą|wszystko)$/iu;

function preferredForm(prep: string, next: string, afterWord = false): string | null {
  const p = prep.toLowerCase();
  const word = next.toLowerCase();
  const pronoun = /^(?:mnie|mną)$/u.test(word);
  // "s Polski" after a lowercase word too ("gorzały s Polski"), not an initial ("J. S Bach").
  if (p === "s") return /^\p{Ll}/u.test(next) || afterWord ? "z" : null;
  if (LONG[p]) {
    if (p === "spod" && word === "łba") return "spode";
    if (pronoun) {
      // "od mnie" -> "ode mnie"; "z mną" -> "ze mną"; "w mnie" -> "we mnie".
      return p === "przed" || p === "nad" || p === "pod" || p === "z"
        ? word === "mną"
          ? LONG[p]
          : null
        : word === "mnie"
          ? LONG[p]
          : null;
    }
    // "w wtorek" -> "we wtorek", "w Wrocławiu": w/f + consonant.
    if (p === "w" && /^[wf]/u.test(word) && opensWithCluster(word)) return "we";
    // "z Świecia", "z szkłem": a sibilant and a consonant ("z wszystkimi" too).
    if (p === "z" && /^(?:[sśzźż]|sz|rz|wsz|wz|ws)/u.test(word) && opensWithCluster(word))
      return "ze";
    return null;
  }
  const short = SHORT[p];
  if (!short || pronoun || LONG_KEPT.test(word)) return null;
  // "we Wiedniu": a name in w- plus a vowel takes "w" ("we wodzie" may be regional speech).
  if (p === "we" && /^\p{Lu}/u.test(next) && /^[wf]/u.test(word) && !opensWithCluster(word))
    return "w";
  // "ze" before a lowercase non-cluster is the conjunction "że" (another check);
  // here only names and the other long forms.
  if (p === "ze" && /^\p{Ll}/u.test(next)) return null;
  // "ze Sionem", "we wodzie" (regional), "w tę i we w tę": sibilant or w-initial words keep it.
  if (/^(?:[sśzźżwf]|rz)/u.test(word) || word.length < 2) return null;
  if (opensWithCluster(word)) return null;
  return short;
}

function prepositionForms(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, PREPOSITION)) {
    const { prep, next } = m.groups!;
    // Acronyms and abbreviations ("z ZSRR", "w ww. czasopismach") are read letter by letter.
    const end = m.index + m[0].length;
    if (/^\p{Lu}{2,}/u.test(next) || /^\.[ \t\u00a0]*\p{Ll}/u.test(ctx.text.slice(end, end + 4)))
      continue;
    const wanted = preferredForm(
      prep,
      next,
      /\p{Ll}[ \t\u00a0]+$/u.test(ctx.text.slice(Math.max(0, m.index - 4), m.index)),
    );
    if (!wanted || wanted === prep.toLowerCase()) continue;
    if (userOrNamed(ctx, prep)) continue;
    findings.push(
      findingAt(ctx, m.index, m.index + prep.length, [caseLike(prep, wanted)], RULE, MESSAGE),
    );
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: [RULE] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) => (isPl(ctx) ? prepositionForms(ctx) : []),
  },
];
