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

    let currentContext: GrammarContext = {
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
    const accumulated: GrammarEdit[] = [];

    for (const trigger of triggers) {
      const edits = this.grammarEngine.process(
        trigger,
        currentContext,
        this.options.enabledGrammarRules,
      );
      if (edits.length === 0) {
        continue;
      }

      for (const edit of edits) {
        accumulated.push(edit);
        currentContext = this.applyEditToContext(currentContext, edit);
      }
    }

    if (accumulated.length === 0) {
      return null;
    }

    return this.mergeEdits(accumulated);
  }

  private applyEditToContext(context: GrammarContext, edit: GrammarEdit): GrammarContext {
    let before = context.beforeCursor;
    let after = context.afterCursor;

    if (edit.deleteBackwards > 0) {
      before = before.slice(0, -edit.deleteBackwards);
    }
    if (edit.deleteForwards > 0) {
      after = after.slice(edit.deleteForwards);
    }

    before += edit.replacement;

    return {
      ...context,
      beforeCursor: before,
      afterCursor: after,
    };
  }

  private mergeEdits(edits: GrammarEdit[]): GrammarEdit {
    let totalDeleteForwards = 0;
    let mergedConfidence: GrammarEdit["confidence"] | undefined;
    let mergedSourceRuleId: GrammarEdit["sourceRuleId"] | undefined;
    let mergedSafetyTier: GrammarEdit["safetyTier"] | undefined;
    let accumulatedString = "";
    let baseDeleteBackwards = 0;

    for (const edit of edits) {
      const deleteIntoBase = Math.max(0, edit.deleteBackwards - accumulatedString.length);
      baseDeleteBackwards += deleteIntoBase;
      const keepAccumulated = accumulatedString.length - edit.deleteBackwards + deleteIntoBase;
      accumulatedString = accumulatedString.slice(0, keepAccumulated) + edit.replacement;

      totalDeleteForwards += edit.deleteForwards;
      if (edit.confidence === "medium") {
        mergedConfidence = "medium";
      } else if (edit.confidence === "high" && mergedConfidence !== "medium") {
        mergedConfidence = "high";
      }
      if (edit.sourceRuleId) {
        mergedSourceRuleId = edit.sourceRuleId;
      }
      if (edit.safetyTier) {
        mergedSafetyTier = edit.safetyTier;
      }
    }

    return {
      replacement: accumulatedString,
      deleteBackwards: baseDeleteBackwards,
      deleteForwards: totalDeleteForwards,
      ...(mergedConfidence ? { confidence: mergedConfidence } : {}),
      ...(mergedSourceRuleId ? { sourceRuleId: mergedSourceRuleId } : {}),
      ...(mergedSafetyTier ? { safetyTier: mergedSafetyTier } : {}),
      description: "Merged edits",
    };
  }
}
