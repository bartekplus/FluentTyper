import { englishInflect, englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishNounPair, englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { MASS, nounNumber } from "./nounNumberSlots";
import {
  ADVERBS,
  AUXILIARIES,
  afterBreak,
  caseLike,
  english,
  evidence,
  FUNCTION_WORDS,
  type Token,
  tokensAfter,
  wordBefore,
} from "./slotWords";

// Subject-verb number agreement with noun-phrase subjects the lexicon can number: "The dogs
// barks", "Some people thinks", "Do your father live…?", "These includes", "This are".

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const TO_PLURAL: Record<string, string> = {
  is: "are",
  was: "were",
  has: "have",
  does: "do",
  "isn't": "aren't",
  "wasn't": "weren't",
  "hasn't": "haven't",
  "doesn't": "don't",
};
const TO_SINGULAR: Record<string, string> = {
  are: "is",
  were: "was",
  "aren't": "isn't",
  "weren't": "wasn't",
};
const SINGULAR_DO_HAVE: Record<string, string> = {
  have: "has",
  do: "does",
  "haven't": "hasn't",
  "don't": "doesn't",
};
// Nouns that take a plural verb in British use or name a group: "The team are…".
export const COLLECTIVE = new Set(
  "team staff family police government committee crew band audience public class group majority folk blues rest number couple pair lot jury army navy board council club company firm management media data total variety range series species means news remainder masters woods belt".split(
    " ",
  ),
);

// Adjectives that name a group as a noun: "the public", "the rich", "the elderly".
const GROUP_ADJECTIVES =
  /^(?:public|rich|poor|elderly|young|old|wealthy|unemployed|homeless|sick|dead|living|blind|deaf|faithful|wise|british|french|english|irish|dutch|welsh|chinese|japanese|swiss)$/;

const normal = (word: string) => word.toLowerCase().replaceAll("’", "'");

/** The plural form of a singular verb token, or null. */
function pluralOf(token: Token, nextToken?: Token, afterNext?: Token): string | null {
  const word = normal(token.lower);
  if (TO_PLURAL[word]) return TO_PLURAL[word];
  if (!/s$/.test(word) || FUNCTION_WORDS.has(word)) return null;
  const read = englishWordInfo(word);
  if (!read?.verbs.some((v) => v.form === "third")) return null;
  // "barks" is also a plural noun: only a verb when an adverb, object or end follows.
  if (read.noun || read.plural) {
    const next = nextToken?.kind === "word" ? englishWordInfo(nextToken.lower) : null;
    // "The properties files still contained…": an adverb before a verb leaves "files" a noun.
    const verbAfter =
      afterNext?.kind === "word" &&
      !!englishWordInfo(afterNext.lower)?.verbs.some(
        (v) => v.form === "past" || v.form === "third",
      );
    const adverbNext =
      nextToken?.kind === "word" &&
      !verbAfter &&
      (ADVERBS.has(nextToken.lower) ||
        /^(?:late|early|fast|hard|well|today|tonight|loudly|everywhere|together)$/.test(
          nextToken.lower,
        ) ||
        (!!next?.adverb && !next.noun));
    // "The struggles sounds bad": a linking verb before an adjective.
    const linked =
      /^(?:sounds|seems|looks|feels|tastes|smells|appears)$/.test(word) &&
      !!next?.adjective &&
      !next.verbs.length;
    const closed =
      !nextToken ||
      nextToken.kind === "end" ||
      adverbNext ||
      linked ||
      (nextToken.kind === "word" &&
        /^(?:the|a|an|my|your|his|her|our|their|it|them|me|us|him|you|that|to|in|on|at|with|for|every|each)$/.test(
          nextToken.lower,
        ));
    if (!closed) return null;
  }
  return englishLemma(word, "third");
}

function push(
  ctx: DetectContext,
  findings: RawFinding[],
  token: Token,
  replacement: string,
  from: number,
): void {
  if (findings.some((f) => f.range.start === token.start)) return;
  findings.push({
    ruleId: "englishSubjectVerbAgreement",
    messageKey: "review_msg_subject_verb",
    range: { start: token.start, end: token.end },
    alternatives: [caseLike(token.text, replacement)],
    context: evidence(ctx, from, token.end),
  });
}

const CLAUSE_CUE = /^(?:whether|when|if|that|because|since|while|where)$/;
// Cues that open a clause later in a sentence.
const LATER_CUE = /^(?:although|though|unless|until|once|but|whereas)$/;
const NUMBERS = /^(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million)$/;
// A conditional or wish keeps "were": "If the county were to build…".
const SUBJUNCTIVE = /\b(?:if|wish|wished|as though|as if|suppose|unless)\b[^.!?;:\n]*$/i;

/** The token at `at` (or after one adverb) is is/has/does, an -s verb only or a linking verb. */
function verbNext(tokens: Token[], at: number): boolean {
  const verbish = (t: Token | undefined) =>
    verbOnlyThird(t) || /^(?:looks|seems|sounds|feels|tastes|smells|appears)$/.test(t?.lower ?? "");
  return verbish(tokens[at]) || (ADVERBS.has(tokens[at]?.lower ?? "") && verbish(tokens[at + 1]));
}

/** A be/have/modal later in the clause: the -s word before it was a noun ("futures prices… have"). */
function auxiliaryLater(tokens: Token[], from: number): boolean {
  let object = false;
  for (const t of tokens.slice(from)) {
    if (t.kind !== "word") return false;
    // "…indicate an issue that must…": after an object, a later clause's auxiliary.
    if (object && /^(?:that|which|who|whom|whose|because|if|and|but|so)$/.test(t.lower))
      return false;
    object ||= /^(?:the|a|an|my|your|his|her|our|their|its)$/.test(t.lower);
    if (
      /^(?:is|are|was|were|has|have|had|will|would|can|could|should|must|may|might)$/.test(t.lower)
    )
      return true;
  }
  return false;
}

/** An -s word read only as a verb: "includes", "seems", not "flips", "confirms". */
function verbOnlyThird(token: Token | undefined): boolean {
  if (token?.kind !== "word") return false;
  const word = normal(token.lower);
  if (TO_PLURAL[word]) return true;
  const read = englishWordInfo(word);
  return !!read?.verbs.some((v) => v.form === "third") && !read.noun && !read.plural;
}

// An opening phrase that ends in a comma: a preposition or subordinator starts the sentence or
// the comma-free stretch, and no "and"/"or" ends it.
const OPENING_PHRASE =
  /(?:^|[.!?;:\n][ \t\u00a0"“]*)(?:as|after|before|in|on|at|when|if|since|because|although|though|while|once|until|unless|during|for|from|by|with|without|despite|given|according|unfortunately|fortunately|today|yesterday|now|still|also|meanwhile)\b[^.!?;:,\n]*(?<!\b(?:and|or))[ \t\u00a0]*,[ \t\u00a0]+$/i;
// "the word ares", "the term cookies": a mentioned word, not a subject.
const MENTION =
  /^(?:word|words|term|terms|name|names|phrase|letter|letters|title|verb|noun|tag|label)$/;

/** "The dogs barks loudly", "The dog are released": a determiner-led subject and its verb. */
const DETERMINER_SUBJECT = `(?<target>the|these|those|my|your|his|her|our|their|many|some|most|both|several|this|that|all|each)${SPACE}(?=[a-z])`;
// "Cars is useful", "Grammatical errors is bad": a plural with no determiner opens the clause.
const BARE_SUBJECT = `(?<=(?:^|[.!?;:\\n"“(—–]|(?:^|[^\\p{L}])(?:because|since|when|while|if|although|though|whereas|unless|until|but|whether|where)[ \\t\\u00a0])[ \\t\\u00a0"“‘']{0,8})(?<target>[A-Za-z][a-z]+)${SPACE}(?=[a-z])`;
// "Lots of water is", "Kinds of fruit": a quantity before of is not the subject's head.
const QUANTITY_HEAD =
  /^(?:lots|loads|tons|heaps|plenty|kinds|sorts|types|dozens|hundreds|thousands|millions|billions|percent)$/;

// A mass noun after a determiner is singular though it has no plural: "The luggage were".
// Animals as a group take a plural verb: "The livestock are fed".
const headNumber = (word: string, bare: boolean) =>
  nounNumber(word) ??
  (MASS.has(word) && !bare && !/^(?:livestock|poultry|wildlife|plankton)$/.test(word)
    ? { singular: word, plural: word, number: "singular" as const }
    : null);

function nounSubject(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const bare of [false, true])
    for (const m of frameMatches(ctx, bare ? BARE_SUBJECT : DETERMINER_SUBJECT)) {
      // A clause opens at a break, a cue word, a list bullet ("- The message…") or a comma after
      // an opening phrase ("As such, each page…"); not after a list item ("The oceans, our wealth").
      const opens =
        afterBreak(ctx, m.index) ||
        CLAUSE_CUE.test(wordBefore(ctx, m.index)) ||
        /(?:^|\n)[ \t]*[-*•][ \t\u00a0]+$/.test(
          ctx.text.slice(Math.max(0, m.index - 8), m.index),
        ) ||
        OPENING_PHRASE.test(ctx.text.slice(Math.max(0, m.index - 80), m.index));
      // "Subject to change, the systems seems…", "although the features has…": a weaker opening
      // (a list may go on: "The oceans, our military power have…") that only a plural head uses.
      const later =
        !bare &&
        (/,[ \t\u00a0]+$/.test(ctx.text.slice(Math.max(0, m.index - 4), m.index)) ||
          LATER_CUE.test(wordBefore(ctx, m.index)));
      if (!opens && !later) continue;
      const pluralOnly = bare || !opens;
      const det = bare ? "" : m.groups!.target.toLowerCase();
      const tokens = tokensAfter(ctx, bare ? m.index : m.index + m[0].length, 9);
      if (tokens.some((t) => t.kind === "other")) continue;
      // A gerund ("Making mistakes is human") or a closed word opens no bare plural.
      if (bare && (/ing$/.test(tokens[0].lower) || FUNCTION_WORDS.has(tokens[0].lower))) continue;
      // "bell hooks doesn't…": a sentence opening in lowercase starts with a name or a fragment.
      if (
        bare &&
        /(?:^|[.!?\n])[ \t\u00a0"“‘']*$/.test(ctx.text.slice(Math.max(0, m.index - 8), m.index)) &&
        tokens[0].text === tokens[0].lower
      )
        continue;
      // Modifiers and the head noun, then an optional of/in phrase, then the verb.
      let i = 0;
      let head: string | null = null;
      let abort = false;
      while (
        i < 4 &&
        tokens[i]?.kind === "word" &&
        (tokens[i].text === tokens[i].lower ||
          (bare && i === 0 && /^[A-Z][a-z]+$/.test(tokens[i].text) && afterBreak(ctx, m.index)))
      ) {
        const word = tokens[i].lower;
        if (
          FUNCTION_WORDS.has(word) ||
          TO_PLURAL[normal(word)] ||
          TO_SINGULAR[normal(word)] ||
          SINGULAR_DO_HAVE[normal(word)]
        )
          break;
        if (NUMBERS.test(word)) {
          abort = true;
          break;
        }
        // A mass noun is singular though it has no plural: "The marketing are" -> is.
        const number = headNumber(word, bare);
        const read = englishWordInfo(word);
        // After the head, an -s word that is also a verb is the verb: "The cats sleeps".
        // An adjective read as the head gives way to a plural noun after it: "The black cats sleeps".
        if (
          head &&
          /s$/.test(word) &&
          read?.verbs.some((v) => v.form === "third") &&
          // "The black cats sleeps", "Heat rates has", "leather boots looks": a plural noun when
          // a verb follows it.
          !(
            read.plural &&
            (verbNext(tokens, i + 1) ||
              (!!englishWordInfo(head)?.adjective && /s$/.test(tokens[i + 1]?.lower ?? "")))
          )
        )
          break;
        // A bare verb with no noun reading after a singular head: "The dog eat.", "Our success
        // depend on…"; or one before its object: "The report show a drop".
        if (head && !number && bareVerbOnly(word)) break;
        if (head && baseBeforeObject(ctx, tokens[i], tokens[i + 1])) break;
        // A postmodifier after the head ("the solvents present in…") or an adjective used as a
        // noun ("the rich"): not this frame.
        if (head && (!number || read?.adjective)) {
          abort = true;
          break;
        }
        // "All things living have…": an -ing word after a plural head modifies it.
        if (head && /ing$/.test(word) && nounNumber(head)?.number === "plural") {
          abort = true;
          break;
        }
        if (number) head = word;
        // "Limited payments hurt": a participle before a bare plural.
        else if (
          !read?.adjective &&
          !(bare && i === 0 && !!read?.verbs.some((v) => v.form === "participle"))
        )
          break;
        i++;
      }
      if (!head || abort || englishWordInfo(head)?.adjective) continue;
      if (bare && QUANTITY_HEAD.test(head)) continue;
      if (tokens.slice(0, i).some((t) => MENTION.test(t.lower))) continue;
      let verbAt = i;
      if (
        /^(?:of|in|from|for|with|at|on|by|after|since|near|across|inside|outside)$/.test(
          tokens[i]?.lower ?? "",
        )
      ) {
        // "The dogs of war is", "The chemicals in Botox is": skip a short phrase. "at first",
        // "in fact" are adverbs, not phrases with a noun.
        if (
          /^(?:first|last|least|most|all|once|large|general|fact|least|times|best|worst)$/.test(
            tokens[i + 1]?.lower ?? "",
          )
        )
          continue;
        let j = i + 1;
        if (/^(?:the|a|an|my|your|his|her|our|their)$/.test(tokens[j]?.lower ?? "")) j++;
        const object = j;
        while (
          j < i + 4 &&
          tokens[j]?.kind === "word" &&
          // "the list of awards you have are…": a relative clause, not the phrase's noun.
          !/^(?:i|you|we|they|he|she)$/.test(tokens[j].lower) &&
          !TO_PLURAL[normal(tokens[j].lower)] &&
          !TO_SINGULAR[normal(tokens[j].lower)] &&
          // "The users in Asia wants": an -s verb after the phrase's noun.
          !(
            j > object &&
            tokens[j].text === tokens[j].lower &&
            /s$/.test(tokens[j].lower) &&
            englishWordInfo(tokens[j].lower)?.verbs.some((v) => v.form === "third")
          )
        )
          j++;
        verbAt = j;
      }
      // "The dog always bark": a frequency adverb before the verb; the word after it is the verb.
      const adverbGap =
        verbAt === i &&
        /^(?:always|never|often|usually|sometimes|rarely|seldom|also|still|just|really|only|even|already|actually|generally|normally|typically|mostly|probably)$/.test(
          tokens[verbAt]?.lower ?? "",
        );
      if (adverbGap) verbAt++;
      const verb = tokens[verbAt];
      if (verb?.kind !== "word" || verb.text !== verb.lower) continue;
      // "All people from Jersey do is…": "all (that) they do" heads a pseudo-cleft.
      if (
        det === "all" &&
        (/^(?:is|was)$/.test(verb.lower) || /^(?:is|was)$/.test(tokens[verbAt + 1]?.lower ?? ""))
      )
        continue;
      if (
        /^were$/.test(verb.lower) &&
        SUBJUNCTIVE.test(ctx.text.slice(Math.max(0, m.index - 64), m.index))
      )
        continue;
      if (
        !TO_PLURAL[normal(verb.lower)] &&
        !TO_SINGULAR[normal(verb.lower)] &&
        (auxiliaryLater(tokens, verbAt + 1) ||
          // "The public demands answers": after an adjective used as a noun, the head may itself
          // be the verb.
          (tokens.slice(0, i).some((t) => GROUP_ADJECTIVES.test(t.lower)) &&
            !!englishWordInfo(head)?.verbs.some((v) => v.form === "third")))
      )
        continue;
      const number = headNumber(head, bare)!;
      if (COLLECTIVE.has(head) || COLLECTIVE.has(number.singular)) continue;
      // "Asteroids was a hit": one capitalized plural may name a title.
      if (bare && i === 1 && tokens[0].text !== tokens[0].lower && TO_PLURAL[normal(verb.lower)])
        continue;
      // "Private practices is the wrong word": the phrase is named, not its referents.
      if (
        TO_PLURAL[normal(verb.lower)] &&
        tokensAfter(ctx, verb.end, 5).some((t) => MENTION.test(t.lower))
      )
        continue;
      // "this/that" before a noun is singular; plural determiners must have a plural head.
      if (number.number === "plural") {
        if (/^(?:this|that)$/.test(det) && verbAt === i) continue;
        // "Ten dollars is a lot", "the assets is a single system": a singular predicate treats
        // the plural as one thing.
        const predicate = ADVERBS.has(tokens[verbAt + 1]?.lower ?? "")
          ? tokens[verbAt + 2]
          : tokens[verbAt + 1];
        if (/^(?:is|was)$/.test(verb.lower) && /^(?:a|an|one)$/.test(predicate?.lower ?? ""))
          continue;
        const fix = pluralOf(verb, tokens[verbAt + 1], tokens[verbAt + 2]);
        if (fix) push(ctx, findings, verb, fix, m.index);
      } else if (
        !pluralOnly &&
        !/^(?:these|those|many|several|both|some|most)$/.test(det) &&
        // "All car are…": all + a plain count noun lost the plural (clauseSlots' allSingular).
        !(
          det === "all" &&
          !englishWordInfo(head)?.verbs.some((v) => v.form !== "base") &&
          englishNounPair(head)
        )
      ) {
        let fix = TO_SINGULAR[normal(verb.lower)];
        // "This girl have blue eyes", "The dog don't bark": have/do right after the head.
        // "This week do you want…": a time phrase before a question.
        if (
          !fix &&
          verbAt === i &&
          !/^(?:that|lest)$/.test(wordBefore(ctx, m.index)) &&
          !/^(?:i|you|we|they|he|she|it)$/.test(tokens[verbAt + 1]?.lower ?? "")
        )
          fix = SINGULAR_DO_HAVE[normal(verb.lower)] ?? "";
        // "We ask that the user restart": a mandative subjunctive keeps the bare verb.
        const verbRead = englishWordInfo(verb.lower);
        if (
          !fix &&
          (verbAt === i || adverbGap) &&
          !/^(?:that|lest)$/.test(wordBefore(ctx, m.index)) &&
          (bareVerbOnly(verb.lower) ||
            (adverbGap &&
              !!verbRead?.verbs.length &&
              verbRead.verbs.every((v) => v.form === "base" && v.lemma === verb.lower) &&
              !verbRead.adjective)) &&
          closedAfter(tokens[verbAt + 1])
        )
          fix = englishInflect(verb.lower, "third") ?? "";
        // "The report show a drop", "The battery need charging": a base verb that is also a noun,
        // before its object.
        if (
          !fix &&
          verbAt === i &&
          !/^(?:that|lest)$/.test(wordBefore(ctx, m.index)) &&
          baseBeforeObject(ctx, verb, tokens[verbAt + 1])
        )
          fix = englishInflect(verb.lower, "third") ?? "";
        if (fix) push(ctx, findings, verb, fix, m.index);
      }
    }
  return findings;
}

/** "Some people thinks", "people who knows": irregular plural subjects with a singular verb. */
function irregularPlurals(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?:(?<det>some|most|many|these|those|the|our|their|my|your|all|other)${SPACE})?(?<target>people|children|men|women)${SPACE}(?=[a-z])`,
  )) {
    // Only a clause-opening subject: "Meeting new people is hard" has people as an object.
    if (!afterBreak(ctx, m.index) && !CLAUSE_CUE.test(wordBefore(ctx, m.index))) continue;
    const tokens = tokensAfter(ctx, m.index + m[0].length, 3);
    const verb = tokens[0];
    if (verb?.kind !== "word" || verb.text !== verb.lower || !verbOnlyThird(verb)) continue;
    // "Most people is probably a bad way to start": the phrase named as one thing.
    const predicate = ADVERBS.has(tokens[1]?.lower ?? "") ? tokens[2] : tokens[1];
    if (/^(?:is|was)$/.test(verb.lower) && /^(?:a|an|one)$/.test(predicate?.lower ?? "")) continue;
    const fix = pluralOf(verb, tokens[1], tokens[2]);
    if (fix) push(ctx, findings, verb, fix, m.index);
  }
  return findings;
}

/** "These includes", "Those two is", "This are my notes": a demonstrative and its verb. */
function demonstratives(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<target>these|those)(?:${SPACE}(?:two|three|four|five|both|all))?${SPACE}(?=[a-z])`,
  )) {
    if (!afterBreak(ctx, m.index) && !CLAUSE_CUE.test(wordBefore(ctx, m.index))) continue;
    const tokens = tokensAfter(ctx, m.index + m[0].length, 3);
    const verb = tokens[0];
    if (verb?.kind !== "word" || verb.text !== verb.lower || !verbOnlyThird(verb)) continue;
    if (!TO_PLURAL[normal(verb.lower)] && auxiliaryLater(tokensAfter(ctx, verb.end, 6), 0))
      continue;
    const fix = pluralOf(verb, tokens[1], tokens[2]);
    if (fix) push(ctx, findings, verb, fix, m.index);
  }
  for (const m of frameMatches(ctx, `(?<target>this|that)${SPACE}(?<verb>are|were)${WORD_END}`)) {
    if (!afterBreak(ctx, m.index)) continue;
    const target = m.groups!.target;
    const [start, end] = m.indices!.groups!.target;
    if (findings.some((f) => f.range.start === start)) continue;
    findings.push({
      ruleId: "englishSubjectVerbAgreement",
      messageKey: "review_msg_subject_verb",
      range: { start, end },
      alternatives: [caseLike(target, target.toLowerCase() === "this" ? "these" : "those")],
      context: evidence(ctx, m.index, end + 5),
    });
  }
  return findings;
}

