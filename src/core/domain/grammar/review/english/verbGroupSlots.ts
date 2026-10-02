import { englishInflect, englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  afterBreak,
  AUXILIARIES,
  caseLike,
  english,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  tokensAfter,
  wordBefore,
} from "./slotWords";
import { MASS } from "./nounNumberSlots";

// Verb groups whose second verb has the wrong form, read from the lexicon: "have finish",
// "was establish", "got mislead", "does makes", "can you sent", "is requires", "I seen".

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const ADVERBS =
  "(?:not|never|already|just|also|often|recently|finally|yet|ever|always|now|nearly|completely|actually|really|since|all|only|usually|sometimes|probably|definitely|certainly|indeed|still|greatly|naturally|affectionately|rapidly|exactly|[a-z]+ly)";
const ADVERB_RUN = `(?<adverbs>(?:${SPACE}${ADVERBS}){0,2})`;
// A request adverb may stand in a question: "can you please send…".
const QUESTION_RUN = `(?<adverbs>(?:${SPACE}(?:${ADVERBS.slice(3, -1)}|please)){0,2})`;
const SUBJECT_PRONOUN = /^(?:i|you|we|they|he|she|it|who)$/;
const OBJECT = /^(?:me|him|her|us|them|you|it)$/;
// What precedes a fronted clause whose verb can follow do/be: "What it does makes sense".
const GAP =
  /\b(?:what|whatever|whoever|all|everything|anything|something|nothing|which|who|how|where|why)\b[^.!?;:,\n]*$/i;

/** A base verb in its own spelling that no participle or past shares ("finish", not "put"). */
function bareBase(word: string): { lemma: string; verbOnly: boolean } | null {
  if (FUNCTION_WORDS.has(word) || PREDICATES.has(word)) return null;
  const read = englishWordInfo(word);
  if (!read?.verbs.some((v) => v.form === "base" && v.lemma === word)) return null;
  if (read.verbs.some((v) => v.form !== "base" && v.form !== "third")) return null;
  const participle = participleOf(word);
  if (!participle || participle === word) return null;
  return { lemma: word, verbOnly: !read.noun && !read.adjective && !read.adverb && !read.plural };
}

function participleOf(lemma: string): string | null {
  const forms = englishVerbForms(lemma);
  if (forms && forms.lemma === lemma) return forms.participle;
  return englishInflect(lemma, "past");
}

// Base verbs that are mostly predicates or names ("weren't awake", "be home", "I am harry");
// "were shock by" belongs to an englishConfusedWords row.
const PREDICATES = new Set(
  "awake home harry close please flatter double further back exempt shock".split(" "),
);

const plainWord = (ctx: DetectContext, word: string) =>
  word === word.toLowerCase() && !ctx.dictionary.has(word);

function push(
  ctx: DetectContext,
  findings: RawFinding[],
  ruleId: RawFinding["ruleId"],
  messageKey: RawFinding["messageKey"],
  start: number,
  end: number,
  alternatives: string[],
  from: number,
  requiresChoice = false,
): void {
  if (findings.some((f) => f.range.start === start && f.range.end === end)) return;
  findings.push({
    ruleId,
    messageKey,
    range: { start, end },
    alternatives,
    ...(requiresChoice ? { requiresChoice: true as const } : {}),
    context: evidence(ctx, from, end),
  });
}

const nextToken = (ctx: DetectContext, end: number) => tokensAfter(ctx, end, 1)[0];

/**
 * An object pronoun follows: the word before it is a verb. A determiner would not do:
 * "I have work the next day", "you have evidence the shop knows".
 */
function objectFollows(ctx: DetectContext, end: number): boolean {
  const first = tokensAfter(ctx, end, 1)[0];
  return first?.kind === "word" && OBJECT.test(first.lower);
}

// Nouns a person "has" bare, before a time phrase or a determiner: "I have work the next day",
// "We have practice this week".
const HAVE_NOUNS = new Set(
  "work practice class school lunch dinner breakfast time fun access control power trouble help need contact experience support care faith hope love respect permission rest sleep charge chance training rehearsal homework sex reason cause priority".split(
    " ",
  ),
);
const TIME_NOUNS =
  /^(?:day|days|week|weeks|weekend|morning|afternoon|evening|night|month|year|time|semester|term|summer|winter)$/;

/**
 * A determiner and a non-time noun after a noun-or-verb base: "has hire several traders",
 * "have see any problems". Not "I have work the next day".
 */
