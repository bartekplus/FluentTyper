import type { GrammarRule } from "./types";
import { GRAMMAR_RULE_CATALOG, type CatalogRuleId } from "./ruleCatalog";
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
import { NeutralPunctuationPolicyRule } from "./implementations/NeutralPunctuationPolicyRule";
import { EnglishPronounICapitalizationRule } from "./implementations/EnglishPronounICapitalizationRule";
import { EnglishContractionNormalizationRule } from "./implementations/EnglishContractionNormalizationRule";
import { EnglishTypoWhitelistCorrectionRule } from "./implementations/EnglishTypoWhitelistCorrectionRule";
import { DoubleSpaceToPeriodRule } from "./implementations/DoubleSpaceToPeriodRule";
import { EllipsisShortcutRule } from "./implementations/EllipsisShortcutRule";
import { EmdashShortcutRule } from "./implementations/EmdashShortcutRule";
import { SmartQuoteNormalizationRule } from "./implementations/SmartQuoteNormalizationRule";
import { DuplicatePunctuationCollapseRule } from "./implementations/DuplicatePunctuationCollapseRule";
import { EnglishModalOfCorrectionRule } from "./implementations/EnglishModalOfCorrectionRule";
import { EnglishYourWelcomeCorrectionRule } from "./implementations/EnglishYourWelcomeCorrectionRule";
import { EnglishTheirThereBeVerbRule } from "./implementations/EnglishTheirThereBeVerbRule";
import { EnglishAlotCorrectionRule } from "./implementations/EnglishAlotCorrectionRule";
import { EnglishPronounVerbWhitelistAgreementRule } from "./implementations/EnglishPronounVerbWhitelistAgreementRule";

export function createGrammarRuleCatalogRuntime(options: {
  insertSpaceAfterAutocomplete: boolean;
  userDictionaryList: string[];
}): GrammarRule[] {
  const spacingOptions = {
    insertSpaceAfterAutocomplete: options.insertSpaceAfterAutocomplete,
  };

  const ruleById: Record<CatalogRuleId, GrammarRule> = {
    capitalizeSentenceStart: new CapitalizeSentenceStartRule(),
    capitalizeAfterLineBreak: new CapitalizeAfterLineBreakRule(),
    englishPronounICapitalization: new EnglishPronounICapitalizationRule(),
    englishContractionNormalization: new EnglishContractionNormalizationRule(),
    englishTypoWhitelistCorrection: new EnglishTypoWhitelistCorrectionRule(
      options.userDictionaryList,
    ),
    doubleSpaceToPeriod: new DoubleSpaceToPeriodRule(),
    englishModalOfCorrection: new EnglishModalOfCorrectionRule(),
    englishYourWelcomeCorrection: new EnglishYourWelcomeCorrectionRule(),
    englishTheirThereBeVerb: new EnglishTheirThereBeVerbRule(),
    englishAlotCorrection: new EnglishAlotCorrectionRule(options.userDictionaryList),
    englishPronounVerbWhitelistAgreement: new EnglishPronounVerbWhitelistAgreementRule(),
    commaPeriodSpacing: new CommaPeriodSpacingRule(spacingOptions.insertSpaceAfterAutocomplete),
    openingBracketSpacing: new OpeningBracketSpacingRule(
      spacingOptions.insertSpaceAfterAutocomplete,
    ),
    closingBracketSpacing: new ClosingBracketSpacingRule(
      spacingOptions.insertSpaceAfterAutocomplete,
    ),
    slashContextSpacing: new SlashContextSpacingRule(spacingOptions.insertSpaceAfterAutocomplete),
    mathOperatorSpacing: new MathOperatorSpacingRule(spacingOptions.insertSpaceAfterAutocomplete),
    technicalTokenCompaction: new TechnicalTokenCompactionRule(
      spacingOptions.insertSpaceAfterAutocomplete,
    ),
    collapseRepeatedSpaces: new CollapseRepeatedSpacesRule(),
    trimSpaceBeforeLineBreak: new TrimSpaceBeforeLineBreakRule(),
    neutralPunctuationPolicy: new NeutralPunctuationPolicyRule(),
    ellipsisShortcut: new EllipsisShortcutRule(),
    emdashShortcut: new EmdashShortcutRule(),
    smartQuoteNormalization: new SmartQuoteNormalizationRule(),
    duplicatePunctuationCollapse: new DuplicatePunctuationCollapseRule(),
  };

  return GRAMMAR_RULE_CATALOG.slice()
    .sort((a, b) => a.priority - b.priority)
    .map((entry) => ruleById[entry.id]);
}
