import { ENGLISH_COUNT_WORDS, hasCountPrefix } from "../implementations/helpers/EnglishNounNumber";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SPACE = "[ \\t\\u00a0]{1,8}";
const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
const END = `(?!${EDGE})(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`;
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
const NUMBER = `(?<count>${ENGLISH_COUNT_WORDS.slice(1).join("|")}|[1-9])${SPACE}(?:(?:important|essential|useful|unusual|observable|natural)${SPACE})?(?<noun>criterion|criteria|phenomenon|phenomena)${END}`;
const SPECIALIST =
  /\b(?:legal|law|court|criminal|judicial|indictment|prosecution|affidavit|writ|bank|banking|remittance|shipping|commercial|trade|patent|archaic|dialect|regional|terminology)\b/i;

/** Ordinary-prose frames only. Quantified mass nouns abstain; no invented amount or unit. */
export function countability(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const patterns = [
    ...MASS.map(({ noun, singular, frame }) => ({
      pattern: `${frame.replaceAll(" ", SPACE)}${SPACE}(?<noun>${noun})${END}`,
      singular,
    })),
    { pattern: NUMBER, singular: "" },
  ];
  for (const { pattern, singular } of patterns) {
    const regex = new RegExp(`(?<![.])(?<!${EDGE})${pattern}`, "gidu");
    regex.lastIndex = Math.max(0, ctx.from - 256);
    for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
      const [start, end] = m.indices!.groups!.noun;
      if (start < ctx.from || start >= ctx.to) continue;
      const noun = m.groups!.noun;
      if (noun !== noun.toLowerCase()) continue;
      const phraseEnd = m.index + m[0].length;
      if (/^\.[\p{L}\p{N}_]/u.test(ctx.text.slice(phraseEnd, phraseEnd + 2))) continue;
      const context = {
        start: Math.max(0, m.index - 128),
        end: Math.min(ctx.text.length, phraseEnd + 128),
      };
      const before = ctx.scanText.slice(context.start, m.index);
      // The whole bounded window is evidence, including specialist qualifiers after the noun.
      if (SPECIALIST.test(ctx.scanText.slice(context.start, context.end))) continue;
      if (
        /\b(?:write|type|spell|phrase|words?|example|literal|text|term|form|heading|title|label|says?|reads?)(?:[ \t]+(?:is|was))?[ :\t]*["“'‘][^\r\n\uFFFC]{0,80}$/i.test(
          before,
        )
      )
        continue;
      const count = m.groups!.count;
      if (count && hasCountPrefix(before)) continue;
      if (
        (m[0].match(/[A-Za-z]+/g) ?? []).some(
          (w) => ctx.dictionary.has(w.toLowerCase()) || applyWordCase(w, detectWordCase(w)) !== w,
        )
      )
        continue;
      const isOne = /^(?:one|1)$/i.test(count ?? "");
      const corrected =
        singular ||
        (/^criteri/.test(noun)
          ? isOne
            ? "criterion"
            : "criteria"
          : isOne
            ? "phenomenon"
            : "phenomena");
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
