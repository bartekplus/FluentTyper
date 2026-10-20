import type {
  GrammarContext,
  GrammarEdit,
  GrammarEventType,
  GrammarRule,
  GrammarRuleId,
} from "../types";
import { CapitalizeSentenceStartRule } from "../implementations/CapitalizeSentenceStartRule";
import { CapitalizeAfterLineBreakRule } from "../implementations/CapitalizeAfterLineBreakRule";
import { CommaPeriodSpacingRule } from "../implementations/CommaPeriodSpacingRule";
import { OpeningBracketSpacingRule } from "../implementations/OpeningBracketSpacingRule";
import { ClosingBracketSpacingRule } from "../implementations/ClosingBracketSpacingRule";
import { SlashContextSpacingRule } from "../implementations/SlashContextSpacingRule";
import { MathOperatorSpacingRule } from "../implementations/MathOperatorSpacingRule";
import { TechnicalTokenCompactionRule } from "../implementations/TechnicalTokenCompactionRule";
import { CollapseRepeatedSpacesRule } from "../implementations/CollapseRepeatedSpacesRule";
import { TrimSpaceBeforeLineBreakRule } from "../implementations/TrimSpaceBeforeLineBreakRule";
import { EnglishPronounICapitalizationRule } from "../implementations/EnglishPronounICapitalizationRule";
import { EnglishContractionNormalizationRule } from "../implementations/EnglishContractionNormalizationRule";
import { EnglishTypoWhitelistCorrectionRule } from "../implementations/EnglishTypoWhitelistCorrectionRule";
import { DoubleSpaceToPeriodRule } from "../implementations/DoubleSpaceToPeriodRule";
import { EllipsisShortcutRule } from "../implementations/EllipsisShortcutRule";
import { EmdashShortcutRule } from "../implementations/EmdashShortcutRule";
import { SmartQuoteNormalizationRule } from "../implementations/SmartQuoteNormalizationRule";
import { FrenchPunctuationSpacingRule } from "../implementations/FrenchPunctuationSpacingRule";
import { DuplicatePunctuationCollapseRule } from "../implementations/DuplicatePunctuationCollapseRule";
import { EnglishModalOfCorrectionRule } from "../implementations/EnglishModalOfCorrectionRule";
import { EnglishYourWelcomeCorrectionRule } from "../implementations/EnglishYourWelcomeCorrectionRule";
import { EnglishTheirThereBeVerbRule } from "../implementations/EnglishTheirThereBeVerbRule";
import { EnglishAlotCorrectionRule } from "../implementations/EnglishAlotCorrectionRule";
import { EnglishPronounVerbWhitelistAgreementRule } from "../implementations/EnglishPronounVerbWhitelistAgreementRule";
import { EnglishArticleAnCorrectionRule } from "../implementations/EnglishArticleAnCorrectionRule";
import { EnglishOrdinalSuffixRule } from "../implementations/EnglishOrdinalSuffixRule";
import { EnglishProperNounCapitalizationRule } from "../implementations/EnglishProperNounCapitalizationRule";
import { AutoBracketCloseRule } from "../implementations/AutoBracketCloseRule";
import { MeasurementUnitFormattingRule } from "../implementations/MeasurementUnitFormattingRule";
import { CurrencySpacingRule } from "../implementations/CurrencySpacingRule";
import { LIVE_PATTERNS, LIVE_RULES } from "./live.generated";
import { findMatches, type PatternSet } from "./matcher";
import { tokenize } from "./tokenizer";

export interface LiveRuleOptions {
  insertSpaceAfterAutocomplete: boolean;
}

/**
 * Named live implementations: the typing rules whose logic a token pattern cannot state
 * (cursor state, typed-character timing, bracket pairing). A rule file names one with
 * `predicate:` on a rule with `modes: [live]`.
 */
