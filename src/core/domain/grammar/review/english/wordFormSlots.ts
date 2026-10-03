import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  afterBreak,
  caseLike,
  english,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  tokensAfter,
  wordBefore,
} from "./slotWords";
import { MASS, nounNumber } from "./nounNumberSlots";

// A word whose form the slot fixes: "There're problem" (problems), "are know being" (now),
// "several other came" (others), "a must see place" (must-see), "The are many" (There are),
// "drop by an see" (and), "a number of book" (books), "the worlds best" (world's),
// "58 years-old" (years old), "wash ones hands" (one's), "too all the" (to all).

const S = SPACE;
const E = WORD_END;

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

type Rule = Pick<RawFinding, "ruleId" | "messageKey">;
const CONFUSED: Rule = { ruleId: "englishConfusedWords", messageKey: "review_msg_confused_word" };
const NUMBER: Rule = { ruleId: "englishNounNumber", messageKey: "review_msg_noun_count" };
const COMPOUND: Rule = { ruleId: "englishContextualCompounds", messageKey: "review_msg_compounds" };
const POSSESSIVE: Rule = { ruleId: "englishApostrophes", messageKey: "review_msg_noun_possessive" };

function push(
  ctx: DetectContext,
  findings: RawFinding[],
  rule: Rule,
  m: RegExpExecArray,
  replacement: string,
  group = "target",
): void {
  const [start, end] = m.indices!.groups![group];
  findings.push({
    ...rule,
    range: { start, end },
    alternatives: [caseLike(ctx.source.slice(start, end), replacement)],
    context: evidence(ctx, m.index, end),
  });
}

/** The regular plural of a plain singular count noun ("chair"), or null. */
function countPlural(noun: string): string | null {
  if (FUNCTION_WORDS.has(noun) || MASS.has(noun) || NOT_COUNTED.test(noun)) return null;
  const read = englishWordInfo(noun);
  if (read && (!read.noun || read.plural || read.adjective || read.adverb)) return null;
  if (read?.verbs.some((v) => v.form !== "base")) return null;
  // Long plain nouns ("problem") come from the lexicon's noun filter.
  const forms = nounNumber(noun);
  return forms?.number === "singular" && forms.plural !== noun ? forms.plural : null;
}

// Numbers and currencies that stand for their own plural.
const NOT_COUNTED =
  /^(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|dozen|baht|yen|yuan|won|rand|krona|krone|euro|percent)$/;

const closes = (ctx: DetectContext, end: number) => {
  const next = tokensAfter(ctx, end, 1)[0];
  return (
    !next ||
    next.kind === "end" ||
    next.kind === "comma" ||
    (FUNCTION_WORDS.has(next.lower) && !/^(?:and|or|nor)$/.test(next.lower)) ||
    /^(?:today|tonight|tomorrow|yesterday|now|again|here|there|already|yet|last|this|next)$/.test(
      next.lower,
    )
  );
};

// "There're problem in it": a plural existential before a singular count noun.
const THERE_ARE = `there(?:['’]re|${S}are|${S}were)${S}(?<target>[a-z]+)${E}`;
// "A number of book", "dozens of reason": a count that needs a plural.
const COUNT_OF = `(?:a${S}(?:number|couple|pair|multitude|series|majority)|dozens|hundreds|thousands)${S}of${S}(?<target>[a-z]+)${E}`;

function pluralSlots(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const pattern of [THERE_ARE, COUNT_OF])
    for (const m of frameMatches(ctx, pattern)) {
      const noun = m.groups!.target;
      if (ctx.dictionary.has(noun)) continue;
      const plural = countPlural(noun);
      if (!plural || !closes(ctx, m.index + m[0].length)) continue;
      // After "there are", a noun that is also a verb ("water") is the existential check's.
      if (pattern === THERE_ARE && englishWordInfo(noun)?.verbs.length) continue;
      push(ctx, findings, NUMBER, m, plural);
    }
  return findings;
}

