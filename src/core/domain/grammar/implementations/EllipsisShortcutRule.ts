// Facade: the rule's code is in grammar/rules/common.yaml (ellipsisShortcut.live).
import { liveRule } from "../engine/liveRules";
import type { GrammarContext, GrammarEdit, GrammarRule } from "../types";

export class EllipsisShortcutRule implements GrammarRule {
  readonly id = "ellipsisShortcut" as const;
  private readonly rule = liveRule(this.id);
  readonly triggers = this.rule.triggers;

  apply(context: GrammarContext): GrammarEdit | null {
    return this.rule.apply(context);
  }
}