export const LIVE_PREDICATES: Readonly<Record<string, (options: LiveRuleOptions) => GrammarRule>> =
  {
    CapitalizeSentenceStartRule: () => new CapitalizeSentenceStartRule(),
    CapitalizeAfterLineBreakRule: () => new CapitalizeAfterLineBreakRule(),
    EnglishPronounICapitalizationRule: () => new EnglishPronounICapitalizationRule(),
    EnglishContractionNormalizationRule: () => new EnglishContractionNormalizationRule(),
    EnglishTypoWhitelistCorrectionRule: () => new EnglishTypoWhitelistCorrectionRule(),
    DoubleSpaceToPeriodRule: () => new DoubleSpaceToPeriodRule(),
    EnglishModalOfCorrectionRule: () => new EnglishModalOfCorrectionRule(),
    EnglishYourWelcomeCorrectionRule: () => new EnglishYourWelcomeCorrectionRule(),
    EnglishTheirThereBeVerbRule: () => new EnglishTheirThereBeVerbRule(),
    EnglishAlotCorrectionRule: () => new EnglishAlotCorrectionRule(),
    EnglishPronounVerbWhitelistAgreementRule: () => new EnglishPronounVerbWhitelistAgreementRule(),
    EnglishArticleAnCorrectionRule: () => new EnglishArticleAnCorrectionRule(),
    EnglishOrdinalSuffixRule: () => new EnglishOrdinalSuffixRule(),
    EnglishProperNounCapitalizationRule: () => new EnglishProperNounCapitalizationRule(),
    CommaPeriodSpacingRule: (o) => new CommaPeriodSpacingRule(o.insertSpaceAfterAutocomplete),
    OpeningBracketSpacingRule: () => new OpeningBracketSpacingRule(),
    ClosingBracketSpacingRule: (o) => new ClosingBracketSpacingRule(o.insertSpaceAfterAutocomplete),
    SlashContextSpacingRule: (o) => new SlashContextSpacingRule(o.insertSpaceAfterAutocomplete),
    MathOperatorSpacingRule: () => new MathOperatorSpacingRule(),
    MeasurementUnitFormattingRule: () => new MeasurementUnitFormattingRule(),
    CurrencySpacingRule: () => new CurrencySpacingRule(),
    TechnicalTokenCompactionRule: () => new TechnicalTokenCompactionRule(),
    CollapseRepeatedSpacesRule: () => new CollapseRepeatedSpacesRule(),
    TrimSpaceBeforeLineBreakRule: () => new TrimSpaceBeforeLineBreakRule(),
    EllipsisShortcutRule: () => new EllipsisShortcutRule(),
    EmdashShortcutRule: () => new EmdashShortcutRule(),
    SmartQuoteNormalizationRule: () => new SmartQuoteNormalizationRule(),
    FrenchPunctuationSpacingRule: () => new FrenchPunctuationSpacingRule(),
    DuplicatePunctuationCollapseRule: () => new DuplicatePunctuationCollapseRule(),
    AutoBracketCloseRule: () => new AutoBracketCloseRule(),
  };

// Enough text before the cursor for any live pattern; the window starts after a space.
const LIVE_WINDOW = 200;
const BOUNDARY = /[\s\p{P}]/u;

/**
 * The live patterns of one check. When a space or punctuation mark is typed, the text
 * before the cursor is tokenized once, and the first match that ends at the typed
 * character (or at the typed mark itself) is fixed. Only safe-to-fix checks run live.
 */
export class PatternLiveRule implements GrammarRule {
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  constructor(
    readonly id: GrammarRuleId,
    private readonly patterns: ReadonlySet<number>,
    private readonly set: PatternSet = LIVE_PATTERNS,
  ) {}

  apply(context: GrammarContext): GrammarEdit | null {
    const text = context.beforeCursor;
    const typed = text.at(-1) ?? "";
    if (!BOUNDARY.test(typed)) return null;
    let windowStart = Math.max(0, text.length - LIVE_WINDOW);
    if (windowStart > 0) windowStart = text.indexOf(" ", windowStart) + 1 || text.length;
    const tokens = tokenize(text, windowStart);
    const dictionary = new Set(context.hints?.userDictionary?.map((word) => word.toLowerCase()));
    // The match ends at the typed character (a mark the pattern names) or just before it.
    const ends = new Set([text.length, text.length - typed.length]);
    const matches = findMatches(this.set, tokens, text, context.hints?.lang ?? "en_US", (p) =>
      this.patterns.has(p.index),
    );
    for (const match of matches) {
      if (!ends.has(match.end)) continue;
      const replaced = tokens.filter(
        (token) => token.start >= match.targetStart && token.end <= match.targetEnd,
      );
      if (replaced.some((token) => dictionary.has(token.key))) continue;
      const alternative = match.alternatives[0];
      if (alternative === text.slice(match.targetStart, match.targetEnd)) continue;
      return {
        replacement: alternative + text.slice(match.targetEnd),
        deleteBackwards: text.length - match.targetStart,
        deleteForwards: 0,
      };
    }
    return null;
  }
}

/** The typing rules of the rule files, in priority order. */
export function createLiveRules(options: LiveRuleOptions): GrammarRule[] {
  return LIVE_RULES.map((rule) =>
    rule.predicate
      ? LIVE_PREDICATES[rule.predicate](options)
      : new PatternLiveRule(rule.check as GrammarRuleId, new Set(rule.patterns)),
  );
}
