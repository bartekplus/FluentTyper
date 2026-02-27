// Handles prediction routing logic for FluentTyper
import type { PresageModule } from "./PresageTypes";
import { PresageHandler } from "./PresageHandler";
import {
  PredictionOrchestrator,
  PredictionConfig,
} from "./PredictionOrchestrator";
import type {
  PredictionDebugEvent,
  PredictionResult,
  PredictionRunConfig,
} from "./PredictionTypes";
import libPresageMod from "@third-party/libpresage/libpresage.js";
import { WebLLMPredictor } from "./WebLLMPredictor";
import { DEFAULT_AI_PREDICTION_TIMEOUT_MS } from "@core/domain/constants";

export interface PredictionDebugRequestMeta {
  requestId?: number;
  tabId?: number;
  frameId?: number;
  tributeId?: number;
}

export interface PredictorDebugTrace extends PredictionDebugEvent {
  requestId: number | null;
  tabId: number | null;
  frameId: number | null;
  tributeId: number | null;
}

export interface PredictorDebugSnapshot {
  generatedAtMs: number;
  config: {
    aiPredictorEnabled: boolean;
    aiModelId: string;
    aiPredictionTimeoutMs: number;
    debugPresagePredictorEnabled: boolean;
    debugAIPredictorEnabled: boolean;
  };
  runtime: {
    presage: {
      languageEngineCount: number;
    };
    webllm: {
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
      lastInitProgressLog: Array<{
        atMs: number;
        progress: number;
        text: string;
      }>;
      lastPredictAt: number | null;
      lastPredictDurationMs: number | null;
      lastPredictSource: string;
      lastPredictInput: string | null;
      lastRawOutputPreview: string | null;
      lastPredictOutputCount: number;
      lastPredictError: string | null;
    };
  };
  traces: PredictorDebugTrace[];
}

const MAX_DEBUG_TRACES = 80;

export class PredictionManager {
  private libPresageMod: () => Promise<PresageModule>;
  private presageHandler: PresageHandler | undefined;
  private predictionOrchestrator: PredictionOrchestrator | undefined;
  private webLLMPredictor: WebLLMPredictor | null = null;
  private initializationPromise: Promise<void> | null = null;
  private debugTraces: PredictorDebugTrace[] = [];
  private currentConfig: PredictionConfig | null = null;

  constructor() {
    this.libPresageMod = libPresageMod as () => Promise<PresageModule>;
    this.initialize();
  }