// "The files are know being checked": now before an -ing form.
const KNOW = `(?:is|are|was|were|am|['’]re|['’]m)${S}(?<target>know)${S}(?<next>[a-z]+ing)${E}`;
// "Tom and several other came": a pronoun "others" before a verb or the end.
const OTHER = `(?:several|many|some|few|both)${S}(?<target>other)(?=[ \\t\\u00a0]*(?:[.!?,;:]|$)|${S}(?<next>[a-z]+)${E})`;
// "The are many people here": there at the clause start.
const THE_ARE = `(?<target>the)${S}(?:are|were)${S}(?:many|several|some|no|plenty|lots|a${S}lot|a${S}few|two|three|four|five|ten)${E}`;
// "I might not make sense to ask": the dummy subject it.
const I_SENSE = `(?<target>I)(?:${S}(?:might|may|would|will|could|does|doesn['’]t|did|didn['’]t|wouldn['’]t|won['’]t)(?:${S}not)?)?${S}(?:make|makes|made)${S}sense${S}to${S}[a-z]+${E}`;
// "It maybe helpful": the modal "may be" before a predicate.
const MAYBE = `(?:I|you|he|she|it|we|they|this|that|there)${S}(?<target>maybe)${S}(?<next>[a-z]+)${E}`;
// "I'll drop by an see you": "an" before a bare verb.
const AN_VERB = `(?<target>an)${S}(?<verb>[a-z]+)${E}`;

function confusedSlots(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, KNOW)) {
    const next = m.groups!.next;
    if (next !== "being" && !englishWordInfo(next)?.verbs.some((v) => v.form === "ing")) continue;
    push(ctx, findings, CONFUSED, m, "now");
  }
  for (const m of frameMatches(ctx, OTHER)) {
    const next = m.groups!.next;
    if (next) {
      const read = englishWordInfo(next);
      // "several other came": a verb, not a noun ("some other time").
      if (
        FUNCTION_WORDS.has(next) ||
        !read?.verbs.some((v) => v.form === "past" || v.form === "third") ||
        read.noun
      )
        continue;
      // "a few other compromised members": a participle modifying a noun after it.
      const after = tokensAfter(ctx, m.indices!.groups!.next[1], 1)[0];
      if (after?.kind === "word" && !FUNCTION_WORDS.has(after.lower)) continue;
    }
    push(ctx, findings, CONFUSED, m, "others");
  }
  for (const m of frameMatches(ctx, THE_ARE)) {
    if (!afterBreak(ctx, m.index)) continue;
    push(ctx, findings, CONFUSED, m, "there");
  }
  for (const m of frameMatches(ctx, I_SENSE)) push(ctx, findings, CONFUSED, m, "it");
  for (const m of frameMatches(ctx, MAYBE)) {
    const next = m.groups!.next;
    const read = englishWordInfo(next);
    // A predicate: an adjective, a participle, a noun phrase or "worth/best/able".
    const predicate =
      /^(?:a|an|the|worth|best|better|able|possible|necessary|wrong|right|true|time|due)$/.test(
        next,
      ) ||
      (!!read &&
        !FUNCTION_WORDS.has(next) &&
        (read.adjective || read.verbs.some((v) => v.form === "participle")) &&
        !read.verbs.some((v) => v.form === "base" || v.form === "third"));
    if (
      !predicate ||
      (!afterBreak(ctx, m.index) &&
        !/^(?:and|but|so|that|if|think|because)$/.test(wordBefore(ctx, m.index)))
    )
      continue;
    push(ctx, findings, CONFUSED, m, "may be");
  }
  for (const m of frameMatches(ctx, AN_VERB)) {
    const verb = m.groups!.verb;
    if (FUNCTION_WORDS.has(verb) || ctx.dictionary.has(verb)) continue;
    const read = englishWordInfo(verb);
    if (
      !read?.verbs.length ||
      !read.verbs.every((v) => v.form === "base" && v.lemma === verb) ||
      read.noun ||
      read.adjective ||
      read.adverb
    )
      continue;
    // "an add", "an excel format": before a vowel "an" is the article of a slip; only a
    // consonant-initial verb before an object or the end reads as "and" ("by an see what").
    if (/^[aeiou]/.test(verb)) continue;
    const after = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (after?.kind === "other") continue;
    if (
      after?.kind === "word" &&
      !/^(?:the|a|an|this|that|these|those|my|your|his|her|our|their|it|them|me|us|him|you|what|how|if|whether|to|for|with|about)$/.test(
        after.lower,
      )
    )
      continue;
    // "an" then a bare verb: only after a word that could take "and" ("by an see", "go an get").
    const before = wordBefore(ctx, m.index);
    if (!before || /^(?:a|the|is|was|be|such|what|quite|half)$/.test(before)) continue;
    push(ctx, findings, CONFUSED, m, "and");
  }
  return findings;
}