/** "Do your father live…?", "Has your parents told…?", "Where is your dogs?": an inverted aux. */
function invertedAuxiliary(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const singular: Record<string, string> = { do: "does", have: "has", are: "is", were: "was" };
  const plural: Record<string, string> = { does: "do", has: "have", is: "are", was: "were" };
  for (const m of frameMatches(
    ctx,
    `(?<aux>do|does|have|has|is|are|was|were)${SPACE}(?:the|your|my|his|her|our|their)${SPACE}(?<noun>[a-z]+)(?:${SPACE}(?:ever|never|already|really|just|always|also|still|actually)(?=${SPACE}[a-z]+${WORD_END}))?(?:${SPACE}(?<verb>[a-z]+))?${WORD_END}`,
    "aux",
  )) {
    const before = wordBefore(ctx, m.index);
    if (!afterBreak(ctx, m.index) && !/^(?:what|where|when|why|how|who|which)$/.test(before))
      continue;
    const { aux, noun, verb } = m.groups!;
    const a = aux.toLowerCase();
    const number = nounNumber(noun);
    // A plural collective ("the teams") takes a plural verb like any plural.
    if (
      !number ||
      (COLLECTIVE.has(number.singular) && number.number === "singular") ||
      NUMBERS.test(noun)
    )
      continue;
    // "Where were the book I lent you?": a relative clause after the subject.
    const relative =
      /^(?:i|you|we|they|he|she)$/i.test(verb ?? "") &&
      /^(?:what|where|when|why|how|who|which)$/.test(before);
    const read = verb && !relative ? englishWordInfo(verb) : null;
    // A verb must follow do/have ("Do your homework" is an order); be may end the question.
    if (/^(?:do|does)$/.test(a) && !read?.verbs.some((v) => v.form === "base" && v.lemma === verb))
      continue;
    if (
      /^(?:have|has)$/.test(a) &&
      verb !== "been" &&
      !read?.verbs.some((v) => v.form === "participle")
    )
      continue;
    if (
      /^(?:is|are|was|were)$/.test(a) &&
      verb &&
      !relative &&
      !read?.verbs.some((v) => v.form === "ing" || v.form === "participle")
    )
      continue;
    if (
      /^(?:is|are|was|were)$/.test(a) &&
      !verb &&
      !/^(?:what|where|when|why|how|who|which)$/.test(before)
    )
      continue;
    // "Do your parents…" vs "Does your father…": the noun's number decides.
    if (verb && read?.plural) continue;
    // "Do the zip file installation steps work…": the noun phrase goes on.
    const after = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (verb && read?.noun && after?.kind === "word" && nounNumber(after.lower)) continue;
    const fix = number.number === "plural" ? plural[a] : singular[a];
    if (!fix) continue;
    const [start, end] = m.indices!.groups!.aux;
    findings.push({
      ruleId: "englishSubjectVerbAgreement",
      messageKey: "review_msg_subject_verb",
      range: { start, end },
      alternatives: [caseLike(aux, fix)],
      context: evidence(ctx, m.index, m.index + m[0].length),
    });
  }
  // "Does you have…?", "Does anyone knows?": do + a pronoun or indefinite subject.
  for (const m of frameMatches(
    ctx,
    `(?<aux>does)${SPACE}(?<subject>you|I|we|they)${WORD_END}`,
    "aux",
  )) {
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:but|and|so|what|where|when|why|how)$/.test(wordBefore(ctx, m.index))
    )
      continue;
    const [start, end] = m.indices!.groups!.aux;
    findings.push({
      ruleId: "englishSubjectVerbAgreement",
      messageKey: "review_msg_subject_verb",
      range: { start, end },
      alternatives: [caseLike(m.groups!.aux, "do")],
      context: evidence(ctx, m.index, m.index + m[0].length),
    });
  }
  for (const m of frameMatches(
    ctx,
    `(?:does|do|did)${SPACE}(?:anyone|anybody|someone|somebody|everyone|nobody)(?:${SPACE}here)?${SPACE}(?<verb>[a-z]+s)${WORD_END}`,
    "verb",
  )) {
    const verb = m.groups!.verb;
    const forms = englishVerbForms(verb);
    const lemma =
      verb === "has" ? "have" : forms?.third === verb ? forms.lemma : englishLemma(verb, "third");
    if (!lemma || lemma === verb || !englishInflect(lemma, "third")) continue;
    const [start, end] = m.indices!.groups!.verb;
    findings.push({
      ruleId: "englishSubjectVerbAgreement",
      messageKey: "review_msg_subject_verb",
      range: { start, end },
      alternatives: [lemma],
      context: evidence(ctx, m.index, end),
    });
  }
  return findings;
}

