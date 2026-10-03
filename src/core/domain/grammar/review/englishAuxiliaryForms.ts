import { englishLemma } from "../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { NOUN_LIKE_ING } from "./englishParticiples";
import { frameMatches, hasUserOrCasedWord, SPACE, WORD_END, WORD_START } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SUBJECT = "(?:I|you|he|she|it|we|they)";
const WH = "(?:what|when|where|why|how|who)";
const AUXILIARY =
  "(?:did(?:n['’]t)?|does(?:n['’]t)?|do(?:n['’]t)?|can(?:not|['’]t)?|could(?:n['’]t)?|will|won['’]t|would(?:n['’]t)?|shall|should(?:n['’]t)?|may|might|must(?:n['’]t)?)";
// After a noun, bare can/will/may/must can close a compound noun ("the trash can smells",
// "the last will states"), so a determiner-led subject only takes the unambiguous auxiliaries.
const NOUN_AUXILIARY =
  "(?:did(?:n['’]t)?|does(?:n['’]t)?|do(?:n['’]t)?|can(?:not|['’]t)|could(?:n['’]t)?|won['’]t|would(?:n['’]t)?|shall|should(?:n['’]t)?|might|mustn['’]t)";
// Auxiliaries that need a verb after any subject word. Affirmative do can be a main verb
// ("What I did works"), so only its negative contractions are here.
const MID_AUXILIARY =
  "(?:can['’]t|cannot|can|couldn['’]t|could|won['’]t|will|wouldn['’]t|would|shan['’]t|shall|shouldn['’]t|should|mightn['’]t|might|may|mustn['’]t|must|doesn['’]t|don['’]t|didn['’]t)";
const DETERMINER = "(?:the|this|that|my|your|our|his|her|their|its|a|an)";
const ADVERB =
  "(?:not|really|just|ever|even|always|still|actually|never|definitely|certainly|probably|greatly|surely|also|usually|often|sometimes|truly|simply)";
// Third-person forms that are also plural nouns, so "do/did" can be the main verb.
const DO_OBJECT_NOUNS = new Set(
  (
    "bears beats bends bets binds bites blows breaks breeds builds bursts buys catches costs " +
    "cuts deals digs draws drinks drives falls feeds fights finds flies goes hangs hits holds " +
    "keeps leads leaves lies lights means meets mistakes puts reads rebuilds reruns resets " +
    "rewrites rides rings rises runs sets shakes shoots sinks sits slides spins splits spreads " +
    "springs stands steals sticks stings strikes sweeps swims swings takes tears throws " +
    "upsets wakes wins winds works"
  ).split(" "),
);
// Compiled once: frameMatches would rebuild a string pattern on every call.
const frame = (pattern: string) => new RegExp(`${WORD_START}${pattern}`, "gidu");
const PREFIX = `(?:${SUBJECT}(?:${SPACE}${AUXILIARY}|(?<contraction>['’](?:ll|d)))|(?:${WH}${SPACE})?${AUXILIARY}${SPACE}(?:${SUBJECT}|this|that)|${DETERMINER}${SPACE}(?<noun>[a-z]+)${SPACE}${NOUN_AUXILIARY})`;
const PATTERN = frame(`${PREFIX}(?:${SPACE}${ADVERB}){0,2}${SPACE}(?<verb>[A-Za-z]+)${WORD_END}`);
const MID_PATTERN = frame(
  `(?<aux>${MID_AUXILIARY})(?:${SPACE}${ADVERB}){0,2}${SPACE}(?<verb>[A-Za-z]+)${WORD_END}`,
);
// "Can the server handles it?": an inverted question with a determiner + up to three words.
const QUESTION_PATTERN = frame(
  `(?:${WH}${SPACE})?${AUXILIARY}${SPACE}${DETERMINER}(?<words>(?:${SPACE}[A-Za-z]+){2,4})${WORD_END}`,
);
const STARTS_WITH_AUXILIARY = new RegExp(`^(?:${WH}${SPACE})?${AUXILIARY}(?![A-Za-z])`, "i");
// Closed-class words cannot fill the one-word noun slot ("The will…", "That it did…").
const NOT_A_NOUN =
  /^(?:i|you|he|she|it|we|they|me|him|us|them|the|this|that|these|those|my|your|our|his|her|their|its|a|an|do|does|did|can|could|will|would|shall|should|may|might|must|is|are|was|were|be|been|have|has|had|not|so|very)$/;
