import {
  englishLexiconInflect,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import { ENGLISH_VERB_FORMS } from "../../implementations/helpers/EnglishVerbForms";
import { dateSide, dayCount, recentPast } from "../reviewClock";
import { hasUserOrCasedWord } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import {
  DETERMINERS,
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
// the Review clock. The frames are in grammar/rules/en.yaml.

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
  start: number,
  end: number,
  alternatives: string[],
  messageKey:
    "review_msg_tense_time_word" | "review_msg_future_date_past" | "review_msg_past_date_future",
  from: number,
): RawFinding {
  return finding("englishTenseConsistency", messageKey, start, end, alternatives, {
    // The time word may be the slip instead: nothing is preselected.
    ...(alternatives.length ? { requiresChoice: true as const } : { warningOnly: true as const }),
    context: evidence(ctx, from, end),
  });
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

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

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  /** "Tomorrow we visited", "We visited them tomorrow": the future asks for "will". */
  tenseFutureWordPastVerb: (m, ctx) => {
    const target = m.groups!.target;
    const lemma = pastOnly(target);
    if (!lemma || hasUserOrCasedWord(ctx, target)) return null;
    const between = m.groups!.between;
    if (between !== undefined) {
      if (NO_WORDS_BETWEEN.test(between)) return null;
      if (!objectBefore(ctx, m.indices!.groups!.when[0])) return null;
    }
    if (OTHER_CLAUSE.test(sentenceBefore(ctx, m.index))) return null;
    const [start, end] = m.indices!.groups!.target;
    return push(ctx, start, end, [`will ${lemma}`], "review_msg_tense_time_word", m.index);
  },
  /** "Yesterday I will call him", "We will call him two days ago": the past asks for the past. */
  tensePastWordFutureVerb: (m, ctx) => {
    const { verb, between } = m.groups!;
    const past = pastOf(verb.toLowerCase());
    if (!past || hasUserOrCasedWord(ctx, m.groups!.target)) return null;
    if (between !== undefined) {
      if (NO_WORDS_BETWEEN.test(between)) return null;
      if (!objectBefore(ctx, m.indices!.groups!.when[0])) return null;
    }
    if (OTHER_CLAUSE.test(sentenceBefore(ctx, m.index))) return null;
    const [typed, end] = m.indices!.groups!.target;
    // "we'll call": the contraction's apostrophe goes too.
    const contracted = /['’]$/.test(ctx.text.slice(typed - 1, typed));
    const start = contracted ? typed - 1 : typed;
    const fixed = contracted ? ` ${past}` : past;
    return push(ctx, start, end, [fixed], "review_msg_tense_time_word", m.index);
  },
  /** "We visited the client on 27/10/2090": a past verb on a date that is still to come. */
  tenseFutureDatePastVerb: (m, ctx) => {
    const g = m.groups!;
    // Every reading is more than a day after today on the Review clock.
    const readings = dateReadings(g);
    if (!readings.length || readings.some((r) => dateSide(...r) !== "future")) return null;
    if (g.between !== undefined && NO_WORDS_BETWEEN.test(g.between)) return null;
    if (OTHER_CLAUSE.test(sentenceBefore(ctx, m.index))) return null;
    const word = (g.part ?? g.simple).toLowerCase();
    const read = englishWordInfo(word);
    const past = g.part
      ? // "have visited", but "will have visited" stays future.
        read?.verbs.some((v) => v.form === "participle" && !ARRANGING.test(v.lemma)) &&
        !/\b(?:will|shall|would|'ll)\s*$/i.test(
          ctx.text.slice(Math.max(0, m.indices!.groups!.verb[0] - 12), m.indices!.groups!.verb[0]),
        )
      : !!pastOnly(word);
    if (!past) return null;
    const [start, end] = m.indices!.groups!.date;
    return push(ctx, start, end, [], "review_msg_future_date_past", m.index);
  },
  /**
   * "We will visit the client on 27/10/2025" when that date has passed: a future verb on a past
   * date. Only a date of the last three years: older dates are history, which can use "will" for
   * the future in the past.
   */
  tensePastDateFutureVerb: (m, ctx) => {
    const g = m.groups!;
    const readings = dateReadings(g);
    if (!readings.length || !readings.every((r) => recentPast(...r))) return null;
    if (g.between !== undefined && NO_WORDS_BETWEEN.test(g.between)) return null;
    if (OTHER_CLAUSE.test(sentenceBefore(ctx, m.index))) return null;
    // "will have visited" is a future perfect; the verb must be a base form.
    const inf = g.inf.toLowerCase();
    if (inf === "have" || !englishWordInfo(inf)?.verbs.some((v) => v.form === "base")) return null;
    const [start, end] = m.indices!.groups!.date;
    return push(ctx, start, end, [], "review_msg_past_date_future", m.index);
  },
} satisfies Record<string, MatchFixer>;