const RELATIVE_SUBJECT = `(?<det>the|these|those|my|our|their|his|her|your|all|many|some|most|this|that|a|an|every|each)${SPACE}(?<head>(?:[a-z]+${SPACE}){0,2}?[a-z]+)${SPACE}(?:who|that)${SPACE}(?=[a-z])`;
const PRONOUN_HEAD = `(?<head>anyone|anybody|someone|somebody|everyone|everybody|nobody)${SPACE}who${SPACE}(?=[a-z])`;
// Words after which a bare verb continues the clause: "helped clean", "made me laugh".
const CATENATIVE =
  /^(?:help|helps|helped|let|lets|make|makes|made|watch|watched|see|saw|seen|hear|heard|have|has|had|do|does|did|will|would|can|could|shall|should|may|might|must|to|not|never|dare|rather|better)$/;
const TIME_WORDS =
  /^(?:yesterday|today|tonight|now|then|before|earlier|later|here|there|again|early|late|hard|fast|well)$/;
const SINGULAR_FIX: Record<string, string> = { have: "has", are: "is", were: "was", do: "does" };

const BE_OR_AUX =
  /^(?:is|are|was|were|am|has|have|had|do|does|did|will|would|can|could|should|may|might|must)$/;

/**
 * "The ladies who talk loudly annoys me", "The tall woman that I met yesterday manage the team":
 * the main verb after a relative clause agrees with the noun before who/that. The clause must
 * have its own verb, and the main verb must follow an adverb, a time word or that verb.
 */
