import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";

export class CommaPeriodSpacingRule extends SpacingRuleShared implements GrammarRule {
  readonly id = "commaPeriodSpacing" as const;
  readonly name = "Comma and Period Spacing";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const inputStr = context.beforeCursor;
    if (!inputStr || inputStr.length < 2) {
      return null;
    }

    const length = inputStr.length;
    const lastChar = inputStr[length - 1];

    if (lastChar !== "." && lastChar !== ",") {
      return null;
    }

    let spaceRunLength = 0;
    let i = length - 2;
    while (i >= 0 && SPACE_CHARS.includes(inputStr[i])) {
      spaceRunLength += 1;
      i -= 1;
    }
    const previousSignificantChar = i >= 0 ? inputStr[i] : "";

    const spaceBeforeViolated = spaceRunLength > 0;
    const insertSpaceAfter = this.insertSpaceAfterAutocomplete;
    const inputAction = this.resolveInputAction(context);

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

    if (spaceBeforeViolated) {
      return this.createEdit(
        `${lastChar}${insertSpaceAfter ? " " : ""}`,
        spaceRunLength + 1,
        "Applied comma/period spacing",
      );
    }

    return this.createEdit(
      `${lastChar}${insertSpaceAfter ? " " : ""}`,
      1,
      "Applied comma/period spacing",
    );
  }
}
