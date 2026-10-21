import { englishWordInfo, hasVerbForm } from "../implementations/helpers/EnglishLexicon";
import { knownEnglishNounNumber } from "../implementations/helpers/EnglishNounNumber";
import { ENGLISH_VERB_FORMS, englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import { englishInitialSound } from "../implementations/helpers/EnglishInitialSound";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { opensSubjectClause } from "./englishWordConfusions";
import { caseLike, group, hasUserOrCasedWord } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";
import type { MatchFixer } from "../engine/reviewRules";

// Irregular simple-past forms with one owner ("lay" is lay's lemma and lie's past); with
// modals and "had/did", any subject agrees.
export const PASTS = ENGLISH_VERB_FORMS.filter(
  (entry) => englishVerbForms(entry.past) === entry,
).map((entry) => entry.past);
const PREPOSITION =
  "(?:to|with|for|from|about|at|by|of|on|in|into|onto|upon|without|against|among|between|toward|towards|behind|beside|near|around|via)";
/** A word that ends right before `index` (spaces between) and is one of `words`. */
const after = (ctx: DetectContext, index: number, words: string) =>
  new RegExp(`(?:^|[^\\p{L}\\p{N}_'’-])${words}[ \\t\\u00a0]{1,8}$`, "iu").test(
    ctx.text.slice(Math.max(0, index - 40), index),
  );

type Finding = Omit<RawFinding, "ruleId">;
/** The findings of one match of a sentence structure frame. */
type Find = (m: RegExpExecArray, ctx: DetectContext) => Finding[] | null;
/** The evidence around a match: 32 characters before it, 16 after it. */
export const tightAround = (ctx: DetectContext, m: RegExpExecArray) => ({
  start: Math.max(0, m.index - 32),
  end: Math.min(ctx.text.length, m.index + m[0].length + 16),
});

const isBaseVerb = (word: string) => word === "be" || hasVerbForm(word, "base");

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

const doubleSubjects: Find = (m, ctx) => {
  const findings: Finding[] = [];
  if (m.index < ctx.from || m.index >= ctx.to) return null;
  const { a, b } = m.groups!;
  if (a.toLowerCase() === b.toLowerCase() || hasUserOrCasedWord(ctx, m[0])) return findings;
  const [start] = group(m, "a");
  const [, end] = group(m, "b");
  // "I" is capitalized anywhere; it starts a sentence unless a semicolon or colon precedes it.
  const sentenceInitial =
    a !== "I" || !/[;:][ \t\u00a0]*$/.test(ctx.text.slice(Math.max(0, start - 10), start));
  const second = /^[A-Z]/.test(a) && sentenceInitial ? caseLike(m[0], b.toLowerCase()) : b;
  findings.push({
    messageKey: "review_msg_double_subject",
    range: { start, end },
    alternatives: [a, second === "i" ? "I" : second],
    requiresChoice: true,
    context: tightAround(ctx, m),
  });
  return findings;
};

const possessiveSubjects: Find = (m, ctx) => {
  const findings: Finding[] = [];
  const { a } = m.groups!;
  // A capitalized "My I never…" can be an exclamation.
  if (a !== a.toLowerCase() && m[0] !== m[0].toUpperCase()) return findings;
  if (after(ctx, m.index, "(?:oh|ah|my),?") || hasUserOrCasedWord(ctx, m[0])) return findings;
  const [start] = group(m, "a");
  const [, end] = group(m, "b");
  findings.push({
    messageKey: "review_msg_pronoun_sequence",
    range: { start, end },
    alternatives: [],
    warningOnly: true,
    context: tightAround(ctx, m),
  });
  return findings;
};

const objectPairs: Find = (m, ctx) => {
  const findings: Finding[] = [];
  const { a, b } = m.groups!;
  if (a.toLowerCase() === b.toLowerCase() || hasUserOrCasedWord(ctx, m[0])) return findings;
  const [start] = group(m, "a");
  const [, end] = group(m, "b");
  findings.push({
    messageKey: "review_msg_pronoun_sequence",
    range: { start, end },
    alternatives: [a, b],
    requiresChoice: true,
    context: tightAround(ctx, m),
  });
  return findings;
};

const META_NOUN = /^(?:keyword|pronoun|word|determiner|possessive|variable|declaration|operator)$/i;
/** Adds a determiner clash of `m` to `findings` unless a user or cased word is in it. */
const clashPusher =
  (ctx: DetectContext, findings: Finding[]) =>
  (m: RegExpExecArray, alternatives: string[], start: number, end: number) => {
    if (hasUserOrCasedWord(ctx, m[0])) return;
    findings.push({
      messageKey: "review_msg_determiner_clash",
      range: { start, end },
      alternatives,
      requiresChoice: true,
      context: tightAround(ctx, m),
    });
  };

const determinerClashes: Find = (m, ctx) => {
  const findings: Finding[] = [];
  const push = clashPusher(ctx, findings);
  const { article, possessive } = m.groups!;
  const noun = m.groups!.noun ?? "";
  // "the My Account page" names an interface label.
  if (possessive !== possessive.toLowerCase() && m[0] !== m[0].toUpperCase()) return findings;
  // "the his and hers set", "the my keyword" (a word, not an owner).
  if (/^(?:and|or|own|but)$/i.test(noun) || META_NOUN.test(noun)) return findings;
  const her = possessive.toLowerCase() === "her";
  if (her && (article.toLowerCase() !== "the" || !noun)) return findings;
  if (!noun && !/^[ \t\u00a0]*(?:[.!?,;:)]|$)/.test(ctx.text.slice(m.index + m[0].length)))
    return findings;
  let bare = article;
  if (article.toLowerCase() !== "the") {
    const sound = noun ? englishInitialSound(noun) : "either";
    if (sound === "either") return findings;
    bare = caseLike(m[0], sound === "vowel" ? "an" : "a");
  }
  const [start] = group(m, "article");
  const [, end] = group(m, "possessive");
  const owner =
    /^[A-Z]/.test(article) && m[0] !== m[0].toUpperCase()
      ? caseLike(article, possessive.toLowerCase())
      : possessive;
  push(m, [owner, bare], start, end);
  return findings;
};

