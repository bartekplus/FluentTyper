import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import {
  COMPLETE,
  frameMatches,
  hasUserOrCasedWord,
  SPACE,
  WORD_END as END_WORD,
} from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";
const SUBJECT = "(?:I|you|we|they|he|she)";
const DAILY = [
  "(?:use|uses|used) this tool",
  "(?:check|checks|checked) the report",
  "(?:read|reads) the file",
  "(?:open|opens|opened) the app",
  "(?:visit|visits|visited) the office",
  "(?:review|reviews|reviewed) the plan",
  "(?:test|tests|tested) the device",
  "(?:work|works|worked) (?:here|remotely)",
  "(?:walk|walks|walked) home",
  "(?:run|runs|ran) the tests",
  "(?:write|writes|wrote) code",
  "(?:send|sends|sent) the report",
]
  .map((p) => p.replaceAll(" ", SPACE))
  .join("|");
const templates: ReadonlyArray<{
  pattern: string;
  replacement: string;
  messageKey: RawFinding["messageKey"];
}> = [
  {
    pattern: `(?:tested|checked|reviewed)${SPACE}(?<target>aswell)${COMPLETE}`,
    replacement: "as well",
    messageKey: "review_msg_contextual_grammar",
  },
  {
    pattern: `${SUBJECT}${SPACE}(?:${DAILY})${SPACE}(?<target>everyday)${COMPLETE}`,
    replacement: "every day",
    messageKey: "review_msg_every_day",
  },
  // Adverb after a lowercase verb or object, before a clause end or a linking word.
  {
    pattern: `(?<!\\b(?:the|an?|word|is|are|was|were|be|so|very|quite|more|most|less|such|of|called|named|my|your|our|their|his|her|its)${SPACE})(?<=[a-z]${SPACE})(?<target>everyday)(?=[ \t ]{0,8}(?:[.!?,;:)]|$)|${SPACE}(?:without|and|but|so|at|in|for|until|while|since|now|anyway)${END_WORD})`,
    replacement: "every day",
    messageKey: "review_msg_every_day",
  },
  {
    pattern: `each${SPACE}and${SPACE}(?<target>everyday)${END_WORD}`,
    replacement: "every day",
    messageKey: "review_msg_every_day",
  },
  // Adjective before a listed noun after a determiner: "an every day thing".
  {
    pattern: `(?:a|an|the|my|our|your|their|his|her|its|of|in|for|beyond|these|those|such|and)${SPACE}(?<target>every${SPACE}day)${SPACE}(?:life|thing|things|problem|routine|routines|use|items|objects|language|tasks|activities|situations|problems|clothes|people|essentials|conversation|conversations|basis|tools|work)${END_WORD}`,
    replacement: "everyday",
    messageKey: "review_msg_everyday_adjective",
  },
];
/** Only curated grammatical slots; dictionary membership never determines compound boundaries. */
export function contextualCompounds(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { pattern, replacement, messageKey } of templates) {
    for (const m of frameMatches(ctx, pattern)) {
      const [start, end] = m.indices!.groups!.target;
      if (m.groups!.target !== m.groups!.target.toLowerCase()) continue;
      const phraseEnd = m.index + m[0].length;
      if (hasUserOrCasedWord(ctx, m[0])) continue;
      if (findings.some((f) => f.range.start === start)) continue;
      findings.push({
        ruleId: "englishContextualCompounds",
        messageKey,
        range: { start, end },
        alternatives: [applyWordCase(replacement, detectWordCase(m.groups!.target))],
        context: {
          start: Math.max(0, m.index - 96),
          end: Math.min(ctx.text.length, phraseEnd + 9),
        },
      });
    }
  }
  return findings;
}
