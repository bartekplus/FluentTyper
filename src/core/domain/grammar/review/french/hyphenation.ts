import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { IL, ILS, isVerbHomograph, JE, NOUS, TU, verbReadings, VOUS } from "./frenchLexicon";
import {
  CLITICS,
  ownedFrenchWords,
  SUBJECT_PRONOUNS,
  tokensAfter,
  tokensBefore,
  withCase,
} from "./frenchTokens";
import { namedExampleBefore } from "../exampleCues";

// Hyphens French grammar requires: the inverted subject of a question ("pouvez-vous",
// "a-t-il", "est-ce") and the adverb "peut-être".

const RULE = "frenchHyphenation";
const MESSAGE = "review_msg_fr_hyphen";

const PERSON: Record<string, number> = {
  je: JE,
  tu: TU,
  il: IL,
  elle: IL,
  on: IL,
  nous: NOUS,
  vous: VOUS,
  ils: ILS,
  elles: ILS,
};
const QUESTION_WORDS = new Set(
  "que qu' où comment pourquoi quand combien quel quelle quels quelles quoi qui".split(" "),
);
const CE_VERBS = new Set(["est", "était", "sera", "serait", "fut"]);
const SENTENCE_START = /(?:^|[.!?…\n])[\s\u00a0]*$/u;
// After an inverted "ce": a clause, a pronoun or a common attribute ("est-ce possible ?").
const CE_FOLLOWERS = new Set(
  (
    "que qu' qui là vrai possible grave normal bien mal juste faux exact sûr clair utile " +
    "nécessaire obligatoire important ça cela vous toi lui moi elle eux nous elles pas " +
    "vraiment encore toujours donc"
  ).split(" "),
);
// "son" is also the noun "sound" ("quel est ce son ?"): left out.
const DETERMINERS = new Set(
  "le la les l' un une des du ce cet cette ces mon ma mes ton ta tes sa ses notre nos votre vos leur leurs".split(
    " ",
  ),
);

/** The finite persons of a word as a verb that is no noun ("porte" is both). */
function persons(word: string): number {
  let mask = 0;
  for (const r of verbReadings(word)) if (typeof r.slot === "number") mask |= r.slot;
  return mask;
}

/** The sentence from `index` on ends with a question mark. */
function inQuestion(text: string, index: number): boolean {
  const end = text.slice(index, index + 300).search(/[.!?…\n]/);
  return end >= 0 && text[index + end] === "?";
}

/** "pouvez vous", "a t il", "est ce que": an inverted subject joined with hyphens. */
function inversion(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const pronoun = m.groups!.pronoun.toLowerCase();
  const verb = m.groups!.verb;
  const lower = verb.toLowerCase();
  const start = m.index;
  const end = start + m[0].length;
  const euphonic = !!m.groups!.t;
  if (namedExampleBefore(ctx.text, start) || ctx.dictionary.has(lower)) return null;
  const before = tokensBefore(ctx.text, start, 6);
  const after = tokensAfter(ctx.text, end, 2);
  let i = 0;
  while (before[i] && (CLITICS.has(before[i].w) || before[i].w === "ne" || before[i].w === "n'"))
    i++;
  // A subject before the verb ("tu viens tu manges ?") leaves nothing to invert.
  if (before.slice(0, i + 1).some((t) => SUBJECT_PRONOUNS.has(t.w) && !CLITICS.has(t.w)))
    return null;
  if (before[i] && ["ça", "cela", "ceci", "qui"].includes(before[i].w)) return null;
  if (pronoun === "ce") {
    if (!CE_VERBS.has(lower)) return null;
    // "le but est ce que tu dis": only a clause start or a question word inverts.
    if (before[i]) {
      if (
        !QUESTION_WORDS.has(before[i].w) &&
        !["et", "mais", "alors", "ou", "donc"].includes(before[i].w)
      )
        return null;
    } else if (!SENTENCE_START.test(ctx.text.slice(Math.max(0, start - 4), start))) return null;
    // "quel est ce bruit ?": "ce" before a noun is its determiner.
    const following = after[0];
    if (following && !CE_FOLLOWERS.has(following.w) && !DETERMINERS.has(following.w)) {
      const participle = verbReadings(following.w).some((r) => r.slot === "Q");
      if (!participle || isVerbHomograph(following.w)) return null;
    }
    const next = after[0]?.w;
    if (!inQuestion(ctx.text, end) && next !== "que" && next !== "qu'" && next !== "qui")
      return null;
  } else {
    if (!euphonic && !inQuestion(ctx.text, end)) return null;
    // "As tu": a verb that is also a noun inverts only at the start or after a question word.
    const opening = !before[i] || QUESTION_WORDS.has(before[i].w);
    if (isVerbHomograph(lower) && !euphonic && !opening) return null;
    if (!(persons(lower) & PERSON[pronoun])) return null;
    // "je" after a verb in -e takes "-é-je": left to the writer.
    if (pronoun === "je" && /e$/.test(lower)) return null;
    // The pronoun is the subject of the next verb: "quand tu viens tu manges".
    const next = after[0];
    if (next && persons(next.w) & PERSON[pronoun] && !isVerbHomograph(next.w)) return null;
  }
  const third = ["il", "elle", "on"].includes(pronoun);
  // The euphonic t only between vowels: "a-t-il", but "est-il", "faut-il".
  const joiner = third && /[aeé]$/i.test(verb) ? "-t-" : "-";
  const typed = ctx.source.slice(start, end);
  const fixed = `${verb}${joiner}${m.groups!.pronoun}`;
  if (fixed === typed) return null;
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start, end },
    alternatives: [fixed],
  };
}

