import { SUPPORTED_LANGUAGES } from "@core/domain/lang";
import { isWhiteSpace } from "@core/application/domain-utils";
import { createLogger } from "@core/application/logging/Logger";
import { getErrorMessage } from "@core/domain/error";
import { Capitalization } from "./CapitalizationHelper";
import { PredictionInputProcessor } from "./PredictionInputProcessor";
import { TemplateExpander } from "./TemplateExpander";
import type { PresageModule } from "./PresageTypes";
import { UserDictionaryManager } from "./UserDictionaryManager";
import { TextExpansionManager } from "./TextExpansionManager";
import type { PresageEngineConfig } from "./PresageEngine";
import { PresageEngine } from "./PresageEngine";
import { MAX_NUM_SUGGESTIONS } from "@core/domain/constants";
import type { PredictionResult } from "./PredictionTypes";
import { SPACING_RULES, Spacing } from "@core/domain/spacingRules";
import { rankPersonalizedCandidates } from "@core/domain/personalization/PersonalizationRanker";
import type { PersonalizationRankingSnapshot } from "@core/domain/personalization/types";
const SUGGESTION_COUNT = 5;
const MIN_WORD_LENGTH_TO_PREDICT = 1;
const logger = createLogger("PresageHandler");

export interface PresageConfig {
  numSuggestions: number;
  engineNumSuggestions?: number;
  minWordLengthToPredict: number;
  insertSpaceAfterAutocomplete: boolean;
  autoCapitalize: boolean;
  textExpansions: Array<[string, object]>;
  prefixOnlyMode: boolean;
  personalizationEnabled?: boolean;

  timeFormat?: string;
  dateFormat?: string;
  userDictionaryList?: string[];
}

interface PresageHandlerOptions {
  getPersonalizationSnapshot?: () => PersonalizationRankingSnapshot;
  now?: () => number;
}

export interface PresagePredictionContext {
  text: string;
  nextChar: string;
  afterCursorTokenSuffix?: string;
  lang: string;
  predictionInput: string;
  doPrediction: boolean;
  doCapitalize: Capitalization;
  effectiveNumSuggestions: number;
  tabId?: number;
}

export class PresageHandler {
  private presageEngines: Record<string, PresageEngine>;
  private lastPredictionInputByLang: Record<string, string> = {};
  private numSuggestions: number;
  private minWordLengthToPredict: number;
  private predictNextWordAfterSeparatorChar: boolean;
  private insertSpaceAfterAutocomplete: boolean;
  private autoCapitalize: boolean;
  private prefixOnlyMode: boolean;
  private userDictionaryList: string[];
  private predictionInputProcessor: PredictionInputProcessor;
  private textExpansionManager: TextExpansionManager;
  private userDictionaryManager: UserDictionaryManager;

  private timeFormat?: string;
  private dateFormat?: string;
  private engineNumSuggestions: number;
  private textExpansionsSignature = "";
  private textExpansionShortcuts = new Set<string>();
  private userDictionarySignature = "";
  private personalizationEnabled = false;
  private readonly getPersonalizationSnapshot: () => PersonalizationRankingSnapshot;
  private readonly now: () => number;

