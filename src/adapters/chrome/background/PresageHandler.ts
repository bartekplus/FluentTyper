import { SUPPORTED_LANGUAGES } from "@core/domain/lang";
import { isWhiteSpace } from "@core/application/domain-utils";
import { createLogger } from "@core/application/logging/Logger";
import { getErrorMessage } from "@core/domain/error";
import { Capitalization } from "./CapitalizationHelper";
import { PredictionInputProcessor } from "./PredictionInputProcessor";
import type { TemplateVariables } from "./TemplateExpander";
import { TemplateExpander } from "./TemplateExpander";
import type { PresageModule } from "./PresageTypes";
import { UserDictionaryManager } from "./UserDictionaryManager";
import { TextExpansionManager } from "./TextExpansionManager";
import type { PresageEngineConfig } from "./PresageEngine";
import { PresageEngine } from "./PresageEngine";
import type { PredictionInputAction, TextEditOperation } from "@core/domain/messageTypes";
import { MAX_NUM_SUGGESTIONS } from "@core/domain/constants";
import type { PredictionResult } from "./PredictionTypes";
import { GrammarRuleEngine } from "@core/domain/grammar/GrammarRuleEngine";
import { SPACE_CHARS, SPACING_RULES, Spacing } from "@core/domain/spacingRules";
import { createGrammarRuleCatalogRuntime } from "@core/domain/grammar/ruleFactory";
import { normalizeGrammarRuleSelection } from "@core/domain/grammar/ruleCatalog";
const SUGGESTION_COUNT = 5;
const MIN_WORD_LENGTH_TO_PREDICT = 1;
const logger = createLogger("PresageHandler");

interface LastPrediction {
  pastStream: string;
  predictions: string[];
}

export interface PresageConfig {
  numSuggestions: number;
  engineNumSuggestions?: number;
  minWordLengthToPredict: number;
  insertSpaceAfterAutocomplete: boolean;
  autoCapitalize: boolean;
  textExpansions: Array<[string, object]>;

  timeFormat?: string;
  dateFormat?: string;
  userDictionaryList?: string[];
  enabledGrammarRules?: string[];
}

export interface PresagePredictionContext {
  text: string;
  nextChar: string;
  lang: string;
  predictionInput: string;
  doPrediction: boolean;
  doCapitalize: Capitalization;
  textEdit: TextEditOperation | null;
  effectiveNumSuggestions: number;
  tabId?: number;
}

export class PresageHandler {
  private presageEngines: Record<string, PresageEngine>;
  private lastPrediction: Record<string, LastPrediction>;
  private numSuggestions: number;
  private minWordLengthToPredict: number;
  private predictNextWordAfterSeparatorChar: boolean;
  private insertSpaceAfterAutocomplete: boolean;
  private autoCapitalize: boolean;
  private userDictionaryList: string[];
  private grammarEngine: GrammarRuleEngine;
  private enabledGrammarRules: string[] = [];
  private predictionInputProcessor: PredictionInputProcessor;
  private textExpansionManager: TextExpansionManager;
  private userDictionaryManager: UserDictionaryManager;

  private timeFormat?: string;
  private dateFormat?: string;
  private engineNumSuggestions: number;

  constructor(Module: PresageModule) {
    const engineConfig: PresageEngineConfig = {
      numSuggestions: SUGGESTION_COUNT,
    };
    this.presageEngines = {};
    this.lastPrediction = {};
    this.numSuggestions = SUGGESTION_COUNT;
    this.engineNumSuggestions = MAX_NUM_SUGGESTIONS;
    this.minWordLengthToPredict = MIN_WORD_LENGTH_TO_PREDICT;
    this.predictNextWordAfterSeparatorChar = false;
    this.insertSpaceAfterAutocomplete = true;
    this.autoCapitalize = true;
    this.userDictionaryList = [];

    this.grammarEngine = this.buildGrammarEngine(this.insertSpaceAfterAutocomplete);

    this.predictionInputProcessor = new PredictionInputProcessor(
      this.minWordLengthToPredict,
      this.autoCapitalize,
    );
    for (const [lang] of Object.entries(SUPPORTED_LANGUAGES)) {
      if (lang === "auto_detect") {
        continue;
      }
      try {
        this.lastPrediction[lang] = { pastStream: "", predictions: [] };
        this.presageEngines[lang] = new PresageEngine(Module, engineConfig, lang);
      } catch (error) {
        logger.warn("Failed to create Presage engine instance", {
          lang,
          error: getErrorMessage(error),
        });
      }
    }
    this.textExpansionManager = new TextExpansionManager(Module, this.presageEngines);
    this.userDictionaryManager = new UserDictionaryManager(Module, this.presageEngines);
  }

