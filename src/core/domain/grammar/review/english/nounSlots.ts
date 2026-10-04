import { ENGLISH_MASS_NOUNS } from "../../implementations/helpers/EnglishCountability";
import {
  englishCountNoun,
  englishNounPair,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { DetectContext, ReviewDetectorEntry } from "../reviewDetectors";
import { frameDetector, type Frame, type Rule } from "./idioms5";
import { afterBreak, DETERMINERS, FUNCTION_WORDS, tokensAfter, wordBefore } from "./slotWords";

// Noun phrase slots the words around them fix: a number or "one" before a plural ("1 days"),
// "a lot" with no "of", "the worlds best", an -ly word before a noun ("a simply solution"),
// "Is there any chances", "there was updates", "Here the files", "a must read",
// "the important of", "19 century", "between he and", and plural heads before "of".

export const PHRASES: readonly PhraseRow[] = [
  [["have a stoke", "had a stoke", "having a stoke", "from a stoke"], "a stroke"],
  [
    ["a stoke of genius", "a stoke of luck"],
    ["a stroke of genius", "a stroke of luck"],
  ],
  ["not limited too", "not limited to"],
  ...["all", "front", "rear", "four"].map((kind): PhraseRow => [
    `${kind} wheel drive`,
    `${kind}-wheel drive`,
  ]),
];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const NUMBER: Rule = { ruleId: "englishNounNumber", messageKey: "review_msg_noun_count" };
const AGREE: Rule = {
  ruleId: "englishSubjectVerbAgreement",
  messageKey: "review_msg_subject_verb",
};
const EXISTENTIAL: Rule = {
  ruleId: "englishExistentialAgreement",
  messageKey: "review_msg_existential_agreement",
};
const STRUCTURE: Rule = {
  ruleId: "englishSentenceStructure",
  messageKey: "review_msg_sentence_structure",
};
const CONTEXT: Rule = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_contextual_grammar",
};
const COMPOUND: Rule = { ruleId: "englishContextualCompounds", messageKey: "review_msg_compounds" };
const SUPERLATIVE: Rule = {
  ruleId: "englishSentenceStructure",
  messageKey: "review_msg_superlative_the",
};
const CASE: Rule = { ruleId: "englishPronounCase", messageKey: "review_msg_pronoun_object_case" };
const CONFUSED: Rule = { ruleId: "englishConfusedWords", messageKey: "review_msg_confused_word" };

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

