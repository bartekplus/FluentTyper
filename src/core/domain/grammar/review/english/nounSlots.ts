import { ENGLISH_MASS_NOUNS } from "../../implementations/helpers/EnglishCountability";
import {
  englishCountNoun,
  englishNounPair,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import type { DetectContext } from "../reviewDetectors";
import type { Fixer } from "../../engine/reviewRules";
import { afterBreak, DETERMINERS, FUNCTION_WORDS, tokensAfter, wordBefore } from "./slotWords";

const read = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);
const lower = (word: string | undefined) => (word ?? "").toLowerCase();
// Plural-looking nouns that name one thing or one amount.
const ONE_THING =
  /^(?:news|means|series|species|headquarters|thanks|pants|scissors|glasses|jeans|trousers|shorts|clothes|goods|data|media|criteria|physics|mathematics|economics|politics|ethics|athletics|gymnastics|electronics|graphics|analytics|statistics|logistics|diabetes|measles|lens|bus|gas|plus|minus|status|campus|virus|bonus|focus|chaos|canvas|alias|atlas|apparatus|corps|crossroads|barracks|whereabouts)$/;
/** A lowercase plural noun with no verb, adjective or one-thing reading, and its singular. */
function pluralNoun(word: string): string | null {
  if (word !== lower(word) || ONE_THING.test(word) || /(?:ss|ics|us)$/.test(word)) return null;
  const r = read(word);
  if (!r?.plural || r.verbs.length || r.adjective || r.adverb || FUNCTION_WORDS.has(word))
    return null;
  return englishNounPair(word)?.singular ?? null;
}
/** A lowercase plural noun that may also be an -s verb ("chances", "parents"). */
const pluralWord = (word: string) =>
  word === lower(word) && !ONE_THING.test(word) && !!read(word)?.plural && !read(word)?.adjective;
