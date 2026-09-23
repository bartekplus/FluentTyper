export type GrammarEventType = "insertChar" | "wordBoundary" | "idle" | "paste";

export type GrammarRuleId =
  | "measurementUnitFormatting"
  | "currencySpacing"
  | "capitalizeSentenceStart"
  | "capitalizeAfterLineBreak"
  | "englishPronounICapitalization"
  | "englishContractionNormalization"
  | "englishTypoWhitelistCorrection"
  | "doubleSpaceToPeriod"
  | "englishModalOfCorrection"
  | "englishYourWelcomeCorrection"
  | "englishTheirThereBeVerb"
  | "englishAlotCorrection"
  | "englishPronounVerbWhitelistAgreement"
  | "englishArticleAnCorrection"
  | "commaPeriodSpacing"
  | "openingBracketSpacing"
  | "closingBracketSpacing"
  | "slashContextSpacing"
  | "mathOperatorSpacing"
  | "technicalTokenCompaction"
  | "collapseRepeatedSpaces"
  | "trimSpaceBeforeLineBreak"
  | "neutralPunctuationPolicy"
  | "ellipsisShortcut"
  | "emdashShortcut"
  | "smartQuoteNormalization"
  | "duplicatePunctuationCollapse"
  | "autoBracketClose"
  // Legacy ids kept for compatibility and migration handling.
  | "spacingRule"
  | "capitalizeFirstLetter";

export interface GrammarHints {
  /** Adapter-verified editing context; missing information fails closed. */
  measurementContext?: "prose" | "protected";
  isPaste?: boolean;
  inputAction?: "insert" | "delete" | "other";
  lang?: string;
  userDictionary?: string[];
}

export interface GrammarContext {
  beforeCursor: string;
  afterCursor: string;
  charTyped?: string;
  hints?: GrammarHints;
}

export interface GrammarEdit {
  replacement: string;
  deleteBackwards: number; // Number of characters to delete before the cursor
  deleteForwards: number; // Number of characters to delete after the cursor
  cursorOffset?: number; // If set, cursor is placed at replaceStart + cursorOffset instead of end of replacement
  sourceRuleId?: Exclude<GrammarRuleId, "spacingRule" | "capitalizeFirstLetter">;
  // Apply only if the field is untouched and the result lands exactly as computed;
  // never fall back to a host-editor bypass. For edits that must not corrupt markup.
  strict?: boolean;
}

export interface GrammarRule {
  readonly id: GrammarRuleId;
  readonly triggers: GrammarEventType[];

  apply(context: GrammarContext): GrammarEdit[] | GrammarEdit | null;
}

export interface GrammarRuleCatalogEntry {
  id: Exclude<GrammarRuleId, "spacingRule" | "capitalizeFirstLetter">;
  name: string;
  titleI18nKey: string;
  descriptionI18nKey: string;
  exampleI18nKey: string;
  languageScope: "all" | "en_US";
  safetyTier: "safe" | "advanced";
  defaultRollout: "on" | "off";
  recommended: boolean;
  priority: number;
}
