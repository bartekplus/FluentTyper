import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  isLikelyCodeLikeContext,
  resolveEnglishBoundaryContext,
} from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

const AGREEMENT_REGEX = /\b(i\s+is|i\s+has|you\s+was|(he|she|it)\s+are)$/i;

function resolveAgreementCorrection(lowerPhrase: string): string | null {
  switch (lowerPhrase) {
    case "i is":
      return "i am";
    case "i has":
      return "i have";
    case "you was":
      return "you were";
    case "he are":
      return "he is";
    case "she are":
      return "she is";
    case "it are":
      return "it is";
    default:
      return null;
  }
}

export class EnglishPronounVerbWhitelistAgreementRule implements GrammarRule {
  readonly id = "englishPronounVerbWhitelistAgreement" as const;
  readonly name = "English Pronoun Verb Whitelist Agreement";
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const boundaryContext = resolveEnglishBoundaryContext(context);
    if (!boundaryContext) {
      return null;
    }

    const match = boundaryContext.core.match(AGREEMENT_REGEX);
    if (!match) {
      return null;
    }

    const phrase = match[0];
    const phraseStart = boundaryContext.core.length - phrase.length;
    if (isLikelyCodeLikeContext(boundaryContext.core, phraseStart, boundaryContext.core.length)) {
      return null;
    }

    const corrected = resolveAgreementCorrection(phrase.toLowerCase());
    if (!corrected) {
      return null;
    }

    const [inputPronoun] = phrase.split(/\s+/);
    const [pronoun, verb] = corrected.split(" ");
    const pronounStyle = detectWordCase(inputPronoun || pronoun);
    const verbStyle =
      pronounStyle === "upper" && (inputPronoun || "").toLowerCase() !== "i" ? "upper" : "lower";

    return {
      replacement: `${applyWordCase(pronoun, pronounStyle)} ${applyWordCase(verb, verbStyle)}${boundaryContext.trailing}`,
      deleteBackwards: boundaryContext.input.length - phraseStart,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected whitelisted pronoun-verb mismatch",
    };
  }
}
