import {
  COMPLETE,
  detectPhraseTemplates,
  EDGE,
  frameMatches,
  group,
  hasUserOrCasedWord,
  type PhraseTemplate,
  SPACE,
} from "./phraseTemplates";
import { ENGLISH_COUNT_WORDS, hasCountPrefix } from "../implementations/helpers/EnglishNounNumber";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const MASS = [
  {
    noun: "informations",
    singular: "information",
    frame:
      "(?:the|this) (?:page|guide|report|document) (?:contains|provides|includes) (?:useful|helpful|important|relevant|detailed|additional)",
  },
  {
    noun: "advices",
    singular: "advice",
    frame:
      "(?:thanks for|thank you for|we appreciate|I appreciate) (?:the|your) (?:helpful|useful|practical|valuable|thoughtful|excellent)",
  },
  {
    noun: "equipments",
    singular: "equipment",
    frame:
      "(?:we|they|you) (?:need|use|bought|ordered|checked|tested) (?:the|our|your) (?:new|old|necessary|available|basic|standard)",
  },
] as const;
const NUMBER = `(?<count>${ENGLISH_COUNT_WORDS.slice(1).join("|")}|[1-9])${SPACE}(?:(?:important|essential|useful|unusual|observable|natural)${SPACE})?(?<noun>criterion|criteria|phenomenon|phenomena)${COMPLETE}`;
export const SPECIALIST =
  /\b(?:legal|law|court|criminal|judicial|indictment|prosecution|affidavit|writ|bank|banking|remittance|shipping|commercial|trade|patent|archaic|dialect|regional|terminology)\b/i;

/** Ordinary-prose frames only. Quantified mass nouns abstain; no invented amount or unit. */
export function countability(ctx: DetectContext): RawFinding[] {
  // A template without a replacement only gives a warning.
  const findings: RawFinding[] = detectPhraseTemplates(
    ctx,
    [
      ...[
        `(?:we|they)${SPACE}received${SPACE}(?<target>many${SPACE}(?:useful${SPACE})?feedbacks)${SPACE}from${SPACE}(?:our|their)${SPACE}users(?:${COMPLETE}|${SPACE}and${SPACE})`,
        `(?:and|received)${SPACE}(?<target>several${SPACE}(?:important${SPACE})?informations)${SPACE}from${SPACE}the${SPACE}testing${SPACE}team${COMPLETE}`,
        `gave${SPACE}us${SPACE}(?<target>(?:two|three|four|[2-9])${SPACE}advices)${SPACE}about${SPACE}the${SPACE}user${SPACE}interface(?!${EDGE})`,
        `(?:received|provides?|suggests?)${SPACE}(?<target>a${SPACE}information)${COMPLETE}`,
      ].map((pattern): PhraseTemplate => ({
        pattern,
        replacement: "",
        messageKey: "review_msg_contextual_grammar",
      })),
      {
        pattern: `(?:buy|need)${SPACE}new${SPACE}(?<target>equipments)${SPACE}for${SPACE}the${SPACE}(?:laboratory|office)${COMPLETE}`,
        replacement: "equipment",
        messageKey: "review_msg_mass_noun",
      },
      {
        pattern: `all${SPACE}the${SPACE}(?<target>datas)${SPACE}collected${SPACE}during${SPACE}(?:previous${SPACE})?tests(?!${EDGE})`,
        replacement: "data",
        messageKey: "review_msg_contextual_grammar",
      },
      {
        pattern: `which${SPACE}(?<target>criterias)${SPACE}should${SPACE}be${SPACE}used${COMPLETE}`,
        replacement: "criteria",
        messageKey: "review_msg_contextual_grammar",
      },
    ],
    "englishCountability",
  )
    .filter((d) => !SPECIALIST.test(ctx.text.slice(d.context!.start, d.context!.end)))
    .map((d) => (d.alternatives[0] ? d : { ...d, alternatives: [], warningOnly: true as const }));
  const patterns = [
    ...MASS.map(({ noun, singular, frame }) => ({
      pattern: `${frame.replaceAll(" ", SPACE)}${SPACE}(?<noun>${noun})${COMPLETE}`,
      singular,
    })),
    { pattern: NUMBER, singular: "" },
  ];
  for (const { pattern, singular } of patterns) {
    for (const m of frameMatches(ctx, pattern, "noun")) {
      const [start, end] = group(m, "noun");
      const noun = m.groups!.noun;
      if (noun !== noun.toLowerCase()) continue;
      const phraseEnd = m.index + m[0].length;
      const context = {
        start: Math.max(0, m.index - 128),
        end: Math.min(ctx.text.length, phraseEnd + 128),
      };
      const before = ctx.scanText.slice(context.start, m.index);
      // The whole bounded window is evidence, including specialist qualifiers after the noun.
      if (SPECIALIST.test(ctx.scanText.slice(context.start, context.end))) continue;
      const count = m.groups!.count;
      if (count && hasCountPrefix(before)) continue;
      if (hasUserOrCasedWord(ctx, m[0])) continue;
      const isOne = /^(?:one|1)$/i.test(count ?? "");
      const corrected = singular || noun.replace(/(?:on|a)$/, isOne ? "on" : "a");
      if (corrected === noun) continue;
      findings.push({
        ruleId: "englishCountability",
        messageKey: singular ? "review_msg_mass_noun" : "review_msg_countable_number",
        range: { start, end },
        alternatives: [corrected],
        context,
      });
    }
  }
  return findings;
}
