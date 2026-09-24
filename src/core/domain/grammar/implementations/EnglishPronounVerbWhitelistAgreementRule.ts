import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { matchTrailingEnglishPhrase } from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

const AGREEMENT_REGEX = /\b(i\s+is|i\s+has|you\s+was|(he|she|it)\s+are)(\s+\S+)$/i;
const AGREEMENT_CORRECTIONS = new Map([
  ["i is", "i am"],
  ["i has", "i have"],
  ["you was", "you were"],
  ["he are", "he is"],
  ["she are", "she is"],
  ["it are", "it is"],
]);

export class EnglishPronounVerbWhitelistAgreementRule implements GrammarRule {
  readonly id = "englishPronounVerbWhitelistAgreement" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const matched = matchTrailingEnglishPhrase(context, AGREEMENT_REGEX);
    if (!matched) {
      return null;
    }
    const { boundary: boundaryContext, match, phraseStart } = matched;
    const phrase = match[1];

    const corrected = AGREEMENT_CORRECTIONS.get(phrase.toLowerCase());
    if (!corrected) {
      return null;
    }

    const [inputPronoun] = phrase.split(/\s+/);
    const [pronoun, verb] = corrected.split(" ");
    const pronounStyle = detectWordCase(inputPronoun || pronoun);
    const verbStyle =
      pronounStyle === "upper" && (inputPronoun || "").toLowerCase() !== "i" ? "upper" : "lower";

    return {
      replacement: `${applyWordCase(pronoun, pronounStyle)} ${applyWordCase(verb, verbStyle)}${match[3] ?? ""}${boundaryContext.trailing}`,
      deleteBackwards: boundaryContext.input.length - phraseStart,
      deleteForwards: 0,
    };
  }
}
