import {
  COMPLETE as END,
  detectPhraseTemplates,
  EDGE,
  SPACE,
  type PhraseTemplate,
} from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SUBJECT = `(?:(?:this|that|the)${SPACE}(?:(?:new|old|latest)${SPACE})?(?:feature|idea|story|proposal|question|book|article|design|project|topic)|it)`;
const templates: readonly PhraseTemplate[] = [
  {
    pattern: `(?:we|I|they)${SPACE}(?:finally${SPACE})?(?<target>finded)${SPACE}the${SPACE}(?:problem|bug|issue)${END}`,
    replacement: "found",
    messageKey: "review_msg_contextual_grammar",
  },

  ...(
    [
      [
        `(?:do${SPACE}you${SPACE}know|can${SPACE}you${SPACE}tell${SPACE}me|I${SPACE}wonder)${SPACE}where${SPACE}(?<target>is${SPACE}the${SPACE}configuration${SPACE}file)${END}`,
        "the configuration file is",
      ],
      [
        `(?:do${SPACE}you${SPACE}know|can${SPACE}you${SPACE}tell${SPACE}me|I${SPACE}wonder)${SPACE}why${SPACE}(?<target>did${SPACE}the${SPACE}process${SPACE}crash)${END}`,
        "the process crashed",
      ],
      [
        `(?:do${SPACE}you${SPACE}know|can${SPACE}you${SPACE}tell${SPACE}me|I${SPACE}wonder)${SPACE}what${SPACE}(?<target>does${SPACE}this${SPACE}option${SPACE}do)${END}`,
        "this option does",
      ],
      [
        `(?:nobody|no${SPACE}one)${SPACE}knows${SPACE}when${SPACE}(?<target>will${SPACE}the${SPACE}new${SPACE}version${SPACE}be${SPACE}released)${END}`,
        "the new version will be released",
      ],
      [`between${SPACE}(?<target>you${SPACE}and${SPACE}I)(?=,)`, "you and me"],
      [
        `(?:a|the)${SPACE}(?:(?:big|large|small|positive|negative)${SPACE})?(?<target>affect)${SPACE}on${SPACE}(?:performance|stability|the${SPACE}(?:results|system))${END}`,
        "effect",
      ],
      [
        `(?:know|knows|wonder|wondered)${SPACE}(?<target>weather)${SPACE}(?:they|we|you)${SPACE}will${SPACE}(?:finish|complete)${SPACE}it(?:${SPACE}today)?${END}`,
        "whether",
      ],
      [
        `(?:developer|user|person)${SPACE}(?<target>who['’]s)${SPACE}(?:laptop|computer|phone)${SPACE}(?:crashed|broke)${SPACE}(?:said|reported)(?!${EDGE})`,
        "whose",
      ],
      [`(?:by|with)${SPACE}a${SPACE}(?<target>lose)${SPACE}(?:cable|connection)${END}`, "loose"],
      [
        `(?:intuitive|simple|clear),?${SPACE}(?<target>accept)${SPACE}for${SPACE}the${SPACE}(?:(?:advanced|new)${SPACE})?(?:settings|options)${SPACE}page${END}`,
        "except",
      ],
    ] as const
  ).map(([pattern, replacement]) => ({
    pattern,
    replacement,
    messageKey: "review_msg_contextual_grammar" as const,
  })),
  // A negated verb already carries the negation: "didn't have no idea" -> "any".
  {
    pattern: `(?:didn['’]t|did${SPACE}not|don['’]t|do${SPACE}not|doesn['’]t|does${SPACE}not|can['’]t|cannot|couldn['’]t|won['’]t|wouldn['’]t|never)${SPACE}(?:have|had|want|make|get|need|see|know|do|give|find|hear|feel|mean|show)${SPACE}(?<target>no)${SPACE}(?!(?:one|longer|matter|more|less|doubt|further|sooner|way|thanks)(?!${EDGE}))[a-z]+(?!${EDGE})`,
    replacement: "any",
    messageKey: "review_msg_double_negative",
  },
  // "few days ago" without "a" reads as "hardly any"; the time phrase means "a few".
  {
    pattern: `(?<!(?:a|very|quite|only|the|so|too|these|those|last|first|past|next|fewer|precious|relatively)${SPACE})(?<target>few)${SPACE}(?:seconds?|minutes?|hours?|days?|weeks?|weekends?|months?|years?|decades?|ms)${SPACE}ago(?!${EDGE})`,
    replacement: "a few",
    messageKey: "review_msg_a_few",
  },
  {
    pattern: `for${SPACE}all${SPACE}(?<target>intensive)${SPACE}purposes,${SPACE}(?:the|this|that)${SPACE}(?:test|project|work|task|report|plan|design|review|process|document|proposal|update)${SPACE}(?:is|was)${SPACE}(?:complete|finished|ready|done|final|successful)${END}`,
    replacement: "intents and",
    messageKey: "review_msg_intents_purposes",
  },
  {
    pattern: `(?:they|we|these|those|(?:the|these|those)${SPACE}two${SPACE}(?:things|people|files|documents|reports|plans|ideas|options))${SPACE}(?:are|were)${SPACE}one${SPACE}(?<target>in)${SPACE}the${SPACE}same${END}`,
    replacement: "and",
    messageKey: "review_msg_one_same",
  },
  ...(
    [
      ["peaked", "piqued"],
      ["peaks", "piques"],
      ["peak", "pique"],
      ["peaking", "piquing"],
    ] as const
  ).map(([form, replacement]) => ({
    pattern: `${SUBJECT}${SPACE}${form === "peak" ? `(?:can|will|could|should|may|might)${SPACE}` : form === "peaking" ? `(?:is|was)${SPACE}` : ""}(?<target>${form})${SPACE}(?:my|your|his|her|our|their)${SPACE}interest${END}`,
    replacement,
    messageKey: "review_msg_pique_interest" as const,
  })),
];

/** Conventional meanings only; unknown metaphors and literal peak constructions abstain. */
export function usagePhrases(ctx: DetectContext): RawFinding[] {
  return detectPhraseTemplates(ctx, templates, "englishUsagePhrases").filter(
    (finding) =>
      !/\b(?:metaphor|poetic|creative|deliberate|deliberately|dialect|invented)\b/i.test(
        ctx.scanText.slice(finding.context!.start, finding.context!.end),
      ),
  );
}
