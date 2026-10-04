import type { PredictionConfig } from "../../src/adapters/chrome/background/PredictionOrchestrator";

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