// Function words the lexicon also lists as nouns or verbs ("in", "it", "up", "now").
const FUNCTION_WORD =
  /^(?:i|you|he|she|it|we|they|me|him|us|them|the|this|that|these|those|my|your|our|his|her|their|its|a|an|some|any|no|all|each|every|both|either|neither|more|most|much|many|few|less|own|other|another|such|what|which|who|whom|whose|when|where|why|how|if|whether|than|as|so|and|or|but|nor|yet|of|in|on|at|by|for|from|to|into|onto|upon|with|without|within|about|above|below|over|under|after|before|since|until|till|through|thru|across|along|around|against|among|between|behind|beyond|during|near|off|out|up|down|via|per|like|unlike|toward|towards|not|now|then|here|there|soon|again|also|too|very|just|only|even|still|ever|never|always|first|last|next|is|are|was|were|be|been|being|am|have|has|had|do|does|did)$/;
// Before a bare will/can/may/must/might, these make it a noun ("at will", "the last will")
// or invert the clause ("nor will users", "when can we").
const NOT_A_SUBJECT =
  /^(?:the|a|an|my|your|our|his|her|their|its|whose|thy|own|no|any|every|each|some|first|second|third|last|next|of|in|on|at|by|for|from|to|into|onto|upon|with|without|within|against|about|after|before|through|over|under|as|than|nor|neither|so|only|never|rarely|seldom|hardly|little|when|where|why|how|whether|if|is|are|was|were|be|been|being|am|not)$/;
