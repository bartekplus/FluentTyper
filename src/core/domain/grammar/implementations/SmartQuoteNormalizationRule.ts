import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { resolveTypographyProfile } from "../typographyProfiles";
import {
  isDeleteInputAction,
  isLikelyApostropheContext,
  splitTrailingSpaces,
  shouldOpenQuote,
  shouldSkipGenericReplacement,
} from "./helpers/GenericRuleShared";
import { isInsideProtectedSpan } from "./helpers/ProtectedSpanShared";

const APOSTROPHE = "’";

export class SmartQuoteNormalizationRule implements GrammarRule {
  readonly id = "smartQuoteNormalization" as const;
  readonly triggers: GrammarEventType[] = ["insertChar"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (isDeleteInputAction(context) || context.hints?.measurementContext === "protected") {
      return null;
    }

    const input = context.beforeCursor;
    if (input.length === 0) {
      return null;
    }

    const profile = resolveTypographyProfile(context.hints?.lang);
    const [doubleOpen, doubleClose] = profile.double;
    const [singleOpen, singleClose] = profile.single;
    const pad = profile.quoteSpace;

    const typed = input.charAt(input.length - 1);
    if (typed !== '"' && typed !== "'") {
      return null;
    }

    const beforeQuote = input.slice(0, -1);
    if (shouldSkipGenericReplacement(beforeQuote) || isInsideProtectedSpan(beforeQuote)) {
      return null;
    }

    let replacement: string;
    let deleteBackwards = 1;

    if (typed === '"') {
      if (quoteBalance(beforeQuote, typed, doubleOpen, doubleClose) === null) {
        return null;
      }
      const { core, trailingSpaces } = splitTrailingSpaces(beforeQuote);
      const forceClosingQuoteWithSpaceTrim =
        trailingSpaces.length > 0 &&
        (quoteBalance(core, typed, doubleOpen, doubleClose) ?? 0) > 0 &&
        endsWithLikelyQuoteContent(core);

      if (forceClosingQuoteWithSpaceTrim) {
        replacement = `${pad}${doubleClose}`;
        deleteBackwards = 1 + trailingSpaces.length;
      } else {
        replacement = shouldOpenQuote(beforeQuote) ? `${doubleOpen}${pad}` : `${pad}${doubleClose}`;
      }
    } else {
      const balance = quoteBalance(beforeQuote, typed, singleOpen, singleClose);
      if (balance === null) {
        return null;
      }
      if (isLikelyApostropheContext(beforeQuote)) {
        // ponytail: where the closer is not the apostrophe (de, pl, fr), a word
        // ending inside an open nested quote closes it, so "‚Peter's" loses its
        // apostrophe. Looking at the next typed character would settle it.
        replacement = balance > 0 ? singleClose : APOSTROPHE;
      } else {
        replacement = shouldOpenQuote(beforeQuote) ? singleOpen : singleClose;
      }
    }

    if (replacement === typed) {
      return null;
    }

    return {
      replacement,
      deleteBackwards,
      deleteForwards: 0,
    };
  }
}

/**
 * Open quotes left in `input`, counting straight quotes by position, or null
 * when a closer has nothing to close. An apostrophe inside a word is neither.
 */
function quoteBalance(input: string, straight: string, open: string, close: string): number | null {
  let balance = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input.charAt(i);
    if (char === open) {
      balance += 1;
      continue;
    }
    if (char !== close && char !== straight) {
      continue;
    }
    if (straight === "'" && isWordChar(input.charAt(i - 1)) && isWordChar(input.charAt(i + 1))) {
      continue;
    }
    if (char === straight && shouldOpenQuote(input.slice(0, i))) {
      balance += 1;
      continue;
    }
    if (balance === 0) {
      return null;
    }
    balance -= 1;
  }

  return balance;
}

function endsWithLikelyQuoteContent(input: string): boolean {
  return /[\p{L}\p{N}\])}»›”’!?.,:;]$/u.test(input);
}

function isWordChar(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}
