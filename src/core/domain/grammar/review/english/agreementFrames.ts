import {
  ENGLISH_MASS_NOUNS,
  MASS_WITH_COUNT_SENSE,
} from "../../implementations/helpers/EnglishCountability";
import { englishInflect } from "../../implementations/helpers/EnglishInflection";
import {
  englishCountNoun,
  englishNounPair,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import type { DetectContext } from "../reviewDetectors";
import type { Fixer } from "../../engine/reviewRules";
import { nounVerb, participle } from "./realWordFrames";
import { nounNumber } from "./nounNumberSlots";
import { afterBreak, FUNCTION_WORDS, tokensAfter, wordBefore } from "./slotWords";

const read = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);
const lower = (word: string | undefined) => (word ?? "").toLowerCase();
// Plurals and number words the lexicon reads as singular nouns, and time words that stand
// bare ("all day", "of all time").
const NOT_COUNTED =
  /^(?:men|women|children|people|feet|teeth|mice|geese|oxen|data|media|criteria|phenomena|alumni|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|day|night|year|time|week|month|morning|evening|afternoon|summer|winter|spring|autumn|season|life|weekend|today|tonight|tomorrow|yesterday)$/;

/**
 * The plural of a lowercase singular count noun: no adjective reading, not a listed mass noun,
 * and counted by the n-grams or a noun only ("computer"). The slot shows it is a noun, so a
 * verb reading may stay ("book") when the n-grams count it.
 */
function countNoun(word: string): string | null {
  if (word !== lower(word) || FUNCTION_WORDS.has(word) || NOT_COUNTED.test(word)) return null;
  if (ENGLISH_MASS_NOUNS.has(word) || MASS_WITH_COUNT_SENSE.has(word)) return null;
  // "kind" and "sort" have other readings but count here.
  if (/^(?:kind|sort|type)$/.test(word)) return `${word}s`;
  const r = read(word);
  if (!r?.noun || r.plural || r.adjective || r.adverb) return null;
  if (!englishCountNoun(word) && r.verbs.length) return null;
  const regular = /(?:s|x|z|ch|sh)$/.test(word)
    ? `${word}es`
    : /[^aeiou]y$/.test(word)
      ? `${word.slice(0, -1)}ies`
      : `${word}s`;
  return englishNounPair(word)?.plural ?? regular;
}
/**
 * The next token ends the noun phrase: clause punctuation, a listed verb or preposition, or
 * (unless `strict`) any past or -s verb.
 */