function relativeClauseSubject(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const pattern of [RELATIVE_SUBJECT, PRONOUN_HEAD])
    for (const m of frameMatches(ctx, pattern, null)) {
      if (!afterBreak(ctx, m.index) && !CLAUSE_CUE.test(wordBefore(ctx, m.index))) continue;
      // "A new WHO report": the relative pronoun is lowercase.
      if (!/[ \t\u00a0](?:who|that)[ \t\u00a0]+$/.test(m[0])) continue;
      const words = m.groups!.head.split(/[ \t ]+/);
      const head = words.at(-1)!;
      if (words.some((w) => FUNCTION_WORDS.has(w) || BE_OR_AUX.test(w))) continue;
      // Modifiers before the head are adjectives or nouns, never verbs.
      if (words.slice(0, -1).some((w) => englishWordInfo(w)?.verbs.some((v) => v.form !== "base")))
        continue;
      const headRead = englishWordInfo(head);
      const number = !m.groups!.det
        ? { singular: head, plural: head, number: "singular" as const }
        : (nounNumber(head) ??
          // "guys" is also a verb the noun pairs skip: the lexicon's plural reading.
          (headRead?.noun && headRead.plural && /s$/.test(head)
            ? { singular: head.slice(0, -1), plural: head, number: "plural" as const }
            : null));
      if (!number || COLLECTIVE.has(number.singular) || NUMBERS.test(head)) continue;
      const det = (m.groups!.det ?? "").toLowerCase();
      const plural = number.number === "plural";
      if (
        plural
          ? /^(?:a|an|this|that|every|each)$/.test(det)
          : /^(?:these|those|many|all|most)$/.test(det)
      )
        continue;
      const tokens = tokensAfter(ctx, m.index + m[0].length, 10);
      // The clause's own verb; the main verb comes right after it or after adverbs.
      let clauseVerb = -1;
      for (let j = 0; j < tokens.length; j++) {
        const t = tokens[j];
        if (t.kind !== "word" || (t.text !== t.lower && t.text !== "I")) break;
        if (/^(?:and|but|or|because|if|when|which|who|that|while)$/.test(t.lower)) break;
        const read = englishWordInfo(t.lower);
        const verb =
          BE_OR_AUX.test(t.lower) || (!!read?.verbs.length && !FUNCTION_WORDS.has(t.lower));
        if (clauseVerb < 0) {
          if (verb) clauseVerb = j;
          continue;
        }
        const prev = tokens[j - 1];
        const prevRead = englishWordInfo(prev.lower);
        const adverbBefore =
          ADVERBS.has(prev.lower) ||
          TIME_WORDS.test(prev.lower) ||
          (!!prevRead?.adverb && !prevRead.noun && !prevRead.adjective && !prevRead.verbs.length);
        const afterClauseVerb = j - 1 === clauseVerb && !CATENATIVE.test(prev.lower);
        // "that he can not use", "its gonna randomly scramble": a bare verb after a modal.
        if (
          tokens
            .slice(clauseVerb, j)
            .some((w) => CATENATIVE.test(w.lower) || /^(?:gonna|wanna|gotta)$/.test(w.lower))
        )
          break;
        if (!adverbBefore && !afterClauseVerb) {
          if (verb) break;
          continue;
        }
        if (!verb) continue;
        // Right after the clause verb a noun reading may be its object ("who play sports").
        if (adverbBefore || (!read?.noun && !read?.adjective)) {
          let fix: string | null = null;
          if (plural) fix = pluralOf(t, tokens[j + 1], tokens[j + 2]);
          else if (SINGULAR_FIX[t.lower]) fix = SINGULAR_FIX[t.lower];
          else if (
            read?.verbs.some((v) => v.form === "base" && v.lemma === t.lower) &&
            (adverbBefore || !read.adjective) &&
            (!read.noun || closedAfter(tokens[j + 1]))
          )
            fix = englishInflect(t.lower, "third");
          if (fix && fix !== t.lower) push(ctx, findings, t, fix, m.index);
        } else if (read?.noun) continue; // "who answers calls rarely forget": an object.
        break;
      }
    }
  return findings;
}