/** A lowercase singular noun with no verb or adjective reading, and its plural. */
function singularNoun(word: string): string | null {
  if (word !== lower(word) || FUNCTION_WORDS.has(word)) return null;
  const r = read(word);
  if (!r?.noun || r.plural || r.verbs.length || r.adjective || r.adverb) return null;
  return englishNounPair(word)?.plural ?? word;
}
const nextToken = (ctx: DetectContext, end: number) => tokensAfter(ctx, end, 1)[0];
const ORDINAL = (n: number) =>
  n % 100 >= 11 && n % 100 <= 13
    ? "th"
    : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // "I have 1 days left", "I drew one hexagons": one takes the singular.
  nounSlotsA: (m, ctx) => {
    const before = wordBefore(ctx, m.index);
    // "No one cares", "twenty one years", "season one specials": a pronoun, a compound
    // number or a label. Only a lowercase verb or preposition before the count.
    if (
      !before ||
      DETERMINERS.has(before) ||
      /^(?:no|every|any|some|each|which|this|that|the|other|another|last|first|next|only|and|season|chapter|part|level|phase|room|page|step|day|week|year|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)$/.test(
        before,
      ) ||
      !/^[a-z]/.test(ctx.text.slice(m.index - before.length - 1, m.index).trim()) ||
      m.groups!.one === "One" ||
      m.groups!.target === "innings"
    )
      return null;
    return pluralNoun(m.groups!.target);
  },
  // "We added a lot functionality", "a lot spikes": a lot of.
  nounSlotsA2: (m) => {
    const noun = m.groups!.noun;
    const mass =
      ENGLISH_MASS_NOUNS.has(noun) && !read(noun)?.verbs.length && !read(noun)?.adjective;
    return pluralNoun(noun) || mass ? "a lot of" : null;
  },
  // "It's a simply solution", "a philosophically question": the adjective before a noun.
  nounSlotsA3: (m, ctx) => {
    // "holding down A shortly after": a capital A mid-sentence names a key or a grade.
    if (/^A/.test(m[0]) && !afterBreak(ctx, m.index)) return null;
    const word = m.groups!.target;
    const r = read(word);
    if (!r?.adverb || r.adjective || r.noun || r.verbs.length) return null;
    if (!singularNoun(m.groups!.noun)) return null;
    const next = nextToken(ctx, m.index + m[0].length);
    // "a hugely dominant market position": the noun phrase goes on.
    if (
      next?.kind === "word" &&
      !FUNCTION_WORDS.has(next.lower) &&
      (read(next.lower)?.noun || read(next.lower)?.plural)
    )
      return null;
    const stem = word.slice(0, -2);
    const candidates = [
      word.replace(/ically$/, "ical"),
      word.replace(/ily$/, "y"),
      word.replace(/bly$/, "ble"),
      word.replace(/ply$/, "ple"),
      word.replace(/lly$/, "l"),
      stem,
    ];
    return (
      candidates.find(
        (c) => c !== word && c.length > 2 && !!read(c)?.adjective && !FUNCTION_WORDS.has(c),
      ) ?? null
    );
  },
  // "Is there any chances that…", "there was updates daily": a plural takes are/were.
  nounSlotsIs: (m) =>
    pluralWord(m.groups!.noun) ? (lower(m.groups!.target) === "is" ? "are" : "were") : null,
  nounSlotsWas: (m) => {
    const noun = m.groups!.noun;
    const r = read(noun);
    // "updates" is a verb too; a time word or adverb after it shows the noun.
    if (!r?.plural || r.adjective || ONE_THING.test(noun) || /(?:ss|us)$/.test(noun)) return null;
    if (
      !/^(?:daily|every|each|weekly|monthly|yearly|to|for|in|on|at|from|with|about|since|that|which|all|available|here|there|left|\d)$/.test(
        lower(m.groups!.next),
      )
    )
      return null;
    return lower(m.groups!.target) === "is" ? "are" : "were";
  },
  // "Here the specs of the device.", "Here some files from our plugin": Here is/are.
  nounSlotsHere: (m, ctx) => {
    if (m.groups!.target !== "Here" || !afterBreak(ctx, m.index)) return null;
    // "Here the group of children is studied": a verb later in the sentence.
    const clause = /^[^.!?;:\n]*/.exec(
      ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 200),
    )![0];
    if (
      (clause.match(/[A-Za-z]+(?:['’][a-z]+)?/g) ?? []).some((w) => {
        const r = read(w);
        return (
          /^(?:is|are|was|were|has|have|had|can|could|will|would|should|must|may|might|won['’]t|isn['’]t)$/i.test(
            w,
          ) ||
          (!!r?.verbs.some((v) => v.form === "third" || v.form === "past" || v.form === "base") &&
            !r.noun &&
            !r.plural &&
            !r.adjective)
        );
      })
    )
      return null;
    const words = m.groups!.words.split(/[ \t ]+/);
    if (
      words.some((w) =>
        /^(?:is|are|was|were|has|have|had|can|will|would|could|should|must|may|might)$/i.test(w),
      )
    )
      return null;
    const head = words.at(-1)!;
    // "Here the water is deep", "Here the road ends": a verb in the phrase ends the check.
    if (
      words.some(
        (w) =>
          (words.length > 1 &&
            !!read(w)?.verbs.some((v) => v.form === "third" || v.form === "past")) ||
          (!!read(w)?.verbs.some((v) => v.form === "third" || v.form === "past") && !read(w)?.noun),
      )
    )
      return null;
    const r = read(head);
    if (!r?.noun && !r?.plural) return null;
    return r.plural && !ONE_THING.test(head) ? "Here are" : "Here is";
  },
  // "a must read book", "It is an absolute must have": the compound noun or adjective.
  nounSlotsMust: (m) => `must-${lower(m.groups!.verb)}`,
  nounSlotsMust2: (m, ctx) =>
    afterBreak(ctx, m.index) ? m.groups!.target.replace(/[ \t ]+/, "-") : null,
  // "He emphasized the important of this task": the -ance/-ence noun.
  nounSlotsA4: (m) => {
    const word = m.groups!.target;
    const r = read(word);
    if (!r?.adjective || r.noun || r.verbs.length) return null;
    const noun = word.replace(/t$/, "ce");
    return read(noun)?.noun ? noun : null;
  },
  // "in the 19 century": an ordinal.
  nounSlotsD: (m) => `${m.groups!.target}${ORDINAL(Number(m.groups!.target))}`,
  // "tension between he and his roommate": the object case after a preposition.
  nounSlotsHe: (m) =>
    ({ he: "him", she: "her", i: "me", we: "us", they: "them" })[lower(m.groups!.target) as "he"],
  // "not even for we relics", "not we lawyers": us before a plural noun after a preposition.
  nounSlotsWe: (m) => (pluralWord(m.groups!.noun) ? "us" : null),
  // "if there demands are not met": their.
  nounSlotsThere: (m) => (pluralNoun(m.groups!.noun) ? "their" : null),
  // "Customer reports of strange behavior is valuable": the plural head agrees.
  nounSlotsIs2: (m, ctx) => {
    const head = m.groups!.head;
    // "Billions of dollars is…", "the number of…": an amount or a count noun as the head.
    if (
      !pluralNoun(head) ||
      /^(?:bytes|kilobytes|megabytes|gigabytes|terabytes|grams|kilograms|ounces|dollars|euros|pounds|cents|years|months|weeks|days|hours|minutes|seconds|miles|kilometers|kilometres|meters|metres|feet|pounds|tons|tonnes|gallons|liters|litres|percent|points|kinds|types|sorts|lots|tons|dozens|hundreds|thousands|millions|billions|pairs|pieces|bits|parts|units)$/.test(
        head,
      )
    )
      return null;
    const rest = lower(m.groups!.rest)
      .trim()
      .split(/[ \t ]+/);
    // The phrase after "of" is nouns and adjectives only: no verb, no clause.
    if (
      rest.some(
        (w) =>
          /^(?:who|which|that|and|or|but|if|when|where|is|are|was|were)$/.test(w) ||
          (!!read(w)?.verbs.length && !read(w)?.noun && !read(w)?.plural),
      )
    )
      return null;
    // The head opens its clause: "the areas of Pakistan is found" may sit in a phrase.
    const lead = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (!afterBreak(ctx, m.index) && !/,[ \t\u00a0]*$/.test(lead)) return null;
    // "one of the…", "each of": the head is not the first noun.
    if (
      /\b(?:one|each|every|none|any|either|neither)[ \t ]+$/i.test(
        ctx.text.slice(Math.max(0, m.index - 16), m.index),
      )
    )
      return null;
    return { is: "are", was: "were", has: "have", needs: "need", seems: "seem" }[
      lower(m.groups!.target) as "is"
    ];
  },
  // "How is your new friends?", "How are your new school?": the be agrees with the noun.
  nounSlotsIs3: (m) => {
    const be = lower(m.groups!.target);
    const noun = m.groups!.noun;
    const adjectives = m
      .groups!.adjectives.trim()
      .split(/[ \t ]+/)
      .filter(Boolean);
    if (adjectives.some((w) => !read(w)?.adjective)) return null;
    if (pluralNoun(noun)) return be === "is" ? "are" : be === "was" ? "were" : null;
    if (singularNoun(noun) && !ENGLISH_MASS_NOUNS.has(noun))
      return be === "are" ? "is" : be === "were" ? "was" : null;
    return null;
  },
  // "Some time I like to read": sometimes.
  nounSlotsSome: (m, ctx) => {
    if (!afterBreak(ctx, m.index) || !/^Some/.test(m[0])) return null;
    return read(m.groups!.verb)?.verbs.some((v) => v.form === "base" || v.form === "third")
      ? "Sometimes"
      : null;
  },
  // "I have no been able to", "It is no signed by": not.
  nounSlotsNo: (m, ctx) => {
    const word = lower(m.groups!.word);
    if (/^(?:been|sure)$/.test(word)) return "not";
    const r = read(word);
    if (!r?.verbs.some((v) => v.form === "participle") || r.noun || r.plural) return null;
    // "has no signed contract": a participle adjective before its noun. "had no built in
    // support": a participle and its particle before a noun.
    const next = nextToken(ctx, m.index + m[0].length);
    if (next?.kind === "word" && /^(?:in|up|out|on)$/.test(next.lower)) {
      const noun = nextToken(ctx, next.end);
      const nounRead = noun?.kind === "word" && !FUNCTION_WORDS.has(noun.lower) && read(noun.lower);
      if (nounRead && (nounRead.noun || nounRead.plural)) return null;
    }
    return next?.kind === "word" &&
      !/^(?:by|the|a|an|my|your|his|her|our|their|it|them|up|out|in|on|yet|for|with|to)$/.test(
        next.lower,
      )
      ? null
      : "not";
  },
  // "Please harry up!": hurry.
  nounSlotsHarry: (m, ctx) => {
    const before = wordBefore(ctx, m.index);
    return (m.groups!.target === "harry" || (!before && afterBreak(ctx, m.index))) &&
      (!before || /^(?:please|so|push|just|must|to|can|should|you|we)$/.test(before))
      ? "hurry"
      : null;
  },
  // "Looking forward the new release": to after look forward.
  nounSlotsForward: (m) => {
    const prep = m.groups!.prep;
    if (prep) {
      const start = m.indices!.groups!.target[0];
      return { alternatives: ["forward to"], range: [start, m.indices!.groups!.prep[1]] };
    }
    return "forward to";
  },
  // "Would it possible to track it?", "Would it great?": be after the subject.
  nounSlotsWould: (m, ctx) => {
    if (!afterBreak(ctx, m.index)) return null;
    const r = read(m.groups!.adjective);
    return r?.adjective && !r.verbs.length ? `${m.groups!.target} be` : null;
  },
  // "And the are beautiful!": they are or there are.
  nounSlotsThe: (m) => {
    // "the ARE" names something; "the are has fallen out of use" is the unit of area.
    const next = lower(m.groups!.next);
    const r = read(next);
    const predicate =
      /^(?:not|so|very|really|all|also|always|still|again|going|coming)$/.test(next) ||
      (!!r?.adjective && !r.noun && !r.verbs.length) ||
      (!!r?.verbs.some((v) => v.form === "ing") && !r.noun);
    return /ARE/.test(m[0]) || !predicate ? null : ["they are", "there are"];
  },
  // "This is the most frequent errors.": one superlative thing.
  nounSlotsA5: (m) => (read(m.groups!.adjective)?.adjective ? pluralNoun(m.groups!.target) : null),
  // "This is most popular game", "Be best writer you can be": the superlative takes the.
  nounSlotsMost: (m, ctx) => {
    const r = read(m.groups!.adjective);
    if (!r?.adjective || r.noun || r.verbs.length) return null;
    const noun = m.groups!.noun;
    if (
      !read(noun)?.noun ||
      read(noun)?.plural ||
      !englishCountNoun(noun) ||
      ENGLISH_MASS_NOUNS.has(noun)
    )
      return null;
    const next = nextToken(ctx, m.index + m[0].length);
    if (next?.kind === "word" && read(next.lower)?.noun && !FUNCTION_WORDS.has(next.lower))
      return null;
    return "the most";
  },
} satisfies Record<string, Fixer>;
