import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { opensSubjectClause } from "../englishWordConfusions";
import { NOUN_LIKE_ING } from "../englishParticiples";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adverb,
  afterBreak,
  caseLike,
  DETERMINERS,
  english,
  evidence,
  FUNCTION_WORDS,
  info,
  nounOnly,
  PREPOSITIONS,
  type Token,
  tokensAfter,
  wordBefore,
  WH_WORDS,
} from "./slotWords";
import { ADDRESSED, YOU_CLAUSE_VERBS } from "./slotConfusions";

// its/it's, your/you're and it/its, you/your decided by the word class of what follows, read
// from the generated lexicon: a possessive needs a noun phrase, a contraction a predicate.

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

// Words after which a clause, and so a subject, can start.
const CUE = new Set(
  (
    "and or but so plus yes yeah yep well oh wow hey yay ah glad hope hoping trust imagine " +
    "believe dunno once while whether where now here see hear sorry until unless though god " +
    "although bet figure feel say think thought guess know knew sure maybe perhaps because " +
    "since if when that what how why mean means confirm"
  ).split(" "),
);
// Stricter cue for a following name or time: "Hey, its Katie" but not "Paris and its Louvre".
const NAME_CUE = new Set(
  "think hope guess bet hey yay yes yeah yep oh wow ok okay well sure maybe god thought here".split(
    " ",
  ),
);
// Words that end an exclamation after a predicate: "It's cool man!", "It's crazy, yeah!"
const TAGS = new Set("man dude bro mate guys yeah ugh lol haha right".split(" "));
// Prenominal words: "its only purpose", "its very existence", "your best".
const NOT_HEAD = new Set(
  "own only first last next other same whole entire main usual former latter very kind sort favorite best worst most least every each both".split(
    " ",
  ),
);
// Adverbs that end a predicate on their own ("it's already there.", "you're all set").
const ENDING_ADVERBS = new Set("all there here not already so still too now again away".split(" "));
// Prepositions that never open a noun phrase after a possessive ("its in there", "your at it").
const PREDICATE_PREPOSITIONS = new Set(
  "in at by from with without into onto between among through during until against within toward towards upon despite throughout under".split(
    " ",
  ),
);
// After these the possessive can still own a compound ("its on switch", "your about page").
const PARTICLE_FOLLOW = new Set(
  "there here top of for to in on at with from again now already the a an my your our his her their this that me him us them you it".split(
    " ",
  ),
);
// What may follow a predicate adjective or participle, never a noun it modifies.
const AFTER_PREDICATE = new Set(
  "to than for enough as if when because now then today tonight again outside inside here there though too with about at of in on by from that so already yet anymore right out away back off up down around over lately anyway please like let without".split(
    " ",
  ),
);
// Predicate words the lexicon gives no adjective reading.
const PREDICATIVE = new Set(
  "welcome okay ok alone afraid awake asleep hurt done gone better worse".split(" "),
);
// What an -ing predicate takes besides a closed word: "you're feeling better".
const AFTER_ING = new Set("better worse well fine good great bad okay".split(" "));
// After these a later verb belongs to another clause.
const CLAUSE_STOP = new Set(
  "that which who whom because if when and but so as than while since until where".split(" "),
);
const FINITE = new Set(
  "is are was were has had does did am will would can could shall should may might must".split(" "),
);
const DAYS =
  /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|christmas|easter)$/;

