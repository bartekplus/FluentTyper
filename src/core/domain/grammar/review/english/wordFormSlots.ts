import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { DetectContext } from "../reviewDetectors";
import type { FrameRef, MatchFixer } from "../../engine/reviewRules";
import { afterBreak, FUNCTION_WORDS, nounOnly, tokensAfter, wordBefore } from "./slotWords";
import { MASS, nounNumber } from "./nounNumberSlots";
import { slotFinding } from "./everydaySlots";

// A word whose form the slot fixes: "There're problem" (problems), "are know being" (now),
// "several other came" (others), "a must see place" (must-see), "The are many" (There are),
// "drop by an see" (and), "a number of book" (books), "the worlds best" (world's),
// "58 years-old" (years old), "wash ones hands" (one's), "too all the" (to all).
// The frames are in grammar/rules/en.yaml.

/** The regular plural of a plain singular count noun ("chair"), or null. */
function countPlural(noun: string): string | null {
  if (FUNCTION_WORDS.has(noun) || MASS.has(noun) || NOT_COUNTED.test(noun)) return null;
  const read = englishWordInfo(noun);
  if (read && (!read.noun || read.plural || read.adjective || read.adverb)) return null;
  if (read?.verbs.some((v) => v.form !== "base")) return null;
  // Long plain nouns ("problem") come from the lexicon too.
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

/** The plural slot of a "there are" (`thereAre`) or count-of frame. */
function plural(m: RegExpExecArray, ctx: DetectContext, frame: FrameRef, thereAre: boolean) {
  const noun = m.groups!.target;
  if (ctx.dictionary.has(noun)) return null;
  const fix = countPlural(noun);
  if (!fix || !closes(ctx, m.index + m[0].length)) return null;
  // After "there are", a noun that is also a verb ("water") is the existential check's.
  if (thereAre && englishWordInfo(noun)?.verbs.length) return null;
  return slotFinding(ctx, frame, m, fix);
}

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  wordFormThereAre: (m, ctx, frame) => plural(m, ctx, frame, true),
  wordFormCountOf: (m, ctx, frame) => plural(m, ctx, frame, false),
  wordFormKnow: (m, ctx, frame) => {
    const next = m.groups!.next;
    if (next !== "being" && !englishWordInfo(next)?.verbs.some((v) => v.form === "ing"))
      return null;
    return slotFinding(ctx, frame, m, "now");
  },
  wordFormOther: (m, ctx, frame) => {
    const next = m.groups!.next;
    if (next) {
      const read = englishWordInfo(next);
      // "several other came": a verb, not a noun ("some other time").
      if (
        FUNCTION_WORDS.has(next) ||
        !read?.verbs.some((v) => v.form === "past" || v.form === "third") ||
        read.noun
      )
        return null;
      // "a few other compromised members": a participle modifying a noun after it.
      const after = tokensAfter(ctx, m.indices!.groups!.next[1], 1)[0];
      if (after?.kind === "word" && !FUNCTION_WORDS.has(after.lower)) return null;
    }
    return slotFinding(ctx, frame, m, "others");
  },
  wordFormTheAre: (m, ctx, frame) =>
    afterBreak(ctx, m.index) ? slotFinding(ctx, frame, m, "there") : null,
  wordFormISense: (m, ctx, frame) => slotFinding(ctx, frame, m, "it"),
  wordFormMaybe: (m, ctx, frame) => {
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
      return null;
    return slotFinding(ctx, frame, m, "may be");
  },
  wordFormAnVerb: (m, ctx, frame) => {
    const verb = m.groups!.verb;
    if (FUNCTION_WORDS.has(verb) || ctx.dictionary.has(verb)) return null;
    const read = englishWordInfo(verb);
    if (
      !read?.verbs.length ||
      !read.verbs.every((v) => v.form === "base" && v.lemma === verb) ||
      read.noun ||
      read.adjective ||
      read.adverb
    )
      return null;
    // "an add", "an excel format": before a vowel "an" is the article of a slip; only a
    // consonant-initial verb before an object or the end reads as "and" ("by an see what").
    if (/^[aeiou]/.test(verb)) return null;
    const after = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (after?.kind === "other") return null;
    if (
      after?.kind === "word" &&
      !/^(?:the|a|an|this|that|these|those|my|your|his|her|our|their|it|them|me|us|him|you|what|how|if|whether|to|for|with|about)$/.test(
        after.lower,
      )
    )
      return null;
    // "an" then a bare verb: only after a word that could take "and" ("by an see", "go an get").
    const before = wordBefore(ctx, m.index);
    if (!before || /^(?:a|the|is|was|be|such|what|quite|half)$/.test(before)) return null;
    return slotFinding(ctx, frame, m, "and");
  },
  wordFormMust: (m, ctx, frame) => {
    const noun = m.groups!.noun;
    const read = englishWordInfo(noun);
    if (FUNCTION_WORDS.has(noun) || !(read?.noun || nounOnly(noun))) return null;
    return slotFinding(ctx, frame, m, `must-${m.groups!.verb}`);
  },
  wordFormYearsOld: (m, ctx, frame) =>
    slotFinding(ctx, frame, m, m.groups!.target.replace("-", " ")),
  wordFormWorlds: (m, ctx, frame) => slotFinding(ctx, frame, m, "world's"),
  wordFormOnes: (m, ctx, frame) => {
    const noun = m.groups!.noun;
    if (noun !== "own") {
      const read = englishWordInfo(noun);
      // "the ones that…", "of ones choosing": only a plain noun after it.
      if (
        FUNCTION_WORDS.has(noun) ||
        !(read?.noun || nounNumber(noun)) ||
        !!read?.verbs.some((v) => v.form !== "base" && !(read.plural && v.form === "third"))
      )
        return null;
    }
    // "the old ones": a determiner makes "ones" the pronoun.
    return slotFinding(ctx, frame, m, "one's");
  },
  // "gone with her too all those years ago": "too" closes the clause before it.
  wordFormTooAll: (m, ctx, frame) =>
    /^(?:me|you|him|her|us|them|it)$/.test(wordBefore(ctx, m.index))
      ? null
      : slotFinding(ctx, frame, m, "to"),
  wordFormYourIng: (m, ctx, frame) => {
    const { ing } = m.groups!;
    const before = m.groups!.before.toLowerCase();
    const read = englishWordInfo(ing);
    if (!read?.verbs.some((v) => v.form === "ing") || read.noun || read.adjective) return null;
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
    if (!wh && !noun) return null;
    // "your thinking patterns": the -ing word modifies a noun after it.
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (
      next?.kind === "word" &&
      !FUNCTION_WORDS.has(next.lower) &&
      (nounOnly(next.lower) || !!englishWordInfo(next.lower)?.plural)
    )
      return null;
    return slotFinding(ctx, frame, m, "you're");
  },
  wordFormYourAll: (m, ctx, frame) => slotFinding(ctx, frame, m, "you're"),
  wordFormHaveName: (m, ctx, frame) => {
    const { target, name, part } = m.groups!;
    if (!/^[A-Z][a-z]+$/.test(name) || englishWordInfo(name.toLowerCase())) return null;
    if (!/^[A-Za-z]/.test(target) || ctx.dictionary.has(name.toLowerCase())) return null;
    // At a question's start or after a wh-word.
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:when|why|where|how|what|who)$/.test(wordBefore(ctx, m.index))
    )
      return null;
    const read = englishWordInfo(part);
    if (
      !read?.verbs.some((v) => v.form === "participle") ||
      read.verbs.some((v) => v.form === "base") ||
      read.noun
    )
      return null;
    return slotFinding(ctx, frame, m, /n['’]t$/.test(target) ? `hasn${target.slice(-2)}` : "has");
  },
} satisfies Record<string, MatchFixer>;
