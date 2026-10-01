import { englishInflect, englishLemma } from "../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import {
  COMPLETE,
  detectPhraseTemplates,
  EDGE,
  frameMatches,
  gluedAfter,
  hasUserOrCasedWord,
  SPACE,
  WORD_END,
} from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SUBJECT = "(?:I|you|we|they|he|she|it)";
const NEGATIVE = `(?:(?:(?:do|does|did)${SPACE}not|(?:don't|doesn't|didn't|don’t|doesn’t|didn’t))${SPACE})?`;
const MODALS = "(?:can|could|will|would|should|may|might|must)";
// Complete arguments distinguish verbs from noun uses: "need work" is deliberately absent.
const COMPLEMENTS: Readonly<Record<string, string>> = {
  fix: "(?:this|the) bug",
  deploy: "(?:tomorrow|today)",
  meet: "(?:you|them|her|him)",
  make: "the change",
  take: "a break",
  write: "the report",
  run: "the tests",
  come: "home",
  see: "the results",
  learn: "(?:Rust|English|Python)",
  visit: "the office",
  read: "the file",
  send: "the message",
  go: "home",
};
const complementTail = (lemma: string) =>
  new RegExp(
    `^${SPACE}${COMPLEMENTS[lemma].replaceAll(" ", SPACE)}${COMPLETE}(?!\\.[\\p{L}\\p{N}_]|\\uFFFC)`,
    "iu",
  );

const OBJECTS = "me|you|him|her|us|them|it";
// anyone, everybody, no one, "any one"
const INDEFINITE = `(?:any|every|some|no)(?:body|one|${SPACE}one)`;
const DETERMINERS = "the|an?|my|your|our|their|his|its|these|those";
const WORD = `(?<word>[A-Za-z]+)${WORD_END}`;
const set = (words: string) => new Set(words.split(/\s+/));
// Closed-class words that spelling alone would take for a base verb ("to all the", "and others").
const FUNCTION_WORDS = set(
  `me you him her us them it the a an my your our their his its these those i we they he she this
  that some any all both each every either neither no none more most much many few less least other
  others another such own same lot anyone someone everyone nobody somebody everybody anybody and or
  but nor so yet if as than then because while when where why how what who whom whose which whether
  to of in on at by for from with about into onto over under up down out off through after before
  since until via per not never also just only still even very too really already always often
  again here there now today tomorrow tonight further better best first once well fast rather
  together is am are was were can could will would shall should may might must`,
);

// Closed classes for reading the words before a frame (lowercase, ’ folded to ').
const BE_WORDS = set("am is are was were be been being 'm 're 's isn wasn aren weren");
const GET_WORDS = set("get gets got getting gotten");
const HAVE_WORDS = set("has have had 've");
const MODAL_DO = set(
  "will would shall should can could may might must 'll 'd do does did don doesn didn won wouldn couldn shouldn cannot",
);
const AUXILIARIES = new Set([
  ...BE_WORDS,
  ...HAVE_WORDS,
  ...MODAL_DO,
  ...set("'t not never also just really actually always even still ever already maybe probably"),
]);
const SUBJECTS = set("i we you they he she it");
const RELATIVES = set("who which that whom");
const FREE_RELATIVES = set("what whatever whoever whichever");
const CONJUNCTIONS = set("and or but then");
const SUBORDINATORS = set(
  "because if when while although though since as so once until unless whereas how why whether",
);
const PREPOSITIONS = set(
  `of in on at by for from with about into onto over under through after before since until via
  per to toward towards among between within without upon across behind beyond like near during
  against around thru`,
);
const NP_DETERMINERS = set(
  "the a an my your our their his her its this that these those some any no every each many much several most all both few more",
);
const INDEFINITES = set(
  "anyone anybody everyone everybody someone somebody nobody one none everything something",
);
const QUANTIFIERS =
  "some|many|much|several|most|all|any|each|every|both|few|more|no|multiple|various|numerous";

const info = (word: string) => englishWordInfo(word);
/** An adverb and nothing else: "strangely", "quickly". */
const pureAdverb = (word: string) => {
  const i = info(word);
  return !!i?.adverb && !i.noun && !i.adjective && !i.verbs.length;
};

