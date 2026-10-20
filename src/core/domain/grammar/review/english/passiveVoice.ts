import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { MatchFixer } from "../../engine/reviewRules";
import { finding } from "../finding";

// stylePassiveVoice (optional): a form of "be" with a past participle ("was caused by", "is
// said to", "have been finalized"). A note, not a fix: turning it active needs the doer.

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

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  stylePassive: (m, ctx) => {
    const { p, after } = m.groups!;
    const read = englishWordInfo(p);
    if (!read?.verbs.some((v) => v.form === "participle") || ctx.dictionary.has(p)) return null;
    const link = after?.trim().toLowerCase() ?? "";
    const agent = link === "by";
    const reported = (link === "to" || link === "that") && REPORTING.has(p);
    if (!agent && !reported && (STATIVE.has(p) || read.adjective)) return null;
    // "is used to it", "are supposed to": set phrases, not passives.
    if (link === "to" && !reported) return null;
    const start = m.index;
    const end = m.index + m[0].length - (after?.length ?? 0);
    return finding("stylePassiveVoice", "review_msg_passive_voice", start, end, [], {
      warningOnly: true,
    });
  },
} satisfies Record<string, MatchFixer>;