  constructor(Module: PresageModule, options: PresageHandlerOptions = {}) {
    const engineConfig: PresageEngineConfig = {
      numSuggestions: SUGGESTION_COUNT,
      prefixOnlyMode: false,
    };
    this.presageEngines = {};
    this.numSuggestions = SUGGESTION_COUNT;
    this.engineNumSuggestions = MAX_NUM_SUGGESTIONS;
    this.minWordLengthToPredict = MIN_WORD_LENGTH_TO_PREDICT;
    this.predictNextWordAfterSeparatorChar = false;
    this.insertSpaceAfterAutocomplete = true;
    this.autoCapitalize = true;
    this.prefixOnlyMode = false;
    this.userDictionaryList = [];
    this.getPersonalizationSnapshot = options.getPersonalizationSnapshot ?? (() => ({}));
    this.now = options.now ?? Date.now;

    this.predictionInputProcessor = new PredictionInputProcessor(
      this.minWordLengthToPredict,
      this.autoCapitalize,
    );
    for (const [lang] of Object.entries(SUPPORTED_LANGUAGES)) {
      if (lang === "auto_detect") {
        continue;
      }
      try {
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
    const textExpansionsSignature = JSON.stringify(config.textExpansions ?? []);
    const userDictionarySignature = JSON.stringify(config.userDictionaryList ?? []);
    const shouldRefreshEngines =
      textExpansionsSignature !== this.textExpansionsSignature ||
      userDictionarySignature !== this.userDictionarySignature;

    this.numSuggestions = config.numSuggestions;
    this.engineNumSuggestions = Math.min(
      MAX_NUM_SUGGESTIONS,
      Math.max(this.numSuggestions, config.engineNumSuggestions ?? this.numSuggestions),
    );
    this.minWordLengthToPredict = Math.max(0, config.minWordLengthToPredict);
    this.predictNextWordAfterSeparatorChar = this.minWordLengthToPredict === 0;
    this.insertSpaceAfterAutocomplete = config.insertSpaceAfterAutocomplete;
    this.autoCapitalize = config.autoCapitalize;
    this.prefixOnlyMode = config.prefixOnlyMode;
    this.personalizationEnabled = config.personalizationEnabled ?? false;
    this.textExpansionShortcuts = new Set(
      (config.textExpansions ?? []).map(([shortcut]) => shortcut.trim().toLocaleLowerCase()),
    );

    this.timeFormat = config.timeFormat;
    this.dateFormat = config.dateFormat;
    this.userDictionaryList = config.userDictionaryList || [];

    if (shouldRefreshEngines) {
      this.refreshPresageEngines();
      this.textExpansionsSignature = textExpansionsSignature;
      this.userDictionarySignature = userDictionarySignature;
    }

    this.textExpansionManager.setTextExpansions(config.textExpansions);
    this.userDictionaryManager.setUserDictionaryList(this.userDictionaryList);

    this.predictionInputProcessor = new PredictionInputProcessor(
      this.minWordLengthToPredict,
      this.autoCapitalize,
    );
    for (const [, presageEngine] of Object.entries(this.presageEngines)) {
      presageEngine.setConfig({
        numSuggestions: this.engineNumSuggestions,
        prefixOnlyMode: this.prefixOnlyMode,
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

  hasLanguageEngine(lang: string): boolean {
    return lang in this.presageEngines;
  }

  processInput(
    predictionInput: string,
    language: string,
    numSuggestions: number = this.numSuggestions,
    afterCursorTokenSuffix?: string,
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
      afterCursorTokenSuffix,
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
    const resolver = TemplateExpander.createResolver(
      lang,
      this.timeFormat ?? "",
      this.dateFormat ?? "",
      tabId,
    );
    const predictions = this.presageEngines[lang].predict(predictionInput);
    this.lastPredictionInputByLang[lang] = predictionInput;
    return Promise.all(
      predictions.map((text) => TemplateExpander.parseStringTemplateAsync(text, resolver)),
    );
  }

  preparePredictionContext(
    text: string,
    nextChar: string,
    lang: string,
    numSuggestionsOverride?: number,
    tabId?: number,
    afterCursorTokenSuffix?: string,
  ): PresagePredictionContext {
    const effectiveNumSuggestions =
      typeof numSuggestionsOverride === "number"
        ? Math.min(MAX_NUM_SUGGESTIONS, Math.max(0, Math.round(numSuggestionsOverride)))
        : this.numSuggestions;
    const { predictionInput, doPrediction, doCapitalize } = this.processInput(
      text,
      lang,
      effectiveNumSuggestions,
      afterCursorTokenSuffix,
    );

    return {
      text,
      nextChar,
      afterCursorTokenSuffix,
      lang,
      predictionInput,
      doPrediction,
      doCapitalize,
      effectiveNumSuggestions,
      tabId,
    };
  }

  async predictPresage(context: PresagePredictionContext): Promise<string[]> {
    if (
      !context.doPrediction ||
      context.effectiveNumSuggestions <= 0 ||
      !this.hasLanguageEngine(context.lang)
    ) {
      return [];
    }
    const predictions = await this.doPredictionHandler(
      context.predictionInput,
      context.lang,
      context.tabId,
    );
    if (!this.personalizationEnabled || this.isTextExpansionRequest(context.predictionInput)) {
      return predictions;
    }

    const inputLower = context.predictionInput.trim().toLocaleLowerCase();
    const pinnedCandidates = new Set(
      predictions.filter((candidate) => candidate.toLocaleLowerCase() === inputLower),
    );
    return rankPersonalizedCandidates({
      candidates: predictions,
      language: context.lang,
      snapshot: this.getPersonalizationSnapshot(),
      nowMs: this.now(),
      pinnedCandidates,
    });
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
    );
  }

  async runPrediction(
    text: string,
    nextChar: string,
    lang: string,
    configOverride?: { numSuggestions?: number; tabId?: number },
    afterCursorTokenSuffix?: string,
  ): Promise<PredictionResult> {
    const context = this.preparePredictionContext(
      text,
      nextChar,
      lang,
      configOverride?.numSuggestions,
      configOverride?.tabId,
      afterCursorTokenSuffix,
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
    return { predictions };
  }

  getLastPredictionInput(lang: string): string {
    return this.lastPredictionInputByLang[lang] ?? "";
  }

  private refreshPresageEngines(): void {
    for (const presageEngine of Object.values(this.presageEngines)) {
      presageEngine.reinitialize();
    }
  }

  private isTextExpansionRequest(predictionInput: string): boolean {
    const finalToken = predictionInput.trim().split(/\s+/u).at(-1)?.toLocaleLowerCase();
    return finalToken ? this.textExpansionShortcuts.has(finalToken) : false;
  }
}