/** The word before index, or an interjection before a comma there ("Hey, its…"). */
function cueBefore(ctx: DetectContext, index: number): string {
  const comma = /(?<![\p{L}\p{N}_'’-])([A-Za-z]+),[ \t\u00a0]*$/u.exec(
    ctx.text.slice(Math.max(0, index - 16), index),
  );
  return comma && NAME_CUE.has(comma[1].toLowerCase())
    ? comma[1].toLowerCase()
    : wordBefore(ctx, index);
}

/** A clause around index could start with the subject at index. */
function subjectSlot(ctx: DetectContext, index: number): boolean {
  return (
    afterBreak(ctx, index) ||
    opensSubjectClause(ctx, index) ||
    CUE.has(cueBefore(ctx, index)) ||
    // After an introductory phrase: "In that case, its fine."
    /,[ \t\u00a0]*$/.test(ctx.text.slice(Math.max(0, index - 4), index))
  );
}

// Conjunctions after which "your thinking of…" opens a clause rather than naming a noun phrase.
const SUBORDINATORS = new Set(
  "if when while because once unless whether hope though although so mean means".split(" "),
);
// Cues after which a noun-like predicate adjective still reads as a clause: "since it's cold out".
const ADJECTIVE_CUES = new Set([...SUBORDINATORS, "since", "until", ""]);
// Before a possessive + gerund these are prepositions or coordinate noun phrases:
// "since its founding in 1859", "and its teaching that…".
const GERUND_PREPOSITIONS = new Set("since until till after before as".split(" "));
const GERUND_CUES = new Set("and or but how where why".split(" "));
// Nouns the lexicon also reads as adjectives that take "to": "its potential to grow".
const NOUN_BEFORE_TO = new Set("potential intent right due key fit".split(" "));
// Particles that end a predicate only before a closing word: "it's cold outside" but not
// "its powerful outside counsel".
const PARTICLES = new Set("outside inside out up down off over around back away".split(" "));
const DEGREE = new Set(
  "so very really pretty too quite extremely totally completely absolutely way much far".split(" "),
);

/** A finite verb later in the same clause: the word before it headed a noun-phrase subject. */
function laterFiniteVerb(tokens: Token[], from: number, strict = false): boolean {
  for (const t of tokens.slice(from)) {
    if (t.kind !== "word" || CLAUSE_STOP.has(t.lower)) return false;
    if (FINITE.has(t.lower) || /n['’]t$/.test(t.lower)) return true;
    const read = info(t.lower);
    if (
      read &&
      read.verbs.some(
        (v) =>
          v.form === "third" || (v.form === "past" && (strict || (!read.noun && !read.adjective))),
      )
    )
      return true;
  }
  return false;
}

const ingForm = (word: string) => !!englishWordInfo(word)?.verbs.some((v) => v.form === "ing");
const adjectiveHead = (word: string) => {
  if (PREDICATIVE.has(word)) return true;
  const read = info(word);
  return (
    !!read &&
    read.adjective &&
    !read.plural &&
    !NOT_HEAD.has(word) &&
    !(/est$/.test(word) && !/(?:honest|modest|earnest|interest)$/.test(word))
  );
};
const participleHead = (word: string) => {
  const read = info(word);
  return (
    !!read &&
    !read.noun &&
    !read.plural &&
    read.verbs.some((v) => v.form === "participle") &&
    !read.verbs.some((v) => v.form === "base" || v.form === "third")
  );
};

/** The token closes the predicate: punctuation, or a comma before a new clause or the end. */
function closes(tokens: Token[], k: number): boolean {
  const t = tokens[k];
  if (!t || t.kind === "end") return true;
  if (t.kind === "word" && TAGS.has(t.lower)) return closes(tokens, k + 1);
  if (t.kind !== "comma") return false;
  const after = tokens[k + 1];
  // "its large, ornate dome" coordinates adjectives before a noun.
  if (!after || after.kind === "end" || (after.kind === "word" && TAGS.has(after.lower)))
    return true;
  if (after.kind !== "word" || after.text !== after.lower) return after.kind === "number";
  const read = info(after.lower);
  return !(
    read?.adjective ||
    read?.verbs.some((v) => v.form === "participle") ||
    nounOnly(after.lower)
  );
}

/**
 * Where a predicate (not a noun phrase) follows `index`: the end of its evidence, else -1.
 * `nameCue` (after a sentence break or "hey", "think"…) also lets a name or clock time count.
 */
function predicateAfter(
  ctx: DetectContext,
  index: number,
  cue: string,
  nameCue: boolean,
  your: boolean,
): number {
  const tokens = tokensAfter(ctx, index, 14);
  let k = 0;
  while (k < 3 && tokens[k]?.kind === "word" && adverb(tokens[k].lower)) k++;
  const head = tokens[k];
  const next = tokens[k + 1];
  // A glued technical token ("use.tools", "this_file") in the clause: abstain.
  if (!head || tokens.some((t) => t.kind === "other")) return -1;
  if (head.kind === "end" || head.kind === "comma") {
    // "its already there.", "your all set": a closed adverb run that cannot modify a noun.
    return k > 0 &&
      tokens.slice(0, k).every((t) => ENDING_ADVERBS.has(t.lower)) &&
      closes(tokens, k)
      ? head.start
      : -1;
  }
  if (head.kind === "number") {
    if (!nameCue) return -1;
    const rest = ctx.text.slice(head.end, head.end + 24);
    return head.text.includes(":") ||
      /^[ \t\u00a0]*(?:[ap]\.?m\b|o['’]clock|(?:years?|months?|weeks?|days?|hours?|minutes?)[ \t\u00a0]+(?:old|ago|late|early|away)\b)/i.test(
        rest,
      )
      ? head.end
      : -1;
  }
  if (head.kind !== "word") return -1;
  const word = head.lower;
  const nextWord = next?.kind === "word" ? next.lower : "";
  // A name: "Hey, its Katie.", "Its Google's fault", "Yay its Monday!"
  if (/^[A-Z][a-z]/.test(head.text)) {
    // "Your Honor", "Your Grave": a title, never "you're".
    if (!nameCue || your) return -1;
    if (/['’]s$/.test(word) || closes(tokens, k + 1) || /^(?:not|from|but|the)$/.test(nextWord))
      return head.end;
    return DAYS.test(word) && /^(?:and|again|already|tomorrow|today)$/.test(nextWord)
      ? head.end
      : -1;
  }
  if (head.text !== word) return -1;
  if ((DETERMINERS.has(word) && !NOT_HEAD.has(word)) || /^(?:me|him|us|them|you)$/.test(word))
    return head.end;
  if (WH_WORDS.has(word) || word === "gonna" || word === "than" || (!your && word === "been"))
    return head.end;
  if (word === "one" && nextWord === "of") return next.end;
  // "its more than enough", "it's as simple as that"
  if (/^(?:more|less)$/.test(word) && nextWord === "than" && tokens[k + 2]?.kind !== "number")
    return next.end;
  if (word === "as" && adjectiveHead(nextWord) && tokens[k + 2]?.lower === "as") return next.end;
  if (word === "kind" && tokens[k - 1]?.lower === "very" && nextWord === "of") return next.end;
  if (
    word === "time" &&
    (closes(tokens, k + 1) || /^(?:for|to|you|we|i|they|he|she|now|again)$/.test(nextWord))
  )
    return head.end;
  if (
    word === "worth" &&
    (/^(?:it|more|less|a|an|the|every|much|nothing|twice)$/.test(nextWord) ||
      (next?.kind === "word" && ingForm(nextWord)) ||
      next?.kind === "number")
  )
    return next.end;
  if (PREDICATE_PREPOSITIONS.has(word))
    return next?.kind === "word" || next?.kind === "number" ? head.end : -1;
  if (PREPOSITIONS.has(word))
    return closes(tokens, k + 1) || PARTICLE_FOLLOW.has(nextWord) || next?.kind === "number"
      ? head.end
      : -1;
  if (FUNCTION_WORDS.has(word)) return -1;
  const particleEnds =
    PARTICLES.has(nextWord) &&
    (closes(tokens, k + 2) ||
      /^(?:of|to|in|on|at|for|there|here|now|today)$/.test(tokens[k + 2]?.lower ?? ""));
  const fitsPredicate =
    closes(tokens, k + 1) ||
    (AFTER_PREDICATE.has(nextWord) && (!PARTICLES.has(nextWord) || particleEnds)) ||
    (next?.kind === "word" && (DETERMINERS.has(nextWord) || /^(?:me|him|us|them)$/.test(nextWord)));
  const degree = tokens.slice(0, k).some((t) => DEGREE.has(t.lower) || ENDING_ADVERBS.has(t.lower));
  // A word that is also a noun ("see its meaning.", "know your name at…") needs more evidence.
  const nounToo = !PREDICATIVE.has(word) && (!!info(word)?.noun || NOUN_LIKE_ING.test(word));
  // "Your welcome" belongs to englishYourWelcomeCorrection.
  if (your && word === "welcome" && k === 0) return -1;
  // "going to" needs its verb on the same line: "Your going to\nlike this" may be a heading.
  if (word === "going" && nextWord === "to" && tokens[k + 2]?.kind !== "word") return -1;
  if (ingForm(word)) {
    // "its working as expected" but "its working parts", "your meeting with Tom went well".
    if (GERUND_PREPOSITIONS.has(cue) || (nounToo && GERUND_CUES.has(cue))) return -1;
    const closed =
      next?.kind === "word" &&
      (DETERMINERS.has(nextWord) ||
        /^(?:to|me|him|us|them|it|you)$/.test(nextWord) ||
        adverb(nextWord) ||
        AFTER_ING.has(nextWord));
    const ok = nounToo
      ? degree ||
        closed ||
        ((nameCue || SUBORDINATORS.has(cue) || cue === "what") && closes(tokens, k + 1)) ||
        (SUBORDINATORS.has(cue) && PREPOSITIONS.has(nextWord))
      : fitsPredicate || closed || PREPOSITIONS.has(nextWord);
    return ok && !laterFiniteVerb(tokens, k + 1, word === "going") ? head.end : -1;
  }
  if ((participleHead(word) || adjectiveHead(word)) && !NOUN_BEFORE_TO.has(word)) {
    const ok = nounToo
      ? (degree && fitsPredicate) ||
        (/^(?:to|than|enough)$/.test(nextWord) && !NOUN_BEFORE_TO.has(word)) ||
        (nameCue && closes(tokens, k + 1)) ||
        (ADJECTIVE_CUES.has(cue) && fitsPredicate)
      : fitsPredicate ||
        (nextWord === "or" && tokens[k + 2]?.lower === "not") ||
        (participleHead(word) &&
          (ingForm(nextWord) ||
            PREDICATE_PREPOSITIONS.has(nextWord) ||
            /^(?:of|on|as)$/.test(nextWord)));
    return ok && !laterFiniteVerb(tokens, k + 1) ? head.end : -1;
  }
  return -1;
}

function contraction(
  ctx: DetectContext,
  pattern: string,
  ruleId: RawFinding["ruleId"],
  messageKey: RawFinding["messageKey"],
  replacement: string,
): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, pattern)) {
    const target = m.groups!.target;
    const [start, end] = m.indices!.groups!.target;
    // "ITS", "ITs": an acronym or an identifier.
    if (!/^[a-z]+$|^[A-Z][a-z]+$/.test(target) || ctx.dictionary.has(target.toLowerCase()))
      continue;
    if (target !== target.toLowerCase() && !afterBreak(ctx, start)) continue;
    if (!subjectSlot(ctx, start)) continue;
    const cue = cueBefore(ctx, start);
    const nameCue = afterBreak(ctx, start) || NAME_CUE.has(cue);
    const until = predicateAfter(ctx, end, cue, nameCue, replacement === "you're");
    // A list after a comma ("your tired, your poor, …") is no clause.
    if (until >= 0 && !cue && !afterBreak(ctx, start)) {
      const clause = /[^.!?;:\n]*$/.exec(ctx.text.slice(Math.max(0, start - 160), start))![0];
      if (
        /^[ \t\u00a0]*,/.test(ctx.text.slice(until, until + 8)) ||
        new RegExp(`\\b${target}\\b`, "i").test(clause)
      )
        continue;
    }
    if (until < 0) continue;
    findings.push({
      ruleId,
      messageKey,
      range: { start, end },
      alternatives: [caseLike(target, replacement)],
      context: evidence(ctx, start, until),
    });
  }
  return findings;
}

/** "Its working now", "If your interested", "Hey, its Katie": its/your before a predicate. */
function possessiveBeforePredicate(ctx: DetectContext): RawFinding[] {
  return [
    ...contraction(
      ctx,
      `(?<target>its)${WORD_END}`,
      "englishItsContext",
      "review_msg_its_contraction",
      "it's",
    ),
    ...contraction(
      ctx,
      `(?<target>your)${WORD_END}`,
      "englishYourYouAre",
      "review_msg_your_you_are",
      "you're",
    ),
  ];
}

// Words that can follow "you" or "it" as an apposition or adverb, not as an owned noun.
const NOT_OWNED = new Set(
  (
    "today tonight tomorrow yesterday now then again too also first last next instead anyway " +
    "either though once twice soon later early right back home there here all both two three " +
    "guys people folks kids lot sir madam dear man dude buddy mate pal bro ladies gentlemen " +
    "kindly personally directly alone yourself itself myself everyday sometime someday " +
    "upstairs downstairs outdoors indoors backwards forwards afterwards overseas abroad day " +
    "night week something anything nothing everything someone anyone everyone nobody nowhere " +
    "somewhere anywhere everywhere auto"
  ).split(" "),
);
// Verbs that take a second object after "you": "sold you garbage", "wishing you relief".
const SECOND_OBJECT =
  /^(?:sell|sells|sold|selling|lend|lends|lent|hand|hands|handed|pass|passed|leave|left|write|wrote|written|read|serve|served|feed|fed|deny|denied|grant|granted|award|awarded|bake|baked|cook|cooked|fetch|fetched|find|found|order|ordered|pour|poured|promise|promised|reserve|reserved|spare|spared|teach|taught|wish|wishes|wishing|bring|brings|bringing|throw|threw|toss|tossed|offer|offers|offering|allow|allowed|assign|assigned|forgive|forgave|refuse|refused|call|calls|calling|name|named|consider|considered|make|makes|making|get|gets|getting|give|gives|giving|send|sends|sending|show|shows|showing|tell|tells|telling|buy|buys|buying|pay|pays|paying|charge|charges|owe|owes|cost|costs|save|saves|saving|keep|keeps|kept)$/;
// Plurals the lexicon does not number; not "you men", "you people" (addressed).
const IRREGULAR_PLURAL = /^(?:children|feet|teeth)$/;
// Vocatives after a preposition: "This is for you mom!"
const VOCATIVES = new Set(
  "mom dad mum mommy daddy honey baby babe darling sweetie sweetheart love son sis kid boss grandma grandpa granny".split(
    " ",
  ),
);
const OWNER_PREPOSITIONS = new Set(
  "for on of from in about at by into under without toward towards over".split(" "),
);
// "go for it attitude": an idiom ending in "it" used as a modifier.
const IT_IDIOM_VERBS = new Set("go goes going went".split(" "));
const FINITE_AFTER_NOUN = new Set(
  "is was will would can could should may might must has had does did isn't wasn't won't wouldn't can't couldn't".split(
    " ",
  ),
);

/** A noun, also when it is a base verb ("help", "name"): never an -s, past or -ing form. */
function nounReading(word: string): "singular" | "plural" | null {
  const only = nounOnly(word);
  if (only) return only;
  const read = info(word);
  if (!read?.noun || read.adjective || read.adverb) return null;
  if (read.verbs.some((v) => v.form !== "base")) return null;
  return read.plural ? "plural" : "singular";
}

/** The noun phrase after "you"/"it": optional adjective + a noun; its last token index. */
function ownedNoun(tokens: Token[], allowPlural: boolean): number {
  let k = 0;
  const first = tokens[0];
  if (first?.kind !== "word" || first.text !== first.lower || NOT_OWNED.has(first.lower)) return -1;
  const read = info(first.lower);
  // An adjective before the noun; one that is also a noun ("kind", "quick") only before a
  // plain noun: "for you kind reply".
  if (
    read &&
    read.adjective &&
    !read.verbs.length &&
    tokens[1]?.kind === "word" &&
    (!read.noun || nounReading(tokens[1].lower) !== null)
  )
    k = 1;
  const noun = tokens[k];
  if (noun?.kind !== "word" || noun.text !== noun.lower || NOT_OWNED.has(noun.lower)) return -1;
  const number = nounReading(noun.lower);
  return number === "singular" || (allowPlural && number === "plural") ? k : -1;
}

/** "You friend will call", "thanks for you help", "It face was red", "on it movement". */
function pronounForPossessive(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, `(?<target>you|it)${SPACE}(?=[a-z])`)) {
    const target = m.groups!.target;
    // "IT priorities": information technology.
    if (!/^(?:you|it|You|It)$/.test(target)) continue;
    const it = target.toLowerCase() === "it";
    const [start, end] = m.indices!.groups!.target;
    const before = wordBefore(ctx, start);
    const tokens = tokensAfter(ctx, end, 4);
    let k: number;
    // After a fronted clause's comma ("When it heats, it color fades") "it" opens a clause too.
    const afterComma =
      it && /,[ \t\u00a0]{1,8}$/.test(ctx.text.slice(Math.max(0, start - 4), start));
    if (
      (afterBreak(ctx, start) && target !== target.toLowerCase()) ||
      /^(?:and|so|but|if|when|then|now|otherwise)$/.test(before) ||
      afterComma
    ) {
      // Subject position: the noun must be followed by a finite verb that agrees with it.
      k = ownedNoun(tokens, it);
      // "You might has well…": a modal mistyped before "as well", not the noun might.
      if (k < 0 || /^(?:might|may|can|must)$/.test(tokens[k].lower)) continue;
      const verb = tokens[k + 1]?.kind === "word" ? tokens[k + 1].lower : "";
      const plural = nounReading(tokens[k].lower) === "plural";
      const read = info(verb);
      // A base noun that is also a base verb ("volume", "face") cannot follow "it" as a verb.
      const subjectNoun =
        nounOnly(tokens[k].lower) ||
        (it && k === 0 && !plural && nounReading(tokens[k].lower) === "singular");
      const agrees = !subjectNoun
        ? false
        : plural
          ? /^(?:are|were|have|do|will|would|can|could|should|may|might|must)$/.test(verb) ||
            (!!read && !read.noun && read.verbs.some((v) => v.form === "base"))
          : FINITE_AFTER_NOUN.has(verb) ||
            (!!read && read.verbs.some((v) => v.form === "third") && !!subjectNoun);
      if (!agrees) continue;
    } else if (OWNER_PREPOSITIONS.has(before) || (it && /^(?:times|twice)$/.test(before))) {
      // Object of a preposition: "for you help", "of it quadrants".
      k = ownedNoun(tokens, it);
      if (k < 0 || VOCATIVES.has(tokens[k].lower)) continue;
      if (it && IT_IDIOM_VERBS.has(wordBefore(ctx, start - before.length - 1))) continue;
      const after = tokens[k + 1];
      if (!(
        after?.kind === "end" ||
        after?.kind === "comma" ||
        (after?.kind === "word" && (OWNER_PREPOSITIONS.has(after.lower) || after.lower === "with"))
      ))
        continue;
    } else if (
      !it &&
      (before === "not" ||
        (!!before &&
          !FUNCTION_WORDS.has(before) &&
          !!info(before)?.verbs.length &&
          !YOU_CLAUSE_VERBS.test(before) &&
          !SECOND_OBJECT.test(before)))
    ) {
      // An object after a verb that takes no second object: "Did you hug you kids?", "have
      // you camera with you". A plain noun only ("see you soon", "love you mom" stay).
      k = ownedNoun(tokens, true);
      if (k < 0 && tokens[0]?.kind === "word" && IRREGULAR_PLURAL.test(tokens[0].text)) k = 0;
      if (k < 0 || ADDRESSED.test(tokens[k].lower) || VOCATIVES.has(tokens[k].lower)) continue;
      // After an adjective any noun reading will do ("you previous team").
      if (
        !nounOnly(tokens[k].lower) &&
        !(k === 1 && info(tokens[k].lower)?.noun) &&
        !IRREGULAR_PLURAL.test(tokens[k].lower)
      )
        continue;
      const after = tokens[k + 1];
      if (!(
        after?.kind === "end" ||
        after?.kind === "comma" ||
        (after?.kind === "word" &&
          (OWNER_PREPOSITIONS.has(after.lower) ||
            /^(?:with|yet|yesterday|today|now|again|first|and|or)$/.test(after.lower)))
      ))
        continue;
    } else continue;
    if (tokens.slice(0, k + 1).some((t) => ctx.dictionary.has(t.lower))) continue;
    findings.push({
      ruleId: it ? "englishItsContext" : "englishYourYouAre",
      messageKey: it ? "review_msg_its_possessive" : "review_msg_your_possessive",
      range: { start, end },
      alternatives: [caseLike(target, it ? "its" : "your")],
      context: evidence(ctx, start, tokens[k].end),
    });
  }
  return findings;
}

/** "It has it limits": has + it + a plural noun the clause's subject owns. */
function hasItPlural(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?:has|(?<=(?:has|have)${SPACE})had)${SPACE}(?<target>it)${SPACE}(?<noun>[a-z]+)${WORD_END}`,
  )) {
    // The owned noun ends its phrase: "has it flaws.", "has it ups and downs", "has it origins in".
    const after = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (!(after.kind === "end" || after.kind === "comma" || /^(?:and|in|of)$/.test(after.lower)))
      continue;
    // A question ("Has it rained?") or a modal before has: not this frame.
    if (afterBreak(ctx, m.index)) continue;
    const before = wordBefore(ctx, m.index);
    if (
      !before ||
      /^(?:what|why|how|where|when|who|which|will|would|could|should|might|must|may|can|to|nor|rumour|rumor|that)$/.test(
        before,
      )
    )
      continue;
    const noun = m.groups!.noun;
    const read = info(noun);
    const plural = read
      ? read.plural && !read.adjective && !read.adverb
      : nounOnly(noun) === "plural";
    if (NOT_OWNED.has(noun) || !plural || ctx.dictionary.has(noun)) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ruleId: "englishItsContext",
      messageKey: "review_msg_its_possessive",
      range: { start, end },
      alternatives: ["its"],
      context: evidence(ctx, m.index, m.index + m[0].length),
    });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishItsContext", "englishYourYouAre"],
    detect: english(possessiveBeforePredicate, pronounForPossessive, hasItPlural),
  },
];
