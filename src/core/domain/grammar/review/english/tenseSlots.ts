import {
  englishLexiconInflect,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import { ENGLISH_VERB_FORMS } from "../../implementations/helpers/EnglishVerbForms";
import type { PhraseRow } from "../englishPhraseTables";
import { dateSide, dayCount, recentPast } from "../reviewClock";
import { frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  DETERMINERS,
  english,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  OBJECT_PRONOUNS,
  wordBefore,
} from "./slotWords";
import { finding } from "../finding";

// A tense the sentence's own time word rules out: "Tomorrow we visited the client" (will visit),
// "Last week I will call him" (called), and a past verb on a date that has not come yet ("We
// visited the client on 27/10/2090"), and a future verb on a date that has passed. Dates use
// the Review clock.

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const S = SPACE;
const SUBJECT = "(?:I|we|you|he|she|they)";
const DAY_NAME = "(?:mon|tues|wednes|thurs|fri|satur|sun)day";
const UNIT = "(?:week|month|year|weekend|summer|winter|spring|autumn|fall|semester|term)";
const FUTURE_WORD = `(?:tomorrow|next${S}(?:${UNIT}|${DAY_NAME}))`;
const PAST_WORD = `(?:yesterday|last${S}(?:night|${UNIT}|${DAY_NAME}))`;
const AGO = `(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|a${S}few|several|[0-9]{1,3})${S}(?:days|weeks|months|years|day|week|month|year)${S}ago`;
// A sentence start: the text start or a sentence end before it.
const START = '(?<=(?:^|[.!?\\n][ \\t\\u00a0"“]{0,8}|^["“]))';
// Reporting, planning and wishing verbs move the time word into another clause: "I thought we
// left tomorrow", "we agreed last week that we will meet".
const OTHER_CLAUSE =
  /\b(?:if|unless|wish|wished|as though|as if|would|could|might|should|said|says|told|tell|thought|think|hoped|hope|planned|plan|decided|agreed|promised|expected|knew|know|realized|realised|guessed|assumed|supposed|announced|confirmed|scheduled|booked|arranged|that|when|whether|because|until|rather|time)\b/i;
const NO_WORDS_BETWEEN =
  /\b(?:to|that|if|when|until|before|after|because|and|but|or|so|than|while|since|which|who|for|about|of|by|from|on|in|at)\b/i;
const MODAL_OR_BE =
  /^(?:was|were|had|did|could|would|should|might|must|used|got|went|left|came|thought|said|told|knew)$/;

// Arranging verbs name the date of what was arranged: "we booked a room on 5 May".
const ARRANGING =
  /^(?:book|reserve|order|schedule|plan|arrange|set|register|enrol|enroll|apply|request|invite|postpone|move|reschedule|delay|push|fix|agree|promise|confirm|announce|cancel)$/;

/** A word the lexicon reads only as a past form: "visited", "wrote"; not "put" or "read". */
function pastOnly(word: string): string | null {
  const lower = word.toLowerCase();
  if (FUNCTION_WORDS.has(lower) || MODAL_OR_BE.test(lower)) return null;
  const read = englishWordInfo(lower);
  if (!read || read.noun) return null;
  const past = read.verbs.find((v) => v.form === "past");
  if (!past || read.verbs.some((v) => v.form === "base" || v.form === "third")) return null;
  if (ARRANGING.test(past.lemma)) return null;
  return past.lemma;
}
/** The simple past of a base verb: "call" -> "called", "go" -> "went". */
function pastOf(lemma: string): string | null {
  const read = englishWordInfo(lemma);
  if (!read?.verbs.some((v) => v.form === "base" && v.lemma === lemma)) return null;
  if (/^(?:be|have|do)$/.test(lemma)) return null;
  return (
    ENGLISH_VERB_FORMS.find((row) => row.lemma === lemma)?.past ??
    englishLexiconInflect(lemma, "past") ??
    null
  );
}
/** The text of the sentence before `index`. */
const sentenceBefore = (ctx: DetectContext, index: number) =>
  /[^.!?\n]*$/.exec(ctx.text.slice(Math.max(0, index - 200), index))![0];
/** The word before a closing time word is no preposition or verb: "call him yesterday". */
function objectBefore(ctx: DetectContext, index: number): boolean {
  const before = wordBefore(ctx, index);
  if (OBJECT_PRONOUNS.has(before)) return true;
  if (!before || FUNCTION_WORDS.has(before)) return false;
  if (nounOnly(before)) return true;
  // "painted the fence": a noun that is also a verb, after its determiner.
  const start = ctx.text.lastIndexOf(before, index) || index;
  return !!englishWordInfo(before)?.noun && DETERMINERS.has(wordBefore(ctx, start));
}

function push(
  ctx: DetectContext,
  findings: RawFinding[],
  start: number,
  end: number,
  alternatives: string[],
  messageKey:
    "review_msg_tense_time_word" | "review_msg_future_date_past" | "review_msg_past_date_future",
  from: number,
): void {
  findings.push(
    finding("englishTenseConsistency", messageKey, start, end, alternatives, {
      // The time word may be the slip instead: nothing is preselected.
      ...(alternatives.length ? { requiresChoice: true as const } : { warningOnly: true as const }),
      context: evidence(ctx, from, end),
    }),
  );
}

/** "Tomorrow we visited", "We visited them tomorrow": the future asks for "will". */
function futureWordPastVerb(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const patterns = [
    `${START}${FUTURE_WORD},?${S}${SUBJECT}${S}(?<target>[a-z]+)${WORD_END}(?!['’])`,
    `(?<![\\p{L}'’])${SUBJECT}${S}(?<target>[a-z]+)(?<between>(?:${S}[a-z]+){0,4})${S}(?<when>${FUTURE_WORD})${WORD_END}(?![ \\t\\u00a0]*['’])(?=[ \\t\\u00a0]*[.!?,;]|[ \\t\\u00a0]*$)`,
  ];
  for (const pattern of patterns)
    for (const m of frameMatches(ctx, pattern)) {
      const target = m.groups!.target;
      const lemma = pastOnly(target);
      if (!lemma || hasUserOrCasedWord(ctx, target)) continue;
      const between = m.groups!.between;
      if (between !== undefined) {
        if (NO_WORDS_BETWEEN.test(between)) continue;
        if (!objectBefore(ctx, m.indices!.groups!.when[0])) continue;
      }
      if (OTHER_CLAUSE.test(sentenceBefore(ctx, m.index))) continue;
      const [start, end] = m.indices!.groups!.target;
      push(ctx, findings, start, end, [`will ${lemma}`], "review_msg_tense_time_word", m.index);
    }
  return findings;
}

/** "Yesterday I will call him", "We will call him two days ago": the past asks for the past. */
function pastWordFutureVerb(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const patterns = [
    `${START}(?:${PAST_WORD}|${AGO}),?${S}${SUBJECT}(?:${S}|['’])(?<target>(?:will|shall|ll)${S}(?<verb>[a-z]+))${WORD_END}`,
    `(?<![\\p{L}'’])${SUBJECT}(?:${S}|['’])(?<target>(?:will|shall|ll)${S}(?<verb>[a-z]+))(?<between>(?:${S}[a-z]+){1,4})${S}(?<when>${PAST_WORD}|${AGO})${WORD_END}(?=[ \\t\\u00a0]*[.!?,;]|[ \\t\\u00a0]*$)`,
  ];
  for (const pattern of patterns)
    for (const m of frameMatches(ctx, pattern)) {
      const { verb, between } = m.groups!;
      const past = pastOf(verb.toLowerCase());
      if (!past || hasUserOrCasedWord(ctx, m.groups!.target)) continue;
      if (between !== undefined) {
        if (NO_WORDS_BETWEEN.test(between)) continue;
        if (!objectBefore(ctx, m.indices!.groups!.when[0])) continue;
      }
      if (OTHER_CLAUSE.test(sentenceBefore(ctx, m.index))) continue;
      const [typed, end] = m.indices!.groups!.target;
      // "we'll call": the contraction's apostrophe goes too.
      const contracted = /['’]$/.test(ctx.text.slice(typed - 1, typed));
      const start = contracted ? typed - 1 : typed;
      const fixed = contracted ? ` ${past}` : past;
      push(ctx, findings, start, end, [fixed], "review_msg_tense_time_word", m.index);
    }
  return findings;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December|(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.?)";
const DATE =
  `(?<date>(?<a>[0-9]{1,2})(?<sep>[/.-])(?<b>[0-9]{1,2})\\k<sep>(?<y1>2[0-9]{3})` +
  `|(?<d2>[0-9]{1,2})(?:st|nd|rd|th)?(?:${S}of)?${S}(?<m2>${MONTH}),?${S}(?<y2>2[0-9]{3})` +
  `|(?<m3>${MONTH})${S}(?<d3>[0-9]{1,2})(?:st|nd|rd|th)?,?${S}(?<y3>2[0-9]{3}))(?![\\p{L}\\p{N}]|[./-][0-9])`;
const PERFECT_ADVERB = `(?:(?:already|just|also|finally|first|then|once)${S})?`;
const VERB_PHRASE = `(?<verb>(?<aux>have|has|had)${S}${PERFECT_ADVERB}(?<part>[a-z]+)|(?<simple>[a-z]+))`;

type Reading = [year: number, month: number, day: number];
/** Every reading of a typed date (month 1 to 12); an all-numeric day and month can swap. */
function dateReadings(g: Record<string, string | undefined>): Reading[] {
  const at = (year: number, month: number, day: number): Reading[] =>
    dayCount(year, month, day) === null ? [] : [[year, month, day]];
  const month = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  if (g.a) {
    const [a, b, y] = [+g.a, +g.b!, +g.y1!];
    return [...at(y, b, a), ...at(y, a, b)];
  }
  if (g.d2) return at(+g.y2!, month(g.m2!), +g.d2);
  return at(+g.y3!, month(g.m3!), +g.d3!);
}

/** "We visited the client on 27/10/2090": a past verb on a date that is still to come. */
function futureDatePastVerb(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const patterns = [
    `${START}On${S}${DATE},?${S}${SUBJECT}${S}${PERFECT_ADVERB}${VERB_PHRASE}${WORD_END}`,
    `(?<![\\p{L}'’])${SUBJECT}${S}${PERFECT_ADVERB}${VERB_PHRASE}(?<between>(?:${S}[a-z]+){0,4})${S}on${S}${DATE}(?=[ \\t\\u00a0]*[.!?;]|[ \\t\\u00a0]*$)`,
  ];
  for (const pattern of patterns)
    for (const m of frameMatches(ctx, pattern, "date")) {
      const g = m.groups!;
      // Every reading is more than a day after today on the Review clock.
      const readings = dateReadings(g);
      if (!readings.length || readings.some((r) => dateSide(...r) !== "future")) continue;
      if (g.between !== undefined && NO_WORDS_BETWEEN.test(g.between)) continue;
      if (OTHER_CLAUSE.test(sentenceBefore(ctx, m.index))) continue;
      const word = (g.part ?? g.simple).toLowerCase();
      const read = englishWordInfo(word);
      const past = g.part
        ? // "have visited", but "will have visited" stays future.
          read?.verbs.some((v) => v.form === "participle" && !ARRANGING.test(v.lemma)) &&
          !/\b(?:will|shall|would|'ll)\s*$/i.test(
            ctx.text.slice(
              Math.max(0, m.indices!.groups!.verb[0] - 12),
              m.indices!.groups!.verb[0],
            ),
          )
        : !!pastOnly(word);
      if (!past) continue;
      const [start, end] = m.indices!.groups!.date;
      push(ctx, findings, start, end, [], "review_msg_future_date_past", m.index);
    }
  return findings;
}

/**
 * "We will visit the client on 27/10/2025" when that date has passed: a future verb on a past
 * date. Only a date of the last three years: older dates are history, which can use "will" for
 * the future in the past.
 */
function pastDateFutureVerb(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const patterns = [
    `${START}On${S}${DATE},?${S}${SUBJECT}(?:${S}|['’])(?:will|shall|ll)${S}(?<inf>[a-z]+)${WORD_END}`,
    `(?<![\\p{L}'’])${SUBJECT}(?:${S}|['’])(?:will|shall|ll)${S}(?<inf>[a-z]+)(?<between>(?:${S}[a-z]+){0,4})${S}on${S}${DATE}(?=[ \\t\\u00a0]*[.!?;]|[ \\t\\u00a0]*$)`,
  ];
  for (const pattern of patterns)
    for (const m of frameMatches(ctx, pattern, "date")) {
      const g = m.groups!;
      const readings = dateReadings(g);
      if (!readings.length || !readings.every((r) => recentPast(...r))) continue;
      if (g.between !== undefined && NO_WORDS_BETWEEN.test(g.between)) continue;
      if (OTHER_CLAUSE.test(sentenceBefore(ctx, m.index))) continue;
      // "will have visited" is a future perfect; the verb must be a base form.
      const inf = g.inf.toLowerCase();
      if (inf === "have" || !englishWordInfo(inf)?.verbs.some((v) => v.form === "base")) continue;
      const [start, end] = m.indices!.groups!.date;
      push(ctx, findings, start, end, [], "review_msg_past_date_future", m.index);
    }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishTenseConsistency"],
    detect: english(futureWordPastVerb, pastWordFutureVerb, futureDatePastVerb, pastDateFutureVerb),
  },
];
