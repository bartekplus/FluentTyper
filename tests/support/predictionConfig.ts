import {
  PredictionOrchestrator,
  type PredictionConfig,
} from "../../src/adapters/chrome/background/PredictionOrchestrator";
import type { PresageHandler } from "../../src/adapters/chrome/background/PresageHandler";

/** Runs one prediction through the orchestrator, as PredictionManager does. */
export function runPrediction(
  handler: PresageHandler,
  ...args: Parameters<PredictionOrchestrator["runPrediction"]>
) {
  return new PredictionOrchestrator(handler).runPrediction(...args);
}

export function predictionConfig(overrides: Partial<PredictionConfig> = {}): PredictionConfig {
  return {
    numSuggestions: 5,
    minWordLengthToPredict: 0,
    insertSpaceAfterAutocomplete: false,
    autoCapitalize: false,
    textExpansions: [],
    prefixOnlyMode: false,
    timeFormat: "",
    dateFormat: "",
    userDictionaryList: [],
    ...overrides,
  };
}
