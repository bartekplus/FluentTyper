import { englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { SPACE as S } from "../phraseTemplates";
import type { DetectContext } from "../reviewDetectors";
import type { Fixer } from "../../engine/reviewRules";
import { MASS, nounNumber } from "./nounNumberSlots";
import {
  afterBreak,
  AUXILIARIES,
  FUNCTION_WORDS,
  info,
  nounOnly,
  tokensAfter,
  wordBefore,
} from "./slotWords";

const read = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);
// Pronouns the lexicon reads as nouns: "She like everyone was tired" is "like" the preposition.
const NOT_LIKED = new Set(
  "all none one everyone everybody someone somebody anyone anybody nobody nothing something anything everything".split(
    " ",
  ),
);
/**
 * "He like pizza": a bare lowercase noun with no other verb, adjective or adverb reading, and no
 * finite verb after it ("She like teachers knows", "like" the preposition). "It like magic" is
 * "It's like magic", so "it" abstains.
 */
function likedNoun(m: RegExpExecArray, ctx: DetectContext): boolean {
  const { who, noun } = m.groups!;
  if (who.toLowerCase() === "it" || noun !== noun.toLowerCase() || NOT_LIKED.has(noun))
    return false;
  const r = info(noun);
  if (!r?.noun || r.adjective || r.adverb || r.verbs.some((v) => v.form !== "third")) return false;
  const [after] = tokensAfter(ctx, m.index + m[0].length, 1);
  if (after.kind !== "word") return true;
  if (AUXILIARIES.has(after.lower)) return false;
  return !info(after.lower)?.verbs.some((v) => v.form === "third" || v.form === "past");
}
// A verb with "like" before ("He fought like lions. She like tigers.") or a second "<pronoun>
// like" in the sentence ("he like lions, but she like tigers"): the verb is left out.
const VERB_LIKE = new RegExp(`\\b(?!(?:he|she|it|they|we|you|i)\\b)[a-z]+${S}like\\b`, "i");
const PRONOUN_LIKE = new RegExp(`\\b(?:he|she|it|they|we|you|i)${S}like\\b`, "i");
function ellipsis(m: RegExpExecArray, ctx: DetectContext): boolean {
  const end = m.index + m[0].length;
  const before = ctx.text.slice(Math.max(0, m.index - 160), m.index);
  if (VERB_LIKE.test(before)) return true;
  // An object pronoun is no ellipsis: "He like me, she like you."
  if (/^(?:me|you|him|her|us|them|it)$/i.test(m[0].split(/\s+/).at(-1)!)) return false;
  const sentence = `${/[^.!?\n]*$/.exec(before)![0]} ${/^[^.!?\n]*/.exec(ctx.text.slice(end, end + 160))![0]}`;
  return PRONOUN_LIKE.test(sentence);
}
const COLLECTIVE = new Set(
  "staff police personnel cattle clergy crew team family government audience faculty public youth people".split(
    " ",
  ),
);
const COMPARATIVE: Record<string, string> = {
  fast: "faster",
  slow: "slower",
  big: "bigger",
  small: "smaller",
  cheap: "cheaper",
  easy: "easier",
  hard: "harder",
  long: "longer",
  short: "shorter",
  high: "higher",
  low: "lower",
  quick: "quicker",
  safe: "safer",
  large: "larger",
  nice: "nicer",
  good: "better",
  bad: "worse",
  strong: "stronger",
  young: "younger",
  old: "older",
};

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // "The United States are 246 years old": one country.
  clauseFramesAre: (m, ctx) =>
    !afterBreak(ctx, m.index)
      ? null
      : { are: "is", were: "was", have: "has" }[m.groups!.target.toLowerCase() as "are"],
  // "The symptom's vary": a plural before a plural verb ("my dad's are blue" is elliptical).
  clauseFramesNoun: (m) => {
    const n = nounNumber(m.groups!.noun);
    return n?.number === "singular" && m.groups!.noun !== "let" ? n.plural : null;
  },
  // "It you have any questions": if.
  clauseFramesIt: (m, ctx) =>
    afterBreak(ctx, m.index) || /^(?:and|but|so)$/.test(wordBefore(ctx, m.index)) ? "if" : null,
  // "Help us helps you", "Let us documents it": the base after let/help/make + object.
  clauseFramesA: (m, ctx) => {
    const word = m.groups!.target;
    const r = read(word);
    if (!r?.verbs.some((v) => v.form === "third")) return null;
    // "made us friends.", "help me guys.": a plural noun object, not a verb.
    if (r.plural && /^[ \t\u00a0]*[.!?,]/.test(ctx.text.slice(m.index + m[0].length))) return null;
    return englishLemma(word, "third");
  },
  // "Nobody told me nothing": anything after a negative subject.
  clauseFramesNothing: (m) => {
    const r = read(m.groups!.verb);
    if (!r?.verbs.some((v) => v.form === "past" || v.form === "third")) return null;
    return m.groups!.target.toLowerCase().replace(/^no/, "any");
  },
  // "What is reason that it fails?": the reason.
  clauseFramesReason: (m) => ({
    alternatives: [`the ${m.groups!.target}`, `a ${m.groups!.target}`],
  }),
  // "in Tuesday", "At this Saturday": on.
  clauseFramesIn: (m, ctx) =>
    /^[A-Z][a-z]/.test(m.groups!.day) &&
    (m.groups!.lead || m.groups!.near || afterBreak(ctx, m.index))
      ? "on"
      : null,
  // "We left in a harry": hurry (not "a Harry Potter book").
  clauseFramesHarry: (m) => (m.groups!.target === "harry" ? "hurry" : null),
  // "He graduated the university": graduated from.
  clauseFramesGraduated: (m) => `${m.groups!.target} from`,
  // "This results missed the estimate", "This guys have left": these.
  clauseFramesThis: (m, ctx) => {
    if (!afterBreak(ctx, m.index)) return null;
    const verb = read(m.groups!.verb);
    const pastOnly =
      !!verb?.verbs.some((v) => v.form === "past") &&
      !verb.noun &&
      !verb.verbs.some((v) => v.form === "base" || v.form === "third");
    return (nounNumber(m.groups!.noun)?.number === "plural" || m.groups!.noun === "guys") &&
      (pastOnly || /^(?:have|are|were|do)$/.test(m.groups!.verb))
      ? "these"
      : null;
  },
  // "some language are complicated": some + a plain count noun + a plural verb.
  clauseFramesA2: (m) => {
    const noun = m.groups!.target;
    const r = read(noun);
    if (r && (!r.noun || r.adjective || r.adverb || r.verbs.some((v) => v.form !== "base")))
      return null;
    const n = nounNumber(noun);
    return n?.number === "singular" && !MASS.has(noun) && !COLLECTIVE.has(noun) ? n.plural : null;
  },
  // "It is a much fast route": a comparative after "much".
  clauseFramesFast: (m) => COMPARATIVE[m.groups!.target.toLowerCase()],
  // "He like me", "It like a higher power", "She like pizza": likes / is like.
  clauseFramesLike: (m, ctx) =>
    (afterBreak(ctx, m.index) || /^(?:but|so|because)$/.test(wordBefore(ctx, m.index))) &&
    !ellipsis(m, ctx) &&
    (!m.groups!.noun || likedNoun(m, ctx))
      ? ["likes", "is like"]
      : null,
  // "entered the he house": a stray pronoun after the article.
  clauseFramesThe: (m) => {
    const noun = m.groups!.noun;
    if (m.groups!.pron !== m.groups!.pron.toLowerCase()) return null;
    return (read(noun)?.noun || nounOnly(noun)) && !FUNCTION_WORDS.has(noun) ? "the" : null;
  },
  // "at the at the turn": a doubled preposition phrase.
  clauseFramesPrep: (m) => `${m.groups!.prep} the`,
  // "The fox' tail": an -x noun takes 's.
  clauseFramesNoun2: (m) => (read(m.groups!.noun)?.noun ? `${m.groups!.noun}'s` : null),
  // "They custom build a solution": the verb compound is hyphenated.
  clauseFramesCustom: (m) => `custom-${m.groups!.verb}`,
  // "has been signed-in": the verb phrase is open.
  clauseFramesSigned: (m) => m.groups!.target.replace("-", " "),
  // "Neither children are happy": neither of the.
  clauseFramesNeither: (m) => {
    const noun = m.groups!.noun;
    return nounOnly(noun) === "plural" || /^(?:children|people|men|women)$/.test(noun)
      ? "neither of the"
      : null;
  },
  // "There are number of animals": a number of.
  clauseFramesNumber: (m) => (nounNumber(m.groups!.noun)?.number === "plural" ? "a number" : null),
  // "that kind of stories": a singular kind with a plural noun.
  clauseFramesDem: (m, ctx) => {
    const { dem, kind, noun } = m.groups!;
    const r = read(noun);
    if (
      r?.verbs.some((v) => v.form === "third") &&
      (!r.plural || /^[ \t\u00a0]*[.!?,]/.test(ctx.text.slice(m.index + m[0].length)))
    )
      return null;
    const n = nounNumber(noun);
    if (n?.number !== "plural") return null;
    const single = n.singular;
    const these = dem.toLowerCase() === "this" ? "these" : "those";
    return [`${dem} ${kind} of ${single}`, `${these} ${kind}s of ${noun}`];
  },
  // "As Christopher show us": a name's verb takes -s.
  clauseFramesA3: (m) => {
    const { name, target } = m.groups!;
    if (!/^[A-Z][a-z]+[^s]$/.test(name) || read(name)?.noun || nounOnly(name.toLowerCase()))
      return null;
    const r = read(target);
    if (!r?.verbs.length || !r.verbs.every((v) => v.form === "base") || r.adjective) return null;
    if (FUNCTION_WORDS.has(target)) return null;
    return /[^aeiou]y$/.test(target)
      ? `${target.slice(0, -1)}ies`
      : /(?:s|x|z|ch|sh|o)$/.test(target)
        ? `${target}es`
        : `${target}s`;
  },
  // "David and I's cat": David's and my.
  clauseFramesWho: (m, ctx) =>
    wordBefore(ctx, m.index) === "the" ? null : `${m.groups!.who}'s and my`,
} satisfies Record<string, Fixer>;
