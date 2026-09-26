import type { Presage, PresageModule, PresageCallback } from "./PresageTypes";

export interface PresageEngineConfig {
  numSuggestions: number;
  prefixOnlyMode: boolean;
}

// Enough candidates that a known rare word still comes back as itself.
const SPELLING_CANDIDATES = 20;

/**
 * Time a review lookup from a page may take before it stops starting words.
 * A known word costs about a millisecond and an unknown one tens, so one
 * request stays well under 100 ms and typing predictions never wait long.
 */
export const REVIEW_SPELLING_BUDGET_MS = 40;

export interface SpellingLookupOptions {
  /** Start no further word after this long; the answer then covers only the first words. */
  budgetMs?: number;
  now?: () => number;
}

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
   *
   * With `budgetMs`, no further word is started once that much time has
   * passed (the first always is): the answer then covers only the first
   * words, and the caller asks again for the rest. An unknown word costs tens
   * of milliseconds, and typing predictions wait behind the whole call.
   */
  lookupWords(
    words: ReadonlyArray<{ word: string; before: string }>,
    { budgetMs = Infinity, now = () => performance.now() }: SpellingLookupOptions = {},
  ): Array<string[] | null> {
    this.libPresage.config("Presage.Selector.SUGGESTIONS", String(SPELLING_CANDIDATES));
    this.libPresage.config("Presage.ContextTracker.PREFIX_ONLY_MODE", "no");
    try {
      const started = now();
      const results: Array<string[] | null> = [];
      for (const { word, before } of words) {
        if (results.length > 0 && now() - started >= budgetMs) break;
        const candidates = this.predict(`${before}${word}`);
        const key = word.toLowerCase();
        results.push(
          candidates.some((candidate) => candidate.trim().toLowerCase() === key)
            ? null
            : candidates,
        );
      }
      return results;
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
