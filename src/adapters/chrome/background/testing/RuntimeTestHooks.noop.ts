import type { CommandRouter } from "../router/CommandRouter";

interface RuntimeTestPredictionRequest {
  lang: string;
  predictionInput: string;
  numSuggestions: number;
}

export function maybePredictFromRuntimeTestOverride(
  _request: RuntimeTestPredictionRequest,
): Promise<string[] | null> {
  return Promise.resolve(null);
}

export function registerRuntimeTestHooks(_commandRouter: CommandRouter): void {
  return;
}