// "a must see place": the compound modifier is hyphenated.
const MUST = `(?:a|an|the|another)${S}(?<target>must${S}(?<verb>see|read|have|do|visit|watch|try|buy|attend|hear|eat|own))${S}(?<noun>[a-z]+)${E}`;
// "He was 58 years-old.": predicative ages are open.
const YEARS_OLD = `(?<=[0-9][ \\t\\u00a0]{1,8}|(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[ \\t\\u00a0]{1,8})(?<target>(?:years|months|weeks|days)-old)(?=[ \\t\\u00a0]*(?:[.!?,;:)]|$)|${S}(?:and|but|when|at|in|by|now|today)${E})`;

function compoundSlots(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, MUST)) {
    const noun = m.groups!.noun;
    const read = englishWordInfo(noun);
    if (FUNCTION_WORDS.has(noun) || !(read?.noun || nounOnly(noun))) continue;
    push(ctx, findings, COMPOUND, m, `must-${m.groups!.verb}`);
  }
  for (const m of frameMatches(ctx, YEARS_OLD))
    push(ctx, findings, COMPOUND, m, m.groups!.target.replace("-", " "));
  return findings;
}

// "the worlds best player": the world's.
const WORLDS = `the${S}(?<target>worlds)${S}(?:best|largest|biggest|greatest|most|first|oldest|fastest|richest|highest|tallest|leading|top|smallest|longest|deepest|strongest|happiest|favorite|favourite|population|economy|attention)${E}`;
// "One should wash ones hands": one's before a noun.
const ONES = `(?:wash|brush|clean|change|mind|lose|lost|keep|know|follow|raise|use|express|share|do|cross|count|in|of|on|for|to|with|about|into|from)${S}(?<target>ones)${S}(?<noun>[a-z]+)${E}`;

function possessiveSlots(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, WORLDS)) push(ctx, findings, POSSESSIVE, m, "world's");
  for (const m of frameMatches(ctx, ONES)) {
    const noun = m.groups!.noun;
    if (noun !== "own") {
      const read = englishWordInfo(noun);
      // "the ones that…", "of ones choosing": only a plain noun after it.
      if (
        FUNCTION_WORDS.has(noun) ||
        !(read?.noun || nounNumber(noun)) ||
        !!read?.verbs.some((v) => v.form !== "base" && !(read.plural && v.form === "third"))
      )
        continue;
    }
    // "the old ones": a determiner makes "ones" the pronoun.
    push(ctx, findings, POSSESSIVE, m, "one's");
  }
  return findings;
}

// "We expanded too all the sites": the preposition.
const TOO_ALL = `(?<target>too)${S}all${S}(?:the|of|my|our|your|their|his|her|these|those)${E}`;

function tooAll(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, TOO_ALL)) {
    // "gone with her too all those years ago": "too" closes the clause before it.
    if (/^(?:me|you|him|her|us|them|it)$/.test(wordBefore(ctx, m.index))) continue;
    push(ctx, findings, { ruleId: "englishToToo", messageKey: "review_msg_to_too" }, m, "to");
  }
  return findings;
}

