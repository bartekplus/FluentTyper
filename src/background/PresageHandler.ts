import { SUPPORTED_LANGUAGES } from "../shared/lang";
import { isWhiteSpace } from "../shared/utils";
import {
  SpacingRulesHandler,
  Spacing,
  SPACING_RULES,
} from "./SpacingRulesHandler";
import { getErrorMessage } from "../shared/error";
import { Capitalization } from "./CapitalizationHelper";
import { PredictionInputProcessor } from "./PredictionInputProcessor";
import { TemplateExpander, TemplateVariables } from "./TemplateExpander";
import { PresageModule } from "./PresageTypes";
import { UserDictionaryManager } from "./UserDictionaryManager";
import { TextExpansionManager } from "./TextExpansionManager";
import { PresageEngine, PresageEngineConfig } from "./PresageEngine";
import { ForceReplaceType } from "../shared/messageTypes";
import {
  DEFAULT_AI_MODEL_ID,
  DEFAULT_AI_PREDICTION_TIMEOUT_MS,
  DEFAULT_DEBUG_AI_PREDICTOR_ENABLED,
  DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  MAX_NUM_SUGGESTIONS,
} from "../shared/constants";
import { WebLLMPredictor } from "./WebLLMPredictor";

const SUGGESTION_COUNT = 5;
const MIN_WORD_LENGTH_TO_PREDICT = 1;
const PRESAGE_INTERLEAVE_COUNT = 2;

export interface PredictionResult {
  predictions: string[];
  forceReplace: ForceReplaceType | null;
}

export interface PredictorStageDebugInfo {
  enabled: boolean;
  attempted: boolean;
  durationMs: number;
  timedOut: boolean;
  predictions: string[];
  skipReason?: string;
}

export interface PredictionDebugEvent {
  timestampMs: number;
  text: string;
  nextChar: string;
  lang: string;
  predictionInput: string;
  numSuggestions: number;
  doPrediction: boolean;
  forceReplace: boolean;
  totalDurationMs: number;
  presage: PredictorStageDebugInfo;
  webllm: PredictorStageDebugInfo & {
    modelId: string;
  };
  mergedPredictions: string[];
  finalPredictions: string[];
}

export type PredictionRunConfig = {
  numSuggestions?: number;
  debugListener?: (debugEvent: PredictionDebugEvent) => void;
};

interface LastPrediction {
  pastStream: string;
  predictions: string[];
}

export type PresageConfig = {
  numSuggestions: number;
  engineNumSuggestions?: number;
  minWordLengthToPredict: number;
  insertSpaceAfterAutocomplete: boolean;
  autoCapitalize: boolean;
  applySpacingRules: boolean;
  textExpansions: Array<[string, object]>;
  variableExpansion?: boolean;
  timeFormat?: string;
  dateFormat?: string;
  userDictionaryList?: string[];
  aiPredictorEnabled?: boolean;
  aiModelId?: string;
  aiPredictionTimeoutMs?: number;
  debugPresagePredictorEnabled?: boolean;
  debugAIPredictorEnabled?: boolean;
};

function clampAIPredictionTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AI_PREDICTION_TIMEOUT_MS;
  }
  return Math.min(2000, Math.max(20, Math.round(value)));
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
  private spacingHandler: SpacingRulesHandler;
  private predictionInputProcessor: PredictionInputProcessor;
  private textExpansionManager: TextExpansionManager;
  private userDictionaryManager: UserDictionaryManager;
  private variableExpansion?: boolean;
  private timeFormat?: string;
  private dateFormat?: string;
  private engineNumSuggestions: number;
  private aiPredictor: WebLLMPredictor | null;
  private aiPredictorEnabled: boolean;
  private aiModelId: string;
  private aiPredictionTimeoutMs: number;
  private debugPresagePredictorEnabled: boolean;
  private debugAIPredictorEnabled: boolean;

  constructor(Module: PresageModule, aiPredictor?: WebLLMPredictor) {
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
    this.aiPredictor = aiPredictor || null;
    this.aiPredictorEnabled = false;
    this.aiModelId = DEFAULT_AI_MODEL_ID;
    this.aiPredictionTimeoutMs = DEFAULT_AI_PREDICTION_TIMEOUT_MS;
    this.debugPresagePredictorEnabled = DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED;
    this.debugAIPredictorEnabled = DEFAULT_DEBUG_AI_PREDICTOR_ENABLED;
    this.spacingHandler = new SpacingRulesHandler(
      this.insertSpaceAfterAutocomplete,
      false,
    );
    this.predictionInputProcessor = new PredictionInputProcessor(
      this.minWordLengthToPredict,
      this.autoCapitalize,
    );
    for (const [lang] of Object.entries(SUPPORTED_LANGUAGES)) {
      if (lang === "auto_detect") continue;
      try {
        this.lastPrediction[lang] = { pastStream: "", predictions: [] };
        this.presageEngines[lang] = new PresageEngine(
          Module,
          engineConfig,
          lang,
        );
      } catch (error) {
        console.warn(
          `Failed to create Presage instance for ${lang} language: ${getErrorMessage(error)}`,
        );
      }
    }
    this.textExpansionManager = new TextExpansionManager(
      Module,
      this.presageEngines,
    );
    this.userDictionaryManager = new UserDictionaryManager(
      Module,
      this.presageEngines,
    );
  }

  setConfig(config: PresageConfig): void {
    this.numSuggestions = config.numSuggestions;
    this.engineNumSuggestions = Math.min(
      MAX_NUM_SUGGESTIONS,
      Math.max(
        this.numSuggestions,
        config.engineNumSuggestions ?? this.numSuggestions,
      ),
    );
    this.minWordLengthToPredict = Math.max(0, config.minWordLengthToPredict);
    this.predictNextWordAfterSeparatorChar =
      this.minWordLengthToPredict === 0 ? true : false;
    this.insertSpaceAfterAutocomplete = config.insertSpaceAfterAutocomplete;
    this.autoCapitalize = config.autoCapitalize;
    this.variableExpansion = config.variableExpansion;
    this.timeFormat = config.timeFormat;
    this.dateFormat = config.dateFormat;
    this.userDictionaryList = config.userDictionaryList || [];
    this.aiPredictorEnabled = config.aiPredictorEnabled ?? false;
    this.aiModelId =
      typeof config.aiModelId === "string" && config.aiModelId.trim().length > 0
        ? config.aiModelId
        : DEFAULT_AI_MODEL_ID;
    this.aiPredictionTimeoutMs = clampAIPredictionTimeoutMs(
      config.aiPredictionTimeoutMs,
    );
    this.debugPresagePredictorEnabled =
      typeof config.debugPresagePredictorEnabled === "boolean"
        ? config.debugPresagePredictorEnabled
        : DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED;
    this.debugAIPredictorEnabled =
      typeof config.debugAIPredictorEnabled === "boolean"
        ? config.debugAIPredictorEnabled
        : DEFAULT_DEBUG_AI_PREDICTOR_ENABLED;
    this.textExpansionManager.setTextExpansions(config.textExpansions);
    this.userDictionaryManager.setUserDictionaryList(this.userDictionaryList);
    this.spacingHandler = new SpacingRulesHandler(
      config.insertSpaceAfterAutocomplete,
      config.applySpacingRules,
    );
    this.predictionInputProcessor = new PredictionInputProcessor(
      this.minWordLengthToPredict,
      this.autoCapitalize,
    );
    for (const [, presageEngine] of Object.entries(this.presageEngines)) {
      presageEngine.setConfig({
        numSuggestions: this.engineNumSuggestions,
      });
    }
    this.aiPredictor?.setConfig({
      enabled: this.aiPredictorEnabled,
      modelId: this.aiModelId,
    });
    if (
      this.aiPredictorEnabled &&
      this.aiPredictor &&
      typeof (this.aiPredictor as { preload?: unknown }).preload === "function"
    ) {
      void this.aiPredictor.preload();
    }
  }

  getDebugState(): {
    predictorConfig: {
      aiPredictorEnabled: boolean;
      aiModelId: string;
      aiPredictionTimeoutMs: number;
      debugPresagePredictorEnabled: boolean;
      debugAIPredictorEnabled: boolean;
    };
    languageEngineCount: number;
  } {
    return {
      predictorConfig: {
        aiPredictorEnabled: this.aiPredictorEnabled,
        aiModelId: this.aiModelId,
        aiPredictionTimeoutMs: this.aiPredictionTimeoutMs,
        debugPresagePredictorEnabled: this.debugPresagePredictorEnabled,
        debugAIPredictorEnabled: this.debugAIPredictorEnabled,
      },
      languageEngineCount: Object.keys(this.presageEngines).length,
    };
  }

  parseStringTemplate(str: string, obj: TemplateVariables): string {
    return TemplateExpander.parseStringTemplate(str, obj);
  }

  getExpandedVariables(lang: string): TemplateVariables {
    return TemplateExpander.getExpandedVariables(
      lang,
      this.variableExpansion ?? false,
      this.timeFormat ?? "",
      this.dateFormat ?? "",
    );
  }

  removePrevSentence(wordArrayOrig: string[]): {
    wordArray: string[];
    foundNewSentence: boolean;
  } {
    const result =
      this.predictionInputProcessor.removePrevSentence(wordArrayOrig);
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

  doPredictionHandler(predictionInput: string, lang: string): string[] {
    if (predictionInput === this.lastPrediction[lang]?.pastStream) {
      return this.lastPrediction[lang].predictions.slice();
    }
    const predictions = this.presageEngines[lang].predict(predictionInput);
    const expandedTemplateVariables = this.getExpandedVariables(lang);
    const expandedPredictions = predictions.map((text) =>
      this.parseStringTemplate(text, expandedTemplateVariables),
    );
    this.lastPrediction[lang] = {
      pastStream: predictionInput,
      predictions: expandedPredictions.slice(),
    };
    return expandedPredictions;
  }

  runPrediction(
    text: string,
    nextChar: string,
    lang: string,
    configOverride?: PredictionRunConfig,
  ): PredictionResult | Promise<PredictionResult> {
    const startedAt = Date.now();
    const overrideSuggestionCount = configOverride?.numSuggestions;
    const debugListener = configOverride?.debugListener;
    const effectiveNumSuggestions =
      typeof overrideSuggestionCount === "number"
        ? Math.min(
            MAX_NUM_SUGGESTIONS,
            Math.max(0, Math.round(overrideSuggestionCount)),
          )
        : this.numSuggestions;
    let predictions: string[] = [];
    const { predictionInput, doPrediction, doCapitalize } = this.processInput(
      text,
      lang,
      effectiveNumSuggestions,
    );
    const forceReplace = this.spacingHandler.applySpacingRules(text);
    const presageDebug: PredictorStageDebugInfo = {
      enabled: this.debugPresagePredictorEnabled,
      attempted: false,
      durationMs: 0,
      timedOut: false,
      predictions: [],
      skipReason: undefined,
    };
    const aiDebug: PredictorStageDebugInfo & { modelId: string } = {
      enabled: this.aiPredictorEnabled && this.debugAIPredictorEnabled,
      attempted: false,
      durationMs: 0,
      timedOut: false,
      predictions: [],
      skipReason: undefined,
      modelId: this.aiModelId,
    };
    const canRunBasePrediction =
      !forceReplace && doPrediction && effectiveNumSuggestions > 0;
    const canRunPresage =
      canRunBasePrediction &&
      this.debugPresagePredictorEnabled &&
      lang in this.presageEngines;
    if (canRunPresage) {
      presageDebug.attempted = true;
      const presageStartedAt = Date.now();
      predictions = this.doPredictionHandler(predictionInput, lang);
      presageDebug.durationMs = Date.now() - presageStartedAt;
      presageDebug.predictions = predictions.slice();
    } else {
      presageDebug.skipReason = this.resolvePresageSkipReason(
        lang,
        doPrediction,
        forceReplace,
        effectiveNumSuggestions,
      );
    }

    const shouldRunAIPredictor =
      canRunBasePrediction &&
      this.debugAIPredictorEnabled &&
      this.aiPredictorEnabled &&
      this.aiPredictor !== null &&
      effectiveNumSuggestions > 0;
    if (!shouldRunAIPredictor) {
      aiDebug.skipReason = this.resolveAISkipReason(
        doPrediction,
        forceReplace,
        effectiveNumSuggestions,
      );
    }

    if (!shouldRunAIPredictor) {
      const result = this.applyPredictionOutputRules(
        predictions,
        predictionInput,
        nextChar,
        doCapitalize,
        effectiveNumSuggestions,
        forceReplace,
      );
      this.emitDebugEvent(debugListener, {
        timestampMs: Date.now(),
        text,
        nextChar,
        lang,
        predictionInput,
        numSuggestions: effectiveNumSuggestions,
        doPrediction,
        forceReplace: Boolean(forceReplace),
        totalDurationMs: Date.now() - startedAt,
        presage: presageDebug,
        webllm: aiDebug,
        mergedPredictions: predictions.slice(),
        finalPredictions: result.predictions.slice(),
      });
      return result;
    }

    aiDebug.attempted = true;
    const aiPromise = this.runAIPredictionWithTimeout(
      lang,
      predictionInput,
      effectiveNumSuggestions,
    );
    return aiPromise
      .then((aiResult) => {
        aiDebug.durationMs = aiResult.durationMs;
        aiDebug.timedOut = aiResult.timedOut;
        aiDebug.predictions = aiResult.predictions.slice();
        const mergedPredictions = this.mergePredictions(
          predictions,
          aiResult.predictions,
          effectiveNumSuggestions,
        );
        const result = this.applyPredictionOutputRules(
          mergedPredictions,
          predictionInput,
          nextChar,
          doCapitalize,
          effectiveNumSuggestions,
          forceReplace,
        );
        this.emitDebugEvent(debugListener, {
          timestampMs: Date.now(),
          text,
          nextChar,
          lang,
          predictionInput,
          numSuggestions: effectiveNumSuggestions,
          doPrediction,
          forceReplace: Boolean(forceReplace),
          totalDurationMs: Date.now() - startedAt,
          presage: presageDebug,
          webllm: aiDebug,
          mergedPredictions: mergedPredictions.slice(),
          finalPredictions: result.predictions.slice(),
        });
        return result;
      })
      .catch(() => {
        const result = this.applyPredictionOutputRules(
          predictions,
          predictionInput,
          nextChar,
          doCapitalize,
          effectiveNumSuggestions,
          forceReplace,
        );
        this.emitDebugEvent(debugListener, {
          timestampMs: Date.now(),
          text,
          nextChar,
          lang,
          predictionInput,
          numSuggestions: effectiveNumSuggestions,
          doPrediction,
          forceReplace: Boolean(forceReplace),
          totalDurationMs: Date.now() - startedAt,
          presage: presageDebug,
          webllm: aiDebug,
          mergedPredictions: predictions.slice(),
          finalPredictions: result.predictions.slice(),
        });
        return result;
      });
  }

  private async runAIPredictionWithTimeout(
    lang: string,
    predictionInput: string,
    numSuggestions: number,
  ): Promise<{
    predictions: string[];
    durationMs: number;
    timedOut: boolean;
  }> {
    if (!this.aiPredictor) {
      return {
        predictions: [],
        durationMs: 0,
        timedOut: false,
      };
    }
    const startedAt = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<{
      predictions: string[];
      timedOut: boolean;
    }>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve({
          predictions: [],
          timedOut: true,
        });
      }, this.aiPredictionTimeoutMs);
    });
    const predictionPromise = this.aiPredictor
      .predict({
        lang,
        predictionInput,
        numSuggestions,
      })
      .then((predictions) => ({
        predictions,
        timedOut: false,
      }))
      .catch(() => ({
        predictions: [],
        timedOut: false,
      }));
    const result = await Promise.race([predictionPromise, timeoutPromise]);
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    return {
      predictions: result.predictions,
      durationMs: Date.now() - startedAt,
      timedOut: result.timedOut,
    };
  }

  private emitDebugEvent(
    debugListener: ((debugEvent: PredictionDebugEvent) => void) | undefined,
    debugEvent: PredictionDebugEvent,
  ): void {
    if (!debugListener) {
      return;
    }
    try {
      debugListener(debugEvent);
    } catch (error) {
      console.warn(
        "Prediction debug listener failed:",
        getErrorMessage(error),
      );
    }
  }

  private resolvePresageSkipReason(
    lang: string,
    doPrediction: boolean,
    forceReplace: ForceReplaceType | null,
    effectiveNumSuggestions: number,
  ): string {
    if (!this.debugPresagePredictorEnabled) {
      return "disabled_by_debug_toggle";
    }
    if (!(lang in this.presageEngines)) {
      return "language_engine_missing";
    }
    if (forceReplace) {
      return "blocked_by_spacing_rule";
    }
    if (!doPrediction) {
      return "input_not_predictable";
    }
    if (effectiveNumSuggestions <= 0) {
      return "num_suggestions_zero";
    }
    return "unknown";
  }

  private resolveAISkipReason(
    doPrediction: boolean,
    forceReplace: ForceReplaceType | null,
    effectiveNumSuggestions: number,
  ): string {
    if (!this.aiPredictorEnabled) {
      return "disabled_in_settings";
    }
    if (!this.debugAIPredictorEnabled) {
      return "disabled_by_debug_toggle";
    }
    if (!this.aiPredictor) {
      return "predictor_unavailable";
    }
    if (forceReplace) {
      return "blocked_by_spacing_rule";
    }
    if (!doPrediction) {
      return "input_not_predictable";
    }
    if (effectiveNumSuggestions <= 0) {
      return "num_suggestions_zero";
    }
    return "unknown";
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    fallback: T,
  ): Promise<T> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      promise
        .then((value) => {
          clearTimeout(timeoutId);
          resolve(value);
        })
        .catch(() => {
          clearTimeout(timeoutId);
          resolve(fallback);
        });
    });
  }

  private mergePredictions(
    presagePredictions: string[],
    aiPredictions: string[],
    limit: number,
  ): string[] {
    if (limit <= 0) {
      return [];
    }

    const merged: string[] = [];
    const seen = new Set<string>();
    const addPrediction = (prediction: string | undefined) => {
      if (!prediction || merged.length >= limit) {
        return;
      }
      const normalized = prediction.replace(/\xA0/g, " ").trim().toLowerCase();
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      merged.push(prediction);
    };

    let presageIdx = 0;
    let aiIdx = 0;
    while (
      merged.length < limit &&
      (presageIdx < presagePredictions.length || aiIdx < aiPredictions.length)
    ) {
      for (let i = 0; i < PRESAGE_INTERLEAVE_COUNT; i += 1) {
        addPrediction(presagePredictions[presageIdx]);
        presageIdx += 1;
      }
      addPrediction(aiPredictions[aiIdx]);
      aiIdx += 1;
    }

    while (merged.length < limit && presageIdx < presagePredictions.length) {
      addPrediction(presagePredictions[presageIdx]);
      presageIdx += 1;
    }
    while (merged.length < limit && aiIdx < aiPredictions.length) {
      addPrediction(aiPredictions[aiIdx]);
      aiIdx += 1;
    }

    return merged;
  }

  private applyPredictionOutputRules(
    predictionCandidates: string[],
    predictionInput: string,
    nextChar: string,
    doCapitalize: Capitalization,
    effectiveNumSuggestions: number,
    forceReplace: ForceReplaceType | null,
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
        if (aLower === inputLower && bLower !== inputLower) return -1;
        if (bLower === inputLower && aLower !== inputLower) return 1;
        // Keep original order for now, follow presage order
        return 0;
        // Prefix match next
        const aStarts = aLower.startsWith(inputLower);
        const bStarts = bLower.startsWith(inputLower);
        if (aStarts && !bStarts) return -1;
        if (bStarts && !aStarts) return 1;
        // Shorter words first (e.g. "act" before "action")
        if (aLower.length !== bLower.length)
          return aLower.length - bLower.length;
        // Otherwise, keep original order
        return 0;
      });
    }
    if (this.insertSpaceAfterAutocomplete) {
      if (
        !isWhiteSpace(nextChar, false) &&
        (!(nextChar in SPACING_RULES) ||
          SPACING_RULES[nextChar].spaceBefore === Spacing.INSERT_SPACE)
      ) {
        predictions = predictions.map((pred) => `${pred}\xA0`);
      }
    }
    switch (doCapitalize) {
      case Capitalization.FirstLetter:
        predictions = predictions.map(
          (pred) => pred.charAt(0).toUpperCase() + pred.slice(1),
        );
        break;
      case Capitalization.WholeWord:
        predictions = predictions.map((pred) => pred.toUpperCase());
        break;
      case Capitalization.None:
      default:
    }
    return { predictions, forceReplace };
  }

  getLastPredictionInput(lang: string): string {
    if (lang in this.lastPrediction) {
      return this.lastPrediction[lang].pastStream;
    }
    return "";
  }
}
