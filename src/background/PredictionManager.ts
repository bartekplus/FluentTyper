// Handles Presage prediction logic for FluentTyper
import { PresageModule } from "./PresageTypes";
import {
  PresageHandler,
  PredictionResult,
  PresageConfig,
  PredictionDebugEvent,
  PredictionRunConfig,
} from "./PresageHandler";
import libPresageMod from "../third_party/libpresage/libpresage.js";
import { WebLLMPredictor } from "./WebLLMPredictor";
import { DEFAULT_AI_PREDICTION_TIMEOUT_MS } from "../shared/constants";

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
      isGenerating: boolean;
      cacheSize: number;
      lastFailureAt: number | null;
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
  private webLLMPredictor: WebLLMPredictor;
  private initializationPromise: Promise<void> | null = null;
  private debugTraces: PredictorDebugTrace[] = [];
  private currentConfig: PresageConfig | null = null;

  constructor() {
    this.libPresageMod = libPresageMod as () => Promise<PresageModule>;
    this.webLLMPredictor = new WebLLMPredictor();
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
    this.presageHandler = new PresageHandler(Module, this.webLLMPredictor);
  }

  async runPrediction(
    text: string,
    nextChar: string,
    lang: string,
    configOverride?: { numSuggestions?: number },
    debugMeta?: PredictionDebugRequestMeta,
  ): Promise<PredictionResult> {
    await this.initialize();
    if (!this.presageHandler) throw new Error("Presage not initialized");
    const runConfig: PredictionRunConfig = {
      numSuggestions: configOverride?.numSuggestions,
      debugListener: (debugEvent) => {
        this.recordDebugTrace(debugEvent, debugMeta);
      },
    };
    return await this.presageHandler.runPrediction(
      text,
      nextChar,
      lang,
      runConfig,
    );
  }

  setConfig(config: PresageConfig): void {
    if (!this.presageHandler) throw new Error("Presage not initialized");
    this.currentConfig = {
      ...config,
    };
    this.presageHandler.setConfig(config);
  }

  clearPredictorDebugTrace(): void {
    this.debugTraces = [];
    this.webLLMPredictor.clearCache();
  }

  getPredictorDebugSnapshot(): PredictorDebugSnapshot {
    const webllmDebugState = this.webLLMPredictor.getDebugState();
    const presageDebugState = this.presageHandler?.getDebugState();
    return {
      generatedAtMs: Date.now(),
      config: {
        aiPredictorEnabled: this.currentConfig?.aiPredictorEnabled ?? false,
        aiModelId: this.currentConfig?.aiModelId ?? "",
        aiPredictionTimeoutMs:
          this.currentConfig?.aiPredictionTimeoutMs ??
          DEFAULT_AI_PREDICTION_TIMEOUT_MS,
        debugPresagePredictorEnabled:
          this.currentConfig?.debugPresagePredictorEnabled ?? true,
        debugAIPredictorEnabled:
          this.currentConfig?.debugAIPredictorEnabled ?? true,
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
          isGenerating: webllmDebugState.isGenerating,
          cacheSize: webllmDebugState.cacheSize,
          lastFailureAt: webllmDebugState.lastFailureAt,
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
      frameId: typeof debugMeta?.frameId === "number" ? debugMeta.frameId : null,
      tributeId:
        typeof debugMeta?.tributeId === "number" ? debugMeta.tributeId : null,
    };
    this.debugTraces.unshift(trace);
    if (this.debugTraces.length > MAX_DEBUG_TRACES) {
      this.debugTraces = this.debugTraces.slice(0, MAX_DEBUG_TRACES);
    }
  }
}
