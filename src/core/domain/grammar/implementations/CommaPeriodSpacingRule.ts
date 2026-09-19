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

    // A digit followed by punctuation is ambiguous until the next character:
    // keep decimal/group input intact, then repair an unambiguous prose continuation.
    const deferredExponent = /[eE]/.test(inputStr[length - 2] ?? "");
    const continuation = deferredExponent ? inputStr.slice(-2) : lastChar;
    const punctuationIndex = length - continuation.length - 1;
    const punctuation = inputStr[punctuationIndex];
    // Only where a deferred decision can still be completed; suppressing the
    // space anywhere else would drop it for good.
    const canDefer =
      this.insertSpaceAfterAutocomplete &&
      !context.afterCursor &&
      !context.hints?.isPaste &&
      resolveInputAction(context) === "insert";

    // The continuation is a letter (prose resumes) or a space the user typed,
    // which also rules out "..." and "../".
    const letterContinuation = /^\p{L}$/u.test(lastChar) && !/^[eE]$/u.test(lastChar);
    const spaceContinuation = continuation === " ";
    if (
      canDefer &&
      (punctuation === "." || punctuation === ",") &&
      (letterContinuation || spaceContinuation)
    ) {
      // A deferred period may have had spaces before it ("path ."); the repair
      // reclaims them so the result matches the immediate edit.
      let spacesBefore = 0;
      while (SPACE_CHARS.includes(inputStr[punctuationIndex - 1 - spacesBefore] ?? "")) {
        spacesBefore += 1;
      }
      const prefixEnd = punctuationIndex - spacesBefore;
      const prefix = inputStr.slice(Math.max(0, prefixEnd - 34), prefixEnd);
      const numericContinuation =
        context.hints?.measurementContext === "prose" &&
        resolveMeasurementLocale(context.hints.lang) &&
        /(?:^|[\s([{])[-+]?\d+(?:[.,]\d*)?$/u.test(prefix);
      // A period closing a word: prose resumes, so the deferred space goes in.
      const wordContinuation = punctuation === "." && /\p{L}\p{L}$/u.test(prefix);
      // Nothing to do when the text already reads correctly.
      const wouldChange = spacesBefore > 0 || letterContinuation;
      if (wouldChange && ((numericContinuation && spacesBefore === 0) || wordContinuation)) {
        return this.createEdit(
          `${punctuation} ${continuation}`,
          spacesBefore + punctuation.length + continuation.length,
        );
      }
    }

    if (lastChar !== "." && lastChar !== ",") {
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
      !context.afterCursor &&
      !context.hints?.isPaste &&
      inputAction === "insert" &&
      context.hints?.measurementContext === "prose" &&
      resolveMeasurementLocale(context.hints.lang)
    ) {
      return null;
    }

    // "e.g", "p.m", "U.S": a period after a one-letter token is an abbreviation
    // as often as a sentence end, so never insert the space for the user.
    if (
      !spaceBeforeViolated &&
      lastChar === "." &&
      /[A-Za-z]/.test(previousSignificantChar) &&
      !/[A-Za-z]/.test(inputStr[i - 1] ?? "")
    ) {
      return null;
    }

    // A period that does not close a word is never sentence punctuation:
    // "[...arr]", "f(...args)", "../src". This holds even mid-text, where the
    // deferral below cannot run because the decision can never be revisited.
    if (
      lastChar === "." &&
      !spaceBeforeViolated &&
      previousSignificantChar !== "" &&
      !/[\p{L}\p{N}]/u.test(previousSignificantChar)
    ) {
      return null;
    }

    // "word. " + "." means the previous period ended a run, not a sentence.
    // Take the space back rather than delay every sentence by a keystroke.
    if (lastChar === "." && spaceBeforeViolated && previousSignificantChar === ".") {
      return this.createEdit(".", spaceRunLength + 1);
    }

    // ponytail: "path ../.." still loses the space before the path, because
    // nothing here records whether the space was the user's or ours. Deferring
    // instead would delay the much commoner "Hello ." cleanup, so this keeps
    // the periods intact and accepts the lost space. Revisit if the engine ever
    // carries edit provenance.

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
