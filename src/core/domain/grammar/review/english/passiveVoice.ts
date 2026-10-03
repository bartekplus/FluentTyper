import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { quotedMention } from "./grammarStyle1";

// stylePassiveVoice (optional): a form of "be" with a past participle ("was caused by", "is
// said to", "have been finalized"). A note, not a fix: turning it active needs the doer.

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const S = SPACE;
const ADVERB =
  "not|never|also|already|still|yet|often|always|usually|generally|commonly|widely|long|" +
  "previously|now|just|recently|partly|largely|mostly|entirely|being|[a-z]{3,}ly";
const PASSIVE = `(?<be>am|is|are|was|were|be|been|being|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)(?:${S}(?:${ADVERB})){0,3}${S}(?<p>[a-z]{3,})(?:${S}(?:up|out|down|off|over|away|back))?${WORD_END}(?<after>${S}(?:by|to|that)${WORD_END})?`;
// Participles that usually describe a state ("is closed", "was tired"): passive only with "by".
const STATIVE = new Set(
  (
    "closed located used interested married based required concerned involved supposed tired " +
    "excited bored worried pleased surprised satisfied disappointed scared finished done gone " +
    "dressed prepared divorced engaged retired qualified related situated equipped entitled " +
    "allowed accustomed aimed amazed annoyed ashamed confused convinced determined delighted " +
    "embarrassed exhausted frightened impressed known lost obliged opened pleased puzzled " +
    "relieved shocked stuck tied trained united crowded experienced advanced complicated " +
    "detailed limited mixed named needed noted organized organised paid parked registered " +
    "reserved fixed set covered filled packed broken"
  ).split(" "),
);
// Clause-taking verbs: "it is thought that", "he is said to".
const REPORTING = new Set(
  "said thought believed known considered expected reported claimed assumed estimated alleged shown found announced understood".split(
    " ",
  ),
);

type Finding = RawFinding;

function passives(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, PASSIVE, "be")) {
    const { p, after } = m.groups!;
    const read = englishWordInfo(p);
    if (!read?.verbs.some((v) => v.form === "participle") || ctx.dictionary.has(p)) continue;
    const link = after?.trim().toLowerCase() ?? "";
    const agent = link === "by";
    const reported = (link === "to" || link === "that") && REPORTING.has(p);
    if (!agent && !reported && (STATIVE.has(p) || read.adjective)) continue;
    // "is used to it", "are supposed to": set phrases, not passives.
    if (link === "to" && !reported) continue;
    const start = m.index;
    const end = m.index + m[0].length - (after?.length ?? 0);
    findings.push({
      ruleId: "stylePassiveVoice",
      messageKey: "review_msg_passive_voice",
      range: { start, end },
      alternatives: [],
      warningOnly: true,
    });
  }
  return findings;
}

/** English only; findings inside a quoted or parenthesized example are dropped. */
const english =
  (detect: (ctx: DetectContext) => Finding[]) =>
  (ctx: DetectContext): Finding[] =>
    ctx.lang !== "en_US" ? [] : detect(ctx).filter((f) => !quotedMention(ctx, f));

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["stylePassiveVoice"], detect: english(passives) },
];