function determinerFollows(ctx: DetectContext, end: number, verb: string): boolean {
  if (HAVE_NOUNS.has(verb) || MASS.has(verb)) return false;
  const [first, second, third] = tokensAfter(ctx, end, 3);
  // "you have evidence the shop knows…": the determiner opens a clause of its own.
  const read = third?.kind === "word" ? englishWordInfo(third.lower) : null;
  const clause =
    third?.kind === "word" &&
    (AUXILIARIES.has(third.lower) ||
      (!read?.plural &&
        (/ed$/.test(third.lower) ||
          !!read?.verbs.some((v) => v.form === "third" || v.form === "past"))));
  return (
    first?.kind === "word" &&
    /^(?:the|a|an|this|these|those|my|your|his|her|our|their|its|several|all|any|some|many|every|each)$/.test(
      first.lower,
    ) &&
    !(second?.kind === "word" && TIME_NOUNS.test(second.lower)) &&
    !clause
  );
}

/** "I have finish", "could have change", "Have you use…": a perfect with a bare verb. */
function perfectWithBase(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const pattern of [
    `(?:(?:i|you|we|they|he|she|it|who)${SPACE}(?:have|has|had)|(?:i|you|we|they|who)['’]ve|(?:could|would|should|must|might|may|will)(?:${SPACE}(?:not|never))?${SPACE}have|(?:could|would|should|must|might)['’]ve|[a-z]+${SPACE}(?:has|have|had))${ADVERB_RUN}${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    `(?:have|has)(?:n['’]t)?${SPACE}(?:i|you|we|they|he|she|it|[A-Z][a-z]+)${ADVERB_RUN}${SPACE}(?<verb>[a-z]+)${WORD_END}`,
  ])
    for (const m of frameMatches(ctx, pattern, "verb")) {
      const verb = m.groups!.verb;
      // The pattern is case-blind: an inverted subject must be a pronoun or a capitalized name.
      const subject = /^(?:have|has)(?:n['’]t)?\s+(\S+)/i.exec(m[0])?.[1];
      if (
        subject &&
        /^(?:have|has)/i.test(m[0]) &&
        !SUBJECT_PRONOUN.test(subject) &&
        !/^[A-Z][a-z]+$/.test(subject)
      )
        continue;
      if (subject && !afterBreak(ctx, m.index) && /^(?:have|has)/i.test(m[0])) continue;
      // "Have Tom and I done enough?": the question owns the participle.
      if (!plainWord(ctx, verb) || (/\bnot\b/.test(m[0]) && verb === "to")) continue;
      // "have to", "have been", "had better" are other constructions.
      if (/^(?:to|been|better|got|gotten|had|done)$/.test(verb)) continue;
      const lead = m[0].slice(0, m.indices!.groups!.adverbs[0] - m.index).toLowerCase();
      // A noun subject before has/have needs a verb-only word ("The man has work at five").
      // A capitalized word the lexicon does not know is a name, as good as a pronoun ("Tom has").
      const name = /^[A-Z][a-z]+\s/.test(m[0]) && !englishWordInfo(lead.split(/\s+/)[0]);
      const nounSubject =
        /^[a-z]+\s+(?:has|have|had)$/.test(lead) &&
        !/^(?:i|you|we|they|he|she|it|who)\s/.test(lead) &&
        !name;
      if (
        nounSubject &&
        /^(?:what|all|which|that|to|i|you|we|they|he|she|it|who|not)$/.test(lead.split(/\s+/)[0])
      )
        continue;
      // "The switches I have do not…": a relative clause ends at have.
      if (nextToken(ctx, m.index + m[0].length)?.lower === "not") continue;
      let participle: string | null;
      if (verb === "be") participle = "been";
      else if (verb === "do") participle = "done";
      else {
        const base = bareBase(verb);
        if (!base) continue;
        if (
          !base.verbOnly &&
          !objectFollows(ctx, m.index + m[0].length) &&
          (nounSubject ||
            // "Who do I have review the contract?": a causative have after do-support.
            /\b(?:do|does|did)[ \t\u00a0]+$/i.test(
              ctx.text.slice(Math.max(0, m.index - 12), m.index),
            ) ||
            !determinerFollows(ctx, m.index + m[0].length, verb))
        )
          continue;
        // "should have write access": a compound noun after the verb.
        const after = nextToken(ctx, m.index + m[0].length);
        if (
          after?.kind === "word" &&
          !FUNCTION_WORDS.has(after.lower) &&
          (nounOnly(after.lower) || englishWordInfo(after.lower)?.noun)
        )
          continue;
        if (nounSubject && !base.verbOnly) continue;
        participle = participleOf(base.lemma);
      }
      if (!participle) continue;
      const [start, end] = m.indices!.groups!.verb;
      push(
        ctx,
        findings,
        "englishPerfectParticiples",
        "review_msg_perfect_participle",
        start,
        end,
        [participle],
        m.index,
      );
    }
  return findings;
}

/** "The software was introduce", "It can be use by everyone": be + a bare verb as a passive. */
function passiveWithBase(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<be>be|been|being|is|are|was|were|am|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)${ADVERB_RUN}${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    "verb",
  )) {
    const verb = m.groups!.verb;
    if (!plainWord(ctx, verb)) continue;
    // "We are please to announce": the participle adjective.
    if (
      verb === "please" &&
      /^[ \t\u00a0]{1,8}(?:to|with|that)\b/i.test(ctx.text.slice(m.index + m[0].length))
    ) {
      const [start, end] = m.indices!.groups!.verb;
      push(
        ctx,
        findings,
        "englishPerfectParticiples",
        "review_msg_be_participle",
        start,
        end,
        ["pleased"],
        m.index,
      );
      continue;
    }
    const base = bareBase(verb);
    if (!base) continue;
    // "was recently release", "is completely rebuild": a manner or time adverb modifies a
    // verb, so a word that is also a noun is the verb here.
    const verbal =
      /\b(?:recently|completely|fully|newly|successfully|already|properly|automatically|correctly|quickly|slowly|carefully|badly|poorly|widely|partially|accidentally|immediately|permanently)\b/i.test(
        m.groups!.adverbs ?? "",
      );
    const before = ctx.text.slice(Math.max(0, m.index - 96), m.index);
    // "All you do is install it", "what I want is…": a bare infinitive after a pseudo-cleft.
    if (GAP.test(before) || /\b(?:do|does|did|to)\b[^.!?;:,\n]*$/i.test(before)) continue;
    // "Let it be", "so be it": be before a pronoun.
    const next = nextToken(ctx, m.index + m[0].length);
    const word = next?.kind === "word" ? next.lower : "";
    const agentNoun = tokensAfter(ctx, m.index + m[0].length, 2)[1];
    const agent = /^(?:by|via)$/.test(word) && agentNoun?.kind === "word";
    const adjective = englishWordInfo(verb)?.adjective;
    if (!base.verbOnly && !(verbal && !adjective) && (!agent || adjective)) continue;
    if (
      !agent &&
      !(next?.kind === "end" || next?.kind === "comma") &&
      !/^(?:in|on|at|to|with|for|from|yet|there|as|because|yesterday|today|now|again|already|into|around|before|after|without|and|but|so|once|when)$/.test(
        word,
      )
    )
      continue;
    const participle = participleOf(base.lemma);
    if (!participle) continue;
    const be = m.groups!.be.toLowerCase();
    const [start, end] = m.indices!.groups!.verb;
    const ing =
      /^(?:is|are|was|were|am)/.test(be) && !agent ? englishInflect(base.lemma, "ing") : null;
    push(
      ctx,
      findings,
      "englishPerfectParticiples",
      "review_msg_be_participle",
      start,
      end,
      ing ? [participle, ing] : [participle],
      m.index,
      !!ing,
    );
  }
  return findings;
}

/** "It got receive by everyone", "is getting spend": get + a bare verb as a passive. */
function getWithBase(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?:get|gets|got|getting|gotten)${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    "verb",
  )) {
    const verb = m.groups!.verb;
    if (!plainWord(ctx, verb)) continue;
    const base = bareBase(verb);
    if (!base?.verbOnly) continue;
    const next = nextToken(ctx, m.index + m[0].length);
    if (!(next?.kind === "end" || next?.kind === "comma" || next?.lower === "by")) continue;
    const participle = participleOf(base.lemma);
    if (!participle) continue;
    const [start, end] = m.indices!.groups!.verb;
    push(
      ctx,
      findings,
      "englishPerfectParticiples",
      "review_msg_be_participle",
      start,
      end,
      [participle],
      m.index,
    );
  }
  return findings;
}

