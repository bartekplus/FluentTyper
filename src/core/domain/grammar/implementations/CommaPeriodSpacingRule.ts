import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { PUNCTUATION_EQUIVALENTS, SPACE_CHARS, SPACING_OR_FILLER_CHARS } from "../../spacingRules";
import { resolveInputAction } from "./helpers/GenericRuleShared";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";
import { resolveMeasurementLocale } from "../measurement/registry";

// A standalone number ending right before a comma: "2", "-1.5", "(١٫٥",
// "1,500,000". Deferral and repair must both use it, or a deferred space can
// never be restored.
const NUMERIC_PREFIX = /(?:^|[\s([{])[-+]?\p{Nd}+(?:[.,\u066B]\p{Nd}*)*$/u;
const numericPrefixBefore = (text: string, index: number): boolean =>
  NUMERIC_PREFIX.test(text.slice(Math.max(0, index - 34), index));

// A closing quote sits tight against the punctuation before it: "Hi," not
// "Hi, ". Only " and " are judged, and only as closers: an opening quote
// right after a comma/period ('He said, "hello"') must keep its space.
// Straight/curly single quotes are apostrophe-ambiguous and » opens rather
// than closes in German/Danish, so none of those are touched at all.
const CURLY_QUOTE_OPENERS = /[“„]/g;
const CURLY_QUOTE_CLOSERS = /”/g;
const STRAIGHT_QUOTES = /"/g;

// Whether the quote just typed at `index` closes an earlier, still-open quote
// in the current paragraph (the text since the last newline) rather than
// opening a new one.
function isClosingQuote(inputStr: string, index: number, ch: string): boolean {
  const paragraphStart = inputStr.lastIndexOf("\n", index - 1) + 1;
  const before = inputStr.slice(paragraphStart, index);
  if (ch === '"') {
    return (before.match(STRAIGHT_QUOTES)?.length ?? 0) % 2 === 1;
  }
  if (ch === "”") {
    const openers = before.match(CURLY_QUOTE_OPENERS)?.length ?? 0;
    const closers = before.match(CURLY_QUOTE_CLOSERS)?.length ?? 0;
    return openers > closers;
  }
  return false;
}

export class CommaPeriodSpacingRule extends SpacingRuleShared implements GrammarRule {
  readonly id = "commaPeriodSpacing" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const inputStr = context.beforeCursor;
    if (!inputStr || inputStr.length < 2) {
      return null;
    }

    const length = inputStr.length;
    const lastChar = inputStr[length - 1];
    // Only where a deferred decision can still be completed; suppressing the
    // space anywhere else would drop it for good.
    const canDefer =
      !context.afterCursor && !context.hints?.isPaste && resolveInputAction(context) === "insert";

    // A period never gets a space from this rule: "google.com", "node.js" and
    // "user.save()" all begin as a word and a period, and the letter that
    // follows says nothing about which one it was. Only a space the user typed
    // after "Hello ." confirms a sentence end; then the stray space before the
    // period can go. Until then "path ." may still become "path ../..".
    if (lastChar === " ") {
      const periodIndex = length - 2;
      if (!canDefer || inputStr[periodIndex] !== ".") {
        return null;
      }
      let spacesBefore = 0;
      while (SPACE_CHARS.includes(inputStr[periodIndex - 1 - spacesBefore] ?? "")) {
        spacesBefore += 1;
      }
      const wordEnd = inputStr[periodIndex - 1 - spacesBefore] ?? "";
      if (spacesBefore === 0 || !/[\p{L}\p{N}]/u.test(wordEnd)) {
        return null;
      }
      return this.createEdit(". ", spacesBefore + 2);
    }

    // A closing quote closes tight: strip a space this rule (or the user)
    // left between "," / "." and the quote that follows it. An opening quote
    // is left untouched, so its space survives.
    if (lastChar === '"' || lastChar === "”") {
      if (!isClosingQuote(inputStr, length - 1, lastChar)) {
        return null;
      }
      let spaceRun = 0;
      let j = length - 2;
      while (j >= 0 && SPACE_CHARS.includes(inputStr[j])) {
        spaceRun += 1;
        j -= 1;
      }
      const punctuationChar = j >= 0 ? inputStr[j] : "";
      if (spaceRun > 0 && (punctuationChar === "," || punctuationChar === ".")) {
        return this.createEdit(lastChar, spaceRun + 1);
      }
      return null;
    }

    // A digit followed by a comma is ambiguous until the next character: keep
    // "1,5" intact, then repair an unambiguous prose continuation ("2,a").
    const deferredExponent = /[eE]/.test(inputStr[length - 2] ?? "");
    const continuation = deferredExponent ? inputStr.slice(-2) : lastChar;
    const punctuationIndex = length - continuation.length - 1;
    if (
      canDefer &&
      this.insertSpaceAfterAutocomplete &&
      inputStr[punctuationIndex] === "," &&
      /^\p{L}$/u.test(lastChar) &&
      // A lone "e" may still become an exponent ("2,e5"); "2,ee" cannot.
      (deferredExponent || !/^[eE]$/u.test(lastChar))
    ) {
      const numericContinuation =
        context.hints?.measurementContext === "prose" &&
        resolveMeasurementLocale(context.hints.lang) &&
        numericPrefixBefore(inputStr, punctuationIndex);
      if (numericContinuation) {
        return this.createEdit(`, ${continuation}`, 1 + continuation.length);
      }
    }

    // Includes equivalent commas such as the Arabic "،".
    if ((PUNCTUATION_EQUIVALENTS[lastChar] ?? lastChar) !== ",") {
      return null;
    }

    let spaceRunLength = 0;
    let i = length - 2;
    while (i >= 0 && SPACING_OR_FILLER_CHARS.includes(inputStr[i])) {
      if (SPACE_CHARS.includes(inputStr[i])) {
        spaceRunLength += 1;
      }
      i -= 1;
    }
    const previousSignificantChar = i >= 0 ? inputStr[i] : "";

    const spaceBeforeViolated = spaceRunLength > 0;
    const insertSpaceAfter = this.insertSpaceAfterAutocomplete;
    const inputAction = resolveInputAction(context);

    // Decimal/grouping punctuation is unfinished numeric input, not yet prose
    // punctuation. Only defer where the repair above can actually complete it;
    // otherwise the space would be dropped and never restored.
    if (
      !spaceBeforeViolated &&
      // Only ASCII "," is ambiguous; the Arabic comma is never numeric.
      lastChar === "," &&
      // \p{Nd}: "١,٥" is as ambiguous as "1,5".
      /^\p{Nd}$/u.test(previousSignificantChar) &&
      numericPrefixBefore(inputStr, length - 1) &&
      canDefer &&
      context.hints?.measurementContext === "prose" &&
      resolveMeasurementLocale(context.hints.lang)
    ) {
      return null;
    }

    // Repeated punctuation bursts (",,,,", ", , ,") should be handled by
    // duplicate-collapse logic; avoid emitting spacing edits that can create
    // comma-space ladders under rapid input.
    if (previousSignificantChar === lastChar) {
      return null;
    }

    // Respect explicit user deletion of an auto-inserted trailing space.
    if (inputAction === "delete" && !spaceBeforeViolated && insertSpaceAfter) {
      return null;
    }

    if (!spaceBeforeViolated && !insertSpaceAfter) {
      return null;
    }

    return this.createEdit(
      `${lastChar}${insertSpaceAfter ? " " : ""}`,
      spaceBeforeViolated ? spaceRunLength + 1 : 1,
    );
  }
}