/**
 * A base verb with a noun reading, read as the verb before an object: "show a drop", "need
 * charging", "need to leave". An object followed by its own verb is a relative clause ("The test
 * plan the team wrote"), and a noun compound may go on ("The car park a block away is…").
 */
function baseBeforeObject(ctx: DetectContext, verb: Token, next: Token | undefined): boolean {
  const word = verb.lower;
  if (word === "need")
    return (
      next?.kind === "word" &&
      (next.lower === "to" || (/ing$/.test(next.lower) && !FUNCTION_WORDS.has(next.lower)))
    );
  if (FUNCTION_WORDS.has(word) || /s$|^(?:please|thank|beware|better|best)$/.test(word))
    return false;
  const read = englishWordInfo(word);
  const forms = englishVerbForms(word);
  if (
    !read?.verbs.some((v) => v.form === "base" && v.lemma === word) ||
    read.adjective ||
    read.plural ||
    (forms && (forms.past === word || forms.participle === word))
  )
    return false;
  if (next?.kind !== "word" || !OBJECT_START.test(next.lower)) return false;
  // Past the object's modifiers and head: no finite verb may follow before the clause ends.
  for (const t of tokensAfter(ctx, next.end, 6)) {
    if (t.kind !== "word") return true;
    if (/^(?:that|which|who|to|and|or|but|for|in|on|at|of|with|from|by)$/.test(t.lower))
      return true;
    if (AUXILIARIES.has(t.lower)) return false;
    const r = englishWordInfo(t.lower);
    if (r?.verbs.some((v) => v.form === "past" || v.form === "third") && !r.noun) return false;
  }
  return true;
}