// What follows the verb: an object, a pointer or particle, "hear from you", or the clause end.
// A bare noun is rarely followed by the first two; degree and time phrases ("summer a lot",
// "lunch the most", "dinner the next day") are not objects. Evidence glued to a token
// ("you.name") is not prose.
const NEXT_END = `${WORD_END}(?!\\.[\\p{L}\\p{N}_]|\\uFFFC)`;
const OBJECT_NEXT = new RegExp(
  `^${SPACE}(?:${OBJECTS}|${DETERMINERS})${NEXT_END}(?!${SPACE}(?:lot|bit|little|most|least|whole|rest|same|next|other|following|day|week|month|year|time|night|morning|evening|weekend|while)${WORD_END})`,
  "iu",
);
const POINTER_NEXT = new RegExp(
  `^${SPACE}(?:this|that|up|down|out|off|back|over|away)${NEXT_END}`,
  "iu",
);
const FROM_NEXT = new RegExp(`^${SPACE}from${SPACE}(?:${OBJECTS}|${DETERMINERS})${NEXT_END}`, "iu");
const END_NEXT = new RegExp(`^${COMPLETE}`, "u");
const PERSON_NEXT = new RegExp(`^${SPACE}(?:you|him|her|us|them)${NEXT_END}`, "iu");
const PLURAL_NEXT = new RegExp(`^${SPACE}[a-z]+s${NEXT_END}`, "u");
const QUANTIFIER_NEXT = new RegExp(`^${SPACE}(?:${QUANTIFIERS})${NEXT_END}`, "iu");
const NUMBER_NEXT = new RegExp(`^${SPACE}\\d`, "u");
const PREPOSITION_NEXT = new RegExp(`^${SPACE}(?:${[...PREPOSITIONS].join("|")})${NEXT_END}`, "iu");
const NEXT_WORD = new RegExp(`^${SPACE}([A-Za-z]+)${NEXT_END}`, "u");
const objectNext = (tail: string) => OBJECT_NEXT.test(tail) || POINTER_NEXT.test(tail);
const nextWord = (tail: string) => NEXT_WORD.exec(tail)?.[1].toLowerCase();

/** "improved and scale": a coordinated base verb follows. */
function coordinatedVerbNext(tail: string): boolean {
  const m = new RegExp(`^${SPACE}(?:and|or)${SPACE}([A-Za-z]+)${NEXT_END}`, "u").exec(tail);
  return !!m && !!baseVerb(m[1]);
}

/** A noun phrase starts after the verb: "change approval policy", "have multiple views". */
function nounPhraseNext(tail: string): boolean {
  if (objectNext(tail) || QUANTIFIER_NEXT.test(tail)) return true;
  const next = nextWord(tail);
  const i = next && !FUNCTION_WORDS.has(next) ? info(next) : null;
  return !!i?.noun && !i.adjective && !i.adverb;
}

type BaseVerb = { lemma: string; irregular: boolean; ambiguous: boolean };

/**
 * A base verb by the lexicon: listed with a base reading and no other verb's form (found, saw,
 * deleted). `ambiguous` when it is also a noun or adjective (work, try, open). "be" has no row.
 */
function baseVerb(word: string): BaseVerb | null {
  const w = word.toLowerCase();
  if (w === "be") return { lemma: w, irregular: true, ambiguous: false };
  if (FUNCTION_WORDS.has(w)) return null;
  const known = englishVerbForms(w);
  if (known && known.lemma !== w) return null;
  const i = info(w);
  if (!i?.verbs.some((v) => v.form === "base") || i.verbs.some((v) => v.lemma !== w)) return null;
  return { lemma: w, irregular: !!known, ambiguous: i.noun || i.adjective };
}

/** The verb after "to", past one focus or -ly adverb: "to only load", "to easily edit". */
function verbAfterAdverb(word: string, tail: string): { word: string; tail: string } {
  const w = word.toLowerCase();
  if (!(/^(?:only|just|also|even|really|still|always|never|ever|simply)$/.test(w) || pureAdverb(w)))
    return { word, tail };
  const m = NEXT_WORD.exec(tail);
  return m ? { word: m[1], tail: tail.slice(m[0].length) } : { word, tail };
}

const LEFT = 160;
/**
 * Lowercase words before `at`, nearest first, back to the clause start, which is "". Commas,
 * dashes and brackets end a clause too. null when no start lies within 160 characters.
 */
