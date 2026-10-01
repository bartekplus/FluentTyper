import { englishWordInfo } from "../implementations/helpers/EnglishLexicon";
import { knownEnglishNounNumber } from "../implementations/helpers/EnglishNounNumber";
import { ENGLISH_VERB_FORMS, englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import { englishInitialSound } from "../implementations/helpers/EnglishInitialSound";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { opensSubjectClause } from "./englishWordConfusions";
import { frame, frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const CLAUSE_START = `(?<=(?:^|[.!?;:\\n"“(])[ \\t\\u00a0]{0,8})`;
const MODALS = "(?:can|could|will|would|shall|should|may|might|must)";
// Simple-past forms with one owner; with modals and "had/did", any subject agrees.
const PASTS = ENGLISH_VERB_FORMS.filter(
  (entry) => englishVerbForms(entry.past) === entry && entry.past !== "was",
).map((entry) => entry.past);
const PREPOSITION =
  "(?:to|with|for|from|about|at|by|of|on|in|into|onto|upon|without|against|among|between|toward|towards|behind|beside|near|around|via)";
/** A word that ends right before `index` (spaces between) and is one of `words`. */
const after = (ctx: DetectContext, index: number, words: string) =>
  new RegExp(`(?:^|[^\\p{L}\\p{N}_'’-])${words}[ \\t\\u00a0]{1,8}$`, "iu").test(
    ctx.text.slice(Math.max(0, index - 40), index),
  );

type Finding = Omit<RawFinding, "ruleId">;
const around = (ctx: DetectContext, m: RegExpExecArray) => ({
  start: Math.max(0, m.index - 32),
  end: Math.min(ctx.text.length, m.index + m[0].length + 16),
});
/** Case of the first word, carried onto whatever word replaces it. */
const caseLike = (word: string, model: string) =>
  word === "I" ? word : applyWordCase(word, model.length > 1 ? detectWordCase(model) : "title");

const isBaseVerb = (word: string) =>
  word === "be" || !!englishWordInfo(word)?.verbs.some((verb) => verb.form === "base");

/**
 * A lowercase plural noun: "noun", "ambiguous" when it is also an -s verb (houses, changes),
 * else null. The lexicon omits long nouns that only take a plural, so an unknown long -s word
 * (centuries, developers) is one.
 */
export function pluralNoun(word: string): "noun" | "ambiguous" | null {
  if (word !== word.toLowerCase()) return null;
  if (knownEnglishNounNumber(word) === "plural") return "noun";
  const info = englishWordInfo(word);
  if (!info) return word.length > 6 && /[^siu]s$/.test(word) ? "noun" : null;
  if (!info.plural) return null;
  return info.verbs.some((verb) => verb.form === "third") ? "ambiguous" : "noun";
}

// "I he went": two subject pronouns left over from an edit. Both readings agree with the verb.
// Reporting verbs leave a comma-less parenthetical possible ("They he said were late").
const DOUBLE_SUBJECT = frame(
  `${CLAUSE_START}(?<a>I|we|they|he|she)${SPACE}(?<b>I|we|they|he|she)${SPACE}(?!(?:said|told|thought|knew|felt|believed|claimed|heard|guessed|supposed|reckoned)${WORD_END})(?:${MODALS}|had|did|${PASTS.join("|")}|[a-z]{2,}ed)${WORD_END}`,
);
function doubleSubjects(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, DOUBLE_SUBJECT, (match) => match.index)) {
    const { a, b } = m.groups!;
    if (a.toLowerCase() === b.toLowerCase() || hasUserOrCasedWord(ctx, m[0])) continue;
    const [start] = m.indices!.groups!.a;
    const [, end] = m.indices!.groups!.b;
    // "I" is capitalized anywhere; it starts a sentence unless a semicolon or colon precedes it.
    const sentenceInitial =
      a !== "I" || !/[;:][ \t\u00a0]*$/.test(ctx.text.slice(Math.max(0, start - 10), start));
    const second = /^[A-Z]/.test(a) && sentenceInitial ? caseLike(b.toLowerCase(), a) : b;
    findings.push({
      messageKey: "review_msg_double_subject",
      range: { start, end },
      alternatives: [a, second === "i" ? "I" : second],
      requiresChoice: true,
      context: around(ctx, m),
    });
  }
  return findings;
}