/** A base verb and nothing else: no noun, adjective or same-spelled past ("let", "put"). */
function bareVerbOnly(word: string): boolean {
  // "Your ticket please.": a politeness word, not a verb.
  if (FUNCTION_WORDS.has(word) || /s$|^(?:please|thank|beware)$/.test(word)) return false;
  const read = englishWordInfo(word);
  const forms = englishVerbForms(word);
  return (
    !!read &&
    read.verbs.some((v) => v.form === "base" && v.lemma === word) &&
    read.verbs.every((v) => v.form === "base") &&
    !read.noun &&
    !read.adjective &&
    !read.adverb &&
    !nounNumber(word) &&
    !(forms && (forms.past === word || forms.participle === word))
  );
}

/** An object, particle, preposition, adverb or the clause end after a verb that is also a noun. */
function closedAfter(t: Token | undefined): boolean {
  if (!t || t.kind === "end") return true;
  if (t.kind !== "word") return false;
  return (
    /^(?:the|a|an|my|your|his|her|our|their|it|them|me|us|him|you|this|that|to|in|on|at|with|for|up|down|out|off|through|into|again|every|each)$/.test(
      t.lower,
    ) ||
    ADVERBS.has(t.lower) ||
    (/ly$/.test(t.lower) && !!englishWordInfo(t.lower)?.adverb)
  );
}

const LIVE_WHERE = /^(?:in|at|on|with|near|abroad|alone)$/;
// A determiner or object pronoun: the word before it is a verb taking an object.
const OBJECT_START = /^(?:the|a|an|my|your|his|her|our|their|its|this|these|those|me|him|us|them)$/;

// Words after which he/she/it opens its own clause; never a causative ("make it work").
const PRONOUN_CUE =
  /^(?:and|but|so|because|when|whenever|while|since|until|although|though|if|think|thought|hope|hoped|assume|assumed|guess|believe|believed|said|says|sure|suppose|know|knew|bet|wish|hoping|hopes)$/;