const stackedDeterminers: Find = (m, ctx) => {
  const findings: Finding[] = [];
  const push = clashPusher(ctx, findings);
  const { first, second } = m.groups!;
  const one = first.toLowerCase();
  const two = second.toLowerCase();
  const plain = second === second.toLowerCase() && /^[a-zA-Z][a-z]*$/.test(first);
  if (!plain && m[0] !== m[0].toUpperCase()) return findings;
  const article = one === "a";
  // "a the" and possessive + "the" only; two possessives stack after "my"/"our" alone.
  if (article ? two !== "the" : two !== "the" && !/^(?:my|our)$/.test(one)) return findings;
  // "her the" is an object; "Oh my the view!"; "his" can stand alone ("It was his the whole
  // time").
  if (two === "her" || one === two) return findings;
  if (
    one === "his" &&
    /^[ \t\u00a0]+(?:whole|entire|same|next|following|previous|last|first|other)\b/i.test(
      ctx.text.slice(m.index + m[0].length),
    )
  )
    return findings;
  if (one === "my" && after(ctx, m.index, "(?:oh|ah|my),?")) return findings;
  if (/^(?:your|their)$/.test(one) && opensSubjectClause(ctx, m.index)) return findings;
  let kept = first;
  if (article) {
    // "a the apple" keeps "an": the article agrees with the next word.
    const next = /^[ \t\u00a0]+([A-Za-z]+)/.exec(ctx.text.slice(m.index + m[0].length))?.[1];
    const sound = next ? englishInitialSound(next) : "either";
    if (sound === "either") return findings;
    kept = caseLike(m[0], sound === "vowel" ? "an" : "a");
  }
  const [start] = group(m, "first");
  const [, end] = group(m, "second");
  const alternatives = [kept, caseLike(m[0], two)];
  // After a comma or an adverb, "your the" is more likely a you're slip ("Thanks, your the best").
  const before = ctx.text.slice(Math.max(0, start - 24), start).trimEnd();
  const previous = /[A-Za-z]+$/.exec(before)?.[0];
  const slip = previous ? englishWordInfo(previous)?.adverb : /[,;:(]$/.test(before);
  if (two === "the" && /^(?:your|their)$/.test(one) && slip)
    alternatives.unshift(
      `${applyWordCase(one === "your" ? "you're" : "they're", detectWordCase(first))}${ctx.source.slice(group(m, "first")[1], group(m, "second")[0])}${second}`,
    );
  push(m, alternatives, start, end);
  return findings;
};

const doubleModals: Find = (m, ctx) => {
  const findings: Finding[] = [];
  const { first, second } = m.groups!;
  if (first.toLowerCase() === second.toLowerCase()) return findings;
  // The frame's `i` flag lets all-caps words in: "THEY MAY CAN BE LATE".
  const next = m.groups!.next.toLowerCase();
  if (
    !/^(?:not|never|also|just|really|still|probably|definitely|surely|certainly)$/.test(next) &&
    !isBaseVerb(next)
  )
    return findings;
  if (hasUserOrCasedWord(ctx, m[0])) return findings;
  const [start] = group(m, "first");
  const [, end] = group(m, "second");
  findings.push({
    messageKey: "review_msg_double_modal",
    range: { start, end },
    alternatives: [first, applyWordCase(second, detectWordCase(first))],
    requiresChoice: true,
    context: tightAround(ctx, m),
  });
  return findings;
};

// Adverbs the lexicon lists as adjectives ("will likely", "can just") are not predicates.
const NOT_PREDICATE = /^(?:just|likely|often|soon|together|alone|only|still|even|sure)$/;
const NOT_A_SUBJECT =
  /^(?:the|a|an|my|your|his|her|our|their|its|good|ill|free|own|last|when|where|what|why|how|who|which|whose|whom)$/i;
const missingBe: Find = (m, ctx) => {
  const findings: Finding[] = [];
  const { subject, modal, adjective } = m.groups!;
  // "In May possible…" names the month; "Will" can be a name.
  if (NOT_A_SUBJECT.test(subject) || (modal !== modal.toLowerCase() && m[0] !== m[0].toUpperCase()))
    return findings;
  const word = adjective.toLowerCase();
  const info = englishWordInfo(word);
  const tail = group(m, "adjective")[1];
  const next = ctx.text.slice(tail, tail + 12);
  // Predicates the lexicon also reads as verbs or nouns: "ready" and "busy" take an object
  // as verbs; "I will back soon"; "It would best to ask".
  const predicate =
    /^(?:ready|busy)$/.test(word) ||
    (word === "back" &&
      /^[ \t\u00a0]+(?:in|soon|home|later|tomorrow|tonight|by|on)\b/i.test(next)) ||
    (word === "best" &&
      /^(?:it|this|that)$/i.test(subject) &&
      /^[ \t\u00a0]+(?:to|if)\b/i.test(next));
  if (
    !predicate &&
    (!info?.adjective || info.adverb || info.verbs.length || NOT_PREDICATE.test(word))
  )
    return findings;
  // "could kind of see": a noun before "of" is a hedge, not a predicate.
  if (info?.noun && /^[ \t\u00a0]+of\b/i.test(next)) return findings;
  // "it cannot due to the bug": an elided verb before "due to"; "I may due that" is "do".
  if (word === "due" && /^[ \t\u00a0]+(?:to|that|it|this)\b/i.test(ctx.text.slice(tail, tail + 12)))
    return findings;
  // "I couldn't careless" is the idiom "couldn't care less".
  if (word === "careless" && /^could/i.test(modal)) return findings;
  // "can be able" is itself awkward; "I can able to" wants "I am able to" or "I can".
  if (/^(?:can|could)/i.test(modal) && /able$/i.test(adjective)) return findings;
  if (hasUserOrCasedWord(ctx, m[0])) return findings;
  const [start, end] = group(m, "adjective");
  findings.push({
    messageKey: "review_msg_missing_be",
    range: { start, end },
    alternatives: [`${applyWordCase("be", detectWordCase(adjective))} ${adjective}`],
    context: tightAround(ctx, m),
  });
  return findings;
};

const quantities: Find = (m, ctx) => {
  const findings: Finding[] = [];
  if (m.index < ctx.from || m.index >= ctx.to) return null;
  const head = m.groups!.head ?? m.groups!.head2;
  const plural = pluralNoun(m.groups!.noun);
  if (!plural || (plural === "ambiguous" && !m.groups!.ago && !after(ctx, m.index, PREPOSITION)))
    return findings;
  // "a lot" is also an adverb ("It helps a lot people say"): its noun must close the phrase.
  const tail = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 16);
  if (
    head.toLowerCase() === "lot" &&
    !/^[ \t\u00a0]*(?:[.!?,;:)]|$|[ \t\u00a0]+(?:here|there|in|on|at|for|with|who|that|to|from|of)\b)/i.test(
      tail,
    )
  )
    return findings;
  if (hasUserOrCasedWord(ctx, m[0])) return findings;
  const [start, headEnd] = m.indices!.groups![m.groups!.head ? "head" : "head2"];
  // The range runs to the noun, so the inserted "of" sits inside it.
  const [, end] = group(m, "noun");
  findings.push({
    messageKey: "review_msg_couple_of",
    range: { start, end },
    alternatives: [
      `${head} ${head === head.toUpperCase() ? "OF" : "of"}${ctx.text.slice(headEnd, end)}`,
    ],
    context: tightAround(ctx, m),
  });
  return findings;
};