/** "il partira peut être demain", "peu être": the adverb "peut-être". */
function maybe(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const start = m.index;
  if (namedExampleBefore(ctx.text, start)) return null;
  const before = tokensBefore(ctx.text, start, 2);
  const previous = before[0];
  const next = tokensAfter(ctx.text, start + m[0].length, 1)[0];
  // "Peut être résilié chaque mois.": a contract-style "can be" + participle.
  const sentenceStart =
    !previous &&
    SENTENCE_START.test(ctx.text.slice(Math.max(0, start - 4), start)) &&
    !(next && verbReadings(next.w).some((r) => r.slot === "Q"));
  // "il peut être tard" is pouvoir + être: only after another verb is it the adverb, and not
  // after a subject clause ("tout ce que vous dites peut être utilisé").
  const clauseSubject = tokensBefore(ctx.text, start, 20).some((t) =>
    ["que", "qu'", "qui", "dont", "où", "ce"].includes(t.w),
  );
  const afterVerb =
    previous &&
    !clauseSubject &&
    /^\p{Ll}/u.test(ctx.text.slice(previous.start, previous.end)) &&
    !isVerbHomograph(previous.w) &&
    verbReadings(previous.w).some((r) => typeof r.slot === "number" && r.lemma !== "pouvoir");
  // "peu être" is a slip wherever "peu" modifies nothing ("un peu être seul", "il peu" for
  // "il peut" are left alone).
  const peu =
    /^peu[ \t]/i.test(m[0]) &&
    !(previous && (PEU_BEFORE.has(previous.w) || SUBJECT_PRONOUNS.has(previous.w)));
  if (!sentenceStart && !afterVerb && !peu) return null;
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start, end: start + m[0].length },
    alternatives: [withCase(m[0], "peut-être")],
  };
}

const INVERSION =
  /(?<![\p{L}\p{M}\p{N}_-])(?<verb>\p{L}+)(?:[ \t]*-[ \t]+|[ \t]+-[ \t]*|[ \t]+(?<t>t['’]|t[ \t]+|-t-|t-)[ \t]*|[ \t]+)(?<pronoun>je|tu|il|elle|on|nous|vous|ils|elles|ce)(?![\p{L}\p{M}\p{N}_'’-])/giu;
const PEU_BEFORE = new Set(
  "à un très trop si assez bien pour de le ce tout aussi ne n' qui ça cela".split(" "),
);
const MAYBE = /(?<![\p{L}\p{M}\p{N}_'’-])peut?[ \t]+être(?![\p{L}\p{M}\p{N}_'’-])/giu;

function hyphenation(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, INVERSION)) {
    const finding = inversion(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, MAYBE)) {
    const finding = maybe(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: hyphenation }];
