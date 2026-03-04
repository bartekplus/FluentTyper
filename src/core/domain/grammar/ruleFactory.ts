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

export function createGrammarRuleCatalogRuntime(options: {
  insertSpaceAfterAutocomplete: boolean;
}): GrammarRule[] {
  const spacingOptions = {
    insertSpaceAfterAutocomplete: options.insertSpaceAfterAutocomplete,
  };

  const ruleById: Record<CatalogRuleId, GrammarRule> = {
    capitalizeSentenceStart: new CapitalizeSentenceStartRule(),
    capitalizeAfterLineBreak: new CapitalizeAfterLineBreakRule(),
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
  };

  return GRAMMAR_RULE_CATALOG.slice()
    .sort((a, b) => a.priority - b.priority)
    .map((entry) => ruleById[entry.id]);
}