  setConfig(config: PresageConfig): void {
    this.numSuggestions = config.numSuggestions;
    this.engineNumSuggestions = Math.min(
      MAX_NUM_SUGGESTIONS,
      Math.max(this.numSuggestions, config.engineNumSuggestions ?? this.numSuggestions),
    );
    this.minWordLengthToPredict = Math.max(0, config.minWordLengthToPredict);
    this.predictNextWordAfterSeparatorChar = this.minWordLengthToPredict === 0;
    this.insertSpaceAfterAutocomplete = config.insertSpaceAfterAutocomplete;
    this.autoCapitalize = config.autoCapitalize;

    this.timeFormat = config.timeFormat;
    this.dateFormat = config.dateFormat;
    this.userDictionaryList = config.userDictionaryList || [];

    this.textExpansionManager.setTextExpansions(config.textExpansions);
    this.userDictionaryManager.setUserDictionaryList(this.userDictionaryList);
    this.enabledGrammarRules = normalizeGrammarRuleSelection(config.enabledGrammarRules);
    this.grammarEngine = this.buildGrammarEngine(config.insertSpaceAfterAutocomplete);

    this.predictionInputProcessor = new PredictionInputProcessor(
      this.minWordLengthToPredict,
      this.autoCapitalize,
    );
    for (const [, presageEngine] of Object.entries(this.presageEngines)) {
      presageEngine.setConfig({
        numSuggestions: this.engineNumSuggestions,
      });
    }
  }

  getDebugState(): {
    languageEngineCount: number;
  } {
    return {
      languageEngineCount: Object.keys(this.presageEngines).length,
    };
  }

  private buildGrammarEngine(insertSpaceAfterAutocomplete: boolean): GrammarRuleEngine {
    const engine = new GrammarRuleEngine();
    const rules = createGrammarRuleCatalogRuntime({
      insertSpaceAfterAutocomplete,
      userDictionaryList: this.userDictionaryList,
    });
    for (const rule of rules) {
      engine.registerRule(rule);
    }
    return engine;
  }

  hasLanguageEngine(lang: string): boolean {
    return lang in this.presageEngines;
  }

  parseStringTemplate(str: string, obj: TemplateVariables): string {
    return TemplateExpander.parseStringTemplate(str, obj);
  }

  getExpandedVariables(lang: string): TemplateVariables {
    return TemplateExpander.getExpandedVariables(
      lang,

      this.timeFormat ?? "",
      this.dateFormat ?? "",
    );
  }

  removePrevSentence(wordArrayOrig: string[]): {
    wordArray: string[];
    foundNewSentence: boolean;
  } {
    const result = this.predictionInputProcessor.removePrevSentence(wordArrayOrig);
    return {
      wordArray: result.wordArray,
      foundNewSentence: result.newSentence,
    };
  }

  processInput(
    predictionInput: string,
    language: string,
    numSuggestions: number = this.numSuggestions,
  ): {
    predictionInput: string;
    lastWord: string;
    doPrediction: boolean;
    doCapitalize: Capitalization;
  } {
    return this.predictionInputProcessor.processInput(
      predictionInput,
      language,
      numSuggestions,
      this.predictNextWordAfterSeparatorChar,
    );
  }

  async doPredictionHandler(
    predictionInput: string,
    lang: string,
    tabId?: number,
  ): Promise<string[]> {
    if (!this.hasLanguageEngine(lang)) {
      return [];
    }
    if (predictionInput === this.lastPrediction[lang]?.pastStream) {
      return this.lastPrediction[lang].predictions.slice();
    }
    const predictions = this.presageEngines[lang].predict(predictionInput);

    const resolver = TemplateExpander.createResolver(
      lang,

      this.timeFormat ?? "",
      this.dateFormat ?? "",
      tabId,
    );

    const expandedPredictions = await Promise.all(
      predictions.map((text) => TemplateExpander.parseStringTemplateAsync(text, resolver)),
    );

    this.lastPrediction[lang] = {
      pastStream: predictionInput,
      predictions: expandedPredictions.slice(),
    };
    return expandedPredictions;
  }

