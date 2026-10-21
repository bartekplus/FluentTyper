import { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import { englishWordInfo } from "../implementations/helpers/EnglishLexicon";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { atClauseStart } from "./englishParticiples";
import { group, nextLowerWord } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";
import type { ReviewMessageKey } from "./types";
import type { MatchFixer } from "../engine/reviewRules";

function finding(
  ctx: DetectContext,
  match: RegExpExecArray,
  ruleId: RawFinding["ruleId"],
  messageKey: ReviewMessageKey,
  replacement: string,
): RawFinding | null {
  const target = match.groups!.target;
  if (ctx.dictionary.has(target.toLowerCase())) return null;
  if (applyWordCase(target, detectWordCase(target)) !== target) return null;
  const [start, end] = group(match, "target");
  const phraseEnd = match.index + match[0].length;
  return {
    ruleId,
    messageKey,
    range: { start, end },
    alternatives: [applyWordCase(replacement, detectWordCase(target))],
    context: {
      start: Math.max(0, match.index - 96),
      end: Math.min(ctx.text.length, phraseEnd + 10),
    },
  };
}

// Stricter than EnglishRuleShared's opensClause: a comma opens a clause only
// with "and", "but" or "so" after it, and dashes, [ and { never do.
const opensMainClause = (ctx: DetectContext, index: number) =>
  /(?:^|[.!?;:\n"“(][ \t ]*|,[ \t ]*(?:and|but|so)[ \t ]+)$/i.test(
    ctx.text.slice(Math.max(0, index - 96), index),
  );
// Words after which a new clause (and so a subject) starts.
const CLAUSE_CUE =
  "(?:think|thought|guess|hope|know|knew|heard|suspect|promise|realized|realised|said|says|sure|maybe|perhaps|because|since|if|when|as|before|after|that|(?:looks|seems|sounds|feels)[ \\t\\u00a0]+like|(?:tell|told|remind|reminded)[ \\t\\u00a0]+them)";
// Finite verbs that show a "their going to…" clause is a gerund subject ("…surprised me").
// "going to" needs the rest of its clause as plain words on the same line.
const PLAIN_CLAUSE = /^(?:[ \t\u00a0]{1,8}[A-Za-z'’]+)+(?=[ \t\u00a0]*(?:[.!?,;:)]|$))/;
const LATER_PREDICATE =
  /^[^.!?;:,\n]*?\b(?:is|was|are|were|has|had|surprised|upset|made|caused|seemed|became|annoyed|worried|shocked|pleased|helped|meant|took|cost|lasted|went|felt|looked)\b/i;
const CUED = new RegExp(`\\b${CLAUSE_CUE}[ \\t\\u00a0]+$`, "i");
const cued = (ctx: DetectContext, index: number) =>
  CUED.test(ctx.text.slice(Math.max(0, index - 96), index));
/** Where "your"/"their" at `index` would open a clause, the you're/they're frames own it. */
export const opensSubjectClause = (ctx: DetectContext, index: number) =>
  opensMainClause(ctx, index) || cued(ctx, index);
const PREPOSITION =
  "(?:of|for|about|with|from|into|onto|at|by|against|between|among|without|toward|towards|under|through|during|despite|to|on|in)";
// Only intransitive place verbs before a clause end: "They left their." may be "theirs".
const PLACE_END =
  /^(?:been|go|goes|went|gone|going|stay|stayed|staying|stand|standing|sit|sitting|live|lived|wait|waited|waiting|sat|stood|park|paused|stop|stopped|safer|over|right|up|down|out)$/i;

/**
 * A clause-opening "their"/"your" frame that reads "they're"/"you're": no "right to", and no
 * later predicate after "going (to)" or "X not".
 */
function opensPredicate(ctx: DetectContext, match: RegExpExecArray): boolean {
  if (!opensSubjectClause(ctx, match.index)) return false;
  // "Your A grade", "Their A team": a capital letter after the possessive is a name or grade.
  if (/(?:^|[^\p{L}])An?$/u.test(match[0]) && !/^(?:YOUR|THEIR)$/.test(match.groups!.target))
    return false;
  const { pred, follow } = match.groups!;
  if (pred === "right" && follow === "to") return false;
  const end = match.index + match[0].length;
  const going = /^(?:going|gonna)$/i.test(pred ?? "");
  if (
    (going || /^\w+\s+not\b/i.test(match[0])) &&
    LATER_PREDICATE.test(ctx.text.slice(end, end + 96))
  )
    return false;
  return !going || PLAIN_CLAUSE.test(ctx.text.slice(end, end + 200));
}

/** A finding unless the evidence holds an identifier or a name ("versionName"). */
function degreeFinding(
  ctx: DetectContext,
  match: RegExpExecArray,
  ruleId: RawFinding["ruleId"],
  key: ReviewMessageKey,
  replacement: string,
): RawFinding | null {
  if ((match[0].match(/\p{L}+/gu) ?? []).some((w) => /\p{Ll}\p{Lu}/u.test(w))) return null;
  return finding(ctx, match, ruleId, key, replacement);
}

/** The fixer of a frame with one fix. */
const fixedBy =
  (ruleId: RawFinding["ruleId"], key: ReviewMessageKey, replacement: string): MatchFixer =>
  (match, ctx) =>
    finding(ctx, match, ruleId, key, replacement);

/** The fixer of a then/than, to/too or were/where frame with one fix. */
const degreeBy =
  (ruleId: RawFinding["ruleId"], key: ReviewMessageKey, replacement: string): MatchFixer =>
  (match, ctx) =>
    degreeFinding(ctx, match, ruleId, key, replacement);

/** "going to" after your (you're) or their/there (they're), at a clause start. */
const goingTo =
  (your: boolean): MatchFixer =>
  (match, ctx) => {
    if (!atClauseStart(ctx.text, match.index)) return null;
    if ((match.groups!.target.toLowerCase() === "your") !== your) return null;
    return your
      ? finding(ctx, match, "englishYourYouAre", "review_msg_your_you_are", "you're")
      : finding(ctx, match, "englishTheirThereTheyAre", "review_msg_they_are", "they're");
  };

/** The named frame fixes of the wordConfusions frames of grammar/rules/common.yaml. */
export const FIXERS = {
  thenThan: fixedBy("englishThenThan", "review_msg_then_than", "than"),
  goingToYour: goingTo(true),
  goingToTheir: goingTo(false),
  youreOwn: fixedBy("englishYourYouAre", "review_msg_your_possessive", "your"),
  toTooAdjective: fixedBy("englishToToo", "review_msg_to_too", "too"),
  thereBe: (match, ctx) =>
    opensSubjectClause(ctx, match.index)
      ? finding(ctx, match, "englishTheirThereTheyAre", "review_msg_their_there", "there")
      : null,
  theresA: fixedBy("englishTheirThereTheyAre", "review_msg_their_there", "there's"),
  thereLocation: (match, ctx) =>
    match.groups!.end === undefined || PLACE_END.test(match.groups!.verb)
      ? finding(ctx, match, "englishTheirThereTheyAre", "review_msg_their_there", "there")
      : null,
  theyAre: (match, ctx) =>
    opensPredicate(ctx, match)
      ? finding(ctx, match, "englishTheirThereTheyAre", "review_msg_they_are", "they're")
      : null,
  thereBeforePlace: (match, ctx) =>
    opensMainClause(ctx, match.index)
      ? null
      : finding(ctx, match, "englishTheirThereTheyAre", "review_msg_their_there", "there"),
  theirPossessive: fixedBy("englishTheirThereTheyAre", "review_msg_their_possessive", "their"),
  theirOwn: (match, ctx) =>
    !/^there$/i.test(match.groups!.target) ||
    opensMainClause(ctx, match.index) ||
    new RegExp(
      `(?:\\b${PREPOSITION}|ing|\\bto[ \\t\\u00a0]+[a-z]+|\\b(?:create|creates|created|make|makes|made|have|has|had|get|gets|got|build|builds|built|find|found|choose|chose|bring|brought|use|uses|used|pay|paid|run|runs|ran|do|does|did|manage|managed|keep|keeps|kept|set|sets|write|wrote|host|hosted|provide|provides|provided|become|became|define|defined|pick|picks|picked|want|wants|wanted|need|needs|needed|take|takes|took|brings|like|likes|prefer|prefers|love|loves)|\\b(?:check|checked|reset|update|updated|save|saved|change|changed|remember|remembered|forgot|entered|lost))[ \\t\\u00a0]+$`,
      "i",
    ).test(ctx.text.slice(Math.max(0, match.index - 96), match.index))
      ? finding(ctx, match, "englishTheirThereTheyAre", "review_msg_their_possessive", "their")
      : null,
  thenComparison: (match, ctx) => {
    const conditional = (match: RegExpExecArray) =>
      /\b(?:if|when|once|unless|after|before|until)\b[^.!?;:\n]*$/i.test(
        ctx.text.slice(Math.max(0, match.index - 96), match.index),
      );
    return conditional(match)
      ? null
      : degreeFinding(ctx, match, "englishThenThan", "review_msg_then_than", "than");
  },
  thanTemporal: degreeBy("englishThenThan", "review_msg_then_than_temporal", "then"),
  youAre: (match, ctx) =>
    opensPredicate(ctx, match)
      ? degreeFinding(ctx, match, "englishYourYouAre", "review_msg_your_you_are", "you're")
      : null,
  toTooDegree: degreeBy("englishToToo", "review_msg_to_too", "too"),
  tooBeforeDeterminer: degreeBy("englishToToo", "review_msg_to_infinitive", "to"),
  tooBeforeVerb: (match, ctx) => {
    if (/^\p{Lu}/u.test(match.groups!.middle ?? "")) return null;
    const verb = match.groups!.verb.toLowerCase();
    const forms = englishVerbForms(verb);
    const info = forms ? null : englishWordInfo(verb);
    // "has too darn many ads": a degree word follows, so "too" is the adverb.
    if (
      !forms &&
      /^(?:many|much|few|more|less|little)$/i.test(
        nextLowerWord(ctx, match.index + match[0].length),
      )
    )
      return null;
    // A regular verb only when no adjective or adverb reading fits "too" ("too slow", "too long").
    if (
      verb === "be" ||
      (forms?.lemma === verb && !forms.ambiguous.includes(verb)) ||
      (info?.verbs.some((v) => v.form === "base") && !info.adjective && !info.adverb)
    )
      return degreeFinding(ctx, match, "englishToToo", "review_msg_to_infinitive", "to");
    return null;
  },
  wereSubject: (match, ctx) => {
    const before = ctx.text.slice(Math.max(0, match.index - 96), match.index);
    // "…show you where the exit is", "I know you where…": an object "you" before where.
    if (
      /\b(?:show|showed|shown|tell|told|ask|asked|know|knew|see|saw|remind|reminded|guide|guided|take|took)[ \t\u00a0]+$/i.test(
        before,
      )
    )
      return null;
    return degreeFinding(ctx, match, "englishWereWhere", "review_msg_were_where", "were");
  },
  whereClause: degreeBy("englishWereWhere", "review_msg_were_where", "where"),
} satisfies Record<string, MatchFixer>;