// "about my I want": a possessive needs a noun, never a subject pronoun ("Oh my, I…" abstains).
const POSSESSIVE_SUBJECT = frame(
  `(?<a>my|your|our|their)${SPACE}(?<b>I|you|he|she|we|they)${WORD_END}`,
);
// "to you them": a preposition takes one object; "give you them" (two objects) has no preposition.
const OBJECT_PAIR = frame(
  `${PREPOSITION}${SPACE}(?<a>me|you|him|her|us|them|it)${SPACE}(?<b>me|him|us|them)${WORD_END}`,
);
function pronounSequences(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, POSSESSIVE_SUBJECT, "a")) {
    const { a } = m.groups!;
    // A capitalized "My I never…" can be an exclamation.
    if (a !== a.toLowerCase() && m[0] !== m[0].toUpperCase()) continue;
    if (after(ctx, m.index, "(?:oh|ah|my),?") || hasUserOrCasedWord(ctx, m[0])) continue;
    const [start] = m.indices!.groups!.a;
    const [, end] = m.indices!.groups!.b;
    findings.push({
      messageKey: "review_msg_pronoun_sequence",
      range: { start, end },
      alternatives: [],
      warningOnly: true,
      context: around(ctx, m),
    });
  }
  for (const m of frameMatches(ctx, OBJECT_PAIR, "a")) {
    const { a, b } = m.groups!;
    if (a.toLowerCase() === b.toLowerCase() || hasUserOrCasedWord(ctx, m[0])) continue;
    const [start] = m.indices!.groups!.a;
    const [, end] = m.indices!.groups!.b;
    findings.push({
      messageKey: "review_msg_pronoun_sequence",
      range: { start, end },
      alternatives: [a, b],
      requiresChoice: true,
      context: around(ctx, m),
    });
  }
  return findings;
}

const POSSESSIVE = "(?:my|your|our|their|his|its|her)";
const META_NOUN = /^(?:keyword|pronoun|word|determiner|possessive|variable|declaration|operator)$/i;
// "the my car": an article and a possessive cannot share a noun. "a/an her" abstains (object
// "her" after a noun is ordinary: "a gift for a her"), as does a bare "the her".
const DETERMINER_CLASH = frame(
  `(?<article>the|a|an)${SPACE}(?<possessive>${POSSESSIVE})${WORD_END}(?:${SPACE}(?<noun>[a-z]+))?`,
);
// "my the car", "a the car", "my your car": determiners that cannot stack either way round.
// "its the"/"your the" opening a clause are it's/you're slips, which those rules own.
const STACKED = frame(
  `(?<first>my|your|our|their|his|a)${SPACE}(?<second>the|${POSSESSIVE})${WORD_END}`,
);
function determinerClashes(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  const push = (m: RegExpExecArray, alternatives: string[], start: number, end: number) => {
    if (hasUserOrCasedWord(ctx, m[0])) return;
    findings.push({
      messageKey: "review_msg_determiner_clash",
      range: { start, end },
      alternatives,
      requiresChoice: true,
      context: around(ctx, m),
    });
  };
  for (const m of frameMatches(ctx, DETERMINER_CLASH, "article")) {
    const { article, possessive } = m.groups!;
    const noun = m.groups!.noun ?? "";
    // "the My Account page" names an interface label.
    if (possessive !== possessive.toLowerCase() && m[0] !== m[0].toUpperCase()) continue;
    // "the his and hers set", "the my keyword" (a word, not an owner).
    if (/^(?:and|or|own|but)$/i.test(noun) || META_NOUN.test(noun)) continue;
    const her = possessive.toLowerCase() === "her";
    if (her && (article.toLowerCase() !== "the" || !noun)) continue;
    if (!noun && !/^[ \t\u00a0]*(?:[.!?,;:)]|$)/.test(ctx.text.slice(m.index + m[0].length)))
      continue;
    let bare = article;
    if (article.toLowerCase() !== "the") {
      const sound = noun ? englishInitialSound(noun) : "either";
      if (sound === "either") continue;
      bare = applyWordCase(sound === "vowel" ? "an" : "a", detectWordCase(article));
    }
    const [start] = m.indices!.groups!.article;
    const [, end] = m.indices!.groups!.possessive;
    const owner =
      /^[A-Z]/.test(article) && m[0] !== m[0].toUpperCase()
        ? caseLike(possessive.toLowerCase(), article)
        : possessive;
    push(m, [owner, bare], start, end);
  }
  for (const m of frameMatches(ctx, STACKED, "first")) {
    const { first, second } = m.groups!;
    const one = first.toLowerCase();
    const two = second.toLowerCase();
    const plain = second === second.toLowerCase() && /^[a-zA-Z][a-z]*$/.test(first);
    if (!plain && m[0] !== m[0].toUpperCase()) continue;
    const article = one === "a";
    // "a the" and possessive + "the" only; two possessives stack after "my"/"our" alone.
    if (article ? two !== "the" : two !== "the" && !/^(?:my|our)$/.test(one)) continue;
    // "her the" is an object; "Oh my the view!"; "his" can stand alone ("It was his the whole
    // time").
    if (two === "her" || one === two) continue;
    if (
      one === "his" &&
      /^[ \t\u00a0]+(?:whole|entire|same|next|following|previous|last|first|other)\b/i.test(
        ctx.text.slice(m.index + m[0].length),
      )
    )
      continue;
    if (one === "my" && after(ctx, m.index, "(?:oh|ah|my),?")) continue;
    if (/^(?:your|their)$/.test(one) && opensSubjectClause(ctx, m.index)) continue;
    const [start] = m.indices!.groups!.first;
    const [, end] = m.indices!.groups!.second;
    const alternatives = [first, /^[A-Z]/.test(first) ? caseLike(two, first) : second];
    // After a comma or an adverb, "your the" is more likely a you're slip ("Thanks, your the best").
    const before = ctx.text.slice(Math.max(0, start - 24), start).trimEnd();
    const previous = /[A-Za-z]+$/.exec(before)?.[0];
    const slip = previous ? englishWordInfo(previous)?.adverb : /[,;:(]$/.test(before);
    if (two === "the" && /^(?:your|their)$/.test(one) && slip)
      alternatives.unshift(
        `${applyWordCase(one === "your" ? "you're" : "they're", detectWordCase(first))}${ctx.source.slice(m.indices!.groups!.first[1], m.indices!.groups!.second[0])}${second}`,
      );
    push(m, alternatives, start, end);
  }
  return findings;
}