// Bare auxiliaries that are also nouns or names.
const NOUN_MODAL = /^(?:will|can|may|must|might)$/i;
// What can follow a verb but never a noun or adjective: an object pronoun, or (after a
// participle) a determiner. "did tests on it" and "did advanced training" stay lexical.
const OBJECT_PRONOUN = /^(?:me|him|her|us|them|it|you)$/;
const DETERMINER_WORD = /^(?:the|a|an|my|your|his|her|its|our|their|this|that|these|those)$/;
const BE = /^(?:am|is|are|was|were|be|been|being|.+['’](?:s|re|m))$/;
const CLAUSE_OPENING = /[.!?;:\n"“][ \t ]{0,8}$/;

// Heads that always take a bare infinitive after "to". "used to", "looking forward to", "key to"
// and other prepositional "to" heads, including nouns ("travel plans to Paris"), are left out.
const TO_HEAD =
  /^(?:want|wants|wanted|need|needs|needed|have|has|had|able|try|tries|tried|trying|decide|decides|decided|supposed|ought|planned|like|going)$/;
const TO_PATTERN = frame(`to(?<adverb>${SPACE}[a-z]+ly)?${SPACE}(?<verb>[A-Za-z]+)${WORD_END}`);
const NEED_TO_PATTERN = frame(
  `(?<head>need|needs|needed|needing|want|wants|wanted|wanting|try|tries|tried|trying)${SPACE}(?<target>to${SPACE}(?<noun>[a-z]+))${WORD_END}`,
);
// Nouns the lexicon leaves out for length; their endings are never verb endings.
const NOUN_ENDING = /(?:tion|sion|ness|ity|ance|ence|ship|ism)$/;
const ADJECTIVE_ENDING = /(?:al|ic|ive|ous|ful|less|ary|ish|ian)$/;
// Endings that only form nouns (with the noun-only reading checked): priority, developer.
const DERIVED_NOUN = /(?:tion|sion|ness|ity|ance|ence|ship|ism|ment|[^e]er|or|ist)$/;

function nextWord(ctx: DetectContext, end: number): string {
  return (
    /^[ \t ]{1,8}([A-Za-z]+)(?![\p{L}\p{N}_'’@/#\\-])/u
      .exec(ctx.scanText.slice(end, end + 40))?.[1]
      ?.toLowerCase() ?? ""
  );
}

/** The word right before `start` (spaces only between) and where it starts; "" for none. */
function previousWord(ctx: DetectContext, start: number): [string, number] {
  const from = Math.max(0, start - 48);
  const m = /(?<![\p{L}\p{N}_'’@/#\\.-])([A-Za-z]+(?:['’][a-z]{0,2})?)[ \t ]{1,8}$/u.exec(
    ctx.text.slice(from, start),
  );
  return m ? [m[1], from + m.index] : ["", start];
}

const atClauseStart = (ctx: DetectContext, start: number) => {
  const before = ctx.text.slice(Math.max(0, start - 96), start);
  return (start <= 96 && /^[ \t ]*$/.test(before)) || CLAUSE_OPENING.test(before);
};

/** A content word an adjective or participle could modify. */
function contentWord(word: string): boolean {
  if (!word || FUNCTION_WORD.test(word) || OBJECT_PRONOUN.test(word)) return false;
  const info = englishWordInfo(word);
  return !info || info.noun || info.plural || info.adjective;
}

/**
 * The base behind an -s or -ed form (regular or irregular); null when spelling cannot tell or
 * the dictionary does not know the word ("containg" is a typo, not conta + -ing).
 */
function inflectedLemma(word: string): string | null {
  if (/^(?:hers|ours|yours|theirs|others)$/.test(word) || !englishWordInfo(word)) return null;
  const lemma = englishLemma(word, word.endsWith("s") ? "third" : "past");
  // "be" forms ("could been", "will is") usually lack a word ("could have been").
  return lemma && lemma !== word && lemma !== "be" ? lemma : null;
}

type Repair = {
  forms: string[];
  /** A progressive or passive reading after a modal: "will be walking", "can be used". */
  be?: true;
  choice?: true;
};

// Not verb forms after an auxiliary: intensifiers and prepositions in -ing/-ed.
const NOT_AUXILIARY_VERB =
  /^(?:fucking|freaking|frigging|bloody|concerning|regarding|considering|including|according|following|thanks)$/;
const PREPOSITION_NEXT = /^(?:of|for|at|in|on|from|with|to|be|by)$/;

// Verbs whose -ed form describes how someone feels: "Are you interested/worried/bored?".
export const FEELING_VERBS = new Set(
  (
    "interest satisfy excite bore tire scare worry surprise confuse disappoint amaze please " +
    "embarrass annoy concern frighten shock terrify thrill impress overwhelm exhaust depress " +
    "frustrate puzzle relieve delight fascinate horrify astonish irritate offend stress"
  ).split(" "),
);

function repairAfterAuxiliary(
  word: string,
  next: string,
  isDo: boolean,
  lexicalDo: boolean,
  auxiliary = "",
): Repair | null {
  if (NOT_AUXILIARY_VERB.test(word) || (word === "based" && /^(?:on|upon)$/.test(next)))
    return null;
  // "might has well" is "might as well".
  if (word === "has" && next === "well") return null;
  // "It doesn't seen right", "I can't seen to": seem before an adjective or to.
  if (word === "seen" && (next === "to" || !!englishWordInfo(next)?.adjective))
    return { forms: ["seem"] };
  // "did not found any colonies": found/ground/wound are base verbs too; a pronoun object
  // ("didn't found it") still offers the choice.
  if (/^(?:found|ground|wound)$/.test(word) && !OBJECT_PRONOUN.test(next)) return null;
  // "should troops pass", "should cuts of any kind occur", "may contacts at": a plural noun
  // after an inverted or mistyped modal.
  if (word.endsWith("s") && englishWordInfo(word)?.plural && PREPOSITION_NEXT.test(next))
    return null;
  // "they must needs come", "should costs rise": a noun or adverb before the real verb.
  const nextInfo = word.endsWith("s") && englishWordInfo(word)?.plural && englishWordInfo(next);
  if (nextInfo && !nextInfo.adjective && nextInfo.verbs.some((v) => v.form === "base")) return null;
  const entry = englishVerbForms(word);
  if (entry && word !== entry.lemma && !entry.ambiguous.includes(word)) {
    // Lexical "do works of art", "did builds", "do rides" are not auxiliary errors.
    if (lexicalDo && DO_OBJECT_NOUNS.has(word)) return null;
    // "I would never done that": a participle that is no past after would/could/should/
    // might/must lost "have".
    if (
      /\b(?:would|could|should|might|must)(?:n['’]t)?\b/i.test(auxiliary) &&
      word === entry.participle &&
      word !== entry.past
    )
      return { forms: [`have ${word}`, entry.lemma], choice: true };
    // "It can done easily": after another modal it may also lack a passive "be".
    if (!isDo && auxiliary && word === entry.participle && word !== entry.past)
      return { forms: [entry.lemma, `be ${word}`], be: true, choice: true };
    return { forms: [entry.lemma] };
  }
  if (entry) {
    // "saw", "found", "left": after a modal they can be base verbs ("can saw wood"); after
    // do the user picks, and lexical "did bit parts"/"did ground checks" need verb evidence.
    if (!isDo || (lexicalDo && !OBJECT_PRONOUN.test(next) && !DETERMINER_WORD.test(next)))
      return null;
    return { forms: [entry.lemma], choice: true };
  }
  if (word.endsWith("ing")) {
    // Lexical "do testing"; everyday nouns ("will reading") abstain.
    if (isDo || NOUN_LIKE_ING.test(word) || !englishWordInfo(word)) return null;
    const lemma = englishLemma(word, "ing");
    if (!lemma) return null;
    if (lemma === "be") return { forms: [lemma] };
    // "would willing": an -ing adjective wants be first.
    const forms = englishWordInfo(word)?.adjective ? [`be ${word}`, lemma] : [lemma, `be ${word}`];
    return { forms, be: true, choice: true };
  }
  const lemma = inflectedLemma(word);
  if (!lemma) return null;
  const past = !word.endsWith("s");
  // "wasn't supposed to" is the fix, not "didn't suppose to"; "would used to" has no good repair.
  if (next === "to" && (word === "supposed" || (word === "used" && !isDo))) return null;
  const verbEvidence = OBJECT_PRONOUN.test(next) || (past && DETERMINER_WORD.test(next));
  // Lexical do takes plural nouns and participle adjectives: "did tests", "did wonders".
  if (lexicalDo && !verbEvidence) return null;
  // "It can used to…" more often lacks a passive "be" than an active verb.
  if (!isDo && past && !verbEvidence)
    return { forms: [lemma, `be ${word}`], be: true, choice: true };
  return { forms: [lemma] };
}

/** After 'd (would or had): -ed and -ing fit had; "they'd went" belongs to englishPerfectParticiples. */
function repairAfterWouldOrHad(word: string): Repair | null {
  const entry = englishVerbForms(word);
  if (entry) {
    if (entry.ambiguous.includes(word) || word !== entry.third) return null;
    return { forms: [entry.lemma] };
  }
  const lemma = word.endsWith("s") && !englishWordInfo(word)?.plural && inflectedLemma(word);
  return lemma ? { forms: [lemma] } : null;
}

/** A participle before a noun can modify it: conditional "should affected users call". */
const modifiesNext = (word: string, next: string) =>
  !word.endsWith("s") && !word.endsWith("ing") && contentWord(next);

function finding(
  ctx: DetectContext,
  start: number,
  verbStart: number,
  end: number,
  token: string,
  repair: Repair,
): RawFinding {
  const kase = detectWordCase(token);
  const lead = ctx.source.slice(start, verbStart);
  return {
    ruleId: "englishAuxiliaryBaseVerb",
    messageKey: repair.be ? "review_msg_modal_be" : "review_msg_auxiliary_base",
    range: { start, end },
    alternatives: repair.forms.map((form) => `${lead}${applyWordCase(form, kase)}`),
    ...(repair.choice ? { requiresChoice: true as const } : {}),
    context: { start: Math.max(0, start - 96), end: Math.min(ctx.text.length, end + 32) },
  };
}

/**
 * "free will", "living will", "John's will", "military might", "the tin can": after this word,
 * a bare will/can/may/must/might can be a noun. Only a plural or pronoun rules out "X can".
 */
function modalMayBeNoun(subject: string, aux: string): boolean {
  const s = subject.toLowerCase();
  if (/^(?:i|you|we|they|he|she|it|who|which|that)$/.test(s)) return false;
  const info = englishWordInfo(s);
  if (/['’]|(?:ing|ed)$/.test(s) || info?.adjective) return true;
  // Adjective shapes the dictionary lists as nouns only ("economic", "naval").
  if (ADJECTIVE_ENDING.test(s) && !info?.verbs.length && !info?.plural) return true;
  // Words the lexicon gives no part of speech, and unknown adjective shapes ("naval", "economic").
  if (info ? !info.noun && !info.plural && !info.verbs.length : ADJECTIVE_ENDING.test(s))
    return true;
  return /^can$/i.test(aux) && !(info ? info.plural : /[^s]s$/.test(subject));
}

/** A verb token that is plain text: lowercase or all caps, not a user-dictionary word. */
const plainToken = (ctx: DetectContext, token: string) =>
  (token === token.toLowerCase() || token === token.toUpperCase()) &&
  !ctx.dictionary.has(token.toLowerCase());

/** Pronoun or determiner + one noun at a clause start, and inverted pronoun questions. */
function afterAuxiliary(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const match of frameMatches(ctx, PATTERN, (m) => m.index)) {
    const start = match.index;
    const end = start + match[0].length;
    const { verb: token, noun, contraction } = match.groups!;
    // Avoid subordinate noun clauses: "What I did works" is grammatical. A contracted
    // modal needs its verb anywhere. Ordinary dialogue may open a clause.
    if (!contraction && !atClauseStart(ctx, start)) continue;
    const word = token.toLowerCase();
    // Mixed/internal title casing can name a product or identifier.
    if (!plainToken(ctx, token)) continue;
    if (noun && (noun !== noun.toLowerCase() || NOT_A_NOUN.test(noun) || ctx.dictionary.has(noun)))
      continue;
    const verbStart = end - token.length;
    const prefix = match[0].slice(0, verbStart - start);
    // "The military might impressed them": the noun might.
    if (noun && /\bmight\b/i.test(prefix) && modalMayBeNoun(noun, "might")) continue;
    const isDo = /\b(?:do|does|did)(?:n['’]t)?\b/i.test(prefix);
    const negated = /n['’]t\b|\bnot\b|cannot/i.test(prefix);
    const lexicalDo = isDo && !negated && !STARTS_WITH_AUXILIARY.test(prefix);
    const next = nextWord(ctx, end);
    // "Will that existing user…", "How could that thought…": a determiner phrase subject.
    if (
      /\b(?:this|that)$/i.test(prefix.trim()) &&
      ((/(?:ing|ed)$/.test(word) && contentWord(next)) ||
        (!word.endsWith("s") && englishWordInfo(word)?.noun))
    )
      continue;
    // "Do you interested in…?": a question with an -ed adjective takes be, not do.
    const asked =
      /^(do|does|did)(n['’]t)?([ \t\u00a0]+)(i|you|we|they|he|she|it)[ \t\u00a0]+$/i.exec(prefix);
    const adjective = englishWordInfo(word);
    if (
      asked &&
      /ed$/.test(word) &&
      !adjective?.noun &&
      (adjective?.adjective || FEELING_VERBS.has(englishLemma(word, "past") ?? ""))
    ) {
      const [, aux, negative = "", gap, subject] = asked;
      const singular = /^(?:he|she|it)$/i.test(subject);
      const be = /^do$/i.test(aux)
        ? /^i$/i.test(subject)
          ? "am"
          : "are"
        : /^does$/i.test(aux)
          ? "is"
          : singular || /^i$/i.test(subject)
            ? "was"
            : "were";
      // "Amn't" is no form: "Aren't I".
      const verb = be === "am" && negative ? "are" : be;
      findings.push({
        ...finding(ctx, start, verbStart, end, token, { forms: [word] }),
        alternatives: [
          `${applyWordCase(verb, detectWordCase(aux))}${negative}${gap}${subject} ${token}`,
        ],
      });
      continue;
    }
    const repair = /^['’]d$/i.test(contraction ?? "")
      ? repairAfterWouldOrHad(word)
      : repairAfterAuxiliary(word, next, isDo, lexicalDo, prefix);
    if (repair) findings.push(finding(ctx, start, verbStart, end, token, repair));
  }
  return findings;
}

/** "The fox will ran", "users can't logged in": any subject word before a modal. */
function afterSubjectWord(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const match of frameMatches(ctx, MID_PATTERN, (m) => m.index)) {
    const { aux, verb: token } = match.groups!;
    const start = match.index;
    const end = start + match[0].length;
    if (!plainToken(ctx, token) || !plainToken(ctx, aux)) continue;
    const [subject] = previousWord(ctx, start);
    const s = subject.toLowerCase();
    if (!s || NOT_A_SUBJECT.test(s)) continue;
    if (NOUN_MODAL.test(aux) && modalMayBeNoun(subject, aux)) continue;
    const word = token.toLowerCase();
    const next = nextWord(ctx, end);
    if (/^should$/i.test(aux) && modifiesNext(word, next)) continue;
    // Inverted conditional "should troops pass": a plural subject before its base verb.
    if (
      /^should$/i.test(aux) &&
      englishWordInfo(word)?.plural &&
      englishWordInfo(next)?.verbs.some((v) => v.form === "base")
    )
      continue;
    // "What will hiring managers be like?", "How dangerous would doing that be?": a gerund
    // subject in a question.
    if (
      word.endsWith("ing") &&
      (/^(?:what|which|much|many)$/.test(s) || englishWordInfo(s)?.adjective)
    )
      continue;
    const isDo = /^d/i.test(aux);
    const repair = repairAfterAuxiliary(word, next, isDo, false, aux);
    if (repair) findings.push(finding(ctx, start, end - token.length, end, token, repair));
  }
  return findings;
}

/** "Will the fix works?", "Why did the build failed?" */
function invertedNounQuestion(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const match of frameMatches(ctx, QUESTION_PATTERN, (m) => m.index)) {
    const start = match.index;
    if (!atClauseStart(ctx, start)) continue;
    const wordsStart = match.indices!.groups!.words[0];
    const isDo = /\b(?:do|does|did)(?:n['’]t)?\b/i.test(match[0].slice(0, wordsStart - start));
    const words = [...match.groups!.words.matchAll(/[A-Za-z]+/g)];
    // The subject: lowercase nouns or adjectives, ending in a noun ("the new server").
    for (let k = 1; k < words.length; k++) {
      const subject = words[k - 1][0];
      const info = englishWordInfo(subject);
      if (subject !== subject.toLowerCase() || FUNCTION_WORD.test(subject)) break;
      if (info && !info.noun && !info.plural && !info.adjective) break;
      const token = words[k][0];
      const word = token.toLowerCase();
      if (!plainToken(ctx, token) || FUNCTION_WORD.test(word)) break;
      const end = wordsStart + words[k].index + token.length;
      const next = nextWord(ctx, end);
      // "Did a man called Daffodil come?": a participle modifying the subject.
      if (
        /(?:ed|ing)$/.test(word) &&
        (contentWord(next) || /^[ \t\u00a0]+\p{Lu}/u.test(ctx.text.slice(end, end + 4)))
      )
        break;
      if (!info || info.noun || info.plural) {
        const repair = repairAfterAuxiliary(word, next, isDo, false);
        if (repair) {
          findings.push(finding(ctx, start, end - token.length, end, token, repair));
          break;
        }
      }
      // A base verb ends the subject: "Does the app support dark modes?"
      if (englishWordInfo(word)?.verbs.some((v) => v.form === "base")) break;
    }
  }
  return findings;
}

/** "want to went", "is expected to exists", "To explained the rules": a verb form after "to". */
function afterInfinitiveTo(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const match of frameMatches(ctx, TO_PATTERN, (m) => m.index)) {
    const { verb: token, adverb } = match.groups!;
    const word = token.toLowerCase();
    // "committed to fixing" is valid, and -ing after "to" is never safe to guess.
    if (word.endsWith("ing") || !plainToken(ctx, token)) continue;
    if (hasUserOrCasedWord(ctx, match[0])) continue;
    if (adverb && !englishWordInfo(adverb.trim())?.adverb) continue;
    const lemma = inflectedLemma(word);
    if (!lemma) continue;
    const start = match.index;
    const end = start + match[0].length;
    const [rawHead, headStart] = previousWord(ctx, start);
    const head = rawHead.toLowerCase();
    const beforeHead = head ? previousWord(ctx, headStart)[0].toLowerCase() : "";
    const next = nextWord(ctx, end);
    const object = OBJECT_PRONOUN.test(next) || DETERMINER_WORD.test(next);
    const going = head === "going";
    // "going to meetings" is a place unless be makes it a future; "would like to".
    const strong =
      TO_HEAD.test(head) &&
      (!going || BE.test(beforeHead)) &&
      (head !== "like" || /^(?:would|.+['’]d)$/.test(beforeHead));
    const entry = englishVerbForms(word);
    const pastOnly = !!entry && word === entry.past && word !== entry.participle;
    const info = englishWordInfo(word);
    let ok: boolean;
    if (word.endsWith("s") && (info?.plural ?? true)) {
      // "need to funds released", "going to meetings this week": a plural noun reading.
      ok = strong && (OBJECT_PRONOUN.test(next) || (!going && (!next || object)));
    } else if (word.endsWith("s") || pastOnly) {
      // "is expected to exists"; "the page it links to exists" strands a preposition.
      const headInfo = englishWordInfo(head);
      const passive =
        BE.test(beforeHead) &&
        (!!headInfo?.adjective || !!headInfo?.verbs.some((v) => v.form === "participle"));
      ok = strong || passive || object;
    } else {
      // "set to disabled", "from draft to published", "going to advanced classes": states.
      ok = object || (strong && !(going && contentWord(next)));
    }
    if (!ok) continue;
    // "The students we talked to said…", "the party she was invited to gave…": a relative
    // clause strands its preposition, and the past form is the main verb.
    if (
      !strong &&
      entry?.past === word &&
      /\p{L}[ \t ]+(?:I|we|you|they|he|she)(?:[ \t ]+(?:was|were|had|have|has|am|are|is))?[ \t ]+$/u.test(
        ctx.text.slice(Math.max(0, headStart - 40), headStart),
      )
    )
      continue;
    const verbStart = end - token.length;
    findings.push({
      ruleId: "englishAuxiliaryBaseVerb",
      messageKey: "review_msg_to_base",
      range: { start, end },
      alternatives: [
        `${ctx.source.slice(start, verbStart)}${applyWordCase(lemma, detectWordCase(token))}`,
      ],
      context: { start: Math.max(0, start - 48), end: Math.min(ctx.text.length, end + 32) },
    });
  }
  return findings;
}

/** "I need to information": "to" before a noun that is never a verb. */
function needToNoun(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const match of frameMatches(ctx, NEED_TO_PATTERN, "target")) {
    const noun = match.groups!.noun.toLowerCase();
    if (FUNCTION_WORD.test(noun) || hasUserOrCasedWord(ctx, match[0])) continue;
    // "don't want to today", "wants to may be": an elided verb before a time word or modal.
    if (
      /^(?:today|tomorrow|tonight|yesterday|may|might|can|could|will|would|should|must)$/.test(noun)
    )
      continue;
    const [start, end] = match.indices!.groups!.target;
    const nounStart = match.indices!.groups!.noun[0];
    // "the need to…" is the noun need.
    if (DETERMINER_WORD.test(previousWord(ctx, match.index)[0].toLowerCase())) continue;
    const next = nextWord(ctx, end);
    const nextInfo = englishWordInfo(next);
    // "as much as you want to charity if…", "need to exec or discard": the clause goes on.
    if (/^(?:if|when|or|and|because|but|so|unless)$/.test(next)) continue;
    // "need to password to log in": a second infinitive shows the word used as a verb.
    const toVerb = /^[ \t\u00a0]+to[ \t\u00a0]+([a-z]+)/.exec(
      ctx.scanText.slice(end, end + 40),
    )?.[1];
    if (toVerb && englishWordInfo(toVerb)?.verbs.some((v) => v.form === "base")) continue;
    // "to apologies" is a typo of the -ize verb (clauseSlots' toIesVerb).
    if (/ies$/.test(noun) && englishWordInfo(`${noun.slice(0, -3)}ize`)?.verbs.length) continue;
    // A derived noun the dictionary lists as nothing else is no verb, whatever follows: "need
    // to priority the work", "trying to developer a tool".
    const read = englishWordInfo(noun);
    const derived =
      DERIVED_NOUN.test(noun) &&
      !!read?.noun &&
      !read.verbs.length &&
      !read.adjective &&
      !read.adverb;
    // "need to unit test it", "need to reposition the button": a compound or unlisted verb.
    // "want to proxy websockets": a noun right after reads as the object of a verb. After a
    // derived noun these show a verb was meant, which only the writer knows: a warning.
    const objectNext =
      OBJECT_PRONOUN.test(next) ||
      DETERMINER_WORD.test(next) ||
      (!!nextInfo?.verbs.some((v) => v.form === "base") && !nextInfo.adjective) ||
      (contentWord(next) && (!nextInfo || nextInfo.noun || nextInfo.plural));
    if (objectNext && !derived) continue;
    // "need to override": the dictionary lists "overriding", so it is a verb too.
    if ([`${noun.replace(/e$/, "")}ing`, noun.replace(/e?$/, "ed")].some(englishWordInfo)) continue;
    const info = englishWordInfo(noun);
    // "data" carries no part of speech; a participle after it shows an object.
    const participleNext =
      !!nextInfo?.verbs.length &&
      nextInfo.verbs.every((v) => v.form === "past" || v.form === "participle");
    const isNoun = info
      ? !info.verbs.length &&
        !info.adjective &&
        !info.adverb &&
        (info.noun || info.plural || participleNext)
      : NOUN_ENDING.test(noun);
    if (!isNoun) continue;
    const original = ctx.source.slice(nounStart, end);
    findings.push({
      ruleId: "englishAuxiliaryBaseVerb",
      messageKey: "review_msg_to_noun",
      range: { start, end },
      alternatives: objectNext ? [] : [`the ${original}`, original],
      ...(objectNext ? { warningOnly: true as const } : { requiresChoice: true as const }),
      context: { start: match.index, end: Math.min(ctx.text.length, end + 32) },
    });
  }
  return findings;
}

export function auxiliaryForms(ctx: DetectContext): RawFinding[] {
  // Paths overlap ("They can works" is pronoun-led and subject-word-led): first one wins.
  const ends = new Set<number>();
  return [
    ...afterAuxiliary(ctx),
    ...invertedNounQuestion(ctx),
    ...afterSubjectWord(ctx),
    ...afterInfinitiveTo(ctx),
    ...needToNoun(ctx),
  ].filter((f) => !ends.has(f.range.end) && !!ends.add(f.range.end));
}
