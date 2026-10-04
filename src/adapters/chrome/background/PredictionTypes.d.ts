/** A prediction plus where it came from; a snippet carries the shortcut it expands. */
export interface PredictionCandidate {
  text: string;
  snippetShortcut?: string;
}

export interface PredictionResult {
  predictions: string[];
  /** Per prediction: the snippet shortcut it expands, or null for plain words. */
  snippetShortcuts?: Array<string | null>;
}

export interface PredictorStageDebugInfo {
  enabled: boolean;
  attempted: boolean;
  durationMs: number;
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
  totalDurationMs: number;
  presage: PredictorStageDebugInfo;
  finalPredictions: string[];
}

export interface PredictionConfigOverride {
  numSuggestions?: number;
  /** Disable automatic sentence casing for this request without changing shared config. */
  suppressAutoCapitalize?: boolean;
}

export interface PredictionRunConfig extends PredictionConfigOverride {
  tabId?: number;
  debugListener?: (debugEvent: PredictionDebugEvent) => void;
}