/** A finite or -ing form after do-support or a modal, mapped to its base, or null. */
function baseOf(word: string): string | null {
  const read = englishWordInfo(word);
  if (!read) return null;
  if (word.endsWith("ing")) {
    if (read.noun || read.adjective) return null;
    return englishLemma(word, "ing");
  }
  if (word.endsWith("s")) {
    if (read.plural || read.noun) return null;
    return englishLemma(word, "third");
  }
  if (read.noun || read.adjective) return null;
  const forms = englishVerbForms(word);
  if (forms && (forms.ambiguous.includes(word) || forms.lemma === word)) return null;
  if (!read.verbs.some((v) => v.form === "past" || v.form === "participle")) return null;
  return englishLemma(word, "past");
}

/** "That does makes sense", "he does not has", "Peter did went": do-support + a non-base verb. */
function doSupport(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<subject>[a-z]+)${SPACE}(?<aux>does|do|did)(?:${SPACE}not)?${ADVERB_RUN}${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    "verb",
  )) {
    const { subject, verb } = m.groups!;
    // The subject is a pronoun or a noun: not "Why did…", "neither did…", "you can do…".
    if (
      !plainWord(ctx, verb) ||
      !(
        /^(?:i|you|we|they|he|she|it|this|that|someone|somebody|anyone|everyone|nobody|one)$/i.test(
          subject,
        ) || nounOnly(subject.toLowerCase())
      )
    )
      continue;
    if (verb === "thanks") continue;
    if (/^(?:has|is|was|does|did|have)$/.test(verb)) {
      // "does not has" -> have; "does is" is a cleft.
      if (verb !== "has") continue;
    }
    const before = ctx.text.slice(Math.max(0, m.index - 96), m.index);
    const negated = /\bnot\b/i.test(m[0]);
    // "What it does makes sense": a fronted clause owns the second verb.
    if (!negated && (GAP.test(before) || /^(?:who|which|that)$/i.test(wordBefore(ctx, m.index))))
      continue;
    // "She did testing", "Sami does cycling", "They did needed repairs": lexical do takes
    // nouns and participle adjectives, so the affirmative needs a pronoun subject and an -s
    // or irregular past form.
    if (!negated) {
      if (verb.endsWith("ing")) continue;
      if (!/^(?:i|you|we|they|he|she|it|this|that)$/i.test(subject)) continue;
      // "The research I did showed…": an object-gap relative after a noun.
      const head = wordBefore(ctx, m.index);
      if (head && !FUNCTION_WORDS.has(head) && (nounOnly(head) || englishWordInfo(head)?.noun))
        continue;
      const forms = englishVerbForms(verb);
      if (!verb.endsWith("s") && !(forms && forms.past === verb && forms.participle !== verb))
        continue;
    }
    const lemma = verb === "has" ? "have" : baseOf(verb);
    if (!lemma || lemma === verb) continue;
    const [start, end] = m.indices!.groups!.verb;
    push(
      ctx,
      findings,
      "englishAuxiliaryBaseVerb",
      "review_msg_auxiliary_base",
      start,
      end,
      [caseLike(verb, lemma)],
      m.index,
    );
  }
  return findings;
}

