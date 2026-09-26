import type { Presage, PresageModule, PresageCallback } from "./PresageTypes";

export interface PresageEngineConfig {
  numSuggestions: number;
  prefixOnlyMode: boolean;
}

// Enough candidates that a known rare word still comes back as itself.
const SPELLING_CANDIDATES = 20;

export class PresageEngine {
  private readonly module: PresageModule;
  private readonly lang: string;
  public libPresage: Presage;
  private readonly callback: PresageCallback;
  private callbackImpl: unknown;
  private config: PresageEngineConfig;

  constructor(Module: PresageModule, config: PresageEngineConfig, lang: string) {
    this.module = Module;
    this.lang = lang;
    this.config = config;

    this.callback = {
      pastStream: "",
      get_past_stream() {
        return this.pastStream;
      },
      get_future_stream() {
        return "";
      },
    };
    this.callbackImpl = this.module.PresageCallback.implement(this.callback);
    this.libPresage = this.createLibPresage();
    this.setConfig(config);
  }

  setConfig(config: PresageEngineConfig) {
    this.config = config;
    this.libPresage.config("Presage.Selector.SUGGESTIONS", this.config.numSuggestions.toString());
    this.libPresage.config(
      "Presage.ContextTracker.PREFIX_ONLY_MODE",
      this.config.prefixOnlyMode ? "yes" : "no",
    );
  }

  reinitialize(): void {
    this.libPresage = this.createLibPresage();
    this.setConfig(this.config);
  }

  predict(predictionInput: string): string[] {
    this.callback.pastStream = predictionInput;
    const predictions: string[] = [];
    const predictionsNative = this.libPresage.predictWithProbability();
    for (let i = 0; i < predictionsNative.size(); i++) {
      const text = this.parsePrediction(predictionsNative.get(i).prediction);
      if (text) {
        predictions.push(text);
      }
    }
    return predictions;
  }

  /**
   * Review spelling, read-only: for each word, null when Presage offers the
   * word itself (the dictionary knows it), else its candidates, ranked for the
   * preceding words. Spelling corrections stay on even in prefix-only mode;
   * the typing configuration is restored before returning, and the engine
   * does not learn from these lookups.
   */
  lookupWords(words: ReadonlyArray<{ word: string; before: string }>): Array<string[] | null> {
    this.libPresage.config("Presage.Selector.SUGGESTIONS", String(SPELLING_CANDIDATES));
    this.libPresage.config("Presage.ContextTracker.PREFIX_ONLY_MODE", "no");
    try {
      return words.map(({ word, before }) => {
        const candidates = this.predict(`${before}${word}`);
        const key = word.toLowerCase();
        return candidates.some((candidate) => candidate.trim().toLowerCase() === key)
          ? null
          : candidates;
      });
    } finally {
      // Nothing of the reviewed text stays in the engine.
      this.callback.pastStream = "";
      this.setConfig(this.config);
    }
  }

  private createLibPresage(): Presage {
    return new this.module.Presage(this.callbackImpl, `resources_js/${this.lang}/presage.xml`);
  }

  private parsePrediction(rawPrediction: string): string | null {
    try {
      const parsedPrediction: unknown = JSON.parse(rawPrediction);
      return typeof parsedPrediction === "string" ? parsedPrediction : null;
    } catch {
      return rawPrediction;
    }
  }
}
