import { detectPhraseTemplates, type PhraseTemplate } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SPACE = "[ \\t\\u00a0]{1,8}";
const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
const COMPLETE = `(?!${EDGE})(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`;
const ADJUNCT = `(?:${SPACE}during${SPACE}(?:the|our|their)${SPACE}(?:meeting|test|review))?`;
const TOPIC = `(?:the|this|that|our|your|their)${SPACE}(?:(?:new|old|current|latest|proposed)${SPACE})?(?:release|plan|report|problem|proposal|results|schedule|budget|design|issue|changes|project)`;
const SUBJECT = "(?:I|you|we|they|he|she|it)";
const templates: readonly PhraseTemplate[] = [
  ...(
    [
      [
        `${SUBJECT}${SPACE}(?:is|are|am|was|were)${SPACE}responsible${SPACE}(?<target>of)${SPACE}(?:testing|checking|building)${SPACE}the${SPACE}(?:(?:Windows|Linux)${SPACE})?(?:version|build|application)${COMPLETE}`,
        "for",
      ],
      [
        `${SUBJECT}${SPACE}(?:have|has)${SPACE}(?:been${SPACE}(?:working|living)|worked|lived)${SPACE}here${SPACE}(?<target>since)${SPACE}(?:two|three|four|five|[2-9])${SPACE}(?:years|months|weeks)${COMPLETE}`,
        "for",
      ],
      [
        `${SUBJECT}${SPACE}(?:have|has)${SPACE}(?:been${SPACE}(?:working|living)|worked|lived)${SPACE}here${SPACE}(?<target>from)${SPACE}(?:19|20)[0-9]{2}${COMPLETE}`,
        "since",
      ],
      [
        `${SUBJECT}${SPACE}arrived${SPACE}(?<target>to)${SPACE}the${SPACE}(?:office|station|airport|hotel)(?:${SPACE}at${SPACE}[0-9]{1,2}:[0-9]{2})?${COMPLETE}`,
        "at",
      ],
      [
        `(?:${SUBJECT}${SPACE}|and${SPACE})waited${SPACE}(?<target>the)${SPACE}(?:manager|developer|teacher)(?:${SPACE}for${SPACE}(?:nearly${SPACE})?[0-9]{1,3}${SPACE}minutes)?${COMPLETE}`,
        "for the",
      ],
      [
        `(?:to|will|should)${SPACE}investigate${SPACE}(?<target>on${SPACE})(?:it|the${SPACE}(?:issue|problem))(?:${SPACE}later)?${COMPLETE}`,
        "",
      ],
    ] as const
  ).map(([pattern, replacement]) => ({
    pattern,
    replacement,
    messageKey: "review_msg_contextual_grammar" as const,
  })),
  // A length of time after "since" ("since two weeks") is a duration: "for two weeks".
  {
    pattern: `(?<target>since)${SPACE}(?:(?:over|more${SPACE}than|almost|nearly|about)${SPACE})?(?:two|three|four|five|six|seven|eight|nine|ten|twelve|several|many|a${SPACE}few|[0-9]{1,3})${SPACE}(?:seconds|minutes|hours|days|weeks|months|years|decades)(?!${EDGE})(?=[ \t ]{0,8}(?:[.!?,;:)]|$)|${SPACE}(?:now|already|without|with|in|on|at|and|but|so|straight)(?!${EDGE}))`,
    replacement: "for",
    messageKey: "review_msg_since_duration",
  },
  {
    pattern: `despite${SPACE}(?<target>of${SPACE})(?:the|this|that)${SPACE}(?:(?:long|heavy|loud|bad|high|unexpected)${SPACE})?(?:delay|rain|noise|weather|problem|warning|risk|cost|pressure|heat|cold|traffic)${COMPLETE}`,
    replacement: "",
    messageKey: "review_msg_despite_of",
  },
  {
    pattern: `(?:${SUBJECT}${SPACE}(?:discuss|discussed|discusses|(?:am|is|are|was|were)${SPACE}discussing)|please${SPACE}discuss)${SPACE}(?<target>about${SPACE})${TOPIC}${ADJUNCT}(?:${COMPLETE}|${SPACE}(?:and|but)(?=${SPACE}))`,
    replacement: "",
    messageKey: "review_msg_discuss_about",
  },
  {
    pattern: `${SUBJECT}${SPACE}(?:am|is|are|was|were)${SPACE}interested${SPACE}(?<target>on)${SPACE}(?:learning${SPACE}(?:Rust|English|French|German|Spanish|Python|TypeScript)|writing${SPACE}code|reading${SPACE}books|playing${SPACE}chess|building${SPACE}apps|testing${SPACE}software|checking${SPACE}(?:the|our)${SPACE}(?:(?:Linux|Windows)${SPACE})?(?:build|version)|${TOPIC})${COMPLETE}`,
    replacement: "in",
    messageKey: "review_msg_interested_on",
  },
];

export function fixedPrepositions(ctx: DetectContext): RawFinding[] {
  return detectPhraseTemplates(ctx, templates, "englishFixedPrepositions");
}