const phraseEnds = (ctx: DetectContext, end: number, strict = false) => {
  const next = tokensAfter(ctx, end, 1)[0];
  if (next?.kind === "end" || next?.kind === "comma") return true;
  if (next?.kind !== "word") return false;
  if (
    /^(?:is|are|was|were|have|has|had|will|can|could|would|should|to|in|on|at|for|from|with|that|which|who|exist)$/.test(
      next.lower,
    )
  )
    return true;
  const r = read(next.lower);
  return (
    !strict &&
    !!r?.verbs.some((v) => v.form === "third" || v.form === "past") &&
    !r.noun &&
    !r.plural
  );
};

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // "This make no sense", "That sound very cool", "I hope that look nice": this/that + -s.
  agreementFramesA: (m, ctx) => {
    const before = wordBefore(ctx, m.index);
    if (
      !(!before && afterBreak(ctx, m.index)) &&
      !/^(?:hope|think|guess|believe|and|but|so|because|since|if)$/.test(before)
    )
      return null;
    const word = m.groups!.target;
    const next = lower(m.groups!.next);
    const r = read(word);
    // "This felt so horrible", "that cost me": a past form like its base.
    if (!r?.verbs.some((v) => v.form === "base" && v.lemma === word)) return null;
    if (FUNCTION_WORDS.has(word) || r.verbs.some((v) => v.form === "past")) return null;
    // "That sound very cool", "This make no sense": a predicate or an object after it; "this
    // make of car" keeps its noun.
    const predicate =
      /^(?:no|it|me|us|them|you|him|her|the|a|an|very|so|really|pretty|quite|true|fair|good|great|nice|fine|right|wrong|cool|amazing|awesome|bad|weird|strange|interesting|familiar|sense|perfect)$/.test(
        next,
      );
    // A verb-only word before its object: "This allow us to…". Tech nouns read as verbs
    // otherwise ("This accept button", "this confirm reflects").
    const verbOnly =
      !r.noun &&
      !r.adjective &&
      !r.adverb &&
      !r.plural &&
      /^(?:us|them|me|him|you|my|our|your|their|his|its|these|those|everyone|people)$/.test(next);
    if ((!predicate && !verbOnly) || (r.noun && /^(?:the|a|an)$/.test(next))) return null;
    // "That fine print": an adjective takes a degree word or an object only.
    if (r.adjective && !/^(?:very|so|really|pretty|quite|no|it|me|us|them)$/.test(next))
      return null;
    return englishInflect(word, "third");
  },
  // "Peter did went to the cinema": did takes the base form.
  agreementFramesA2: (m) => {
    // A name; pronoun subjects belong to the auxiliary check.
    const subject = m.groups!.subject;
    if (!/^[A-Z][a-z]+$/.test(subject) || FUNCTION_WORDS.has(lower(subject))) return null;
    const word = m.groups!.target;
    const forms = englishVerbForms(word);
    // Only an irregular past that is no participle ("went", "came", "took").
    if (!forms || forms.past !== word || forms.participle === word || forms.lemma === word)
      return null;
    return forms.lemma;
  },
  // "one of our client decided", "two of my sensor are offline": a member of a plural.
  agreementFramesA3: (m, ctx) => {
    const mods = lower(m.groups!.mods).trim().split(/\s+/).filter(Boolean);
    if (mods.some((w) => FUNCTION_WORDS.has(w) || !(read(w)?.adjective || read(w)?.noun)))
      return null;
    const plural = countNoun(m.groups!.target);
    return plural && phraseEnds(ctx, m.index + m[0].length) ? plural : null;
  },
  // "of all kind of rarity", "the rates of all timekeeper.": all before a count noun.
  agreementFramesA4: (m) => countNoun(m.groups!.target),
  // "a collection of book", "A multitude of bird exist": a group of count nouns.
  agreementFramesA5: (m, ctx) => {
    const word = m.groups!.target;
    const plural = englishCountNoun(word) ? countNoun(word) : null;
    // "a couple of model predicted values": a past form can make a compound adjective.
    return plural && phraseEnds(ctx, m.index + m[0].length, true) ? plural : null;
  },
  // "We are all animal.": all before one count noun at the clause end.
  agreementFramesA6: (m) =>
    englishCountNoun(m.groups!.target) ? countNoun(m.groups!.target) : null,
  // "There are a few computer to test", "There're many problem": a plural after the count.
  agreementFramesA7: (m, ctx) => {
    const plural = countNoun(m.groups!.target);
    return plural && phraseEnds(ctx, m.index + m[0].length) ? plural : null;
  },
  // "Tom has already complaint about it", "We shouldn't have restraint them": the participle.
  agreementFramesA8: (m) => {
    const verb = nounVerb(m.groups!.target);
    return verb ? participle(verb) : null;
  },
  // "He is bagging for mercy", "They bagged for attention": beg.
  agreementFramesBag: (m) => lower(m.groups!.target).replace(/^bag/, "beg"),
  // "Brown begs are out", "a beg full of chocolate": bag.
  agreementFramesBegs: (m) => (/s$/i.test(m.groups!.target) ? "bags" : "bag"),
  // "Users sees the icon": a bare plural subject opens the sentence. Not before is/was: a
  // title takes a singular verb ("Asteroids was a hit").
  agreementFramesA9: (m, ctx) => {
    if (!pluralSubject(ctx, m.index, lower(m.groups!.noun))) return null;
    const verb = lower(m.groups!.target);
    const r = read(verb);
    if (!r || r.noun || r.plural || r.adjective) return null;
    const lemma = r.verbs.find((v) => v.form === "third")?.lemma;
    return lemma && r.verbs.every((v) => v.lemma === lemma) ? lemma : null;
  },
  // "This guys works for us": the -s verb shows that "this" heads a singular noun.
  agreementFramesA10: (m, ctx) => {
    const noun = lower(m.groups!.target);
    const forms = nounNumber(noun);
    const r = read(noun);
    const v = read(m.groups!.verb);
    if (forms?.number !== "plural" || !r?.plural || r.adjective) return null;
    if (!v?.verbs.some((x) => x.form === "third")) return null;
    // A verb reading of the first word or a noun reading of the second ("this sales
    // figures") needs a closed word or an adverb after the pair.
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    const closed =
      next?.kind === "word" && (FUNCTION_WORDS.has(next.lower) || /ly$/.test(next.lower));
    return (!r.verbs.length && !v.noun) || closed ? forms.singular : null;
  },
} satisfies Record<string, Fixer>;

/** A plural noun that opens the sentence as its bare subject: no verb or adjective reading. */
function pluralSubject(ctx: DetectContext, index: number, noun: string): boolean {
  if (!afterBreak(ctx, index) || /^(?:data|media|news|series|species|means)$/.test(noun))
    return false;
  const r = read(noun);
  return nounNumber(noun)?.number === "plural" && !!r?.plural && !r.adjective;
}
