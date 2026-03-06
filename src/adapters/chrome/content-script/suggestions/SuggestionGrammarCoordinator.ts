import { GrammarRuleEngine } from "@core/domain/grammar/GrammarRuleEngine";
import { createGrammarRuleCatalogRuntime } from "@core/domain/grammar/ruleFactory";
import type { GrammarContext, GrammarEdit, GrammarEventType } from "@core/domain/grammar/types";
import type { PredictionInputAction } from "@core/domain/messageTypes";

export class SuggestionGrammarCoordinator {
  private readonly grammarEngine: GrammarRuleEngine;

  constructor(
    private readonly options: {
      enabledGrammarRules: string[];
      insertSpaceAfterAutocomplete: boolean;
      lang: string;
      userDictionaryList: string[];
    },
  ) {
    this.grammarEngine = new GrammarRuleEngine();
    const rules = createGrammarRuleCatalogRuntime({
      insertSpaceAfterAutocomplete: options.insertSpaceAfterAutocomplete,
      userDictionaryList: options.userDictionaryList,
    });
    for (const rule of rules) {
      this.grammarEngine.registerRule(rule);
    }
  }

  public hasEnabledRules(): boolean {
    return this.options.enabledGrammarRules.length > 0;
  }

  public updateLanguage(lang: string): void {
    this.options.lang = lang;
  }

  public run({
    beforeCursor,
    afterCursor,
    inputAction,
    triggers,
  }: {
    beforeCursor: string;
    afterCursor: string;
    inputAction?: PredictionInputAction;
    triggers: GrammarEventType[];
  }): GrammarEdit | null {
    if (!this.hasEnabledRules() || triggers.length === 0) {
      return null;
    }

    const context: GrammarContext = {
      beforeCursor,
      afterCursor,
      hints: {
        inputAction,
        lang: this.options.lang,
        userDictionary: Array.isArray(this.options.userDictionaryList)
          ? this.options.userDictionaryList.slice()
          : [],
      },
    };
    return this.grammarEngine.processSequence(triggers, context, this.options.enabledGrammarRules);
  }
}
