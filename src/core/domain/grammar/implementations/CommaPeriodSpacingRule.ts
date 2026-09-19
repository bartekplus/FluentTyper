import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS, SPACING_OR_FILLER_CHARS } from "../../spacingRules";
import { resolveInputAction } from "./helpers/GenericRuleShared";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";
import { resolveMeasurementLocale } from "../measurement/registry";

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
      !/^[eE]$/u.test(lastChar)
    ) {
      const prefix = inputStr.slice(Math.max(0, punctuationIndex - 34), punctuationIndex);
      const numericContinuation =
        context.hints?.measurementContext === "prose" &&
        resolveMeasurementLocale(context.hints.lang) &&
        /(?:^|[\s([{])[-+]?\d+(?:[.,]\d*)?$/u.test(prefix);
      if (numericContinuation) {
        return this.createEdit(`, ${continuation}`, 1 + continuation.length);
      }
    }

    if (lastChar !== ",") {
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
      this.isDigit(previousSignificantChar) &&
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
