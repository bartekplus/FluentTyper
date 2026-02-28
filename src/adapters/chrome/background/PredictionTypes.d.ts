import type { ForceReplaceType } from "@core/domain/messageTypes";

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

export interface AIPredictorStageDebugInfo extends PredictorStageDebugInfo {
  modelId: string;
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
  webllm: AIPredictorStageDebugInfo;
  mergedPredictions: string[];
  finalPredictions: string[];
}

export interface PredictionRunConfig {
  numSuggestions?: number;
  debugListener?: (debugEvent: PredictionDebugEvent) => void;
}

export interface SecondaryPredictorConfig {
  enabled?: boolean;
  modelId?: string;
}

export interface SecondaryPredictorRequest {
  lang: string;
  predictionInput: string;
  numSuggestions: number;
}

export interface SecondaryPredictor {
  setConfig(config: SecondaryPredictorConfig): void;
  predict(request: SecondaryPredictorRequest): Promise<string[]>;
  preload?(): void | Promise<void>;
  interruptActiveGeneration?(
    reason?: string,
    expectedRequest?: Pick<
      SecondaryPredictorRequest,
      "lang" | "predictionInput"
    >,
  ): boolean;
}
