import { englishWordInfo, hasVerbForm } from "../../implementations/helpers/EnglishLexicon";
import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { before, caseLike, group, hasUserOrCasedWord, nextWord } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  frameRuleDetector,
  type FindingsFilter,
  type FrameRef,
  type MatchFixer,
} from "../../engine/reviewRules";
import { table } from "./tables";

/** Misheard idioms, wrong words in set phrases and their inflections. */
export const PHRASES = table("fixedPhrases.phrases");

/** Split, joined and hyphenated forms of single words. */
export const COMPOUNDS = table("fixedPhrases.compounds");

/** Optional advice: informal abbreviations, contested idiom variants, redundancy. */
export const STYLE = table("fixedPhrases.style");

// ---- Context frames: forms that are also ordinary English elsewhere. ----

/**
 * A finding for `range` with the check and message of the frame; each alternative takes the
 * typed text's initial or all capitals.
 */
function found(
  ctx: DetectContext,
  rule: FrameRef,
  m: RegExpExecArray,
  [start, end]: readonly [number, number],
  alternatives: readonly string[],
  recase = true,
): RawFinding | null {
  if (hasUserOrCasedWord(ctx, m[0])) return null;
  const typed = ctx.text.slice(start, end);
  const cased = alternatives.map((alt) => (recase ? caseLike(typed, alt) : alt));
  return {
    ruleId: rule.ruleId,
    messageKey: rule.messageKey,
    range: { start, end },
    alternatives: cased,
    ...(cased.length > 1 ? { requiresChoice: true as const } : {}),
    context: {
      start: Math.max(0, m.index - 32),
      end: Math.min(ctx.text.length, m.index + m[0].length + 16),
    },
  };
}
/** Only spaces and opening marks between `index` and a stop, a line break or the text start. */
const atClauseStart = (ctx: DetectContext, index: number) =>
  /(?:^|[.!?;:\n])[ \t "“'‘(]*$/.test(before(ctx, index, 96));
// Function words the lexicon also lists as nouns ("ifs and buts", "the ins and outs").
const CLOSED_CLASS =
  /^(?:if|in|on|at|to|for|with|by|of|off|out|up|down|over|than|and|or|but|so|as|when|because|since|after|before|until|now|then|again|lately|here|there|yet|still|too|very|it|this|that)$/i;
/** A word the lexicon knows as a noun; it omits long pure nouns, so unknown long words count. */
const nounLike = (word: string, unknownLong = true) => {
  if (!word || CLOSED_CLASS.test(word)) return false;
  const info = englishWordInfo(word.toLowerCase());
  return info ? info.noun || info.plural : word.length > 6 && (unknownLong || /s$/i.test(word));
};

// "What dose of…", "what dose it takes" and "to dose it" stay nouns or verbs.
const NOUN_DOSE_NEXT =
  /^(?:of|is|was|are|were|has|had|have|should|would|will|can|could|may|might|must|per|for|and|or|to|in|on|at|level|levels|amount|size|range|form)$/i;
const PRONOUN_NEXT = /^(?:it|he|she|this|that|they|we|you|i)$/i;

// worse/worst: the first frame that matches a word decides it, also when it keeps the typed
// word (a user word or a cased word in its match). HELD marks such a kept word.
const WORSE = new WeakSet<RawFinding>();
const HELD = new WeakSet<RawFinding>();
const worseForm =
  (word: string, test?: (m: RegExpExecArray, ctx: DetectContext) => boolean): MatchFixer =>
  (m, ctx, frame) => {
    if (test && !test(m, ctx)) return null;
    const range = group(m, "target");
    let result = found(ctx, frame, m, range, [word]);
    if (!result) {
      result = {
        ruleId: frame.ruleId,
        messageKey: frame.messageKey,
        range: { start: range[0], end: range[1] },
        alternatives: [],
      };
      HELD.add(result);
    }
    WORSE.add(result);
    return result;
  };

// A person who is a "nerve wreck" is a "nervous wreck"; a situation ("It was a nerve-wreck",
// "so much nerve wreck") is left alone.
const SITUATION =
  /(?:\bmuch|\b(?:it|this|that|which)(?:['’]s|[ \t ]+(?:is|was|were|be|been|will[ \t ]+be))[ \t ]+(?:(?:a|such[ \t ]+a|quite[ \t ]+a|a[ \t ]+real|a[ \t ]+total|a[ \t ]+complete)[ \t ]+)?)[ \t ]*$/i;
const NONSENSE_CUE =
  /(?:\b(?:complete|total|utter|absolute|pure|such|dogs|is|was|its|thats|what|bloody|just)|['’]s)[ \t ]+$/i;

/** A frame whose `target` takes one replacement; null keeps the typed text. */
const swap =
  (replace: (typed: string) => string | null, raw = false): MatchFixer =>
  (m, ctx, frame) => {
    const range = group(m, "target");
    const typed = ctx.text.slice(...range);
    // A noun after "has past" keeps "past" an adjective: "has past experience", "had past due".
    if (/^past$/i.test(typed)) {
      const next = nextWord(ctx, range[1]);
      if (next && (nounLike(next) || /^due$/i.test(next))) return null;
    }
    const replacement = replace(typed);
    return replacement ? found(ctx, frame, m, range, [replacement], !raw) : null;
  };
const FORMS = (pairs: Record<string, string>) => (typed: string) =>
  pairs[typed.toLowerCase()] ?? null;

const CORE_TO_FAR_NEXT = /^(?:with|for|on|in|this|and|but|when|because|like|away|off|out|flung)$/i;
// "set the font to big for headings" names a value; "from small to big" a range.
const SETTING_VERB =
  /\b(?:set|sets|setting|change|changes|changed|changing|switch|switched|resize|resized|scale|scaled|convert|converted|from|increase|increased|reduce|reduced|default|defaults|move|moved|grow|grows|grew|shrink|shrank)\b[^.!?;:\n]*$/i;

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  doseSubject: (m, ctx, frame) => found(ctx, frame, m, group(m, "target"), ["does"]),
  doseWh: (m, ctx, frame) => {
    const { next, then = "" } = m.groups!;
    if (!atClauseStart(ctx, m.index) || NOUN_DOSE_NEXT.test(next)) return null;
    const pronoun = PRONOUN_NEXT.test(next);
    if (!pronoun && englishWordInfo(next.toLowerCase())?.plural) return null;
    // "what dose it takes": a third-person verb after the pronoun keeps "dose" a noun.
    if (pronoun && hasVerbForm(then.toLowerCase(), "third")) return null;
    return found(ctx, frame, m, group(m, "target"), ["does"]);
  },
  doseQuestion: (m, ctx, frame) => {
    const verb = m.groups!.verb;
    if (!atClauseStart(ctx, m.index) || /^(?:back|up|off|out|down|too|twice|once)$/i.test(verb))
      return null;
    return hasVerbForm(verb, "base") ? found(ctx, frame, m, group(m, "target"), ["does"]) : null;
  },
  worstToWorse: worseForm("worse"),
  // "getting worst accuracy", "makes them worst case": a noun after it makes it a superlative.
  worstGet: worseForm("worse", (m, ctx) => !nounLike(nextWord(ctx, group(m, "target")[1]))),
  worseToWorst: worseForm("worst"),
  howLooksLike: (m, ctx, frame) => {
    const { subject, verb } = m.groups!;
    const single = /^(?:it|he|she|this|that|everything)$/i.test(subject);
    const agreed = /ed$/i.test(verb) ? "looked" : single ? "looks" : "look";
    return found(ctx, frame, m, group(m, "target"), [
      `what ${subject} ${agreed} like`,
      `how ${subject} ${agreed}`,
    ]);
  },
  howDoesLike: (m, ctx, frame) => found(ctx, frame, m, group(m, "target"), ["what"]),
  makeSeem: (m, ctx, frame) => {
    const prior = before(ctx, m.index, 48);
    if (/\b(?:who|whoever|whatever|what)[ \t ]+$/i.test(prior)) return null;
    if (
      /^making$/i.test(m.groups!.make) &&
      !/\b(?:of|by|for|from|without|avoid|stop|keep|keeps|kept|is|are|was|were|be|been)[ \t ]+$/i.test(
        prior,
      )
    )
      return null;
    return found(ctx, frame, m, group(m, "target"), ["seem"]);
  },
  nerveWreck: (m, ctx, frame) => {
    if (SITUATION.test(before(ctx, m.index, 48))) return null;
    const [nerve, wreck] = m.groups!.target.split(/[ \t -]+/);
    const nervous = applyWordCase("nervous", detectWordCase(nerve));
    return found(ctx, frame, m, group(m, "target"), [`${nervous} ${wreck}`]);
  },
  bullocks: (m, ctx, frame) => {
    const [, end] = group(m, "target");
    const exclamation =
      (atClauseStart(ctx, m.index) || /["“'‘]$/.test(before(ctx, m.index, 1))) &&
      /^[ \t ]*!/.test(ctx.text.slice(end));
    return exclamation || NONSENSE_CUE.test(before(ctx, m.index, 48))
      ? found(ctx, frame, m, group(m, "target"), ["bollocks"])
      : null;
  },
  conformThat: swap(
    FORMS({
      conform: "confirm",
      conforms: "confirms",
      conformed: "confirmed",
      conforming: "confirming",
    }),
  ),
  constitutesAs: swap((typed) => typed.split(/[ \t ]+/)[0]),
  hasPast: swap(() => "passed"),
  payedPaid: swap((typed) => typed.slice(0, -5) + "paid"),
  // The replacement already carries the typed casing.
  toAHalt: swap((typed) => (typed === typed.toUpperCase() ? "A " : "a ") + typed, true),
  raiseQuestion: swap(
    (typed) =>
      ({
        rise: "raise",
        rises: "raises",
        rising: "raising",
        arise: "raise",
        arises: "raises",
        arising: "raising",
      })[typed.toLowerCase()] ?? "raised",
  ),
  inDetail: swap(() => "detail"),
  nowadays: swap(() => "nowadays"),
  eatItToo: swap(() => "too"),
  tooToInfinitive: swap(() => "to"),
  toFar: (m, ctx, frame) => {
    const next = nextWord(ctx, m.index + m[0].length);
    if (!next || CORE_TO_FAR_NEXT.test(next) || nounLike(next, false)) return null;
    return found(ctx, frame, m, group(m, "target"), ["too"]);
  },
  toBigFor: (m, ctx, frame) =>
    SETTING_VERB.test(before(ctx, m.index, 48))
      ? null
      : found(ctx, frame, m, group(m, "target"), ["too"]),
  wroteRote: (m, ctx, frame) => found(ctx, frame, m, group(m, "target"), ["rote"]),
  govt: (m, ctx, frame) => {
    const [start, end] = group(m, "target");
    return found(ctx, frame, m, [start, m.groups!.dot ? end + 1 : end], ["government"]);
  },
  wishWere: (m, ctx, frame) => found(ctx, frame, m, group(m, "target"), ["were"]),
} satisfies Record<string, MatchFixer>;

/** The named findings filters of grammar/rules/en.yaml (`filter:`). */
export const FILTERS = {
  /** A worse/worst word keeps the finding of the first frame that matched it. */
  firstWorseFrame: (_ctx, findings) => {
    const seen = new Set<number>();
    return findings.filter((f) => {
      if (!WORSE.has(f)) return true;
      if (seen.has(f.range.start)) return false;
      seen.add(f.range.start);
      return !HELD.has(f);
    });
  },
} satisfies Record<string, FindingsFilter>;

const fixedPhrasesRule = frameRuleDetector("en.fixedPhrases", { en: FIXERS }, { en: FILTERS });
/** The fixed-phrase frames, whatever checks are on: other checks read them in a view. */
export const fixedPhrases = (view: DetectContext) =>
  fixedPhrasesRule({ ...view, rules: undefined });