  async initialize(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this._doInitializePresage();
    }
    return this.initializationPromise;
  }

  private async _doInitializePresage(): Promise<void> {
    const Module = await this.libPresageMod();
    this.presageHandler = new PresageHandler(Module);
    this.predictionOrchestrator = new PredictionOrchestrator(
      this.presageHandler,
      this.getWebLLMPredictor(),
    );
    if (this.currentConfig) {
      this.predictionOrchestrator.setConfig(this.currentConfig);
    }
  }

  async runPrediction(
    text: string,
    nextChar: string,
    lang: string,
    configOverride?: { numSuggestions?: number },
    debugMeta?: PredictionDebugRequestMeta,
  ): Promise<PredictionResult> {
    await this.initialize();
    if (!this.predictionOrchestrator) {
      throw new Error("Prediction orchestrator not initialized");
    }

    const runConfig: PredictionRunConfig = {
      numSuggestions: configOverride?.numSuggestions,
      debugListener: (debugEvent) => {
        this.recordDebugTrace(debugEvent, debugMeta);
      },
    };

    return await this.predictionOrchestrator.runPrediction(
      text,
      nextChar,
      lang,
      runConfig,
    );
  }

  setConfig(config: PredictionConfig): void {
    this.currentConfig = {
      ...config,
    };
    if (!this.predictionOrchestrator) {
      throw new Error("Prediction orchestrator not initialized");
    }
    this.predictionOrchestrator.setConfig(config);
  }

  clearPredictorDebugTrace(): void {
    this.debugTraces = [];
    this.getWebLLMPredictor().clearCache();
  }

  getPredictorDebugSnapshot(): PredictorDebugSnapshot {
    const webllmDebugState = this.getWebLLMPredictor().getDebugState();
    const presageDebugState = this.presageHandler?.getDebugState();
    const orchestratorDebugState =
      this.predictionOrchestrator?.getDebugState().predictorConfig;

    return {
      generatedAtMs: Date.now(),
      config: {
        aiPredictorEnabled:
          orchestratorDebugState?.aiPredictorEnabled ??
          this.currentConfig?.aiPredictorEnabled ??
          false,
        aiModelId:
          orchestratorDebugState?.aiModelId ??
          this.currentConfig?.aiModelId ??
          "",
        aiPredictionTimeoutMs:
          orchestratorDebugState?.aiPredictionTimeoutMs ??
          this.currentConfig?.aiPredictionTimeoutMs ??
          DEFAULT_AI_PREDICTION_TIMEOUT_MS,
        debugPresagePredictorEnabled:
          orchestratorDebugState?.debugPresagePredictorEnabled ??
          this.currentConfig?.debugPresagePredictorEnabled ??
          true,
        debugAIPredictorEnabled:
          orchestratorDebugState?.debugAIPredictorEnabled ??
          this.currentConfig?.debugAIPredictorEnabled ??
          true,
      },
      runtime: {
        presage: {
          languageEngineCount: presageDebugState?.languageEngineCount ?? 0,
        },
        webllm: {
          enabled: webllmDebugState.enabled,
          modelId: webllmDebugState.modelId,
          status: webllmDebugState.status,
          hasWebGPU: webllmDebugState.hasWebGPU,
          initAttemptCount: webllmDebugState.initAttemptCount,
          isGenerating: webllmDebugState.isGenerating,
          cacheSize: webllmDebugState.cacheSize,
          lastFailureAt: webllmDebugState.lastFailureAt,
          lastInitStartedAt: webllmDebugState.lastInitStartedAt,
          lastInitDurationMs: webllmDebugState.lastInitDurationMs,
          lastInitProgress: webllmDebugState.lastInitProgress,
          lastInitProgressAt: webllmDebugState.lastInitProgressAt,
          lastInitProgressText: webllmDebugState.lastInitProgressText,
          lastInitError: webllmDebugState.lastInitError,
          lastInitProgressLog: webllmDebugState.lastInitProgressLog.slice(),
          lastPredictAt: webllmDebugState.lastPredictAt,
          lastPredictDurationMs: webllmDebugState.lastPredictDurationMs,
          lastPredictSource: webllmDebugState.lastPredictSource,
          lastPredictInput: webllmDebugState.lastPredictInput,
          lastRawOutputPreview: webllmDebugState.lastRawOutputPreview,
          lastPredictOutputCount: webllmDebugState.lastPredictOutputCount,
          lastPredictError: webllmDebugState.lastPredictError,
        },
      },
      traces: this.debugTraces.slice(),
    };
  }

  private recordDebugTrace(
    debugEvent: PredictionDebugEvent,
    debugMeta?: PredictionDebugRequestMeta,
  ): void {
    const trace: PredictorDebugTrace = {
      ...debugEvent,
      requestId:
        typeof debugMeta?.requestId === "number" ? debugMeta.requestId : null,
      tabId: typeof debugMeta?.tabId === "number" ? debugMeta.tabId : null,
      frameId:
        typeof debugMeta?.frameId === "number" ? debugMeta.frameId : null,
      tributeId:
        typeof debugMeta?.tributeId === "number" ? debugMeta.tributeId : null,
    };
    this.debugTraces.unshift(trace);
    if (this.debugTraces.length > MAX_DEBUG_TRACES) {
      this.debugTraces = this.debugTraces.slice(0, MAX_DEBUG_TRACES);
    }
  }

  private getWebLLMPredictor(): WebLLMPredictor {
    if (!this.webLLMPredictor) {
      this.webLLMPredictor = new WebLLMPredictor();
    }
    return this.webLLMPredictor;
  }
}

export type { PredictionConfig };
