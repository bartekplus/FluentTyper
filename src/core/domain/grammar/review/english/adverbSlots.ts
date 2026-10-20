import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { afterBreak, evidence, FUNCTION_WORDS, type Token, tokensAfter } from "./slotWords";
import { finding } from "../finding";

// An adjective where its -ly adverb belongs: between an auxiliary, "to" or a subject and a
// verb ("could possible go", "to easy achieve"), or before another adjective after be
// ("is terrible slow"). The frames are in grammar/rules/en.yaml.

// Colour and shade words combine with each other ("dark blue"), and these adjectives are
// adverbs too ("fast", "hard", "late", "well").
const NOT_ADVERB_BASE = new Set(
  "dark light bright pale deep red blue green yellow black white brown grey gray pink orange purple fast hard late early well long low high straight free sure dead".split(
    " ",
  ),
);

const COMPOUND_VERBS = new Set([
  "cold call",
  "private message",
  "direct message",
  "double check",
  "double click",
  "fast track",
  "spot check",
  "dry clean",
  "deep fry",
  "free ride",
  "blind copy",
  "soft launch",
  "hard code",
  "cross check",
]);

/** The -ly adverb of an adjective, when the lexicon knows it as an adverb. */
function adverbOf(adjective: string): string | null {
  if (adjective.length < 4 || NOT_ADVERB_BASE.has(adjective) || FUNCTION_WORDS.has(adjective))
    return null;
  const read = englishWordInfo(adjective);
  if (!read?.adjective || read.verbs.length || read.adverb) return null;
  const candidates = [
    adjective.replace(/le$/, "ly"),
    adjective.replace(/ic$/, "ically"),
    adjective.replace(/y$/, "ily"),
    `${adjective}ly`,
  ];
  return (
    candidates.find((c) => {
      if (c === adjective || !/ly$/.test(c)) return false;
      const ly = englishWordInfo(c);
      // Some -ly words are listed with no class ("understandably").
      return !!ly && (ly.adverb || (!ly.noun && !ly.adjective && !ly.verbs.length));
    }) ?? null
  );
}

/** A verb form the auxiliary or subject before the adjective takes. */
function verbAfter(
  word: string,
  kind: "base" | "participle" | "finite",
  after: Token | undefined,
  derived: boolean,
): boolean {
  const read = englishWordInfo(word);
  if (!read || FUNCTION_WORDS.has(word))
    return kind === "finite"
      ? /^(?:has|does|had|did|should|would|could|can|will|must|might|may)$/.test(word)
      : /^(?:be|have|do|not)$/.test(word);
  // "Would soft wire work", "could private message me": a noun after the adjective, unless
  // the phrase ends there ("could possible work.").
  const nounEnds = !after || after.kind === "end" || after.kind === "comma";
  // "we temporary stay the course": a noun-or-verb with its own object after it. Only for a
  // long derived adverb: "could private message me", "cold transfer" are compound verbs.
  // After a subject pronoun the word is a finite verb anyway: "You simple need the cable".
  const objectNext =
    (derived || kind === "finite") &&
    after?.kind === "word" &&
    /^(?:the|a|an|my|your|his|her|our|their|this|these|those|it|them|him|us|me|you|all|some|any|out|up|down|off|away|back)$/.test(
      after.lower,
    );
  if (kind === "base")
    return (
      (!read.noun || nounEnds || objectNext) &&
      read.verbs.some((v) => v.form === "base" && v.lemma === word)
    );
  if (kind === "participle") return read.verbs.some((v) => v.form === "participle");
  return (
    (!read.noun || objectNext) &&
    read.verbs.some((v) => v.form === "past" || v.form === "third" || v.form === "base")
  );
}

// The rule keeps one finding per start: its filter is usSlotsOnePerStart.
function push(ctx: DetectContext, m: RegExpExecArray, adverb: string): RawFinding {
  const [start, end] = m.indices!.groups!.target;
  return finding("englishConfusedWords", "review_msg_adverb_form", start, end, [adverb], {
    context: evidence(ctx, m.index, end + 24),
  });
}

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  adverbAdjectiveForAdverb1: (m, ctx) => {
    const { target, verb } = m.groups!;
    const lead = /([A-Za-z'’]+)[ \t\u00a0]+$/.exec(
      ctx.text.slice(Math.max(0, m.index - 16), m.index),
    )![1];
    if (ctx.dictionary.has(target) || target !== target.toLowerCase()) return null;
    const adverb = adverbOf(target);
    if (!adverb) return null;
    const l = lead.toLowerCase();
    const kind = /^(?:have|has|had)$/.test(l)
      ? "participle"
      : /^(?:i|we|you|they|it|he|she)$/.test(l)
        ? "finite"
        : "base";
    // "to" must be an infinitive marker: "how to quick fix" yes, "close to perfect" no.
    // A verb that is no noun after it shows the infinitive too: "wise to temporary disable".
    const verbRead = englishWordInfo(verb);
    const verbOnly = !!verbRead?.verbs.length && !verbRead.noun && !verbRead.adjective;
    if (
      l === "to" &&
      !verbOnly &&
      !/\b(?:how|tried|try|trying|want|wants|need|needs|like|order|able|is|was|are|were)[ \t\u00a0]+to[ \t\u00a0]+$/i.test(
        ctx.text.slice(Math.max(0, m.index - 24), m.index),
      )
    )
      return null;
    // "Should intent be part of…": an inverted modal makes the next word its subject.
    if (kind === "base" && afterBreak(ctx, m.index - lead.length - 1)) return null;
    // "We cold call them": an adjective-noun compound verb.
    if (COMPOUND_VERBS.has(`${target} ${verb}`)) return null;
    const after = tokensAfter(ctx, m.indices!.groups!.verb[1], 1)[0];
    if (!verbAfter(verb, kind, after, /(?:ily|ally|bly)$/.test(adverb))) return null;
    return push(ctx, m, adverb);
  },
  adverbAdjectiveForAdverb2: (m, ctx) => {
    const { target, next } = m.groups!;
    if (target !== target.toLowerCase() || ctx.dictionary.has(target)) return null;
    if (!/(?:ble|al|ary|ic|ent|ous|ive|ful|ple|real|easy)$/.test(target)) return null;
    const adverb = adverbOf(target);
    if (!adverb) return null;
    const read = englishWordInfo(next);
    // The second word must be a predicate adjective or participle, never a noun.
    if (
      !read ||
      read.noun ||
      read.plural ||
      !(read.adjective || read.verbs.some((v) => v.form === "participle"))
    )
      return null;
    if (NOT_ADVERB_BASE.has(next) || FUNCTION_WORDS.has(next)) return null;
    // "be reasonable based on", "necessary soon": a preposition-like participle or an adverb.
    if (
      /^(?:soon|early|late|later|earlier|sooner|longer|enough|then|based|compared|given|considering|including|regarding)$/.test(
        next,
      )
    )
      return null;
    return push(ctx, m, adverb);
  },
} satisfies Record<string, MatchFixer>;