const FRAMES: readonly Frame[] = [
  // "I have 1 days left", "I drew one hexagons": one takes the singular.
  {
    rule: NUMBER,
    pattern: `(?<![\\p{L}\\p{N}.,'’])(?<one>one|1)${S}(?<target>[a-z]+)(?=[ \\t\\u00a0]*[.!?,;]|${S}(?:left|later|on|in|at|for|from|to|with)${E})`,
    fix: (m, ctx) => {
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
  },
  // "We added a lot functionality", "a lot spikes": a lot of.
  {
    rule: CONTEXT,
    cue: ["lot"],
    pattern: `(?<![\\p{L}'’])(?<target>a${S}lot)${S}(?<noun>[a-z]+)${E}`,
    fix: (m) => {
      const noun = m.groups!.noun;
      const mass =
        ENGLISH_MASS_NOUNS.has(noun) && !read(noun)?.verbs.length && !read(noun)?.adjective;
      return pluralNoun(noun) || mass ? "a lot of" : null;
    },
  },
  // "the worlds best car", "the world biggest city": the world's.
  {
    rule: { ruleId: "englishPossessiveNouns", messageKey: "review_msg_noun_possessive" },
    cue: ["world", "worlds"],
    pattern: `(?<![\\p{L}'’])the${S}(?<target>worlds?)${S}(?:best|worst|largest|biggest|smallest|first|most|leading|fastest|tallest|oldest|richest|greatest|highest|longest|top|only|favorite|favourite)${E}`,
    fix: "world's",
  },
  // "It's a simply solution", "a philosophically question": the adjective before a noun.
  {
    rule: CONFUSED,
    cue: ["a", "an"],
    pattern: `(?<![\\p{L}'’])(?:a|an)${S}(?<target>[a-z]+ly)${S}(?<noun>[a-z]+)${E}`,
    fix: (m, ctx) => {
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
  },
  // "Google's headquarter", "the corporate headquarter": headquarters.
  {
    rule: NUMBER,
    cue: ["headquarter"],
    pattern: `(?:the|its|their|our|his|her|my|your|corporate|new|global|company|['’]s)${S}(?<target>headquarter)${E}`,
    fix: "headquarters",
  },
  // "Is there any chances that…", "there was updates daily": a plural takes are/were.
  {
    rule: EXISTENTIAL,
    cue: ["there"],
    pattern: `(?<![\\p{L}'’])(?<target>is|was)${S}there${S}(?:any|some|many|several)${S}(?<noun>[a-z]+)${E}`,
    fix: (m) =>
      pluralWord(m.groups!.noun) ? (lower(m.groups!.target) === "is" ? "are" : "were") : null,
  },
  {
    rule: EXISTENTIAL,
    cue: ["there"],
    pattern: `(?<![\\p{L}'’])(?<!(?:over|out|in|up|down|back|from)${S})there${S}(?<target>was|is)${S}(?:no${S})?(?<noun>[a-z]+)${S}(?<next>[a-z]+|\\d)`,
    fix: (m) => {
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
  },
  // "Here the specs of the device.", "Here some files from our plugin": Here is/are.
  {
    rule: STRUCTURE,
    cue: ["here"],
    pattern: `(?<target>Here)${S}(?:the|a|an|some|my|our|your|two|three|several|few)${S}(?<words>[a-z]+(?:${S}[a-z]+){0,2}?)(?=[ \\t\\u00a0]*(?:[.:!]|$)|${S}(?:of|from|for|that|which|I|we|you)${E})`,
    fix: (m, ctx) => {
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
            (!!read(w)?.verbs.some((v) => v.form === "third" || v.form === "past") &&
              !read(w)?.noun),
        )
      )
        return null;
      const r = read(head);
      if (!r?.noun && !r?.plural) return null;
      return r.plural && !ONE_THING.test(head) ? "Here are" : "Here is";
    },
  },
  // "a must read book", "It is an absolute must have": the compound noun or adjective.
  {
    rule: COMPOUND,
    cue: ["must"],
    pattern: `(?<![\\p{L}'’])(?<lead>a|an|the|absolute|real|our|my|your|their|\\d+)${S}(?<target>must${S}(?<verb>read|have|see|watch|try|buy|visit|do|love|reads|haves|sees))${E}`,
    fix: (m) => `must-${lower(m.groups!.verb)}`,
  },
  {
    rule: COMPOUND,
    cue: ["must"],
    pattern: `(?<target>Must${S}(?:haves|reads|sees))${E}`,
    fix: (m, ctx) => (afterBreak(ctx, m.index) ? m.groups!.target.replace(/[ \t ]+/, "-") : null),
  },
  // "He emphasized the important of this task": the -ance/-ence noun.
  {
    rule: CONFUSED,
    cue: ["of"],
    pattern: `(?<![\\p{L}'’])the${S}(?<target>[a-z]+(?:ant|ent))${S}of${E}`,
    fix: (m) => {
      const word = m.groups!.target;
      const r = read(word);
      if (!r?.adjective || r.noun || r.verbs.length) return null;
      const noun = word.replace(/t$/, "ce");
      return read(noun)?.noun ? noun : null;
    },
  },
  // "in the 19 century": an ordinal.
  {
    rule: { ruleId: "englishOrdinalSuffix", messageKey: "review_msg_ordinal" },
    cue: ["century", "centuries"],
    pattern: `(?<![\\p{L}'’])(?:the|in|of|early|late|mid)${S}(?<target>\\d{1,2})${S}(?:century|centuries)${E}`,
    fix: (m) => `${m.groups!.target}${ORDINAL(Number(m.groups!.target))}`,
  },
  // "tension between he and his roommate": the object case after a preposition.
  {
    rule: CASE,
    cue: ["between"],
    pattern: `(?<![\\p{L}'’])between${S}(?<target>he|she|I|we|they)${S}and${E}`,
    fix: (m) =>
      ({ he: "him", she: "her", i: "me", we: "us", they: "them" })[lower(m.groups!.target) as "he"],
  },
  // "not even for we relics", "not we lawyers": us before a plural noun after a preposition.
  {
    rule: CASE,
    cue: ["we"],
    pattern: `(?<![\\p{L}'’])(?:for|to|with|from|by|of|about|against|among)${S}(?<target>we)${S}(?<noun>[a-z]+)${E}`,
    fix: (m) => (pluralWord(m.groups!.noun) ? "us" : null),
  },
  // "if there any more ideas", "if there anyone": the verb after there.
  {
    rule: STRUCTURE,
    cue: ["there"],
    pattern: `(?<![\\p{L}'’])if${S}(?<target>there)${S}(?<next>anyone|anything|anybody|someone|something|somebody|nobody|nothing)${E}`,
    fix: ["there is", "there was"],
  },
  // "if there demands are not met": their.
  {
    rule: { ruleId: "englishTheirThereTheyAre", messageKey: "review_msg_their_there" },
    cue: ["there"],
    pattern: `(?<![\\p{L}'’])(?:if|when|because|since|unless|that)${S}(?<target>there)${S}(?<noun>[a-z]+)${S}(?:are|were|have|had|will|would|can|could)${E}`,
    fix: (m) => (pluralNoun(m.groups!.noun) ? "their" : null),
  },
  // "Customer reports of strange behavior is valuable": the plural head agrees.
  {
    rule: AGREE,
    cue: ["of"],
    pattern: `(?<![\\p{L}'’])(?<lead>the|these|those|my|our|their|his|her|your|many|some|\\d+)${S}(?<head>[a-z]+)${S}of${S}(?<rest>(?:[a-z]+${S}){1,3}?)(?<target>is|was|has|needs|seems)${E}`,
    fix: (m, ctx) => {
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
  },
  // "How is your new friends?", "How are your new school?": the be agrees with the noun.
  {
    rule: AGREE,
    cue: ["how"],
    pattern: `(?<![\\p{L}'’])how${S}(?<target>is|are|was|were)${S}(?:your|the|my|his|her|our|their)(?<adjectives>(?:${S}[a-z]+){0,2}?)${S}(?<noun>[a-z]+)[ \\t\\u00a0]*\\?`,
    fix: (m) => {
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
  },
  // "Some time I like to read": sometimes.
  {
    rule: CONFUSED,
    cue: ["some"],
    pattern: `(?<target>Some${S}time)${S}(?:I|we|you|they|he|she|it)${S}(?<verb>[a-z]+)${E}`,
    fix: (m, ctx) => {
      if (!afterBreak(ctx, m.index) || !/^Some/.test(m[0])) return null;
      return read(m.groups!.verb)?.verbs.some((v) => v.form === "base" || v.form === "third")
        ? "Sometimes"
        : null;
    },
  },
  // "there isn't anyway to do that", "heard of anyway to": any way.
  {
    rule: CONFUSED,
    cue: ["anyway"],
    pattern: `(?<![\\p{L}'’])(?:there${S}(?:is|isn['’]t|was|wasn['’]t)|is${S}there|of|no|find|found)${S}(?<target>anyway)${S}to${S}[a-z]+${E}`,
    fix: "any way",
  },
  // "I have no been able to", "It is no signed by": not.
  {
    rule: CONFUSED,
    cue: ["no"],
    pattern: `(?<![\\p{L}'’])(?:have|has|had|is|am|are|was|were|['’]m)${S}(?<target>no)${S}(?<word>[a-z]+)${E}`,
    fix: (m, ctx) => {
      const word = lower(m.groups!.word);
      if (/^(?:been|sure)$/.test(word)) return "not";
      const r = read(word);
      if (!r?.verbs.some((v) => v.form === "participle") || r.noun || r.plural) return null;
      // "has no signed contract": a participle adjective before its noun.
      const next = nextToken(ctx, m.index + m[0].length);
      return next?.kind === "word" &&
        !/^(?:by|the|a|an|my|your|his|her|our|their|it|them|up|out|in|on|yet|for|with|to)$/.test(
          next.lower,
        )
        ? null
        : "not";
    },
  },
  // "Do you one to win?": want.
  {
    rule: CONFUSED,
    cue: ["one"],
    pattern: `(?<![\\p{L}'’])(?:do|did|don['’]t|didn['’]t|does|doesn['’]t)${S}(?:you|I|we|they|he|she)(?:${S}(?:ever|really|not))?${S}(?<target>one)${S}to${S}[a-z]+${E}`,
    fix: "want",
  },
  // "Please harry up!": hurry.
  {
    rule: CONFUSED,
    cue: ["harry"],
    pattern: `(?<![\\p{L}'’])(?<target>harry)${S}up(?=[ \\t\\u00a0]*[.!,]|${S}(?:and|please)${E})`,
    fix: (m, ctx) => {
      const before = wordBefore(ctx, m.index);
      return (m.groups!.target === "harry" || (!before && afterBreak(ctx, m.index))) &&
        (!before || /^(?:please|so|push|just|must|to|can|should|you|we)$/.test(before))
        ? "hurry"
        : null;
    },
  },
  // "Please open the attach file": attached.
  {
    rule: CONFUSED,
    cue: ["attach"],
    pattern: `(?<![\\p{L}'’])(?:the|an|this|these|my|your)${S}(?<target>attach)${S}(?:file|files|document|documents|form|invoice|report|image|photo|picture|spreadsheet|pdf|list|letter)${E}`,
    fix: "attached",
  },
  // "Please high light the words": highlight.
  {
    rule: COMPOUND,
    cue: ["light"],
    pattern: `(?<![\\p{L}'’])(?:to|please|can|could|would|will|should|must|I|we|you|couldn['’]t|can['’]t)${S}(?<target>high${S}light)${S}(?:the|his|her|my|your|our|their|this|these|those|it|them|some|all)${E}`,
    fix: "highlight",
  },
  // "Looking forward the new release": to after look forward.
  {
    rule: { ruleId: "englishVerbComplements", messageKey: "review_msg_forward_gerund" },
    cue: ["forward"],
    pattern: `(?<![\\p{L}'’])(?:look|looks|looked|looking)${S}(?<target>forward)(?:${S}(?<prep>of|for))?${S}(?<next>the|this|a|an)${E}`,
    fix: (m) => {
      const prep = m.groups!.prep;
      if (prep) {
        const start = m.indices!.groups!.target[0];
        return { alternatives: ["forward to"], range: [start, m.indices!.groups!.prep[1]] };
      }
      return "forward to";
    },
  },
  // "Would it possible to track it?", "Would it great?": be after the subject.
  {
    rule: { ruleId: "englishSentenceStructure", messageKey: "review_msg_missing_be" },
    cue: ["it"],
    pattern: `(?<target>(?:would|will|could|should|might)${S}it)${S}(?<adjective>[a-z]+)(?=[ \\t\\u00a0]*\\?|${S}(?:for|to|that|if)${E})`,
    fix: (m, ctx) => {
      if (!afterBreak(ctx, m.index)) return null;
      const r = read(m.groups!.adjective);
      return r?.adjective && !r.verbs.length ? `${m.groups!.target} be` : null;
    },
  },
  // "And the are beautiful!": they are or there are.
  {
    rule: CONFUSED,
    cue: ["the"],
    pattern: `(?<![\\p{L}'’])(?<target>the${S}are)${S}(?<next>[a-z]+)${E}`,
    fix: (m) => {
      // "the ARE" names something; "the are has fallen out of use" is the unit of area.
      const next = lower(m.groups!.next);
      const r = read(next);
      const predicate =
        /^(?:not|so|very|really|all|also|always|still|again|going|coming)$/.test(next) ||
        (!!r?.adjective && !r.noun && !r.verbs.length) ||
        (!!r?.verbs.some((v) => v.form === "ing") && !r.noun);
      return /ARE/.test(m[0]) || !predicate ? null : ["they are", "there are"];
    },
  },
  // "That guy is one of the kind.": one of a kind.
  {
    rule: CONTEXT,
    cue: ["kind"],
    pattern: `(?<![\\p{L}'’])(?:one|two|three|four|five)${S}of${S}(?<target>the)${S}kind(?=[ \\t\\u00a0]*[.!?,]|$)`,
    fix: "a",
  },
  // "This is the most frequent errors.": one superlative thing.
  {
    rule: NUMBER,
    cue: ["most", "least"],
    pattern: `(?<![\\p{L}'’])(?:this|that|it)${S}(?:is|was)(?:${S}just)?${S}the${S}(?:most|least)${S}(?<adjective>[a-z]+)${S}(?<target>[a-z]+)(?=[ \\t\\u00a0]*[.!?]|${S}(?:on|in|of|for|with|I|we|you)${E})`,
    fix: (m) => (read(m.groups!.adjective)?.adjective ? pluralNoun(m.groups!.target) : null),
  },
  // "This is most popular game", "Be best writer you can be": the superlative takes the.
  {
    rule: SUPERLATIVE,
    cue: ["most"],
    pattern: `(?<![\\p{L}'’])(?:is|was|are|were|be)(?:${S}(?:by${S}far|clearly|probably))?${S}(?<target>most)${S}(?<adjective>[a-z]+)${S}(?<noun>[a-z]+)${E}`,
    fix: (m, ctx) => {
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
  },
];

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [
      "englishNounNumber",
      "englishPhraseCorrections",
      "englishPossessiveNouns",
      "englishConfusedWords",
      "englishExistentialAgreement",
      "englishSentenceStructure",
      "englishContextualCompounds",
      "englishOrdinalSuffix",
      "englishPronounCase",
      "englishTheirThereTheyAre",
      "englishSubjectVerbAgreement",
      "englishVerbComplements",
    ],
    detect: frameDetector(FRAMES),
  },
];
