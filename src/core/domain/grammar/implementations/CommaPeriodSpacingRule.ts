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
    const lastCharMin1 = inputStr[length - 2];
    const lastCharMin2 = inputStr[length - 3];

    if (lastChar !== "." && lastChar !== ",") {
      return null;
    }

    if (SPACE_CHARS.includes(lastCharMin2)) {
      return null;
    }

    const hasSpaceBefore = SPACE_CHARS.includes(lastCharMin1);
    const spaceBeforeViolated = hasSpaceBefore;
    const insertSpaceAfter = this.insertSpaceAfterAutocomplete;
    const inputAction = this.resolveInputAction(context);

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
        2,
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