// Regional double modals; the writer keeps one. A subject pronoun rules out the nouns
// "will" and "might"; a base verb after them rules out canning ("We must can tomatoes").
const DOUBLE_MODAL = frame(
  `(?:I|you|we|they|he|she|it)${SPACE}(?<first>${MODALS})${SPACE}(?<second>${MODALS}|ought${SPACE}to)${SPACE}(?<next>[a-z]+)${WORD_END}`,
);
function doubleModals(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, DOUBLE_MODAL, "first")) {
    const { first, second, next } = m.groups!;
    if (first.toLowerCase() === second.toLowerCase()) continue;
    if (
      !/^(?:not|never|also|just|really|still|probably|definitely|surely|certainly)$/.test(next) &&
      !isBaseVerb(next)
    )
      continue;
    if (hasUserOrCasedWord(ctx, m[0])) continue;
    const [start] = m.indices!.groups!.first;
    const [, end] = m.indices!.groups!.second;
    findings.push({
      messageKey: "review_msg_double_modal",
      range: { start, end },
      alternatives: [first, applyWordCase(second, detectWordCase(first))],
      requiresChoice: true,
      context: around(ctx, m),
    });
  }
  return findings;
}

// A modal directly before a word the lexicon knows only as an adjective ("It would nice if…").
// Adverbs it lists as adjectives ("will likely", "can just") are named here.
const NOT_PREDICATE = /^(?:just|likely|often|soon|together|alone|only|still|even|sure)$/;
const AFTER_PREDICATE = `(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$)|${SPACE}(?:to|for|that|if|in|on|at|with|of|by|now|soon|again|here|there|today|tomorrow|then|and|but|or|because|when|anymore|yet|enough)${WORD_END})`;
const MISSING_BE = frame(
  `(?<subject>[a-z]+)${SPACE}(?<modal>${MODALS}|won['’]t|cannot|(?:could|would|should|might|must|can)n['’]t)(?:${SPACE}not)?${SPACE}(?<adjective>[a-z]+)${WORD_END}${AFTER_PREDICATE}`,
);
const NOT_A_SUBJECT =
  /^(?:the|a|an|my|your|his|her|our|their|its|good|ill|free|own|last|when|where|what|why|how|who|which|whose|whom)$/i;
