import type { MatchFixer } from "../engine/reviewRules";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { found, group, hasUserOrCasedWord } from "./phraseTemplates";
import { hasCountPrefix } from "../implementations/helpers/EnglishNounNumber";

export const SPECIALIST =
  /\b(?:legal|law|court|criminal|judicial|indictment|prosecution|affidavit|writ|bank|banking|remittance|shipping|commercial|trade|patent|archaic|dialect|regional|terminology)\b/i;

// The mass nouns of the mass noun frames and their singular forms.
const MASS_SINGULAR: Readonly<Record<string, string>> = {
  informations: "information",
  advices: "advice",
  equipments: "equipment",
};

/**
 * The fixer of a countability template: the replacement in the casing of the target. A
 * template without a replacement only gives a warning; a specialist context abstains.
 */
const template =
  (replacement: string): MatchFixer =>
  (m, ctx, frame) => {
    if (hasUserOrCasedWord(ctx, m[0])) return null;
    const fix = replacement ? applyWordCase(replacement, detectWordCase(m.groups!.target)) : "";
    const finding = found(ctx, m, frame.ruleId, frame.messageKey, [fix]);
    if (SPECIALIST.test(ctx.text.slice(finding.context!.start, finding.context!.end))) return null;
    return fix ? finding : { ...finding, alternatives: [], warningOnly: true as const };
  };

/** The named frame fixes of the englishCountability frames of grammar/rules/common.yaml. */
export const FIXERS = {
  countWarning: template(""),
  countEquipment: template("equipment"),
  countData: template("data"),
  countCriteria: template("criteria"),
  // Ordinary-prose frames only. Quantified mass nouns abstain; no invented amount or unit.
  massNoun: (m, ctx) => {
    const [start, end] = group(m, "noun");
    const noun = m.groups!.noun;
    const singular = MASS_SINGULAR[noun] ?? "";
    if (noun !== noun.toLowerCase()) return null;
    const phraseEnd = m.index + m[0].length;
    const context = {
      start: Math.max(0, m.index - 128),
      end: Math.min(ctx.text.length, phraseEnd + 128),
    };
    const before = ctx.scanText.slice(context.start, m.index);
    // The whole bounded window is evidence, including specialist qualifiers after the noun.
    if (SPECIALIST.test(ctx.scanText.slice(context.start, context.end))) return null;
    const count = m.groups!.count;
    if (count && hasCountPrefix(before)) return null;
    if (hasUserOrCasedWord(ctx, m[0])) return null;
    const isOne = /^(?:one|1)$/i.test(count ?? "");
    const corrected = singular || noun.replace(/(?:on|a)$/, isOne ? "on" : "a");
    if (corrected === noun) return null;
    return {
      ruleId: "englishCountability",
      messageKey: singular ? "review_msg_mass_noun" : "review_msg_countable_number",
      range: { start, end },
      alternatives: [corrected],
      context,
    };
  },
} satisfies Record<string, MatchFixer>;
