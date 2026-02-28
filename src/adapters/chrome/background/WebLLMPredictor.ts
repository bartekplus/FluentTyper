import {
  DEFAULT_AI_MODEL_ID,
  DEFAULT_AI_PREDICTOR_ENABLED,
} from "@core/domain/constants";
import { createLogger } from "@core/application/logging/Logger";
import { getErrorMessage } from "@core/domain/error";
import type {
  SecondaryPredictor,
  SecondaryPredictorConfig,
  SecondaryPredictorRequest,
} from "./PredictionTypes";
import { CandidateRanker } from "./webllm/CandidateRanker";
import { EngineLifecycleService } from "./webllm/EngineLifecycleService";
import { GenerationCoordinator } from "./webllm/GenerationCoordinator";
import { PredictionCache } from "./webllm/PredictionCache";
import { PromptBuilder } from "./webllm/PromptBuilder";
import { ResponseParser } from "./webllm/ResponseParser";
import { maybePredictFromRuntimeTestOverride } from "@adapters/chrome/background/testing/RuntimeTestHooks";
import type {
  ChatCreateResponse,
  CompletionCreateResponse,
  InitProgressEntry,
  PredictionModeContext,
  PredictionResponsePayload,
} from "./webllm/types";

const CACHE_TTL_MS = 5000;
const MAX_GENERATION_CHOICES = 5;
const logger = createLogger("WebLLMPredictor");

export type WebLLMPredictorConfig = SecondaryPredictorConfig;

export type WebLLMPredictRequest = SecondaryPredictorRequest;

export interface WebLLMPredictorDebugState {
  enabled: boolean;
  modelId: string;
  status: string;
  hasWebGPU: boolean;
  initAttemptCount: number;
  isGenerating: boolean;
  cacheSize: number;
  lastFailureAt: number | null;
  lastInitStartedAt: number | null;
  lastInitDurationMs: number | null;
  lastInitProgress: number | null;
  lastInitProgressAt: number | null;
  lastInitProgressText: string | null;
  lastInitError: string | null;
  lastInitProgressLog: InitProgressEntry[];
  lastPredictAt: number | null;
  lastPredictDurationMs: number | null;
  lastPredictSource: string;
  lastPredictInput: string | null;
  lastRawOutputPreview: string | null;
  lastPredictOutputCount: number;
  lastPredictError: string | null;
}

export class WebLLMPredictor implements SecondaryPredictor {
  private readonly engineLifecycleService = new EngineLifecycleService();
  private readonly generationCoordinator = new GenerationCoordinator();
  private readonly promptBuilder = new PromptBuilder(MAX_GENERATION_CHOICES);
  private readonly responseParser = new ResponseParser();
  private readonly candidateRanker = new CandidateRanker();
  private readonly predictionCache = new PredictionCache(CACHE_TTL_MS);

  private enabled = DEFAULT_AI_PREDICTOR_ENABLED;
  private modelId = DEFAULT_AI_MODEL_ID;
  private lastPredictAt = 0;
  private lastPredictDurationMs = -1;
  private lastPredictSource = "none";
  private lastPredictInput: string | null = null;
  private lastRawOutputPreview: string | null = null;
  private lastPredictOutputCount = 0;
  private lastPredictError: string | null = null;

  setConfig(config: WebLLMPredictorConfig): void {
    const nextEnabled =
      typeof config.enabled === "boolean"
        ? config.enabled
        : DEFAULT_AI_PREDICTOR_ENABLED;
    const nextModelId =
      typeof config.modelId === "string" && config.modelId.trim().length > 0
        ? config.modelId
        : DEFAULT_AI_MODEL_ID;
    const modelChanged = nextModelId !== this.modelId;
    const enabledChanged = nextEnabled !== this.enabled;

    this.enabled = nextEnabled;
    this.modelId = nextModelId;

    if (modelChanged) {
      this.resetEngine();
    }
    if (enabledChanged && !this.enabled) {
      this.resetEngine();
    }
  }

  getDebugState(): WebLLMPredictorDebugState {
    const lifecycleState = this.engineLifecycleService.getRawState();
    return {
      enabled: this.enabled,
      modelId: this.modelId,
      status: lifecycleState.status,
      hasWebGPU: lifecycleState.hasWebGPU,
      initAttemptCount: lifecycleState.initAttemptCount,
      isGenerating: this.generationCoordinator.getIsGenerating(),
      cacheSize: this.predictionCache.size(),
      lastFailureAt:
        lifecycleState.lastFailureAt > 0 ? lifecycleState.lastFailureAt : null,
      lastInitStartedAt:
        lifecycleState.lastInitStartedAt > 0
          ? lifecycleState.lastInitStartedAt
          : null,
      lastInitDurationMs:
        lifecycleState.lastInitDurationMs >= 0
          ? lifecycleState.lastInitDurationMs
          : null,
      lastInitProgress:
        lifecycleState.lastInitProgress >= 0
          ? lifecycleState.lastInitProgress
          : null,
      lastInitProgressAt:
        lifecycleState.lastInitProgressAt > 0
          ? lifecycleState.lastInitProgressAt
          : null,
      lastInitProgressText: lifecycleState.lastInitProgressText,
      lastInitError: lifecycleState.lastInitError,
      lastInitProgressLog: lifecycleState.lastInitProgressLog.slice(),
      lastPredictAt: this.lastPredictAt > 0 ? this.lastPredictAt : null,
      lastPredictDurationMs:
        this.lastPredictDurationMs >= 0 ? this.lastPredictDurationMs : null,
      lastPredictSource: this.lastPredictSource,
      lastPredictInput: this.lastPredictInput,
      lastRawOutputPreview: this.lastRawOutputPreview,
      lastPredictOutputCount: this.lastPredictOutputCount,
      lastPredictError: this.lastPredictError,
    };
  }