function wordsBefore(text: string, at: number): string[] | null {
  const run = text.slice(Math.max(0, at - LEFT), at);
  const parts = run.split(/[!?;:\n,()[\]–—]|\.(?![\p{L}\p{N}_])|\s-+\s/u);
  if (parts.length === 1 && at > LEFT) return null;
  const words = parts
    .at(-1)!
    .match(/[a-z]+|['’][a-z]+|\d[\d,.]*/giu)
    ?.map((w) => w.toLowerCase().replaceAll("’", "'"));
  return [...(words ?? []).reverse(), ""];
}

/** Skips auxiliaries and adverbs before a verb; returns the index of the first other word. */
function skipAuxiliaries(words: readonly string[], from = 0): number {
  let i = from;
  while (i < words.length && (AUXILIARIES.has(words[i]) || pureAdverb(words[i]))) i++;
  return i;
}

/** A word that can sit inside a noun phrase: determiner, number, noun, adjective or unknown. */
function nounPhraseWord(word: string | undefined): boolean {
  if (!word) return false;
  if (NP_DETERMINERS.has(word) || INDEFINITES.has(word) || /^\d/.test(word)) return true;
  if (FUNCTION_WORDS.has(word) || /^'/.test(word)) return false;
  const i = info(word);
  return !i || i.noun || i.adjective;
}

/** Walks a noun phrase leftward from `from`; a determiner or pronoun begins it. Returns the end. */
function walkNounPhrase(words: readonly string[], from: number): number {
  let j = from;
  while (j < words.length && j - from < 8 && nounPhraseWord(words[j])) {
    const w = words[j++];
    // "a a video game" repeats the determiner.
    if ((NP_DETERMINERS.has(w) || INDEFINITES.has(w)) && !NP_DETERMINERS.has(words[j])) break;
  }
  return j;
}

/**
 * The noun phrase ending at `from` heads a relative clause; true when that phrase is an object
 * (after "have", a preposition, or "is" + "a"), so no main verb can follow the clause. Past
 * verbs and "is the" can open a that-less clause ("I heard the people we helped moved").
 */
function objectAntecedent(words: readonly string[], from: number): boolean {
  const j = walkNounPhrase(words, from);
  const p = words[j];
  if (j === from || !p) return false;
  if (BE_WORDS.has(p)) return words.slice(from, j).some((w) => w === "a" || w === "an");
  return HAVE_WORDS.has(p) || PREPOSITIONS.has(p);
}

/**
 * "help" heads its clause, so the next verb belongs to it: "React helped created a page". After
 * a relative clause that could be a subject ("Everyone who helped got thanks", "The people we
 * helped moved") the next verb may be the main verb, so those abstain.
 */
function helpHeadsClause(words: readonly string[], help: string): boolean {
  const i = skipAuxiliaries(words);
  const skipped = words.slice(0, i);
  if (help === "helped" && skipped.some((w) => BE_WORDS.has(w) || GET_WORDS.has(w))) return false;
  if (help === "helping" && !skipped.some((w) => BE_WORDS.has(w))) return false;
  const w1 = words[i];
  if (help === "help" && !skipped.some((w) => MODAL_DO.has(w)) && !/^(?:i|we|you|they)$/.test(w1))
    return false;
  if (w1 === undefined || FREE_RELATIVES.has(w1)) return false;
  if (w1 === "" || PREPOSITIONS.has(w1)) return true;
  if (CONJUNCTIONS.has(w1))
    return !words.slice(i + 1).some((w) => RELATIVES.has(w) || FREE_RELATIVES.has(w));
  if (RELATIVES.has(w1)) return objectAntecedent(words, i + 1);
  if (SUBJECTS.has(w1)) {
    const w2 = words[i + 1];
    if (w2 === "" || CONJUNCTIONS.has(w2) || SUBORDINATORS.has(w2)) return true;
    // "…, that I have helped implemented": a clause-initial "that" leaves no subject to finish.
    if (RELATIVES.has(w2)) return words[i + 2] === "" || objectAntecedent(words, i + 2);
    // "a video game I helped made": a reduced relative clause
    return nounPhraseWord(w2) ? objectAntecedent(words, i + 1) : true;
  }
  const j = walkNounPhrase(words, i);
  if (j === i) return false;
  // "the people the charity helped": another noun phrase before the subject
  return nounPhraseWord(words[j]) ? objectAntecedent(words, j) : true;
}

type Repair = Pick<RawFinding, "messageKey" | "alternatives" | "requiresChoice">;
type Frame = {
  /** <target> is the replaced range; <word> is the verb, the frame's last word. */
  pattern: string;
  /** Lowercase alternatives for <target> given the verb and the text after it; null abstains. */
  repair: (word: string, tail: string, m: RegExpExecArray, ctx: DetectContext) => Repair | null;
};

const BASE: RawFinding["messageKey"] = "review_msg_causative_base";
const STRESS = "(?:not|really|so|truly|all|also|still|very|definitely|eagerly|certainly|genuinely)";
const BE_SUBJECT = `(?:${SUBJECT}${SPACE}(?:am|is|are|was|were|(?:have|has|had)${SPACE}been|will${SPACE}be)|I['’]m|(?:we|you|they)['’]re|(?:he|she)['’]s|(?:I|we|you|they)['’](?:ve|d)${SPACE}been)`;

/** "it", "this" or "that" is the subject of "worth", or a question or modal starts the clause. */
function dummyWorth(words: readonly string[]): boolean {
  let i = skipAuxiliaries(words);
  // "It doesn't seem worth"
  if (/^(?:seem|seems|seemed|appear|appears|appeared)$/.test(words[i]))
    i = skipAuxiliaries(words, i + 1);
  const w = words[i];
  if (w === "it" || w === "its" || w === "this" || w === "that") return true;
  return w === "" && i > 0;
}

const PARTICIPLE = (lemma: string) => {
  const row = englishVerbForms(lemma);
  return row?.lemma === lemma ? row.participle : englishInflect(lemma, "past");
};

const FRAMES: readonly Frame[] = [
  {
    // "I'm looking forward to meet you": -ing after "look forward to". Nouns end this phrase
    // ("to dinner.", "to spring"), so an ambiguous verb needs an object after it. A bare
    // imperative "Look forward to see the road" looks ahead.
    pattern: `(?:(?:${SUBJECT}(?:['’](?:ll|d))?|${MODALS}|${STRESS}|always|greatly)${SPACE}${NEGATIVE}(?:look|looks|looked)|${BE_SUBJECT}${SPACE}(?:${STRESS}${SPACE}){0,2}looking|(?<=(?:^|[.!?,\\n]|\\band)[ \\t\\u00a0"“]{0,8})(?<bare>looking))${SPACE}forward${SPACE}to${SPACE}(?<target>${WORD})`,
    repair(word, tail, m) {
      const verb = baseVerb(word);
      // A subjectless "Looking forward to see the road" can look ahead; a person cannot be seen
      // that way: "Looking forward to meet you", "to hear from you".
      if (m.groups!.bare && !PERSON_NEXT.test(tail) && !FROM_NEXT.test(tail)) return null;
      const evidence =
        verb &&
        (!verb.ambiguous ||
          OBJECT_NEXT.test(tail) ||
          (verb.irregular && FROM_NEXT.test(tail)) ||
          (Object.hasOwn(COMPLEMENTS, verb.lemma) && complementTail(verb.lemma).test(tail)));
      const ing = evidence && englishInflect(verb.lemma, "ing");
      return ing ? { messageKey: "review_msg_forward_gerund", alternatives: [ing] } : null;
    },
  },
  {
    // "It is worth to try": -ing after "worth". A noun "worth" ("its worth to society", "the
    // worth to investors") takes a recipient, so the verb must not read as one.
    pattern: `worth${SPACE}(?<target>to${SPACE}${WORD})`,
    repair(word, tail, m, ctx) {
      const verb = baseVerb(word);
      const words = verb && wordsBefore(ctx.text, m.index);
      if (!verb || !words || !worthPredicate(words)) return null;
      const evidence =
        !verb.ambiguous ||
        (dummyWorth(words) && !/^\s+(?:who|whom|whose|like)\b/i.test(tail)) ||
        objectNext(tail) ||
        QUANTIFIER_NEXT.test(tail) ||
        END_NEXT.test(tail) ||
        PREPOSITION_NEXT.test(tail);
      const ing = evidence && englishInflect(verb.lemma, "ing");
      return ing ? { messageKey: "review_msg_worth_gerund", alternatives: [ing] } : null;
    },
  },
  {
    // "It is worth of reading": "worth" takes the -ing form directly.
    pattern: `worth${SPACE}(?<target>of${SPACE})${WORD}`,
    repair(word, _tail, m, ctx) {
      const words = wordsBefore(ctx.text, m.index);
      if (!words || !worthPredicate(words)) return null;
      const i = skipAuxiliaries(words);
      if (i === 0 && !dummyWorth(words)) return null;
      return englishLemma(word, "ing")
        ? { messageKey: "review_msg_worth_gerund", alternatives: [""] }
        : null;
    },
  },
  {
    // "Let me to do it": no "to" after causative let/make and an object. "Made it to" means
    // reached; "let it/them to" can mean rent out, so those need a verb-only reading. A noun
    // phrase object is read for let only: "made a trip to see her" is a purpose.
    pattern: `(?<gov>let|lets|let['’]s|letting|make|makes|made|making)${SPACE}(?<object>${OBJECTS}|${INDEFINITE}|(?:${DETERMINERS})(?:${SPACE}(?!to\\b)[a-z]+){1,3}|[a-z]+s)${SPACE}(?<target>to${SPACE})(?<word>[A-Za-z]+)(?:/(?<alt>[A-Za-z]+))?${WORD_END}`,
    repair(first, rest, m) {
      const gov = m.groups!.gov.toLowerCase();
      const object = m.groups!.object.toLowerCase().split(/\s+/);
      const make = /^ma/.test(gov);
      const pronoun = object.length === 1 && new RegExp(`^(?:${OBJECTS})$`).test(object[0]);
      const indefinite = new RegExp(`^${INDEFINITE}$`).test(object.join(" "));
      if (make && (!(pronoun || indefinite) || object[0] === "it")) return null;
      if (!pronoun && !indefinite && !objectPhrase(object)) return null;
      const { word, tail } = verbAfterAdverb(first, rest);
      const verb = baseVerb(word);
      if (!verb || (m.groups!.alt && !baseVerb(m.groups!.alt))) return null;
      const rentable = !indefinite && !(pronoun && !/^(?:it|them)$/.test(object[0]));
      if (rentable && verb.ambiguous && !verb.irregular && !objectNext(tail)) return null;
      return { messageKey: BASE, alternatives: [""] };
    },
  },
  {
    // "It allows to edit files": allow and enable take an object or -ing. Passive "are allowed
    // to" and questions ("Are you allowed to") abstain. A bare "allow"/"allowing" can be recipe
    // ellipsis ("Allow to cool"), so it needs a noun phrase after the verb.
    pattern: `(?<!(?:am|is|are|was|were|be|been|being|get|gets|got|getting|isn['’]t|wasn['’]t|aren['’]t|weren['’]t)${SPACE})(?:(?<subject>${SUBJECT})${SPACE}(?:${MODALS}${SPACE}(?:not${SPACE})?|${NEGATIVE})(?:allow|allowed|enable|enabled)|(?<head>allows|enables)|(?<bare>allow|allowing))${SPACE}(?<target>to${SPACE}${WORD})`,
    repair(word, tail, m) {
      // "allows to easily edit": an -ly word is an adverb unless an object or the end follows.
      if (/ly$/i.test(word) && !objectNext(tail) && !END_NEXT.test(tail)) return null;
      const verb = baseVerb(word);
      if (!verb || (m.groups!.bare && !nounPhraseNext(tail))) return null;
      const ing = englishInflect(verb.lemma, "ing");
      // "You should allow you to" repeats the subject.
      const object = m.groups!.subject?.toLowerCase() === "you" ? "them" : "you";
      return ing
        ? {
            messageKey: "review_msg_allow_object",
            alternatives: [ing, `${object} to ${word.toLowerCase()}`],
            requiresChoice: true,
          }
        : null;
    },
  },
  {
    // "We went ahead and fix it": the second verb shares the tense of went, gone or goes; "go
    // ahead and fixed it" shares the base form. A noun can start a new clause ("went ahead and
    // rain fell"), so an ambiguous word must not be followed by a verb.
    pattern: `(?<gov>went|gone|goes|go)${SPACE}ahead${SPACE}and${SPACE}(?<target>${WORD})`,
    repair(word, tail, m) {
      const gov = m.groups!.gov.toLowerCase();
      let form: string | null;
      if (gov === "go") {
        if (!objectNext(tail) && !END_NEXT.test(tail)) return null;
        form = englishLemma(word, "past");
      } else {
        const verb = baseVerb(word);
        if (!verb) return null;
        if (verb.ambiguous && !objectNext(tail) && !END_NEXT.test(tail)) {
          const next = nextWord(tail);
          if (!next || AUXILIARIES.has(next) || info(next)?.verbs.length) return null;
        }
        form =
          gov === "went"
            ? englishInflect(verb.lemma, "past")
            : gov === "goes"
              ? englishInflect(verb.lemma, "third")
              : PARTICIPLE(verb.lemma);
      }
      return form && form !== word.toLowerCase()
        ? { messageKey: "review_msg_ahead_and_tense", alternatives: [form] }
        : null;
    },
  },
  {
    // "I helped built it", "She helped me fixed it", "He helps us to understood": base verb
    // after help. Without an object, a past form that is also a participle can be an adjective
    // ("helped injured people"), so it needs a verb's continuation; serving food ("helped them
    // to drinks", "to baked potatoes") needs one after "to".
    pattern: `(?<help>help|helps|helped|helping)${SPACE}(?:(?<object>${OBJECTS}|${INDEFINITE})${SPACE})?(?:(?<to>to)${SPACE})?(?<target>${WORD})`,
    repair(word, tail, m, ctx) {
      const w = word.toLowerCase();
      const i = info(w);
      // found, saw, read: also base verbs
      if (!i || i.verbs.some((v) => v.form === "base")) return null;
      const has = (form: string) => i.verbs.some((v) => v.form === form);
      const object = objectNext(tail);
      const end = END_NEXT.test(tail);
      let lemma: string | null = null;
      if (m.groups!.to) {
        if (has("past") && (object || end)) lemma = englishLemma(w, "past");
        else if (has("third") && !i.plural && object) lemma = englishLemma(w, "third");
        else if (has("ing") && (object || PLURAL_NEXT.test(tail))) lemma = englishLemma(w, "ing");
      } else if (m.groups!.object) {
        if (object || end)
          lemma = has("past")
            ? englishLemma(w, "past")
            : has("third")
              ? englishLemma(w, "third")
              : null;
      } else {
        lemma = has("past")
          ? englishLemma(w, "past")
          : has("third") && !i.plural
            ? englishLemma(w, "third")
            : null;
        const loose = !has("past") || has("participle");
        if (
          loose &&
          !(
            object ||
            end ||
            QUANTIFIER_NEXT.test(tail) ||
            NUMBER_NEXT.test(tail) ||
            PREPOSITION_NEXT.test(tail) ||
            coordinatedVerbNext(tail)
          )
        )
          return null;
      }
      if (!lemma || lemma === w) return null;
      const words = wordsBefore(ctx.text, m.index);
      if (!words || !helpHeadsClause(words, m.groups!.help.toLowerCase())) return null;
      return { messageKey: BASE, alternatives: [lemma] };
    },
  },
  {
    // "I suggest to use it", "We avoid to call it": these verbs take -ing. Passive "it is
    // recommended to" and "is considered to be" abstain; "suggest to the team" names a recipient.
    pattern: `(?<head>(?:suggest|recommend|avoid|enjoy|consider)(?:s|ed|ing)?|finish(?:es|ed|ing)?|mind)${SPACE}(?<target>to${SPACE}${WORD})`,
    repair(word, tail, m, ctx) {
      const head = m.groups!.head.toLowerCase();
      const lemma = /^(?:suggest|recommend|avoid|enjoy|consider|finish|mind)/.exec(head)![0];
      const verb = baseVerb(word);
      if (!verb || (lemma === "consider" && verb.lemma === "be")) return null;
      if (/^(?:suggest|recommend)$/.test(lemma) && verb.ambiguous && !objectNext(tail)) return null;
      const words = wordsBefore(ctx.text, m.index);
      if (!words) return null;
      const i = skipAuxiliaries(words);
      if (head.endsWith("ing")) {
        if (!words.slice(0, i).some((w) => BE_WORDS.has(w))) return null;
      } else {
        // "It's strongly recommended to use"
        if (words.slice(0, i + 1).some((w) => BE_WORDS.has(w) || GET_WORDS.has(w))) return null;
        // "We tested it and suggested to add tests": a shared pronoun subject with no relative
        // clause or be in between ("It is unsafe and not recommended to")
        const rest = words.slice(i + 1);
        const shared = rest.findIndex((w) => SUBJECTS.has(w));
        const subject =
          SUBJECTS.has(words[i]) ||
          (CONJUNCTIONS.has(words[i]) &&
            shared >= 0 &&
            !rest
              .slice(0, shared)
              .some((w) => RELATIVES.has(w) || BE_WORDS.has(w) || GET_WORDS.has(w)));
        if ((/ed$/.test(head) || /^(?:consider|finish|mind)$/.test(lemma)) && !subject) return null;
        if (
          lemma === "mind" &&
          !words
            .slice(0, i + 2)
            .some((w) => /^(?:would|do|does|did|don|didn|doesn|wouldn|never|'t|not)$/.test(w))
        )
          return null;
      }
      const ing = englishInflect(verb.lemma, "ing");
      return ing ? { messageKey: "review_msg_gerund_complement", alternatives: [ing] } : null;
    },
  },
];

/** "worth" is a predicate, not a noun after a determiner or adjective ("its worth", "true worth"). */
function worthPredicate(words: readonly string[]): boolean {
  const w = words[0];
  if (NP_DETERMINERS.has(w) || /^(?:of|net|self|own|'s)$/.test(w)) return w === "'s";
  const i = w ? info(w) : null;
  return !(i?.adjective && !i.adverb && !i.verbs.length);
}

/** A let object: a determiner and nouns ("the user"), or a bare plural noun ("users"). */
function objectPhrase(words: readonly string[]): boolean {
  const head = words.at(-1)!;
  const i = info(head);
  if (words.length === 1) return !!i?.plural && !FUNCTION_WORDS.has(head);
  return words.slice(1).every((w) => !FUNCTION_WORDS.has(w) && nounPhraseWord(w)) && (!i || i.noun);
}

function inflectedFrames(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { pattern, repair } of FRAMES) {
    for (const m of frameMatches(ctx, pattern)) {
      const word = m.groups!.word;
      // A capitalized verb names something ("to Meet the Team"); shouting keeps its case.
      if (word !== word.toLowerCase() && m[0] !== m[0].toUpperCase()) continue;
      if (hasUserOrCasedWord(ctx, m[0])) continue;
      const end = m.index + m[0].length;
      const found = repair(word, ctx.scanText.slice(end, end + 128), m, ctx);
      if (!found) continue;
      const [start, targetEnd] = m.indices!.groups!.target;
      const style = detectWordCase(m.groups!.target.trim());
      findings.push({
        ruleId: "englishVerbComplements",
        ...found,
        range: { start, end: targetEnd },
        alternatives: found.alternatives.map((text) => applyWordCase(text, style)),
        context: {
          start: Math.max(0, m.index - 96),
          end: Math.min(ctx.text.length, end + 48),
        },
      });
    }
  }
  return findings;
}

/** Only complete complement frames; missing subjects and ambiguous fragments abstain. */
export function verbComplements(ctx: DetectContext): RawFinding[] {
  const findings = detectPhraseTemplates(
    ctx,
    [
      {
        pattern: `${SUBJECT}${SPACE}(?:decided|decide|decides)${SPACE}(?<target>testing)${SPACE}the${SPACE}(?:feature|application)(?:${SPACE}again)?(?:${SPACE}tomorrow)?(?!${EDGE})(?=[ \\t\\u00a0]{0,8}(?:[.!?]|$))`,
        replacement: "to test",
        messageKey: "review_msg_contextual_grammar" as const,
      },
    ],
    "englishVerbComplements",
  );
  // "We need fix this bug": the verb and its complete argument come from COMPLEMENTS.
  const pattern = `${SUBJECT}${SPACE}${NEGATIVE}(?:need|needs|needed|want|wants|wanted|plan|plans|planned)${SPACE}(?<target>${Object.keys(COMPLEMENTS).join("|")})(?!${EDGE})`;
  for (const match of frameMatches(ctx, pattern)) {
    const [start, end] = match.indices!.groups!.target;
    const target = match.groups!.target;
    const tail = complementTail(target.toLowerCase()).exec(ctx.scanText.slice(end, end + 128));
    if (!tail) continue;
    const phraseEnd = end + tail[0].length;
    if (gluedAfter(ctx.text, phraseEnd)) continue;
    if (hasUserOrCasedWord(ctx, ctx.scanText.slice(match.index, phraseEnd))) continue;
    findings.push({
      ruleId: "englishVerbComplements",
      messageKey: "review_msg_missing_to",
      range: { start, end },
      alternatives: [`${target === target.toUpperCase() ? "TO" : "to"} ${target}`],
      context: {
        start: Math.max(0, match.index - 96),
        end: Math.min(ctx.text.length, phraseEnd + 9),
      },
    });
  }
  return [...findings, ...inflectedFrames(ctx)];
}