const partitives: Find = (m, ctx) => {
  const findings: Finding[] = [];
  const { of, noun } = m.groups!;
  // "make the most of chances" is an idiom.
  if (!pluralNoun(noun) || after(ctx, m.index, "the") || hasUserOrCasedWord(ctx, m[0]))
    return findings;
  const [start] = group(m, "of");
  const [, end] = group(m, "noun");
  findings.push({
    messageKey: "review_msg_partitive_of",
    range: { start, end },
    alternatives: [noun, `${of} ${applyWordCase("the", detectWordCase(of))} ${noun}`],
    requiresChoice: true,
    context: tightAround(ctx, m),
  });
  return findings;
};

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

const notOnlyInversion: Find = (m, ctx) => {
  const findings: Finding[] = [];
  if (m.index < ctx.from || m.index >= ctx.to) return null;
  if (hasUserOrCasedWord(ctx, m[0])) return findings;
  const { subject, contraction, verb } = m.groups!;
  const [start] = group(m, "subject");
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
  if (closed ? !same : !same && !/^it$/i.test(subject) && SUBJECTS.test(then ?? ""))
    return findings;
  let replacement: string;
  if (contraction) {
    const key = contraction.slice(1).toLowerCase();
    if (!SUBJECT_OF[key].test(subject)) return findings;
    const has = key === "s" && /^[ \t\u00a0]+(?:been|got|gotten)\b/i.test(ctx.text.slice(end));
    replacement = `${cased(key === "s" ? (has ? "has" : "is") : CONTRACTED[key])} ${who}`;
  } else if (AUX.test(verb)) {
    const [auxStart] = group(m, "verb");
    replacement = `${verb}${ctx.source.slice(start + subject.length, auxStart)}${who}`;
  } else {
    const support = doSupport(subject, verb, ctx.text.slice(end, end + 24));
    if (!support) return findings;
    replacement = `${cased(support[0])} ${who} ${cased(support[1])}`;
  }
  findings.push({
    messageKey: "review_msg_not_only_inversion",
    range: { start, end },
    alternatives: [replacement],
    context: tightAround(ctx, m),
  });
  return findings;
};

/** A sentence structure frame fix: its findings report englishSentenceStructure. */
const structure =
  (find: Find): MatchFixer =>
  (m, ctx) =>
    find(m, ctx)?.map((finding) => ({ ...finding, ruleId: "englishSentenceStructure" as const }));

/** The named frame fixes of the englishSentenceStructure frames of grammar/rules/common.yaml. */
export const FIXERS = {
  doubleSubjects: structure(doubleSubjects),
  possessiveSubjects: structure(possessiveSubjects),
  objectPairs: structure(objectPairs),
  determinerClashes: structure(determinerClashes),
  stackedDeterminers: structure(stackedDeterminers),
  doubleModals: structure(doubleModals),
  missingBe: structure(missingBe),
  quantities: structure(quantities),
  partitives: structure(partitives),
  notOnlyInversion: structure(notOnlyInversion),
} satisfies Record<string, MatchFixer>;