  clearCache(): void {
    this.predictionCache.clear();
  }

  preload(): void {
    void this.ensureReady();
  }

  interruptActiveGeneration(
    reason = "generation_interrupted",
    expectedRequest?: Pick<WebLLMPredictRequest, "lang" | "predictionInput">,
  ): boolean {
    const inFlightGenerationSeq = this.generationCoordinator.getInFlightGenerationSeq();
    const engine = this.engineLifecycleService.getEngine();
    if (inFlightGenerationSeq === null || !engine) {
      return false;
    }
    if (
      expectedRequest &&
      !this.isExpectedRequestInFlight(expectedRequest.lang, expectedRequest.predictionInput)
    ) {
      return false;
    }
    this.generationCoordinator.markCancelled(inFlightGenerationSeq);
    try {
      engine.interruptGenerate();
      this.lastPredictError = reason;
    } catch (error) {
      this.lastPredictError = getErrorMessage(error);
    }
    return true;
  }

  async predict(request: WebLLMPredictRequest): Promise<string[]> {
    if (!this.enabled || request.numSuggestions <= 0) {
      return [];
    }
    const requestSeq = this.generationCoordinator.nextGenerationSeq();
    const testOverridePredictions = await maybePredictFromRuntimeTestOverride({
      lang: request.lang,
      predictionInput: request.predictionInput,
      numSuggestions: request.numSuggestions,
    });
    if (testOverridePredictions) {
      if (this.isRequestStale(requestSeq)) {
        return [];
      }
      return testOverridePredictions;
    }
    const cacheKey = this.predictionCache.getCacheKey(this.modelId, request);
    const cachedPredictions = this.predictionCache.get(cacheKey);
    if (cachedPredictions) {
      return cachedPredictions;
    }
    const ready = await this.ensureReady();
    if (
      !ready ||
      !this.engineLifecycleService.getEngine() ||
      this.isRequestStale(requestSeq)
    ) {
      return [];
    }
    const modeContext = this.promptBuilder.resolvePredictionMode(
      request.predictionInput,
    );

    const previousGenerationSeq =
      this.generationCoordinator.getInFlightGenerationSeq();
    if (typeof previousGenerationSeq === "number") {
      this.interruptActiveGeneration("newer_request");
      await this.generationCoordinator.waitForGenerationToSettle(
        previousGenerationSeq,
        75,
      );
      if (!this.engineLifecycleService.getEngine() || this.isRequestStale(requestSeq)) {
        return [];
      }
    }
    this.generationCoordinator.registerGeneration(requestSeq, request);
    const predictStartedAt = Date.now();
    this.lastPredictAt = predictStartedAt;
    this.lastPredictInput = request.predictionInput;
    this.lastPredictDurationMs = 0;
    this.lastPredictSource = "none";
    this.lastRawOutputPreview = null;
    this.lastPredictOutputCount = 0;
    this.lastPredictError = null;

    try {
      let predictions: string[] = [];
      let rawOutput = "";
      let source = "none";
      try {
        const chatResult = await this.predictWithChatCompletion(request, modeContext);
        predictions = chatResult.predictions;
        rawOutput = chatResult.rawOutput;
        source = "chat";
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        logger.warn("WebLLM chat completion failed; trying fallback", {
          modelId: this.modelId,
          lang: request.lang,
          error: errorMessage,
        });
        this.lastPredictError = errorMessage;
      }
      if (predictions.length === 0) {
        try {
          const simpleChatResult = await this.predictWithSimpleChatCompletion(
            request,
            modeContext,
          );
          if (simpleChatResult.rawOutput.trim().length > 0 || !rawOutput) {
            rawOutput = simpleChatResult.rawOutput;
          }
          if (simpleChatResult.predictions.length > 0) {
            predictions = simpleChatResult.predictions;
            source = "chat_simple";
          }
        } catch (error) {
          if (!this.lastPredictError) {
            this.lastPredictError = getErrorMessage(error);
          }
        }
      }
      if (predictions.length === 0) {
        const completionResult = await this.predictWithCompletion(
          request,
          modeContext,
        );
        predictions = completionResult.predictions;
        if (completionResult.rawOutput.trim().length > 0 || !rawOutput) {
          rawOutput = completionResult.rawOutput;
        }
        source = "completion";
      }

      if (this.isRequestStale(requestSeq)) {
        return [];
      }
      predictions = this.candidateRanker.postProcessPredictions(
        predictions,
        modeContext,
        request.numSuggestions,
      );

      if (predictions.length > 0) {
        this.predictionCache.set(cacheKey, predictions);
      }
      this.lastPredictDurationMs = Date.now() - predictStartedAt;
      this.lastPredictSource = source;
      this.lastRawOutputPreview = rawOutput.slice(0, 400);
      this.lastPredictOutputCount = predictions.length;
      if (predictions.length === 0 && !this.lastPredictError) {
        this.lastPredictError = "empty_response";
      }
      return predictions;
    } catch (error) {
      if (this.isRequestStale(requestSeq)) {
        return [];
      }
      const errorMessage = getErrorMessage(error);
      logger.warn("WebLLM generation failed; fallback to Presage", {
        modelId: this.modelId,
        lang: request.lang,
        error: errorMessage,
      });
      this.lastPredictDurationMs = Date.now() - predictStartedAt;
      this.lastPredictSource = "error";
      this.lastPredictError = errorMessage;
      this.lastPredictOutputCount = 0;
      return [];
    } finally {
      this.generationCoordinator.completeGeneration(requestSeq);
    }
  }