const LINKING_BASE = /^(?:become|go|get|turn|seem|look|feel|sound|stay|grow|remain|make)$/;
const BETWEEN_ADVERBS =
  /^(?:only|really|just|also|always|never|still|usually|often|probably|suddenly|actually|finally|sometimes|already|even|simply)$/;

/** "It only matter to me", "I hope he go away", "and it become dark": he/she/it + a bare verb. */
function thirdPersonBase(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, `(?<target>he|she|it)${SPACE}(?=[a-z])`)) {
    const pronoun = m.groups!.target;
    if (pronoun !== pronoun.toLowerCase() && !afterBreak(ctx, m.index)) continue;
    const cue = wordBefore(ctx, m.index);
    if (!afterBreak(ctx, m.index) && !PRONOUN_CUE.test(cue)) continue;
    // "you and he work", "after Stan and he meet": a coordinated subject is plural.
    if (
      /^(?:and|or)$/.test(cue) &&
      /(?:\b(?:I|[Yy]ou|[Ww]e|[Tt]hey|[Hh]e|[Ss]he|me|him|her|us|them)|\b\p{Lu}\p{L}*)[ \t\u00a0]+(?:and|or)[ \t\u00a0]+$/u.test(
        ctx.text.slice(Math.max(0, m.index - 40), m.index),
      )
    )
      continue;
    const tokens = tokensAfter(ctx, m.index + m[0].length, 5);
    let k = 0;
    while (k < 2 && tokens[k]?.kind === "word" && BETWEEN_ADVERBS.test(tokens[k].lower)) k++;
    const verb = tokens[k];
    if (verb?.kind !== "word" || verb.text !== verb.lower || ctx.dictionary.has(verb.lower))
      continue;
    const word = verb.lower;
    // "it need not", "it better be": modal uses.
    if (FUNCTION_WORDS.has(word) || /^(?:be|please|need|dare|better|don)$/.test(word)) continue;
    const read = englishWordInfo(word);
    const next = tokens[k + 1];
    // "She live in Rome", "He open the door": an adjective spelling is the verb before an
    // object or, for live, a place.
    const adjectiveVerb =
      !!read?.adjective &&
      (OBJECT_START.test(next?.lower ?? "") ||
        (word === "live" && LIVE_WHERE.test(next?.lower ?? "")));
    if (
      !read?.verbs.some((v) => v.form === "base" && v.lemma === word) ||
      (read.adjective && !adjectiveVerb)
    )
      continue;
    // "he put", "he come home": the same spelling is a past or participle (dialect use).
    const forms = englishVerbForms(word);
    // "it become dark", "it go crazy", "it make sense": a linking verb before an adjective (or
    // "sense") is the verb, whatever else its spelling reads as.
    const nextWord = next?.kind === "word" ? englishWordInfo(next.lower) : null;
    const linked =
      LINKING_BASE.test(word) &&
      next?.kind === "word" &&
      (next.lower === "sense" || (!!nextWord?.adjective && !nextWord.verbs.length));
    if (!linked && forms && (forms.past === word || forms.participle === word)) continue;
    if (read.plural) continue;
    // "he hand wrote", "she dose not", "it time to", "so it sort of": a verb after it, or a noun
    // reading before not/of/to, belongs to another error.
    const nextRead = next?.kind === "word" ? englishWordInfo(next.lower) : null;
    if (nextRead?.verbs.some((v) => v.form === "past" || v.form === "third")) continue;
    if (
      !linked &&
      read.noun &&
      (!closedAfter(next) || /^(?:not|of|to)$/.test(next?.kind === "word" ? next.lower : ""))
    )
      continue;
    const fix = englishInflect(word, "third");
    if (!fix || fix === word) continue;
    // "and it become dark" may be a past: "become" is spelled like its participle.
    const past = forms && forms.participle === word && forms.past !== word ? forms.past : null;
    findings.push({
      ruleId: "englishPronounVerbWhitelistAgreement",
      messageKey: "review_msg_pronoun_verb",
      range: { start: verb.start, end: verb.end },
      alternatives: past ? [fix, past] : [fix],
      ...(past ? { requiresChoice: true as const } : {}),
      context: evidence(ctx, m.index, verb.end),
    });
  }
  return findings;
}

// Openers that are no name: greetings, fillers, vocatives and set wishes ("God bless you").
const NOT_A_NAME =
  /^(?:pls|plz|hey|hi|hello|ok|okay|yes|yeah|yep|nope|oh|ah|um|uh|wow|lol|btw|fyi|imo|thx|thanks|sorry|oops|alright|sure|yo|dear|cheers|mom|mum|dad|sir|madam|honey|guys|folks|man|dude|bro|boss|babe|buddy|mate|sweetie|god|heaven|lord|people|cattle|police|staff|personnel|livestock|clergy|poultry|everyone|everybody|someone|somebody|anyone|anybody|nobody|none)$/;
const NAME_CUE = /^(?:because|since|when|while|if|although|though|whereas|unless|until|but|so)$/;

/** "Tom live in Rome", "Microsoft speak to its customers": a name before a bare verb. */
function nameSubject(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, `(?<name>[A-Z][a-z]+)${SPACE}(?<target>[a-z]+)${WORD_END}`)) {
    if (!afterBreak(ctx, m.index) && !NAME_CUE.test(wordBefore(ctx, m.index))) continue;
    if (
      !/^[A-Z][a-z]+$/.test(m.groups!.name) ||
      m.groups!.target !== m.groups!.target.toLowerCase()
    )
      continue;
    const name = m.groups!.name.toLowerCase();
    if (FUNCTION_WORDS.has(name) || NOT_A_NAME.test(name) || COLLECTIVE.has(name)) continue;
    // A name is unknown to the lexicon or only a noun ("Tom"); never a plural.
    const read = englishWordInfo(name);
    if (read ? read.verbs.length || read.adjective || read.adverb || read.plural : /s$/.test(name))
      continue;
    const [start] = m.indices!.groups!.target;
    const [verb, next] = tokensAfter(ctx, start, 2);
    if (verb?.kind !== "word" || ctx.dictionary.has(verb.lower) || ctx.dictionary.has(name))
      continue;
    const ok =
      (bareVerbOnly(verb.lower) && closedAfter(next)) ||
      baseBeforeObject(ctx, verb, next) ||
      (verb.lower === "live" && LIVE_WHERE.test(next?.lower ?? ""));
    const fix = ok && englishInflect(verb.lower, "third");
    if (fix && fix !== verb.lower) push(ctx, findings, verb, fix, m.index);
  }
  return findings;
}

