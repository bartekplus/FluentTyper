import type { CommandRouter } from "../router/CommandRouter";

interface RuntimeTestPredictionRequest {
  lang: string;
  predictionInput: string;
  numSuggestions: number;
}

export async function maybePredictFromRuntimeTestOverride(
  request: RuntimeTestPredictionRequest,
): Promise<string[] | null> {
  void request;
  return null;
}

export function registerRuntimeTestHooks(commandRouter: CommandRouter): void {
  void commandRouter;
}