/** "Which car would you bought?", "can you please attached": an inverted modal question. */
function invertedModal(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?:can|could|would|will|should|shall|may|might|must)${SPACE}(?<subject>i|you|we|they|he|she|anyone|someone|anybody|everyone|somebody)${QUESTION_RUN}${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    "verb",
  )) {
    const verb = m.groups!.verb;
    if (!plainWord(ctx, verb)) continue;
    // "the garbage can he had": a noun before the modal makes it a noun.
    const previous = wordBefore(ctx, m.index);
    // "his garbage can he had": a determiner-led noun before the modal makes it a noun too.
    const second = previous ? wordBefore(ctx, m.index - previous.length - 1) : "";
    if (
      previous &&
      !FUNCTION_WORDS.has(previous) &&
      (englishWordInfo(previous)?.noun || nounOnly(previous)) &&
      /^(?:the|a|an|his|her|my|your|our|their|its|this|that)$/.test(second)
    )
      continue;
    // "With all his might he pushed": a possessive makes might a noun.
    if (/^(?:his|her|my|your|our|their|its|the|a|this|that|all)$/.test(previous)) continue;
    // "Can anyone involved in…": a participle after an indefinite subject modifies it.
    if (/one|body$/.test(m.groups!.subject) && !verb.endsWith("s")) continue;
    // "Can you fucking believe…": an -ing intensifier before the verb.
    const after = nextToken(ctx, m.index + m[0].length);
    if (
      verb.endsWith("ing") &&
      after?.kind === "word" &&
      englishWordInfo(after.lower)?.verbs.some((v) => v.form === "base")
    )
      continue;
    const lemma = baseOf(verb);
    if (!lemma || lemma === verb) continue;
    const [start, end] = m.indices!.groups!.verb;
    push(
      ctx,
      findings,
      "englishAuxiliaryBaseVerb",
      "review_msg_auxiliary_base",
      start,
      end,
      [lemma],
      m.index,
    );
  }
  return findings;
}

