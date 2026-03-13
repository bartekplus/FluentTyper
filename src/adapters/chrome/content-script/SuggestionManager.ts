import {
  SuggestionManagerRuntime,
  type EarlyTabAcceptResult,
} from "./suggestions/SuggestionManagerRuntime";
import type { PredictionResponse, SuggestionManagerOptions } from "./suggestions/types";

export class SuggestionManager {
  private readonly runtime: SuggestionManagerRuntime;

  constructor(options: SuggestionManagerOptions) {
    this.runtime = new SuggestionManagerRuntime(options);
  }

  public queryAndAttachHelper(root?: Element): boolean {
    return this.runtime.queryAndAttachHelper(root);
  }

  public removeHelpersNotInDocument(): void {
    this.runtime.removeHelpersNotInDocument();
  }

  public triggerActiveSuggestion(): void {
    this.runtime.triggerActiveSuggestion();
  }

  public handleEarlyTabAcceptRequest(entryId: string): EarlyTabAcceptResult {
    return this.runtime.handleEarlyTabAcceptRequest(entryId);
  }

  public updateLangConfig(lang: string): void {
    this.runtime.updateLangConfig(lang);
  }

  public fulfillPrediction(context: PredictionResponse): void {
    this.runtime.fulfillPrediction(context);
  }

  public detachAllHelpers(): void {
    this.runtime.detachAllHelpers();
  }
}