function missingBe(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, MISSING_BE, "adjective")) {
    const { subject, modal, adjective } = m.groups!;
    // "In May possible…" names the month; "Will" can be a name.
    if (
      NOT_A_SUBJECT.test(subject) ||
      (modal !== modal.toLowerCase() && m[0] !== m[0].toUpperCase())
    )
      continue;
    const word = adjective.toLowerCase();
    const info = englishWordInfo(word);
    if (!info?.adjective || info.adverb || info.verbs.length || NOT_PREDICATE.test(word)) continue;
    // "could kind of see": a noun before "of" is a hedge, not a predicate.
    const tail = m.indices!.groups!.adjective[1];
    if (info.noun && /^[ \t\u00a0]+of\b/i.test(ctx.text.slice(tail, tail + 12))) continue;
    // "can be able" is itself awkward; "I can able to" wants "I am able to" or "I can".
    if (/^(?:can|could)/i.test(modal) && /able$/i.test(adjective)) continue;
    if (hasUserOrCasedWord(ctx, m[0])) continue;
    const [start, end] = m.indices!.groups!.adjective;
    findings.push({
      messageKey: "review_msg_missing_be",
      range: { start, end },
      alternatives: [`${applyWordCase("be", detectWordCase(adjective))} ${adjective}`],
      context: around(ctx, m),
    });
  }
  return findings;
}

// "a couple days", "a lot people": a quantity noun takes "of" before a plural. An -s word that is
// also a verb needs "ago" after it or a preposition before ("A couple runs the shop").
const QUANTITY = frame(
  `(?:a${SPACE}(?<head>couple|lot|bunch|handful)|(?<head2>plenty))${SPACE}(?<noun>[a-z]+)${WORD_END}(?<ago>${SPACE}ago${WORD_END})?`,
);
// "many of people": "of" before a bare plural needs a determiner ("many of the people").
const PARTITIVE = frame(
  `(?<quantifier>a${SPACE}few|many|several|most|some|both|all)${SPACE}(?<of>of)${SPACE}(?<noun>[a-z]+)${WORD_END}`,
);
function quantities(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, QUANTITY, (match) => match.index)) {
    const head = m.groups!.head ?? m.groups!.head2;
    const plural = pluralNoun(m.groups!.noun);
    if (!plural || (plural === "ambiguous" && !m.groups!.ago && !after(ctx, m.index, PREPOSITION)))
      continue;
    // "a lot" is also an adverb ("It helps a lot people say"): its noun must close the phrase.
    const tail = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 16);
    if (
      head.toLowerCase() === "lot" &&
      !/^[ \t\u00a0]*(?:[.!?,;:)]|$|[ \t\u00a0]+(?:here|there|in|on|at|for|with|who|that|to|from|of)\b)/i.test(
        tail,
      )
    )
      continue;
    if (hasUserOrCasedWord(ctx, m[0])) continue;
    const [start, headEnd] = m.indices!.groups![m.groups!.head ? "head" : "head2"];
    // The range runs to the noun, so the inserted "of" sits inside it.
    const [, end] = m.indices!.groups!.noun;
    findings.push({
      messageKey: "review_msg_couple_of",
      range: { start, end },
      alternatives: [
        `${head} ${head === head.toUpperCase() ? "OF" : "of"}${ctx.text.slice(headEnd, end)}`,
      ],
      context: around(ctx, m),
    });
  }
  for (const m of frameMatches(ctx, PARTITIVE, "of")) {
    const { of, noun } = m.groups!;
    // "make the most of chances" is an idiom.
    if (!pluralNoun(noun) || after(ctx, m.index, "the") || hasUserOrCasedWord(ctx, m[0])) continue;
    const [start] = m.indices!.groups!.of;
    const [, end] = m.indices!.groups!.noun;
    findings.push({
      messageKey: "review_msg_partitive_of",
      range: { start, end },
      alternatives: [noun, `${of} ${applyWordCase("the", detectWordCase(of))} ${noun}`],
      requiresChoice: true,
      context: around(ctx, m),
    });
  }
  return findings;
}

// "Not only it is fast": a fronted "not only" inverts subject and auxiliary, also after a
// linking word ("because not only it was…"); other verbs take do-support.
const OPENER = "(?:because|so|and|but|here|now|since|although|though|while|yet|thus|hence|indeed)";
const NOT_ONLY = frame(
  `(?=not${SPACE}only${SPACE})(?:${CLAUSE_START}|(?<=(?:^|[^\\p{L}\\p{N}_'’-])${OPENER},?${SPACE}))not${SPACE}only${SPACE}(?<subject>I|you|he|she|it|we|they)(?:(?<contraction>['’](?:s|re|ve|m|ll))|${SPACE}(?<verb>[a-z]+))${WORD_END}`,
);
const SUBJECTS =
  /^(?:i|you|he|she|it|we|they|everyone|everybody|others|nobody|someone|somebody|all|many|most)$/;