  private isExpectedRequestInFlight(lang: string, predictionInput: string): boolean {
    const inFlightRequest = this.generationCoordinator.getInFlightRequest();
    if (!inFlightRequest) {
      return false;
    }
    return (
      inFlightRequest.lang === lang &&
      inFlightRequest.predictionInput === predictionInput
    );
  }

  private isRequestStale(seq: number): boolean {
    return (
      seq !== this.generationCoordinator.getActiveGenerationSeq() ||
      this.generationCoordinator.isCancelled(seq)
    );
  }

  private async ensureReady(): Promise<boolean> {
    return this.engineLifecycleService.ensureReady(this.enabled, this.modelId);
  }

  private resetEngine(): void {
    this.predictionCache.clear();
    this.generationCoordinator.advanceGenerationSeq();
    this.interruptActiveGeneration("reset");
    this.generationCoordinator.clearGenerationTracking();
    this.engineLifecycleService.reset();
  }

  private async predictWithChatCompletion(
    request: WebLLMPredictRequest,
    modeContext: PredictionModeContext,
  ): Promise<PredictionResponsePayload> {
    const engine = this.engineLifecycleService.getEngine();
    if (!engine) {
      return { predictions: [], rawOutput: "" };
    }
    const chatCompletion = (await engine.chat.completions.create({
      stream: false,
      messages: this.promptBuilder.buildChatMessages(
        request.predictionInput,
        request.lang,
        request.numSuggestions,
        modeContext,
      ),
      n: 1,
      max_tokens: Math.max(16, request.numSuggestions * 8),
      temperature: 0.2,
      top_p: 0.95,
    })) as ChatCreateResponse;
    const parsed = await this.responseParser.parseChatCreateResponse(
      chatCompletion,
      request.numSuggestions,
    );
    return this.responseParser.enrichFromEngineMessage(
      engine,
      parsed,
      request.numSuggestions,
    );
  }

  private async predictWithSimpleChatCompletion(
    request: WebLLMPredictRequest,
    modeContext: PredictionModeContext,
  ): Promise<PredictionResponsePayload> {
    const engine = this.engineLifecycleService.getEngine();
    if (!engine) {
      return { predictions: [], rawOutput: "" };
    }
    const chatCompletion = (await engine.chat.completions.create({
      stream: false,
      messages: this.promptBuilder.buildSimpleChatMessages(
        request.predictionInput,
        request.numSuggestions,
        modeContext,
      ),
      n: 1,
      max_tokens: Math.max(16, request.numSuggestions * 8),
      temperature: 0.2,
      top_p: 0.95,
    })) as ChatCreateResponse;
    const parsed = await this.responseParser.parseChatCreateResponse(
      chatCompletion,
      request.numSuggestions,
    );
    return this.responseParser.enrichFromEngineMessage(
      engine,
      parsed,
      request.numSuggestions,
    );
  }

  private async predictWithCompletion(
    request: WebLLMPredictRequest,
    modeContext: PredictionModeContext,
  ): Promise<PredictionResponsePayload> {
    const engine = this.engineLifecycleService.getEngine();
    if (!engine) {
      return { predictions: [], rawOutput: "" };
    }
    const completion = (await engine.completions.create({
      stream: false,
      prompt: this.promptBuilder.buildPrompt(
        request.predictionInput,
        request.lang,
        request.numSuggestions,
        modeContext,
      ),
      n: 1,
      max_tokens: Math.max(16, request.numSuggestions * 8),
      temperature: 0.2,
      top_p: 0.95,
    })) as CompletionCreateResponse;
    const parsed = await this.responseParser.parseCompletionCreateResponse(
      completion,
      request.numSuggestions,
    );
    return this.responseParser.enrichFromEngineMessage(
      engine,
      parsed,
      request.numSuggestions,
    );
  }
}
