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
import { AutoBracketCloseRule } from "./implementations/AutoBracketCloseRule";

export function createGrammarRuleCatalogRuntime(options: {
  insertSpaceAfterAutocomplete: boolean;
  userDictionaryList: string[];
}): GrammarRule[] {
  const insertSpaceAfterAutocomplete = options.insertSpaceAfterAutocomplete;

  const ruleById: Record<CatalogRuleId, GrammarRule> = {
    // Core v1/v2 language rules.
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

    // Spacing and punctuation rules share the autocomplete spacing toggle.
    commaPeriodSpacing: new CommaPeriodSpacingRule(insertSpaceAfterAutocomplete),
    openingBracketSpacing: new OpeningBracketSpacingRule(insertSpaceAfterAutocomplete),
    closingBracketSpacing: new ClosingBracketSpacingRule(insertSpaceAfterAutocomplete),
    slashContextSpacing: new SlashContextSpacingRule(insertSpaceAfterAutocomplete),
    mathOperatorSpacing: new MathOperatorSpacingRule(insertSpaceAfterAutocomplete),
    technicalTokenCompaction: new TechnicalTokenCompactionRule(insertSpaceAfterAutocomplete),
    collapseRepeatedSpaces: new CollapseRepeatedSpacesRule(),
    trimSpaceBeforeLineBreak: new TrimSpaceBeforeLineBreakRule(),
    neutralPunctuationPolicy: new NeutralPunctuationPolicyRule(),

    // Advanced rules stay grouped together so the catalog order is the only priority source.
    ellipsisShortcut: new EllipsisShortcutRule(),
    emdashShortcut: new EmdashShortcutRule(),
    smartQuoteNormalization: new SmartQuoteNormalizationRule(),
    duplicatePunctuationCollapse: new DuplicatePunctuationCollapseRule(),
    autoBracketClose: new AutoBracketCloseRule(),
  };

  return GRAMMAR_RULE_CATALOG.slice()
    .sort((a, b) => a.priority - b.priority)
    .map((entry) => ruleById[entry.id]);
}