const AUX =
  /^(?:am|is|are|was|were|has|have|had|can|could|will|would|should|must|may|might|shall|do|does|did)$/i;
const CONTRACTED: Readonly<Record<string, string>> = { re: "are", ve: "have", m: "am", ll: "will" };
const SUBJECT_OF: Readonly<Record<string, RegExp>> = {
  s: /^(?:he|she|it)$/i,
  re: /^(?:you|we|they)$/i,
  ve: /^(?:I|you|we|they)$/i,
  m: /^I$/,
  ll: /./,
};

/** "does it work", "did they go": do-support for a fronted lexical verb, or null when unclear. */
function doSupport(subject: string, verb: string, rest: string): [string, string] | null {
  if (verb !== verb.toLowerCase()) return null;
  const verbs = englishWordInfo(verb)?.verbs ?? [];
  const lemmas = (form: string) => [
    ...new Set(verbs.filter((reading) => reading.form === form).map((reading) => reading.lemma)),
  ];
  const singular = /^(?:he|she|it)$/i.test(subject);
  const [third, past, base] = [lemmas("third"), lemmas("past"), lemmas("base")];
  if (singular && third.length === 1) return ["does", third[0]];
  if (past.length === 1 && (singular || !base.length)) return ["did", past[0]];
  // "Not only we people are…": a noun, not a verb, when a finite verb follows.
  if (
    !singular &&
    base.length === 1 &&
    !past.length &&
    !/^[ \t\u00a0]+(?:am|is|are|was|were|have|has|had|do|does|did|can|could|will|would|should|must|may|might)\b/i.test(
      rest,
    )
  )
    return ["do", base[0]];
  return null;
}

function notOnlyInversion(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, NOT_ONLY, (match) => match.index)) {
    if (hasUserOrCasedWord(ctx, m[0])) continue;
    const { subject, contraction, verb } = m.groups!;
    const [start] = m.indices!.groups!.subject;
    const upper = m[0] === m[0].toUpperCase();
    const who = upper || subject === "I" ? subject : subject.toLowerCase();
    const cased = (word: string) => (upper ? word.toUpperCase() : word);
    const end = m.index + m[0].length;
    // "Not only you know it, everyone does" and "Not only I am, but you are" stress the
    // subject; "Not only it works, it is fast" goes on with the same one. Expletive "it" is
    // never stressed.
    const tail = ctx.text.slice(end, end + 160);
    const clause = /^[^.!?\n]*/.exec(tail)![0];
    const then = /(?:[,;]|\bbut\b)[ \t\u00a0]*(?:but[ \t\u00a0]+)?(?:also[ \t\u00a0]+)?([A-Za-z]+)/i
      .exec(clause)?.[1]
      ?.toLowerCase();
    const same = then === subject.toLowerCase();
    const closed = /^[ \t\u00a0]*(?:[,;:.!?]|$)/.test(tail);
    if (closed ? !same : !same && !/^it$/i.test(subject) && SUBJECTS.test(then ?? "")) continue;
    let replacement: string;
    if (contraction) {
      const key = contraction.slice(1).toLowerCase();
      if (!SUBJECT_OF[key].test(subject)) continue;
      const has = key === "s" && /^[ \t\u00a0]+(?:been|got|gotten)\b/i.test(ctx.text.slice(end));
      replacement = `${cased(key === "s" ? (has ? "has" : "is") : CONTRACTED[key])} ${who}`;
    } else if (AUX.test(verb)) {
      const [auxStart] = m.indices!.groups!.verb;
      replacement = `${verb}${ctx.source.slice(start + subject.length, auxStart)}${who}`;
    } else {
      const support = doSupport(subject, verb, ctx.text.slice(end, end + 24));
      if (!support) continue;
      replacement = `${cased(support[0])} ${who} ${cased(support[1])}`;
    }
    findings.push({
      messageKey: "review_msg_not_only_inversion",
      range: { start, end },
      alternatives: [replacement],
      context: around(ctx, m),
    });
  }
  return findings;
}

/** Bounded sentence-structure slips: closed-class frames, with lexicon evidence for open words. */
export function sentenceStructure(ctx: DetectContext): RawFinding[] {
  return [
    ...doubleSubjects(ctx),
    ...pronounSequences(ctx),
    ...determinerClashes(ctx),
    ...doubleModals(ctx),
    ...missingBe(ctx),
    ...quantities(ctx),
    ...notOnlyInversion(ctx),
  ].map((finding) => ({ ...finding, ruleId: "englishSentenceStructure" }));
}