/** "Your order is requires approval", "She is always goes": be before an -s verb. */
function beBeforeThird(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<subject>[a-z]+)${SPACE}(?<be>is|am|are)(?<adverbs>(?:${SPACE}(?:also|only|always|often|usually|never|sometimes|really|just|still))?)${SPACE}(?<verb>[a-z]+s)${WORD_END}`,
    "be",
  )) {
    const { subject, verb, adverbs } = m.groups!;
    if (!plainWord(ctx, verb) || !plainWord(ctx, m.groups!.be)) continue;
    if (
      !/^(?:i|you|we|they|he|she|it|this|that)$/i.test(subject) &&
      !nounOnly(subject.toLowerCase())
    )
      continue;
    const before = ctx.text.slice(Math.max(0, m.index - 96), m.index);
    if (GAP.test(before)) continue;
    const read = englishWordInfo(verb);
    if (!read?.verbs.some((v) => v.form === "third")) continue;
    if ((read.noun || read.plural || read.adjective) && !adverbs) continue;
    const [start] = m.indices!.groups!.be;
    const [, end] = m.indices!.groups!.verb;
    push(
      ctx,
      findings,
      "englishSentenceStructure",
      "review_msg_sentence_structure",
      start,
      end,
      [`${adverbs.trim() ? `${adverbs.trim()} ` : ""}${verb}`],
      m.index,
    );
  }
  return findings;
}

// Participles that are never a simple past, so a bare subject before them lacks have/has.
const PARTICIPLE_ONLY = new Set(
  "done seen gone been begun taken written eaten given spoken broken known shown chosen driven ridden risen fallen forgotten gotten sung drunk swum rung".split(
    " ",
  ),
);

/** "I seen it", "He done it", "You could been there": a participle with no have. */
function bareParticiple(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<subject>I|he|she|we|they)(?<adverbs>(?:${SPACE}(?:never|already|just|not|also))?)${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    "verb",
  )) {
    const { subject, verb } = m.groups!;
    if (!PARTICIPLE_ONLY.has(verb) || !plainWord(ctx, verb) || verb === "been") continue;
    const before = wordBefore(ctx, m.index);
    // "Have Tom and I done enough?": an inverted perfect.
    if (
      /^(?:have|has|had)\b/i.test(
        ctx.text
          .slice(Math.max(0, m.index - 64), m.index)
          .split(/[.!?]/)
          .at(-1)!
          .trim(),
      )
    )
      continue;
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:and|but|so|when|if|that|because|think|then|well)$/.test(before)
    )
      continue;
    // "Okay, I done." may be "I'm done": a predicate end abstains.
    const next = nextToken(ctx, m.index + m[0].length);
    if (!next || next.kind !== "word") continue;
    const forms = englishVerbForms(
      verb === "done" ? "do" : verb === "gone" ? "go" : verb === "seen" ? "see" : verb,
    );
    const lemma = forms?.participle === verb ? forms.lemma : englishLemma(verb, "past");
    const past = lemma && englishVerbForms(lemma)?.past;
    if (!past) continue;
    const have = /^(?:he|she)$/i.test(subject) ? "has" : "have";
    const adverbs = m.groups!.adverbs;
    const [verbStart, end] = m.indices!.groups!.verb;
    const start = adverbs ? m.indices!.groups!.adverbs[0] : verbStart;
    push(
      ctx,
      findings,
      "englishPerfectParticiples",
      "review_msg_perfect_participle",
      start,
      end,
      adverbs ? [` ${have}${adverbs} ${verb}`, `${adverbs} ${past}`] : [`${have} ${verb}`, past],
      m.index,
      true,
    );
  }
  // "could been", "can been", "used to been".
  for (const m of frameMatches(
    ctx,
    `(?<modal>could|would|should|might|must|may|can|will|to)${SPACE}(?<target>been)${WORD_END}`,
    "target",
  )) {
    const modal = m.groups!.modal.toLowerCase();
    if (
      modal === "to" &&
      !/\bused[ \t\u00a0]+$/i.test(ctx.text.slice(Math.max(0, m.index - 8), m.index))
    )
      continue;
    const [start, end] = m.indices!.groups!.target;
    const fix = /^(?:can|will|to)$/.test(modal) ? "be" : "have been";
    push(
      ctx,
      findings,
      "englishPerfectParticiples",
      "review_msg_perfect_participle",
      start,
      end,
      [fix],
      m.index,
    );
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishPerfectParticiples", "englishAuxiliaryBaseVerb", "englishSentenceStructure"],
    detect: english(
      perfectWithBase,
      passiveWithBase,
      getWithBase,
      doSupport,
      invertedModal,
      beBeforeThird,
      bareParticiple,
    ),
  },
];
