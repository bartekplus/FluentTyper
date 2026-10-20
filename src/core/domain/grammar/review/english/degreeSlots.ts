import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import {
  afterBreak,
  caseLike,
  evidence,
  info,
  nounOnly,
  type Token,
  tokensAfter,
  wordBefore,
} from "./slotWords";
import { finding } from "../finding";

// "to" where the degree adverb "too" is meant, decided by what surrounds it: a linking verb
// before and a predicate adjective after ("it's to late"), a degree word closing the clause
// ("they cost to much"), or "two much".

// Degree words that only "too" can take before a clause end.
const DEGREE_WORDS = new Set("much many little few late soon early far long".split(" "));
// What may follow the degree phrase: the end, an infinitive, a for-phrase or a reason.
const AFTER = new Set("to for because now and with in at about from off away ago".split(" "));
// Predicate adjectives the lexicon gives no class.
const PREDICATIVE = new Set("afraid alone awake asleep".split(" "));

/** An adjective (or participle) that cannot be a verb after an infinitive "to". */
function degreeTarget(word: string): boolean {
  if (DEGREE_WORDS.has(word) || PREDICATIVE.has(word)) return true;
  if (/^(?:one|two|three|four|five|six|seven|eight|nine|ten)$/.test(word)) return false;
  const read = info(word);
  // "was to trying…": an -ing form is a verb after "to".
  if (!read || read.verbs.some((v) => v.form === "base" || v.form === "third" || v.form === "ing"))
    return false;
  return read.adjective || read.verbs.some((v) => v.form === "participle");
}

const closesAt = (tokens: Token[], k: number) => {
  const t = tokens[k];
  return !t || t.kind === "end" || t.kind === "comma" || (t.kind === "word" && AFTER.has(t.lower));
};

/** The word after "to" is a degree target and the phrase closes there. */
function closedDegree(ctx: DetectContext, end: number, strict: boolean): boolean {
  const tokens = tokensAfter(ctx, end, 4);
  const word = tokens[0];
  if (word?.kind !== "word" || word.text !== word.lower || !degreeTarget(word.lower)) return false;
  // A glued token ("lift.js") or an infinitive that is not a known verb ("to frobnicate", "to.").
  if (tokens.some((t) => t.kind === "other")) return false;
  if (
    tokens[1]?.lower === "to" &&
    !(
      tokens[2]?.kind === "word" &&
      englishWordInfo(tokens[2].lower)?.verbs.some((v) => v.form === "base")
    )
  )
    return false;
  // "much of a stretch"; "much more" is a comparison ("led to much more").
  if (/^(?:much|many)$/.test(word.lower) && tokens[1]?.lower === "of") return !strict;
  return closesAt(tokens, 1) && (!strict || tokens[1]?.kind !== "word");
}

/** "too" for the typed `target`; a user word stays. */
function tooFix(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const [start, end] = m.indices!.groups!.target;
  const target = m.groups!.target;
  if (ctx.dictionary.has(target.toLowerCase())) return null;
  return finding("englishToToo", "review_msg_to_too", start, end, [caseLike(target, "too")], {
    context: evidence(ctx, m.index, m.index + m[0].length),
  });
}

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  degreeLinking: (m, ctx) => {
    // "He seemed to noticed": after "seem", a past form that is no adjective wants the base.
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0]?.lower ?? "";
    const read = info(next);
    if (
      /^seem/i.test(m[0]) &&
      !read?.adjective &&
      read?.verbs.some((v) => v.form === "past") &&
      !DEGREE_WORDS.has(next)
    )
      return null;
    if (closedDegree(ctx, m.index + m[0].length, false)) return tooFix(ctx, m);
    return null;
  },
  degreeAdverb: (m, ctx) => {
    const before = wordBefore(ctx, m.index);
    // "the way to go", "a long way to …", "how far to drive": "to" heads an infinitive.
    if (/^(?:the|a|this|that|one|no|best|which|how|so|as|too)$/.test(before)) return null;
    if (closedDegree(ctx, m.index + m[0].length, true)) return tooFix(ctx, m);
    return null;
  },
  degreeClauseEnd: (m, ctx) => {
    // "amount to much", "come to much", "up to much", "set it to late": "to" is a preposition.
    if (
      /^(?:amounts?|amounted|comes?|came|coming|up|set|sets|switch|changed?|moved?|default|defaults|postponed?|delayed?|back|down)$/.test(
        m.groups!.verb,
      )
    )
      return null;
    const read = info(m.groups!.verb);
    if (!read?.verbs.length) return null;
    return tooFix(ctx, m);
  },
  degreeTryHard: (m, ctx) => tooFix(ctx, m),
  degreeMeasured: (m, ctx) =>
    closedDegree(ctx, m.index + m[0].length, true) ? tooFix(ctx, m) : null,
  degreeObjectAmount: (m, ctx) => {
    const { verb, amount, noun } = m.groups!;
    // "gave to many charities": a recipient.
    if (amount === "many" && /^g[ai]ve/.test(verb)) return null;
    if (nounOnly(noun) || info(noun)?.noun) return tooFix(ctx, m);
    return null;
  },
  degreeSubjectAmount: (m, ctx) => {
    const before = wordBefore(ctx, m.index);
    if (!afterBreak(ctx, m.index) && !/^(?:because|since|as|when|if|and|but|so|that)$/.test(before))
      return null;
    if (!nounOnly(m.groups!.noun) && !info(m.groups!.noun)?.noun) return null;
    return tooFix(ctx, m);
  },
  degreeTwoMuch: (m, ctx) => {
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (next?.kind === "word" && /(?:er|more|less)$/.test(next.lower)) return null;
    return tooFix(ctx, m);
  },
  degreeOneToMany: (m, ctx) => {
    const noun = m.groups!.noun;
    if (nounOnly(noun) === "plural" || info(noun)?.plural) return tooFix(ctx, m);
    return null;
  },
  degreeOpening: (m, ctx) => {
    if (!afterBreak(ctx, m.index) && !/^(?:ah|oh|aw)$/.test(wordBefore(ctx, m.index))) return null;
    const word = m.groups!.word;
    if (word !== word.toLowerCase() || !degreeTarget(word)) return null;
    if (DEGREE_WORDS.has(word) && word !== "late" && word !== "much") return null;
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (next && next.kind === "word" && next.lower !== "that") return null;
    return tooFix(ctx, m);
  },
} satisfies Record<string, MatchFixer>;