  preparePredictionContext(
    text: string,
    nextChar: string,
    lang: string,
    numSuggestionsOverride?: number,
    tabId?: number,
    inputAction?: PredictionInputAction,
  ): PresagePredictionContext {
    const effectiveNumSuggestions =
      typeof numSuggestionsOverride === "number"
        ? Math.min(MAX_NUM_SUGGESTIONS, Math.max(0, Math.round(numSuggestionsOverride)))
        : this.numSuggestions;
    const { predictionInput, doPrediction, doCapitalize } = this.processInput(
      text,
      lang,
      effectiveNumSuggestions,
    );

    let textEdit: TextEditOperation | null = null;
    if (this.enabledGrammarRules.length > 0) {
      // Determine event type
      const isWordBoundary = text.length > 0 && SPACE_CHARS.includes(text[text.length - 1]);
      const eventType = isWordBoundary ? "wordBoundary" : "insertChar";

      const edits = this.grammarEngine.process(
        eventType,
        {
          beforeCursor: text,
          afterCursor: "",
          charTyped: nextChar,
          hints: {
            inputAction,
            lang,
            userDictionary: this.userDictionaryList.slice(),
          },
        },
        this.enabledGrammarRules,
      );

      if (edits.length > 0) {
        // Map merged GrammarEdit -> TextEditOperation (backward deletion only)
        const edit = edits[0];

        // Guard: TextEditOperation does not support forward deletion.
        // The engine should already clamp this, but reject here as a safety net.
        if (edit.deleteForwards > 0) {
          logger.warn(
            "Grammar edit with deleteForwards > 0 cannot be mapped to TextEditOperation, skipping",
            {
              deleteForwards: edit.deleteForwards,
              replacement: edit.replacement,
            },
          );
        } else {
          textEdit = {
            replaceBackwardCount: edit.deleteBackwards,
            replacementText: edit.replacement,
            evaluatedTextLength: text.length,
            expectedReplacedText: text.slice(text.length - edit.deleteBackwards),
            expectedPrefixToken: text.slice(
              Math.max(0, text.length - edit.deleteBackwards - 10),
              text.length - edit.deleteBackwards,
            ),
          };
        }
      }
    }

    return {
      text,
      nextChar,
      lang,
      predictionInput,
      doPrediction,
      doCapitalize,
      textEdit,
      effectiveNumSuggestions,
      tabId,
    };
  }

  async predictPresage(context: PresagePredictionContext): Promise<string[]> {
    if (!context.doPrediction) {
      return [];
    }
    if (context.effectiveNumSuggestions <= 0) {
      return [];
    }
    if (!this.hasLanguageEngine(context.lang)) {
      return [];
    }
    return this.doPredictionHandler(context.predictionInput, context.lang, context.tabId);
  }

  finalizePrediction(
    predictionCandidates: string[],
    context: PresagePredictionContext,
  ): PredictionResult {
    return this.applyPredictionOutputRules(
      predictionCandidates,
      context.predictionInput,
      context.nextChar,
      context.doCapitalize,
      context.effectiveNumSuggestions,
      context.textEdit,
    );
  }

  async runPrediction(
    text: string,
    nextChar: string,
    lang: string,
    configOverride?: { numSuggestions?: number; tabId?: number },
    inputAction?: PredictionInputAction,
  ): Promise<PredictionResult> {
    const context = this.preparePredictionContext(
      text,
      nextChar,
      lang,
      configOverride?.numSuggestions,
      configOverride?.tabId,
      inputAction,
    );
    const predictions = await this.predictPresage(context);
    return this.finalizePrediction(predictions, context);
  }

  private applyPredictionOutputRules(
    predictionCandidates: string[],
    predictionInput: string,
    nextChar: string,
    doCapitalize: Capitalization,
    effectiveNumSuggestions: number,
    textEdit: TextEditOperation | null,
  ): PredictionResult {
    let predictions = predictionCandidates.slice();
    if (predictions.length > effectiveNumSuggestions) {
      predictions = predictions.slice(0, effectiveNumSuggestions);
    }
    // Sort prediction so that the most relevant ones are at the top
    // eg. if input is "the act", then "act" will be first and "action" will be second
    if (predictions.length > 1 && predictionInput.trim().length > 0) {
      const inputLower = predictionInput.trim().toLowerCase();
      predictions.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        // Exact match first
        if (aLower === inputLower && bLower !== inputLower) {
          return -1;
        }
        if (bLower === inputLower && aLower !== inputLower) {
          return 1;
        }
        // Keep original order for now, follow presage order
        return 0;
      });
    }
    if (this.insertSpaceAfterAutocomplete) {
      if (
        nextChar !== undefined &&
        nextChar !== null &&
        (nextChar === "" ||
          nextChar === "\n" ||
          (!isWhiteSpace(nextChar, true) &&
            (!(nextChar in SPACING_RULES) ||
              SPACING_RULES[nextChar].spaceBefore === Spacing.INSERT_SPACE)))
      ) {
        predictions = predictions.map((pred) => `${pred} `);
      }
    }
    switch (doCapitalize) {
      case Capitalization.FirstLetter:
        predictions = predictions.map((pred) => pred.charAt(0).toUpperCase() + pred.slice(1));
        break;
      case Capitalization.WholeWord:
        predictions = predictions.map((pred) => pred.toUpperCase());
        break;
      case Capitalization.None:
      default:
    }
    return { predictions, textEdit };
  }

  getLastPredictionInput(lang: string): string {
    if (lang in this.lastPrediction) {
      return this.lastPrediction[lang].pastStream;
    }
    return "";
  }
}