// "the file your looking for", "what your selling": your before a bare -ing after a noun or
// a wh-word is "you're"; "I think your all set".
const YOUR_ING = `(?<before>[a-z]+)${S}(?<target>your)${S}(?<ing>[a-z]+ing)${E}`;
const YOUR_ALL = `(?<target>your)${S}all${S}(?:set|done|good|ready|invited|welcome|right|wrong|fine|wrong|alone|over|here|there)${E}`;

function youAre(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const rule: Rule = { ruleId: "englishYourYouAre", messageKey: "review_msg_your_you_are" };
  for (const m of frameMatches(ctx, YOUR_ING)) {
    const { ing } = m.groups!;
    const before = m.groups!.before.toLowerCase();
    const read = englishWordInfo(ing);
    if (!read?.verbs.some((v) => v.form === "ing") || read.noun || read.adjective) continue;
    const beforeRead = englishWordInfo(before);
    // A wh-word or subordinator opens a clause ("if your having trouble"); "your testing of
    // the rules" is a gerund phrase.
    const wh =
      /^(?:what|whatever|where|how|why|when|who|if|because|since|while|unless|until|once)$/.test(
        before,
      ) && tokensAfter(ctx, m.index + m[0].length, 1)[0]?.lower !== "of";
    // "the file your looking for": a noun that is no verb ("take your writing") opens a relative.
    const noun =
      !FUNCTION_WORDS.has(before) &&
      !!beforeRead?.noun &&
      !beforeRead.adjective &&
      before !== "use" &&
      (!beforeRead.verbs.length ||
        /^(?:the|a|an|this|that|these|those|my|our|his|her|their|every|any|no)$/.test(
          wordBefore(ctx, m.index),
        ));
    if (!wh && !noun) continue;
    // "your thinking patterns": the -ing word modifies a noun after it.
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (
      next?.kind === "word" &&
      !FUNCTION_WORDS.has(next.lower) &&
      (nounOnly(next.lower) || !!englishWordInfo(next.lower)?.plural)
    )
      continue;
    push(ctx, findings, rule, m, "you're");
  }
  for (const m of frameMatches(ctx, YOUR_ALL)) push(ctx, findings, rule, m, "you're");
  return findings;
}

// "Have Mary bought a ticket?": a name takes has; "Have Tom report to me" is causative.
const HAVE_NAME = `(?<target>have|haven['’]t)${S}(?<name>[A-Z][a-z]+)${S}(?<part>[a-z]+)${E}`;

function haveName(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, HAVE_NAME)) {
    const { target, name, part } = m.groups!;
    if (!/^[A-Z][a-z]+$/.test(name) || englishWordInfo(name.toLowerCase())) continue;
    if (!/^[A-Za-z]/.test(target) || ctx.dictionary.has(name.toLowerCase())) continue;
    // At a question's start or after a wh-word.
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:when|why|where|how|what|who)$/.test(wordBefore(ctx, m.index))
    )
      continue;
    const read = englishWordInfo(part);
    if (
      !read?.verbs.some((v) => v.form === "participle") ||
      read.verbs.some((v) => v.form === "base") ||
      read.noun
    )
      continue;
    push(
      ctx,
      findings,
      { ruleId: "englishSubjectVerbAgreement", messageKey: "review_msg_subject_verb" },
      m,
      /n['’]t$/.test(target) ? `hasn${target.slice(-2)}` : "has",
    );
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishSubjectVerbAgreement"], detect: english(haveName) },
  { rules: ["englishYourYouAre"], detect: english(youAre) },
  { rules: ["englishNounNumber"], detect: english(pluralSlots) },
  { rules: ["englishConfusedWords"], detect: english(confusedSlots) },
  { rules: ["englishContextualCompounds"], detect: english(compoundSlots) },
  { rules: ["englishApostrophes"], detect: english(possessiveSlots) },
  { rules: ["englishToToo"], detect: english(tooAll) },
];
