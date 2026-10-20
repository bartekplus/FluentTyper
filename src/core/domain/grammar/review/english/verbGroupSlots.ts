import { englishInflect, englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import { FEELING_VERBS } from "../englishAuxiliaryForms";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import {
  afterBreak,
  AUXILIARIES,
  caseLike,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  type Token,
  tokensAfter,
  wordBefore,
} from "./slotWords";
import { MASS } from "./nounNumberSlots";
import { finding } from "../finding";

// Verb groups whose second verb has the wrong form, read from the lexicon: "have finish",
// "was establish", "got mislead", "does makes", "can you sent", "is requires", "I seen".
// The frames are in grammar/rules/en.yaml.

const SUBJECT_PRONOUN =
  /^(?:i|you|we|they|he|she|it|who|anyone|anybody|someone|somebody|everyone)$/;
const OBJECT = /^(?:me|him|her|us|them|you|it)$/;
// What precedes a fronted clause whose verb can follow do/be: "What it does makes sense".
const GAP =
  /\b(?:what|whatever|whoever|all|everything|anything|something|nothing|which|who|how|where|why)\b[^.!?;:,\n]*$/i;

/** A base verb in its own spelling that no participle or past shares ("finish", not "put"). */
function bareBase(word: string): { lemma: string; verbOnly: boolean } | null {
  if (FUNCTION_WORDS.has(word) || PREDICATE_WORDS.has(word)) return null;
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
const PREDICATE_WORDS = new Set(
  "awake home harry close please flatter double further back exempt shock".split(" "),
);

const plainWord = (ctx: DetectContext, word: string) =>
  word === word.toLowerCase() && !ctx.dictionary.has(word);

// A rule keeps one finding per range: its filter is usSlotsOnePerRange.
function push(
  ctx: DetectContext,
  ruleId: RawFinding["ruleId"],
  messageKey: RawFinding["messageKey"],
  start: number,
  end: number,
  alternatives: string[],
  from: number,
  requiresChoice = false,
): RawFinding {
  return finding(ruleId, messageKey, start, end, alternatives, {
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
  // "that" is a determiner only before a noun: "have see that film", not "have word that rain…".
  const that =
    first?.kind === "word" &&
    first.lower === "that" &&
    second?.kind === "word" &&
    !FUNCTION_WORDS.has(second.lower) &&
    !!englishWordInfo(second.lower)?.noun;
  return (
    first?.kind === "word" &&
    (that ||
      /^(?:the|a|an|this|these|those|my|your|his|her|our|their|its|several|all|any|some|many|every|each)$/.test(
        first.lower,
      )) &&
    !(second?.kind === "word" && TIME_NOUNS.test(second.lower)) &&
    !clause
  );
}

// Aspect adverbs a perfect takes and a bare noun object does not: "has often rain", "have
// already hire".
const ASPECT =
  /\b(?:already|just|recently|finally|never|ever|often|nearly|previously|repeatedly)\b/i;

/** A particle and its object: "figure out the bug", "set up a meeting". */
function particleObjectFollows(ctx: DetectContext, end: number): boolean {
  const [first, second] = tokensAfter(ctx, end, 2);
  return (
    first?.kind === "word" &&
    /^(?:out|up|down|off|back|over)$/.test(first.lower) &&
    second?.kind === "word" &&
    /^(?:the|a|an|this|that|these|those|my|your|his|her|our|their|its|it|them|me|us|him|what|how|why)$/.test(
      second.lower,
    )
  );
}

/** A preposition and an object pronoun after the word: "has yell at me", "have talk to him". */
function prepositionObjectFollows(ctx: DetectContext, end: number): boolean {
  const [first, second] = tokensAfter(ctx, end, 2);
  return (
    first?.kind === "word" &&
    /^(?:at|to|with|about|from)$/.test(first.lower) &&
    second?.kind === "word" &&
    OBJECT.test(second.lower)
  );
}

// Verbs that take a that-clause: "studies have show that…".
const THAT_VERBS = new Set(
  "show prove suggest indicate notice hear learn decide agree mention note report claim state demonstrate realize realise discover explain confirm assume".split(
    " ",
  ),
);

/**
 * What follows a noun-or-verb word after have rules the noun out: a manner adverb ("have change
 * so drastically"), a that-clause ("have show that"), an object pronoun after a preposition
 * ("has yell at me"), a determiner ("had launch the new phone"), a plural object after an
 * irregular verb ("have see pictures"), or the clause end after a modal have or 've ("could
 * have change,", "you've notice,").
 */
function verbSlot(ctx: DetectContext, end: number, lemma: string, lead: string): boolean {
  if (HAVE_NOUNS.has(lemma) || MASS.has(lemma)) return false;
  const [first, second] = tokensAfter(ctx, end, 2);
  const read = (t: Token | undefined) => (t?.kind === "word" ? englishWordInfo(t.lower) : null);
  const mannerAdverb = (t: Token | undefined) => {
    const r = read(t);
    return !!r?.adverb && !r.noun && !r.adjective && /ly$/.test(t!.lower);
  };
  if (mannerAdverb(first) || (/^(?:so|too)$/.test(first?.lower ?? "") && mannerAdverb(second)))
    return true;
  if (first?.lower === "that" && THAT_VERBS.has(lemma)) return true;
  if (prepositionObjectFollows(ctx, end) || determinerFollows(ctx, end, lemma)) return true;
  const forms = englishVerbForms(lemma);
  if (
    forms?.lemma === lemma &&
    forms.participle !== lemma &&
    forms.participle !== forms.past &&
    !!read(first)?.plural
  )
    return true;
  return (
    (!first || first.kind === "end" || first.kind === "comma") &&
    /(?:(?:could|would|should|must|might|may|will)\s+have|['’]ve)$/.test(lead)
  );
}

// Nouns a modal "be" takes as a predicate: "It will be fun", "It won't be work".
const BE_PREDICATES = new Set(
  "love work hope rain snow design support research change time business trouble risk cost need interest fun home".split(
    " ",
  ),
);

/** A finite or -ing form after do-support or a modal, mapped to its base, or null. */
function baseOf(word: string, nounToo = false): string | null {
  const read = englishWordInfo(word);
  if (!read) return null;
  if (word.endsWith("ing")) {
    if (read.noun || read.adjective) return null;
    return englishLemma(word, "ing");
  }
  if (word.endsWith("s")) {
    if ((read.plural || read.noun) && !nounToo) return null;
    if (!read.verbs.some((v) => v.form === "third")) return null;
    return englishVerbForms(word)?.third === word
      ? englishVerbForms(word)!.lemma
      : englishLemma(word, "third");
  }
  if ((read.noun || read.adjective) && !nounToo) return null;
  const forms = englishVerbForms(word);
  if (forms && (forms.ambiguous.includes(word) || forms.lemma === word)) return null;
  if (forms?.past === word) return forms.lemma;
  if (!read.verbs.some((v) => v.form === "past" || v.form === "participle")) return null;
  return englishLemma(word, "past");
}

// Participles that are never a simple past, so a bare subject before them lacks have/has.
const PARTICIPLE_ONLY = new Set(
  "done seen gone been begun taken written eaten given spoken broken known shown chosen driven ridden risen fallen forgotten gotten sung drunk swum rung".split(
    " ",
  ),
);

// A sentence start before the subject, maybe with an opening "And"/"But" (no closing quote).
const OPENS_SENTENCE = /[.!?\n][ \t "“]*(?:(?:and|but|so|now|yes|well)[ \t ,]+)?$/i;
const OPENS_TEXT = /(?:^|[.!?\n])[ \t "“]*(?:(?:and|but|so|now|yes|well)[ \t ,]+)?$/i;

const DETERMINER_OBJECT =
  /^(?:the|a|an|my|your|his|her|our|their|its|this|these|those|some|any|many|all|it|them|him|us|me)$/;

// -ing words that name a thing someone has: "have meeting rooms", "had training".
const NOUN_LIKE =
  /^(?:meeting|training|building|clothing|feeling|thing|nothing|something|anything|everything|morning|evening|wedding|ceiling|spring|string|king|ring|wing)$/;

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  /** "I have finish", "could have change", "Have you use…": a perfect with a bare verb. */
  verbGroupPerfectWithBase: (m, ctx) => {
    const verb = m.groups!.verb;
    // The pattern is case-blind: an inverted subject must be a pronoun or a capitalized name.
    const subject = /^(?:have|has)(?:n['’]t)?\s+(\S+)/i.exec(m[0])?.[1];
    if (
      subject &&
      /^(?:have|has)/i.test(m[0]) &&
      !SUBJECT_PRONOUN.test(subject) &&
      !/^[A-Z][a-z]+$/.test(subject)
    )
      return null;
    if (subject && !afterBreak(ctx, m.index) && /^(?:have|has)/i.test(m[0])) return null;
    // "Have Tom call me later.": with a name and no question mark, have is causative.
    if (
      subject &&
      !SUBJECT_PRONOUN.test(subject.toLowerCase()) &&
      !/^[^.!\n]*\?/.test(ctx.text.slice(m.index, m.index + 160))
    )
      return null;
    // "Have Tom and I done enough?": the question owns the participle.
    if (!plainWord(ctx, verb) || (/\bnot\b/.test(m[0]) && verb === "to")) return null;
    // "have to", "have been", "had better" are other constructions.
    if (/^(?:to|been|better|got|gotten|had|done)$/.test(verb)) return null;
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
      return null;
    // "The switches I have do not…": a relative clause ends at have.
    if (nextToken(ctx, m.index + m[0].length)?.lower === "not") return null;
    let participle: string | null;
    if (verb === "be") participle = "been";
    else if (verb === "do") participle = "done";
    // "I have like her for years": like before an object pronoun is the verb.
    else if (verb === "like" && objectFollows(ctx, m.index + m[0].length)) participle = "liked";
    else {
      const base = bareBase(verb);
      if (!base) return null;
      // "Who do I have review it?": a causative have after do-support.
      const causative = /\b(?:do|does|did)[ \t ]+$/i.test(
        ctx.text.slice(Math.max(0, m.index - 12), m.index),
      );
      const slot =
        !causative &&
        verb === base.lemma &&
        !englishWordInfo(verb)?.plural &&
        verbSlot(ctx, m.index + m[0].length, base.lemma, lead);
      if (
        !slot &&
        !base.verbOnly &&
        !objectFollows(ctx, m.index + m[0].length) &&
        // Not after an inverted have: "Have Tom report to me" is causative.
        !(
          !nounSubject &&
          !subject &&
          ((!HAVE_NOUNS.has(verb) && ASPECT.test(m.groups!.adverbs ?? "")) ||
            prepositionObjectFollows(ctx, m.index + m[0].length))
        ) &&
        // "Have you figure out the bug?": a particle and its object after a pronoun subject.
        !(
          !nounSubject &&
          (!subject || SUBJECT_PRONOUN.test(subject.toLowerCase())) &&
          particleObjectFollows(ctx, m.index + m[0].length)
        ) &&
        (nounSubject ||
          // "Who do I have review the contract?": a causative have after do-support.
          /\b(?:do|does|did)[ \t\u00a0]+$/i.test(
            ctx.text.slice(Math.max(0, m.index - 12), m.index),
          ) ||
          !determinerFollows(ctx, m.index + m[0].length, verb))
      )
        return null;
      // "should have write access": a compound noun after the verb.
      const after = nextToken(ctx, m.index + m[0].length);
      if (
        !slot &&
        after?.kind === "word" &&
        !FUNCTION_WORDS.has(after.lower) &&
        !/^(?:two|three|four|five|six|seven|eight|nine|ten|twenty|hundreds|thousands)$/.test(
          after.lower,
        ) &&
        (nounOnly(after.lower) || englishWordInfo(after.lower)?.noun)
      )
        return null;
      if (nounSubject && !base.verbOnly && !slot) return null;
      participle = participleOf(base.lemma);
    }
    if (!participle) return null;
    const [start, end] = m.indices!.groups!.verb;
    return push(
      ctx,
      "englishPerfectParticiples",
      "review_msg_perfect_participle",
      start,
      end,
      [participle],
      m.index,
    );
  },
  /** "The software was introduce", "It can be use by everyone": be + a bare verb as a passive. */
  verbGroupPassiveWithBase: (m, ctx) => {
    const verb = m.groups!.verb;
    if (!plainWord(ctx, verb)) return null;
    // "We are please to announce": the participle adjective.
    if (
      verb === "please" &&
      /^[ \t\u00a0]{1,8}(?:to|with|that)\b/i.test(ctx.text.slice(m.index + m[0].length))
    ) {
      const [start, end] = m.indices!.groups!.verb;
      return push(
        ctx,
        "englishPerfectParticiples",
        "review_msg_be_participle",
        start,
        end,
        ["pleased"],
        m.index,
      );
    }
    const base = bareBase(verb);
    if (!base) return null;
    // "was recently release", "is completely rebuild": a manner or time adverb modifies a
    // verb, so a word that is also a noun is the verb here.
    const verbal =
      /\b(?:recently|completely|fully|newly|successfully|already|properly|automatically|correctly|quickly|slowly|carefully|badly|poorly|widely|partially|accidentally|immediately|permanently)\b/i.test(
        m.groups!.adverbs ?? "",
      );
    const before = ctx.text.slice(Math.max(0, m.index - 96), m.index);
    // "All you do is install it", "what I want is…": a bare infinitive after a pseudo-cleft.
    if (GAP.test(before) || /\b(?:do|does|did|to)\b[^.!?;:,\n]*$/i.test(before)) return null;
    // "Let it be", "so be it": be before a pronoun.
    const next = nextToken(ctx, m.index + m[0].length);
    const word = next?.kind === "word" ? next.lower : "";
    const agentNoun = tokensAfter(ctx, m.index + m[0].length, 2)[1];
    const agent = /^(?:by|via)$/.test(word) && agentNoun?.kind === "word";
    const adjective = englishWordInfo(verb)?.adjective;
    if (!base.verbOnly && !(verbal && !adjective) && (!agent || adjective)) return null;
    // "The best art is stuff by local kids": a mass noun before "by" names the work.
    if (agent && !verbal && MASS.has(verb)) return null;
    // "You are not dismiss me", "I was believe that": a verb-only word before its object.
    // A pronoun subject only: "His job is protect them" is a bare infinitive predicate.
    const object =
      base.verbOnly &&
      /^(?:that|me|him|us|them)$/.test(word) &&
      /(?:^|[^\p{L}'’])(?:i|you|we|they|he|she)(?:\s+\p{L}+)?\s*$/u.test(
        ctx.text.slice(Math.max(0, m.index - 24), m.index).toLowerCase(),
      );
    if (
      !agent &&
      !object &&
      !(next?.kind === "end" || next?.kind === "comma") &&
      !/^(?:in|on|at|to|with|for|from|yet|there|as|because|yesterday|today|now|again|already|into|around|before|after|without|and|but|so|once|when)$/.test(
        word,
      )
    )
      return null;
    const participle = participleOf(base.lemma);
    if (!participle) return null;
    const be = m.groups!.be.toLowerCase();
    const [start, end] = m.indices!.groups!.verb;
    const ing =
      /^(?:is|are|was|were|am)/.test(be) && !agent ? englishInflect(base.lemma, "ing") : null;
    return push(
      ctx,
      "englishPerfectParticiples",
      "review_msg_be_participle",
      start,
      end,
      // Before an object the progressive is the likelier repair.
      ing ? (object ? [ing, participle] : [participle, ing]) : [participle],
      m.index,
      !!ing,
    );
  },
  /** "It can't be check because…", "won't be fix until May": modal + be + a bare verb. */
  verbGroupModalBeBase: (m, ctx) => {
    const verb = m.groups!.verb;
    if (!plainWord(ctx, verb) || BE_PREDICATES.has(verb)) return null;
    const base = bareBase(verb);
    // "It will be cold", "may be open": an adjective reading is the predicate.
    const read = englishWordInfo(verb);
    if (!base || read?.adjective || read?.adverb) return null;
    // "would be arbitrage.", "You will be queen.": a noun reading closes the clause as well; only
    // a cue after it ("can't be check because…") makes it the verb.
    const end0 = m.index + m[0].length;
    if (!base.verbOnly && /^[ \t ]*(?:[.,!?;:]|$)/.test(ctx.text.slice(end0, end0 + 9)))
      return null;
    const participle = participleOf(base.lemma);
    if (!participle) return null;
    const [start, end] = m.indices!.groups!.verb;
    return push(
      ctx,
      "englishPerfectParticiples",
      "review_msg_be_participle",
      start,
      end,
      [participle],
      m.index,
    );
  },
  /** "I'm so use to it", "not use to working": be + "use to" is "used to". */
  verbGroupUsedTo: (m, ctx) => {
    if (!plainWord(ctx, m.groups!.verb)) return null;
    const [start, end] = m.indices!.groups!.verb;
    return push(
      ctx,
      "englishPerfectParticiples",
      "review_msg_be_participle",
      start,
      end,
      ["used"],
      m.index,
    );
  },
  /** "It got receive by everyone", "is getting spend": get + a bare verb as a passive. */
  verbGroupGetWithBase: (m, ctx) => {
    const verb = m.groups!.verb;
    if (!plainWord(ctx, verb)) return null;
    const base = bareBase(verb);
    if (!base?.verbOnly) return null;
    const next = nextToken(ctx, m.index + m[0].length);
    if (!(next?.kind === "end" || next?.kind === "comma" || next?.lower === "by")) return null;
    const participle = participleOf(base.lemma);
    if (!participle) return null;
    const [start, end] = m.indices!.groups!.verb;
    return push(
      ctx,
      "englishPerfectParticiples",
      "review_msg_be_participle",
      start,
      end,
      [participle],
      m.index,
    );
  },
  /** "That does makes sense", "he does not has", "Peter did went": do-support + a non-base verb. */
  verbGroupDoSupport: (m, ctx) => {
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
      return null;
    if (verb === "thanks") return null;
    const negated = /\bnot\b/i.test(m[0]);
    if (/^(?:has|is|was|does|did|have)$/.test(verb)) {
      // "does not has" -> have, "doesn't usually does" -> do; "does is" is a cleft.
      if (verb !== "has" && !(verb === "does" && negated)) return null;
    }
    const before = ctx.text.slice(Math.max(0, m.index - 96), m.index);
    // "What it does makes sense": a fronted clause owns the second verb.
    if (!negated && (GAP.test(before) || /^(?:who|which|that)$/i.test(wordBefore(ctx, m.index))))
      return null;
    // "She did testing", "Sami does cycling", "They did needed repairs": lexical do takes
    // nouns and participle adjectives, so the affirmative needs a pronoun subject and an -s
    // or irregular past form.
    if (!negated) {
      if (verb.endsWith("ing")) return null;
      if (
        !/^(?:i|you|we|they|he|she|it|this|that|someone|somebody|anyone|anybody|everyone|nobody)$/i.test(
          subject,
        )
      )
        return null;
      // "The research I did showed…": an object-gap relative after a noun.
      const head = wordBefore(ctx, m.index);
      if (head && !FUNCTION_WORDS.has(head) && (nounOnly(head) || englishWordInfo(head)?.noun))
        return null;
      const forms = englishVerbForms(verb);
      // A regular past is the verb only before a closed word ("did walked there", "did
      // always walked to"), not before the noun it modifies ("did needed repairs").
      const next = nextToken(ctx, m.index + m[0].length);
      const read = englishWordInfo(verb);
      const regularPast =
        !forms &&
        /ed$/.test(verb) &&
        !!read?.verbs.some((v) => v.form === "past" && !FEELING_VERBS.has(v.lemma)) &&
        !read.adjective &&
        !read.noun &&
        (!next ||
          next.kind === "end" ||
          next.kind === "comma" ||
          (next.kind === "word" &&
            ((FUNCTION_WORDS.has(next.lower) &&
              !/^(?:the|a|an|my|your|his|her|our|their|its|this|that|these|those|some|any|no|every|each)$/.test(
                next.lower,
              )) ||
              (!!englishWordInfo(next.lower)?.adverb && !englishWordInfo(next.lower)?.noun))));
      if (
        !verb.endsWith("s") &&
        !(forms && forms.past === verb && forms.participle !== verb) &&
        !regularPast
      )
        return null;
    }
    // An -s word that is also a plural noun ("does makes sense", "doesn't necessarily means")
    // is the verb when negated, or before to, an object pronoun, "sense" or an adjective.
    const after = nextToken(ctx, m.index + m[0].length);
    const afterRead = after?.kind === "word" ? englishWordInfo(after.lower) : null;
    const verbEvidence =
      negated ||
      (after?.kind === "word" &&
        (/^(?:that|it|them|me|us|him|you|sense)$/.test(after.lower) ||
          (!!afterRead?.adjective && !afterRead.noun && !afterRead.verbs.length) ||
          // "does sounds solid": a linking verb before an adjective.
          (/^(?:sounds|looks|seems|feels|smells|tastes)$/.test(verb) && !!afterRead?.adjective)));
    const lemma = verb === "has" ? "have" : verb === "does" ? "do" : baseOf(verb, verbEvidence);
    if (!lemma || lemma === verb) return null;
    const [start, end] = m.indices!.groups!.verb;
    return push(
      ctx,
      "englishAuxiliaryBaseVerb",
      "review_msg_auxiliary_base",
      start,
      end,
      [caseLike(verb, lemma)],
      m.index,
    );
  },
  /** "Which car would you bought?", "can you please attached": an inverted modal question. */
  verbGroupInvertedModal: (m, ctx) => {
    const verb = m.groups!.verb;
    if (!plainWord(ctx, verb)) return null;
    // "the garbage can he had": a noun before the modal makes it a noun.
    const previous = wordBefore(ctx, m.index);
    // "his garbage can he had": a determiner-led noun before the modal makes it a noun too.
    const second = previous ? wordBefore(ctx, m.index - previous.length - 1) : "";
    if (
      previous &&
      !FUNCTION_WORDS.has(previous) &&
      // "the watering can he had": an -ing modifier makes a compound noun.
      (englishWordInfo(previous)?.noun || nounOnly(previous) || /ing$/.test(previous)) &&
      /^(?:the|a|an|his|her|my|your|our|their|its|this|that)$/.test(second)
    )
      return null;
    // "With all his might he pushed": a possessive makes might a noun. "It will he turned
    // on": a subject before the modal, so no inversion ("he" is "be").
    if (
      /^(?:his|her|my|your|our|their|its|the|a|this|that|all|i|you|we|they|he|she|it)$/.test(
        previous,
      )
    )
      return null;
    // "When will he arrived": at a clause start the auxiliary check owns a past form right
    // after the subject and offers the base or "be". It leaves -ing forms to this check.
    if (
      !verb.endsWith("ing") &&
      !m.groups!.adverbs &&
      /^(?:i|you|we|they|he|she)$/i.test(m.groups!.subject) &&
      /(?:^|[.!?:;\n])[ \t "“]*(?:(?:how|what|why|when|where|who)[ \t ]+)?$/i.test(
        ctx.text.slice(Math.max(0, m.index - 24), m.index),
      )
    )
      return null;
    // "Can anyone involved in…": a participle after an indefinite subject modifies it.
    if (/one|body$/.test(m.groups!.subject) && !verb.endsWith("s")) return null;
    // "Can you fucking believe…": an -ing intensifier before the verb.
    const after = nextToken(ctx, m.index + m[0].length);
    if (
      verb.endsWith("ing") &&
      after?.kind === "word" &&
      englishWordInfo(after.lower)?.verbs.some((v) => v.form === "base")
    )
      return null;
    // "Can anyone lists the steps?": an -s word before a determiner or pronoun object is the
    // verb, not a plural noun in apposition ("Can you folks help?").
    const object =
      after?.kind === "word" &&
      /^(?:the|a|an|this|that|these|those|my|your|his|her|our|their|its|it|them|me|us|him)$/.test(
        after.lower,
      );
    const lemma = baseOf(verb, object && verb.endsWith("s"));
    if (!lemma || lemma === verb) return null;
    const [start, end] = m.indices!.groups!.verb;
    return push(
      ctx,
      "englishAuxiliaryBaseVerb",
      "review_msg_auxiliary_base",
      start,
      end,
      [lemma],
      m.index,
    );
  },
  /** "Your order is requires approval", "She is always goes": be before an -s verb. */
  verbGroupBeBeforeThird: (m, ctx) => {
    const { subject, verb, adverbs } = m.groups!;
    if (!plainWord(ctx, verb) || !plainWord(ctx, m.groups!.be)) return null;
    if (
      !/^(?:i|you|we|they|he|she|it|this|that)$/i.test(subject) &&
      !nounOnly(subject.toLowerCase())
    )
      return null;
    const before = ctx.text.slice(Math.max(0, m.index - 96), m.index);
    if (GAP.test(before)) return null;
    const read = englishWordInfo(verb);
    if (!read?.verbs.some((v) => v.form === "third")) return null;
    if ((read.noun || read.plural || read.adjective) && !adverbs) return null;
    const [start] = m.indices!.groups!.be;
    const [, end] = m.indices!.groups!.verb;
    return push(
      ctx,
      "englishSentenceStructure",
      "review_msg_sentence_structure",
      start,
      end,
      [`${adverbs.trim() ? `${adverbs.trim()} ` : ""}${verb}`],
      m.index,
    );
  },
  /** "I seen it", "He done it", "You could been there": a participle with no have. */
  verbGroupBareParticiple1: (m, ctx) => {
    const { subject, verb } = m.groups!;
    if (!plainWord(ctx, verb) || (!PARTICIPLE_ONLY.has(verb) && verb !== "been")) return null;
    // "It's" spelled "it" is rare; "it" takes only a participle that never is a past.
    if (/^it$/i.test(subject) && (verb === "done" || verb === "been")) return null;
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
      return null;
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:and|but|so|when|if|that|because|think|then|well)$/.test(before) &&
      !/,[ \t\u00a0]*$/.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
    )
      return null;
    const have = /^(?:he|she|it)$/i.test(subject) ? "has" : "have";
    const next = nextToken(ctx, m.index + m[0].length);
    // "He been there", "I been to Rome": a perfect without have.
    if (verb === "been") {
      if (next?.kind !== "word" || /^(?:and|or|but)$/.test(next.lower)) return null;
      const [start, end] = m.indices!.groups!.verb;
      const adverbs = m.groups!.adverbs;
      return push(
        ctx,
        "englishPerfectParticiples",
        "review_msg_perfect_participle",
        adverbs ? m.indices!.groups!.adverbs[0] : start,
        end,
        [adverbs ? ` ${have}${adverbs} been` : `${have} been`],
        m.index,
      );
    }
    // "Okay, I done.": finished ("I'm done") or a perfect ("I have done").
    if ((!next || next.kind !== "word") && verb === "done" && !m.groups!.adverbs) {
      const be = /^i$/i.test(subject) ? "am" : /^(?:he|she)$/i.test(subject) ? "is" : "are";
      const [start, end] = m.indices!.groups!.verb;
      return push(
        ctx,
        "englishPerfectParticiples",
        "review_msg_perfect_participle",
        start,
        end,
        [`${be} done`, `${have} done`],
        m.index,
        true,
      );
    }
    if (!next || next.kind !== "word") return null;
    const forms = englishVerbForms(
      verb === "done" ? "do" : verb === "gone" ? "go" : verb === "seen" ? "see" : verb,
    );
    const lemma = forms?.participle === verb ? forms.lemma : englishLemma(verb, "past");
    const past = lemma && englishVerbForms(lemma)?.past;
    if (!past) return null;
    const adverbs = m.groups!.adverbs;
    const [verbStart, end] = m.indices!.groups!.verb;
    const start = adverbs ? m.indices!.groups!.adverbs[0] : verbStart;
    return push(
      ctx,
      "englishPerfectParticiples",
      "review_msg_perfect_participle",
      start,
      end,
      adverbs ? [` ${have}${adverbs} ${verb}`, `${adverbs} ${past}`] : [`${have} ${verb}`, past],
      m.index,
      true,
    );
  },
  verbGroupBareParticiple2: (m, ctx) => {
    const modal = m.groups!.modal.toLowerCase();
    if (
      modal === "to" &&
      !/\bused[ \t\u00a0]+$/i.test(ctx.text.slice(Math.max(0, m.index - 8), m.index))
    )
      return null;
    const [start, end] = m.indices!.groups!.target;
    const fix = /^(?:can|will|to)$/.test(modal) ? "be" : "have been";
    return push(
      ctx,
      "englishPerfectParticiples",
      "review_msg_perfect_participle",
      start,
      end,
      [fix],
      m.index,
    );
  },
  /** "I have was there", "Where have you were?": a past of be after have is "been". */
  verbGroupPerfectWithPastBe: (m, ctx) => {
    // "All we have are memories", "What I had was luck": the subject closes an object gap.
    const before = ctx.text.slice(Math.max(0, m.index - 96), m.index);
    // "The job I had was in Germany": a subject after a noun closes a relative clause. Only a
    // subject that opens its sentence (or follows an opening "And"/"But") counts.
    if (m.groups!.subject && !(m.index <= 96 ? OPENS_TEXT : OPENS_SENTENCE).test(before))
      return null;
    if (
      !m.groups!.subject &&
      !afterBreak(ctx, m.index) &&
      !/\b(?:where|why|how|when|what)[ \t\u00a0]+$/i.test(before)
    )
      return null;
    if (!plainWord(ctx, m.groups!.verb)) return null;
    const [start, end] = m.indices!.groups!.verb;
    return push(
      ctx,
      "englishPerfectParticiples",
      "review_msg_perfect_participle",
      start,
      end,
      ["been"],
      m.index,
    );
  },
  /** "He has uses the laptop": an -s verb with its object after have. */
  verbGroupPerfectWithThird: (m, ctx) => {
    const verb = m.groups!.verb;
    if (!plainWord(ctx, verb)) return null;
    const next = nextToken(ctx, m.index + m[0].length);
    // "I have has the sensor…": a doubled have.
    // Only at a clause start: "the transformer I have has a sensor" is a relative clause.
    if (
      verb === "has" &&
      m.groups!.pronoun &&
      (afterBreak(ctx, m.index) ||
        /^(?:and|but|so|because|that|if|when)$/.test(wordBefore(ctx, m.index))) &&
      next?.kind === "word" &&
      DETERMINER_OBJECT.test(next.lower)
    ) {
      const [start, end] = m.indices!.groups!.verb;
      return push(
        ctx,
        "englishPerfectParticiples",
        "review_msg_perfect_participle",
        start,
        end,
        ["had"],
        m.index,
      );
    }
    const read = englishWordInfo(verb);
    const third = read?.verbs.find((v) => v.form === "third");
    if (!third) return null;
    // An object must follow. A plural noun ("has needs that matter", "has kids my age") takes
    // only "a"/"an" or an object pronoun as proof it is the verb; after a noun subject only a
    // pronoun object ("The group has already copies it").
    if (/^(?:has|is|was|does)$/.test(verb)) return null;
    const proof = !m.groups!.pronoun
      ? /^(?:it|them|him|us|me)$/
      : read!.plural
        ? /^(?:it|them|him|us|me)$/
        : /^(?:the|a|an|my|your|his|her|our|their|its|this|these|those|it|them|him|us|me)$/;
    if (next?.kind !== "word" || !proof.test(next.lower)) return null;
    const participle = participleOf(third.lemma);
    if (!participle) return null;
    const [start, end] = m.indices!.groups!.verb;
    return push(
      ctx,
      "englishPerfectParticiples",
      "review_msg_perfect_participle",
      start,
      end,
      [participle],
      m.index,
    );
  },
  /** "We've also cooking a cake", "will have compiling the data": have + an -ing form. */
  verbGroupPerfectWithIng: (m, ctx) => {
    const verb = m.groups!.verb;
    if (!plainWord(ctx, verb) || verb === "having" || NOUN_LIKE.test(verb)) return null;
    // A pronoun right before have belongs to englishParticiples' progressive check; "have
    // since adding" is a preposition phrase.
    const adverbs = m.groups!.adverbs ?? "";
    if (!/^(?:will|would|could|should|must|might|may)\b/i.test(m[0]) && !adverbs.trim())
      return null;
    if (/\bsince\b/i.test(adverbs)) return null;
    if (
      /^(?:concerning|regarding|including|following|considering|according|pending|excluding)$/.test(
        verb,
      )
    )
      return null;
    // "how much of a problem they will have compiling it": have trouble doing something.
    if (
      /\b(?:problem|problems|trouble|difficulty|difficulties|issues|time|fun|luck)\b[^.!?;:\n]*$/i.test(
        ctx.text.slice(Math.max(0, m.index - 80), m.index),
      )
    )
      return null;
    const read = englishWordInfo(verb);
    if (!read?.verbs.some((v) => v.form === "ing") || read.noun || read.adjective) return null;
    // Its own object follows: "cooking a cake", "contacting many of you".
    const next = nextToken(ctx, m.index + m[0].length);
    if (next?.kind !== "word" || !DETERMINER_OBJECT.test(next.lower)) return null;
    const lemma = englishLemma(verb, "ing");
    const participle = lemma && participleOf(lemma);
    if (!participle) return null;
    const [start, end] = m.indices!.groups!.verb;
    return push(
      ctx,
      "englishPerfectParticiples",
      "review_msg_perfect_participle",
      start,
      end,
      [participle, `been ${verb}`],
      m.index,
      true,
    );
  },
  /**
   * "When was it send?", "Were they build last year?": an inverted passive with a bare verb.
   * "Were you use the old login?": a person and a verb before its object.
   */
  verbGroupInvertedPassiveBase: (m, ctx) => {
    const person = /^(?:you|we|he|she|i)$/i.test(m.groups!.subject);
    const verb = m.groups!.verb;
    if (!plainWord(ctx, verb)) return null;
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (
      !afterBreak(ctx, m.index) &&
      !/\b(?:where|why|how|when|what|who|whom|exactly|and|but)[ \t\u00a0]+$/i.test(before)
    )
      return null;
    const base = bareBase(verb);
    if (!base || englishWordInfo(verb)?.adjective) return null;
    const next = nextToken(ctx, m.index + m[0].length);
    // "Is it work?" asks about a noun: a noun-or-verb needs a time or agent word after it. A
    // person in a question takes no noun there, so an object or particle shows the verb.
    const tail = /^(?:by|via|last|yesterday|already|yet)$/.test(next?.lower ?? "");
    const personObject =
      person &&
      /^(?:the|a|an|my|your|his|her|our|their|its|this|that|these|those|it|them|me|us|him|out|up|off|down)$/.test(
        next?.lower ?? "",
      ) &&
      /^[^.!?\n]{0,80}\?/.test(ctx.text.slice(m.index + m[0].length));
    if (!(
      tail ||
      personObject ||
      (!person &&
        base.verbOnly &&
        (next?.kind === "end" || /^(?:to|on|in|at|with|from)$/.test(next?.lower ?? "")))
    ))
      return null;
    const participle = participleOf(base.lemma);
    if (!participle) return null;
    // "Why is this happen?": the progressive fits as well as the passive.
    const ing = /^(?:is|are|was|were)$/i.test(m.groups!.be)
      ? englishInflect(base.lemma, "ing")
      : null;
    const [start, end] = m.indices!.groups!.verb;
    return push(
      ctx,
      "englishPerfectParticiples",
      "review_msg_be_participle",
      start,
      end,
      ing ? [participle, ing] : [participle],
      m.index,
      !!ing,
    );
  },
} satisfies Record<string, MatchFixer>;
