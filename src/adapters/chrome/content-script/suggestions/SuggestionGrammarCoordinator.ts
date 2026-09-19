import { GrammarRuleEngine } from "@core/domain/grammar/GrammarRuleEngine";
import { createGrammarRuleCatalogRuntime } from "@core/domain/grammar/ruleFactory";
import type {
  GrammarContext,
  GrammarEdit,
  GrammarEventType,
  GrammarHints,
} from "@core/domain/grammar/types";
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
    measurementContext,
  }: {
    beforeCursor: string;
    afterCursor: string;
    inputAction?: PredictionInputAction;
    triggers: GrammarEventType[];
    measurementContext?: GrammarHints["measurementContext"];
  }): GrammarEdit | null {
    if (!this.hasEnabledRules() || triggers.length === 0) {
      return null;
    }

    const context: GrammarContext = {
      beforeCursor,
      afterCursor,
      hints: {
        inputAction,
        // The engine already skips disabled rules; the numeric guards in the
        // punctuation rules need this context regardless of that toggle.
        measurementContext,
        isPaste: triggers.includes("paste"),
        lang: this.options.lang,
        userDictionary: Array.isArray(this.options.userDictionaryList)
          ? this.options.userDictionaryList.slice()
          : [],
      },
    };
    return this.grammarEngine.processSequence(triggers, context, this.options.enabledGrammarRules);
  }

  /**
   * Runs the word-boundary rules as if the boundary the caller is about to hand
   * to the host had already been typed, then shifts the edit back off that
   * virtual character so only the text the user really typed changes.
   *
   * Enter needs this because a chat box that submits never turns the key into
   * text, so the boundary rules would otherwise never see the final word.
   */
  public runVirtualWordBoundary(args: {
    beforeCursor: string;
    afterCursor: string;
    measurementContext?: GrammarHints["measurementContext"];
  }): GrammarEdit | null {
    const edit = this.run({
      beforeCursor: `${args.beforeCursor}\n`,
      afterCursor: args.afterCursor,
      measurementContext: args.measurementContext,
      inputAction: "insert",
      triggers: ["wordBoundary"],
    });
    if (
      !edit ||
      edit.cursorOffset !== undefined ||
      edit.deleteForwards > 0 ||
      edit.deleteBackwards < 1 ||
      !edit.replacement.endsWith("\n")
    ) {
      // The edit either never reached the virtual boundary or rewrote around
      // it; unshifting those safely is not worth guessing at.
      return null;
    }
    const replacement = edit.replacement.slice(0, -1);
    const deleteBackwards = edit.deleteBackwards - 1;
    if (replacement.length === 0 && deleteBackwards === 0) {
      return null;
    }
    return { ...edit, replacement, deleteBackwards };
  }
}
