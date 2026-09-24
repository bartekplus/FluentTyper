import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { resolveTypographyProfile } from "../typographyProfiles";
import {
  isDeleteInputAction,
  isLikelyApostropheContext,
  splitTrailingSpaces,
  shouldOpenQuote,
  shouldSkipGenericReplacement,
} from "./helpers/GenericRuleShared";

const APOSTROPHE = "’";

export class SmartQuoteNormalizationRule implements GrammarRule {
  readonly id = "smartQuoteNormalization" as const;
  // A typed space arrives as a word boundary; see closeNestedQuote.
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (isDeleteInputAction(context)) {
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

    const nestedClose = closeNestedQuote(input, singleOpen, singleClose);
    if (nestedClose) {
      return nestedClose;
    }

    const typed = input.charAt(input.length - 1);
    if (typed !== '"' && typed !== "'") {
      return null;
    }

    const beforeQuote = input.slice(0, -1);
    if (shouldSkipGenericReplacement(beforeQuote)) {
      return null;
    }

    let replacement: string;
    let deleteBackwards = 1;

    if (typed === '"') {
      if (quoteBalance(beforeQuote, typed, doubleOpen, doubleClose) === null) {
        return null;
      }
      const { core, trailingSpaces } = splitTrailingSpaces(beforeQuote);
      // Nothing was typed between the marks ("" ), only the opener's own
      // padding: close it instead of opening another one over that padding.
      const openedEmpty =
        pad.length > 0 &&
        trailingSpaces === pad &&
        core.endsWith(doubleOpen) &&
        (quoteBalance(core, typed, doubleOpen, doubleClose) ?? 0) > 0;
      const forceClosingQuoteWithSpaceTrim =
        !openedEmpty &&
        trailingSpaces.length > 0 &&
        (quoteBalance(core, typed, doubleOpen, doubleClose) ?? 0) > 0 &&
        endsWithLikelyQuoteContent(core, doubleClose, singleClose);

      if (openedEmpty) {
        replacement = `${pad}${doubleClose}`;
      } else if (forceClosingQuoteWithSpaceTrim) {
        replacement = `${pad}${doubleClose}`;
        deleteBackwards = 1 + trailingSpaces.length;
      } else {
        replacement = shouldOpenQuote(beforeQuote) ? `${doubleOpen}${pad}` : `${pad}${doubleClose}`;
      }
    } else {
      if (quoteBalance(beforeQuote, typed, singleOpen, singleClose) === null) {
        return null;
      }
      if (isLikelyApostropheContext(beforeQuote)) {
        // Where the nested closer differs, closeNestedQuote decides once the word ends.
        replacement = APOSTROPHE;
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
 * Where the nested closer is not the apostrophe (de, pl, fr), "’" after a word
 * is only known to close an open nested quote once a non-word character follows
 * it: "'c'est bon'" is “c’est bon”. The typed character is kept for the engine's
 * next pass, which may convert it too.
 */
function closeNestedQuote(input: string, open: string, close: string): GrammarEdit | null {
  if (close === APOSTROPHE || !/[\p{L}\p{N}]’[^\p{L}\p{N}’]$/u.test(input)) {
    return null;
  }
  if ((quoteBalance(input.slice(0, -2), "'", open, close) ?? 0) === 0) {
    return null;
  }
  return { replacement: `${close}${input.slice(-1)}`, deleteBackwards: 2, deleteForwards: 0 };
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

// "”", "’" and "»" always close a quote in every profile they appear in, so
// they unambiguously mark quoted content. "“" and "‘" don't: "“" is also
// French's nested-quote opener and "‘" is English's single opener, so they
// only count when they are the active profile's own closing mark.
const UNAMBIGUOUS_QUOTE_CONTENT_REGEX = /[\p{L}\p{N}\])}»’!?.,:;]$/u;

function endsWithLikelyQuoteContent(
  input: string,
  doubleClose: string,
  singleClose: string,
): boolean {
  const last = input.charAt(input.length - 1);
  return (
    UNAMBIGUOUS_QUOTE_CONTENT_REGEX.test(input) || last === doubleClose || last === singleClose
  );
}

function isWordChar(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}