const SINGULAR_OF: Record<string, string> = { are: "is", were: "was", have: "has", do: "does" };
const PLURAL_OF: Record<string, string> = { is: "are", was: "were", has: "have", does: "do" };

/**
 * Quantified and coordinated subjects: "Each of the kids are" (is), "The number of users have"
 * (has), "Both of them believes" (believe), "Tina and her brother sings" (sing), "Does dogs
 * sleep" (Do).
 */
function quantifiedSubjects(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const at = (m: RegExpExecArray, group: string): Token => {
    const [start, end] = m.indices!.groups![group];
    const text = ctx.text.slice(start, end);
    return { text, lower: text.toLowerCase(), start, end, kind: "word" };
  };
  const opens = (m: RegExpExecArray) =>
    afterBreak(ctx, m.index) || CLAUSE_CUE.test(wordBefore(ctx, m.index));
  // each of / the number of: a singular head.
  for (const m of frameMatches(
    ctx,
    `(?:each${SPACE}of${SPACE}(?:them|us|you|(?:the|these|those|my|your|our|their|his|her|its)(?:${SPACE}[a-z]+){1,2})|the${SPACE}number${SPACE}of(?:${SPACE}[a-z]+){1,2})${SPACE}(?<verb>are|were|have|do)${WORD_END}`,
    "verb",
  )) {
    const verb = at(m, "verb");
    // "If each of them were…": a conditional keeps were.
    const subjunctive =
      verb.lower === "were" && SUBJUNCTIVE.test(ctx.text.slice(Math.max(0, m.index - 64), m.index));
    if (opens(m) && verb.text === verb.lower && !subjunctive)
      push(ctx, findings, verb, SINGULAR_OF[verb.lower], m.index);
  }
  // both of them / both + plural subject: a plural verb.
  for (const m of frameMatches(
    ctx,
    `both${SPACE}of${SPACE}(?:them|us|you|these|those)${SPACE}(?<verb>[a-z]+s)${WORD_END}`,
    "verb",
  )) {
    const verb = at(m, "verb");
    if (!opens(m)) continue;
    const third = !!englishWordInfo(verb.lower)?.verbs.some((v) => v.form === "third");
    const fix = PLURAL_OF[verb.lower] ?? (third ? englishLemma(verb.lower, "third") : null);
    if (fix) push(ctx, findings, verb, fix, m.index);
  }
  // "Tina and her brother sings": a second conjunct with its own determiner.
  for (const m of frameMatches(
    ctx,
    `(?:[A-Z][a-z]+|(?:the|my|your|his|her|our|their)${SPACE}[a-z]+)${SPACE}and${SPACE}(?:the|my|your|his|her|our|their)${SPACE}(?<noun>[a-z]+)${SPACE}(?<verb>is|was|has|does|[a-z]+s)${WORD_END}`,
    "verb",
  )) {
    if (!opens(m) || !/^[A-Za-z]/.test(m[0])) continue;
    const first = m[0].split(/[ \t ]+/)[0];
    if (
      /^[A-Z]/.test(first) &&
      FUNCTION_WORDS.has(first.toLowerCase()) &&
      !/^(?:the|my|your|his|her|our|their)$/i.test(first)
    )
      continue;
    // "Anna And Her Men" is a title; "her art friends defended": the -s word is the head noun.
    if (!/[ \t ]and[ \t ]/.test(m[0])) continue;
    const noun = m.groups!.noun;
    if (!nounNumber(noun) || englishWordInfo(noun)?.adjective) continue;
    const verb = at(m, "verb");
    const after = tokensAfter(ctx, verb.end, 1)[0];
    if (
      after?.kind === "word" &&
      (AUXILIARIES.has(after.lower) ||
        englishWordInfo(after.lower)?.verbs.some((v) => v.form === "past"))
    )
      continue;
    // "Tom and my name is Rishi": after a bare name, be may open a second clause.
    if (
      /^[A-Z]/.test(m[0]) &&
      !/^(?:the|my|your|his|her|our|their)$/i.test(m[0].split(/[ \t ]+/)[0]) &&
      PLURAL_OF[verb.lower]
    )
      continue;
    // After a whole coordinated subject an -s word is the verb, even one with a noun reading.
    const third = !!englishWordInfo(verb.lower)?.verbs.some((v) => v.form === "third");
    const fix = PLURAL_OF[verb.lower] ?? (third ? englishLemma(verb.lower, "third") : null);
    if (fix) push(ctx, findings, verb, fix, m.index);
  }
  // "Does dogs sleep…?": do before a bare plural.
  for (const m of frameMatches(
    ctx,
    `(?<aux>does|doesn['’]t)${SPACE}(?<noun>[a-z]+s)${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    "aux",
  )) {
    if (!afterBreak(ctx, m.index)) continue;
    const { noun, verb } = m.groups!;
    if (nounNumber(noun)?.number !== "plural") continue;
    if (!englishWordInfo(verb)?.verbs.some((v) => v.form === "base" && v.lemma === verb)) continue;
    const aux = at(m, "aux");
    push(ctx, findings, aux, aux.lower.replace("does", "do"), m.index);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishPronounVerbWhitelistAgreement"],
    detect: english(thirdPersonBase),
  },
  {
    rules: ["englishSubjectVerbAgreement"],
    detect: english(
      nounSubject,
      irregularPlurals,
      demonstratives,
      invertedAuxiliary,
      relativeClauseSubject,
      nameSubject,
      quantifiedSubjects,
    ),
  },
];
