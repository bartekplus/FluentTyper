import type { GrammarRule, GrammarRuleId } from "./types";
import { TYPING_RULE_CATALOG } from "./ruleCatalog";
import { CapitalizeSentenceStartRule } from "./implementations/CapitalizeSentenceStartRule";
import { CapitalizeAfterLineBreakRule } from "./implementations/CapitalizeAfterLineBreakRule";
import { CommaPeriodSpacingRule } from "./implementations/CommaPeriodSpacingRule";
import { OpeningBracketSpacingRule } from "./implementations/OpeningBracketSpacingRule";
import { ClosingBracketSpacingRule } from "./implementations/ClosingBracketSpacingRule";
import { SlashContextSpacingRule } from "./implementations/SlashContextSpacingRule";
import { MathOperatorSpacingRule } from "./implementations/MathOperatorSpacingRule";
import { TechnicalTokenCompactionRule } from "./implementations/TechnicalTokenCompactionRule";
import { CollapseRepeatedSpacesRule } from "./implementations/CollapseRepeatedSpacesRule";
import { TrimSpaceBeforeLineBreakRule } from "./implementations/TrimSpaceBeforeLineBreakRule";
import { EnglishPronounICapitalizationRule } from "./implementations/EnglishPronounICapitalizationRule";
import { EnglishContractionNormalizationRule } from "./implementations/EnglishContractionNormalizationRule";
import { EnglishTypoWhitelistCorrectionRule } from "./implementations/EnglishTypoWhitelistCorrectionRule";
import { DoubleSpaceToPeriodRule } from "./implementations/DoubleSpaceToPeriodRule";
import { EllipsisShortcutRule } from "./implementations/EllipsisShortcutRule";
import { EmdashShortcutRule } from "./implementations/EmdashShortcutRule";
import { SmartQuoteNormalizationRule } from "./implementations/SmartQuoteNormalizationRule";
import { FrenchPunctuationSpacingRule } from "./implementations/FrenchPunctuationSpacingRule";
import { DuplicatePunctuationCollapseRule } from "./implementations/DuplicatePunctuationCollapseRule";
import { EnglishModalOfCorrectionRule } from "./implementations/EnglishModalOfCorrectionRule";
import { EnglishYourWelcomeCorrectionRule } from "./implementations/EnglishYourWelcomeCorrectionRule";
import { EnglishTheirThereBeVerbRule } from "./implementations/EnglishTheirThereBeVerbRule";
import { EnglishAlotCorrectionRule } from "./implementations/EnglishAlotCorrectionRule";
import { EnglishPronounVerbWhitelistAgreementRule } from "./implementations/EnglishPronounVerbWhitelistAgreementRule";
import { EnglishArticleAnCorrectionRule } from "./implementations/EnglishArticleAnCorrectionRule";
import { EnglishOrdinalSuffixRule } from "./implementations/EnglishOrdinalSuffixRule";
import { EnglishProperNounCapitalizationRule } from "./implementations/EnglishProperNounCapitalizationRule";
import { AutoBracketCloseRule } from "./implementations/AutoBracketCloseRule";
import { MeasurementUnitFormattingRule } from "./implementations/MeasurementUnitFormattingRule";
import { CurrencySpacingRule } from "./implementations/CurrencySpacingRule";

export function createGrammarRuleCatalogRuntime(options: {
  insertSpaceAfterAutocomplete: boolean;
}): GrammarRule[] {
  const insertSpaceAfterAutocomplete = options.insertSpaceAfterAutocomplete;

  const ruleById: Record<GrammarRuleId, GrammarRule> = {
    // Core v1/v2 language rules.
    capitalizeSentenceStart: new CapitalizeSentenceStartRule(),
    capitalizeAfterLineBreak: new CapitalizeAfterLineBreakRule(),
    englishPronounICapitalization: new EnglishPronounICapitalizationRule(),
    englishContractionNormalization: new EnglishContractionNormalizationRule(),
    englishTypoWhitelistCorrection: new EnglishTypoWhitelistCorrectionRule(),
    doubleSpaceToPeriod: new DoubleSpaceToPeriodRule(),
    englishModalOfCorrection: new EnglishModalOfCorrectionRule(),
    englishYourWelcomeCorrection: new EnglishYourWelcomeCorrectionRule(),
    englishTheirThereBeVerb: new EnglishTheirThereBeVerbRule(),
    englishAlotCorrection: new EnglishAlotCorrectionRule(),
    englishPronounVerbWhitelistAgreement: new EnglishPronounVerbWhitelistAgreementRule(),
    englishArticleAnCorrection: new EnglishArticleAnCorrectionRule(),
    englishOrdinalSuffix: new EnglishOrdinalSuffixRule(),
    englishProperNounCapitalization: new EnglishProperNounCapitalizationRule(),

    // Spacing and punctuation rules share the autocomplete spacing toggle.
    commaPeriodSpacing: new CommaPeriodSpacingRule(insertSpaceAfterAutocomplete),
    openingBracketSpacing: new OpeningBracketSpacingRule(),
    closingBracketSpacing: new ClosingBracketSpacingRule(insertSpaceAfterAutocomplete),
    slashContextSpacing: new SlashContextSpacingRule(insertSpaceAfterAutocomplete),
    mathOperatorSpacing: new MathOperatorSpacingRule(),
    measurementUnitFormatting: new MeasurementUnitFormattingRule(),
    currencySpacing: new CurrencySpacingRule(),
    technicalTokenCompaction: new TechnicalTokenCompactionRule(),
    collapseRepeatedSpaces: new CollapseRepeatedSpacesRule(),
    trimSpaceBeforeLineBreak: new TrimSpaceBeforeLineBreakRule(),

    // Advanced rules stay grouped together so the catalog order is the only priority source.
    ellipsisShortcut: new EllipsisShortcutRule(),
    emdashShortcut: new EmdashShortcutRule(),
    smartQuoteNormalization: new SmartQuoteNormalizationRule(),
    frenchPunctuationSpacing: new FrenchPunctuationSpacingRule(),
    duplicatePunctuationCollapse: new DuplicatePunctuationCollapseRule(),
    autoBracketClose: new AutoBracketCloseRule(),
  };

  return TYPING_RULE_CATALOG.slice()
    .sort((a, b) => a.priority - b.priority)
    .map((entry) => ruleById[entry.id]);
}
