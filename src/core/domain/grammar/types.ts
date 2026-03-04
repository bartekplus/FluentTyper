export type GrammarEventType = "insertChar" | "wordBoundary" | "idle" | "paste";

export type GrammarRuleId =
  | "capitalizeSentenceStart"
  | "capitalizeAfterLineBreak"
  | "commaPeriodSpacing"
  | "openingBracketSpacing"
  | "closingBracketSpacing"
  | "slashContextSpacing"
  | "mathOperatorSpacing"
  | "technicalTokenCompaction"
  | "collapseRepeatedSpaces"
  | "trimSpaceBeforeLineBreak"
  | "neutralPunctuationPolicy"
  // Legacy ids kept for compatibility and migration handling.
  | "spacingRule"
  | "capitalizeFirstLetter";

export interface GrammarContext {
  beforeCursor: string;
  afterCursor: string;
  charTyped?: string;
  hints?: Record<string, unknown>;
}

export interface GrammarEdit {
  replacement: string;
  deleteBackwards: number; // Number of characters to delete before the cursor
  deleteForwards: number; // Number of characters to delete after the cursor
  confidence?: "high" | "medium";
  description?: string;
}

export interface GrammarRule {
  readonly id: GrammarRuleId;
  readonly name: string;
  readonly triggers: GrammarEventType[];

  /**
   * Applies the rule to the current context.
   * Returns an array of edits (often just one), or null/empty array if no edit is needed.
   */
  apply(context: GrammarContext): GrammarEdit[] | GrammarEdit | null;
}

export interface GrammarRuleCatalogEntry {
  id: Exclude<GrammarRuleId, "spacingRule" | "capitalizeFirstLetter">;
  name: string;
  titleI18nKey: string;
  descriptionI18nKey: string;
  exampleI18nKey: string;
  recommended: boolean;
  defaultEnabled: boolean;
  priority: number;
}
