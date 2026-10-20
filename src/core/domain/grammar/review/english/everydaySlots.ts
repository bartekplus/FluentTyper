import { englishInflect, englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishNounPair, englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { FindingsFilter, FrameRef, MatchFixer } from "../../engine/reviewRules";
import {
  afterBreak,
  pushSlot,
  FUNCTION_WORDS,
  nounOnly,
  tokensAfter,
  wordBefore,
} from "./slotWords";
import { quotedMention } from "./grammarStyle1";
import { nounNumber } from "./nounNumberSlots";

// Everyday slips in verb frames, existentials and fixed word pairs: "keep see" (seeing),
// "going be" (to be), "makes me thinking" (think), "Was there many…" (Were), "reading though
// the contract" (through), "give me advise" (advice), "would we helpful" (be), "do not us
// this" (use), "take sometime" (some time), "went good" (well), "Do anyone know" (Does).
// The frames are in grammar/rules/en.yaml.

/** The slot finding of `m`: its `group` gets `fix` in the case the user typed. */
export function slotFinding(
  ctx: DetectContext,
  frame: FrameRef,
  m: RegExpExecArray,
  fix: string,
  group = "target",
): RawFinding[] {
  const findings: RawFinding[] = [];
  pushSlot(ctx, findings, { ruleId: frame.ruleId, messageKey: frame.messageKey }, m, fix, group);
  return findings;
}

/** English (US) only; findings in a quoted or named example, or out of the chunk, are dropped. */
const usSlots: FindingsFilter = (ctx, findings) =>
  ctx.lang !== "en_US"
    ? []
    : findings.filter(
        (f) => f.range.start >= ctx.from && f.range.start < ctx.to && !quotedMention(ctx, f),
      );

/** usSlots after a pass that keeps the first finding of each group of `same` findings. */
const firstOf =
  (same: (a: RawFinding, b: RawFinding) => boolean): FindingsFilter =>
  (ctx, findings) =>
    usSlots(
      ctx,
      findings.filter((f, i) => findings.findIndex((g) => same(f, g)) === i),
    );

/** The named findings filters of the slot rules of grammar/rules/en.yaml (`filter:`). */
export const FILTERS = {
  usSlots,
  /** usSlots, and one finding per range: the first one. */
  usSlotsOnePerRange: firstOf(
    (a, b) => a.range.start === b.range.start && a.range.end === b.range.end,
  ),
  /** usSlots, and one finding per start: the first one. */
  usSlotsOnePerStart: firstOf((a, b) => a.range.start === b.range.start),
} satisfies Record<string, FindingsFilter>;

/** A base verb with no noun, adjective or other form: "see", "send", "explain". */
function bareVerb(word: string): boolean {
  if (FUNCTION_WORDS.has(word)) return false;
  const read = englishWordInfo(word);
  return (
    !!read &&
    read.verbs.length > 0 &&
    read.verbs.every((v) => v.form === "base" && v.lemma === word) &&
    !read.noun &&
    !read.adjective &&
    !read.adverb
  );
}

const TIME_WORDS = /^(?:today|tonight|tomorrow|yesterday|now|then|though|either|anyway|please)$/;
const does = (typed: string) => (/^do$/i.test(typed) ? "does" : "doesn't");

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  everydayKeep: (m, ctx, frame) => {
    const verb = m.groups!.target;
    if (ctx.dictionary.has(verb) || FUNCTION_WORDS.has(verb)) return null;
    // A verb that is also a noun ("keep track", "keep time") needs an object after it.
    const read = englishWordInfo(verb);
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    const object =
      next?.kind === "word" &&
      /^(?:the|a|an|this|that|these|those|my|your|his|her|our|their|its|it|them|me|us|him|you)$/.test(
        next.lower,
      );
    if (
      !bareVerb(verb) &&
      !(
        object &&
        !!read?.verbs.length &&
        read.verbs.every((v) => v.form === "base" && v.lemma === verb) &&
        !read.adjective
      )
    )
      return null;
    const ing = englishInflect(verb, "ing");
    return ing ? slotFinding(ctx, frame, m, ing) : null;
  },
  everydayGoing: (m, ctx, frame) => {
    const verb = m.groups!.target;
    if (ctx.dictionary.has(verb) || (verb !== "be" && !bareVerb(verb))) return null;
    return slotFinding(ctx, frame, m, `to ${verb}`);
  },
  everydayCausative: (m, ctx, frame) => {
    const verb = m.groups!.target;
    const read = englishWordInfo(verb);
    if (!read || read.noun || read.adjective || ctx.dictionary.has(verb)) return null;
    // "The pool made me freezing", "made them recurring characters": an -ing adjective or a
    // gerund; only an object or a particle after it shows the verb.
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (
      next?.kind !== "word" ||
      !/^(?:the|a|an|this|that|these|those|my|your|his|her|our|their|its|it|them|me|us|him|of|about|into|on|at|for|to|with|up|out|over|through)$/.test(
        next.lower,
      )
    )
      return null;
    const base = englishLemma(verb, "ing");
    return base && base !== verb ? slotFinding(ctx, frame, m, base) : null;
  },
  everydayWasThere: (m, ctx, frame) => {
    if (!afterBreak(ctx, m.index)) return null;
    const { target, quantity, noun } = m.groups!;
    // "Is there a lot of water?": only a plural noun after "of" needs the plural verb.
    if (/of$/i.test(quantity) && nounNumber(noun)?.number !== "plural" && noun !== "people")
      return null;
    return slotFinding(ctx, frame, m, target.toLowerCase() === "was" ? "were" : "are");
  },
  everydayThough: (m, ctx, frame) => {
    // "It worked though the results were bad": a finite verb makes "though" a conjunction.
    const tokens = tokensAfter(ctx, m.index + m[0].length, 6);
    const end = tokens.findIndex((t) => t.kind !== "word");
    const clause = (end < 0 ? tokens : tokens.slice(0, end)).some((t) => {
      if (/^(?:is|are|was|were|has|have|had|will|would|can|could|did|does|do)$/.test(t.lower))
        return true;
      const read = englishWordInfo(t.lower);
      return !!read?.verbs.some((v) => v.form === "past" || v.form === "third") && !read.noun;
    });
    return clause ? null : slotFinding(ctx, frame, m, "through");
  },
  everydayAdvise: (m, ctx, frame) =>
    ctx.dictionary.has("advise") ? null : slotFinding(ctx, frame, m, "advice"),
  // "Would we be…?": at a clause start the modal opens a question.
  everydayWeBe: (m, ctx, frame) =>
    afterBreak(ctx, m.index) ? null : slotFinding(ctx, frame, m, "be"),
  everydayUsUse: (m, ctx, frame) => slotFinding(ctx, frame, m, "use"),
  everydayDoe: (m, ctx, frame) =>
    afterBreak(ctx, m.index)
      ? slotFinding(ctx, frame, m, /^(?:he|she|it)$/i.test(m.groups!.subject) ? "does" : "do")
      : null,
  // "This one works good enough for us" still wants well; "a good one" is no frame here.
  everydayWentGood: (m, ctx, frame) => slotFinding(ctx, frame, m, "well"),
  everydayLatter: (m, ctx, frame) => {
    const tokens = tokensAfter(ctx, m.index + m[0].length, 2);
    const after = /^(?:two|three|both)$/.test(tokens[0]?.lower ?? "") ? tokens[1] : tokens[0];
    // "the later of the two trains" compares times: a noun after it keeps "later".
    if (
      after?.kind === "word" &&
      !FUNCTION_WORDS.has(after.lower) &&
      englishWordInfo(after.lower)?.noun
    )
      return null;
    return slotFinding(ctx, frame, m, "latter");
  },
  everydayGotDid: (m, ctx, frame) => slotFinding(ctx, frame, m, "done"),
  everydayRegard: (m, ctx, frame) =>
    afterBreak(ctx, m.index) ? slotFinding(ctx, frame, m, "regards") : null,
  everydayEveryOne: (m, ctx, frame) => {
    // "warn everyone of the danger": a verb that takes "of" after its object.
    if (
      /^(?:warn|warns|warned|warning|remind|reminds|reminded|inform|informs|informed|notify|notified|accuse|accused|rob|robbed|deprive|deprived|convince|convinced|assure|assured|suspect|suspected|clear|cleared|relieve|relieved|cure|cured|free|freed|tell|told|ask|asked|rid)$/.test(
        wordBefore(ctx, m.index),
      )
    )
      return null;
    return slotFinding(ctx, frame, m, "every one");
  },
  everydayAnyWay: (m, ctx, frame) => slotFinding(ctx, frame, m, "any way"),
  // The match start owns the frame: the target is one of two groups.
  everydaySomeTime: (m, ctx, frame) =>
    m.index < ctx.from || m.index >= ctx.to
      ? null
      : slotFinding(ctx, frame, m, "some time", m.groups!.target ? "target" : "target2"),
  everydayAnyMore: (m, ctx, frame) => {
    const noun = m.groups!.noun;
    if (FUNCTION_WORDS.has(noun) || TIME_WORDS.test(noun)) return null;
    const read = englishWordInfo(noun);
    // "safe anymore due to…": an adjective after it starts a new phrase.
    if (read?.adjective) return null;
    if (!(
      nounOnly(noun) ||
      (read?.noun &&
        !read.adverb &&
        !read.verbs.some((v) => v.form !== "base" && v.form !== "third"))
    ))
      return null;
    return slotFinding(ctx, frame, m, "any more");
  },
  everydayMoreSingular: (m, ctx, frame) => {
    const noun = m.groups!.target;
    if (FUNCTION_WORDS.has(noun) || ctx.dictionary.has(noun)) return null;
    const read = englishWordInfo(noun);
    if (!read?.noun || read.plural || read.adjective || read.verbs.some((v) => v.form !== "base"))
      return null;
    const plural = noun === "person" ? "people" : englishNounPair(noun)?.plural;
    return plural ? slotFinding(ctx, frame, m, plural) : null;
  },
  everydayDoSingular: (m, ctx, frame) => {
    if (!afterBreak(ctx, m.index)) return null;
    // A question: "Do that mean…?" needs the base verb after the subject.
    const verb = m.groups!.verb;
    const read = englishWordInfo(verb);
    if (!read?.verbs.some((v) => v.form === "base" && v.lemma === verb)) return null;
    if (!/\?/.test(ctx.text.slice(m.index, m.index + 160).split(/[.!\n]/)[0])) return null;
    return slotFinding(ctx, frame, m, does(m.groups!.target));
  },
  everydayDoTag: (m, ctx, frame) => {
    // "He doesn't live here, do he?": the tag repeats the clause's own auxiliary.
    if (wordBefore(ctx, m.index) === "") {
      const clause = ctx.text.slice(Math.max(0, m.index - 80), m.index);
      if (!/\b(?:does|doesn['’]t|he|she|it)\b/i.test(clause)) return null;
    }
    return slotFinding(ctx, frame, m, does(m.groups!.target));
  },
} satisfies Record<string, MatchFixer>;
