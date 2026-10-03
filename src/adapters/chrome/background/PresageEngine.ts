import type { Presage, PresageModule, PresageCallback } from "./PresageTypes";
import { tuneHunspellSuggestions } from "./PresageFiles";

export interface PresageEngineConfig {
  numSuggestions: number;
  prefixOnlyMode: boolean;
}

// Suggestions a lookup returns for an unknown word.
const SPELLING_CANDIDATES = 20;
// Candidates searched for the word itself as typed: every predictor's whole partial
// list, so a short known word ("ad", "app") still counts as known when many more
// frequent words start with it.
const SPELLING_POOL = 1000;
// Presage asks every predictor again, with a larger partial list each time, while it
// has fewer candidates than it was asked for. With typing's partial lists (60), a
// short prefix ("naj", "na") took up to 17 rounds, each running the spellers' slow
// suggestion step again: a lookup asks for the whole pool in the first round.
const PARTIAL_PREDICTION_SIZE = "Presage.PredictorActivator.MAX_PARTIAL_PREDICTION_SIZE";

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
    // Native instances are not garbage collected: free the old one or WASM memory runs out.
    const previous = this.libPresage;
    this.libPresage = this.createLibPresage();
    previous.delete?.();
    this.setConfig(this.config);
  }

  predict(predictionInput: string): string[] {
    this.callback.pastStream = predictionInput;
    const predictions: string[] = [];
    const predictionsNative = this.libPresage.predictWithProbability();
    try {
      for (let i = 0; i < predictionsNative.size(); i++) {
        const text = this.parsePrediction(predictionsNative.get(i).prediction);
        if (text) {
          predictions.push(text);
        }
      }
    } finally {
      predictionsNative.delete?.();
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
    const partialSize = this.libPresage.config(PARTIAL_PREDICTION_SIZE);
    this.libPresage.config("Presage.Selector.SUGGESTIONS", String(SPELLING_POOL));
    this.libPresage.config("Presage.ContextTracker.PREFIX_ONLY_MODE", "no");
    this.libPresage.config(PARTIAL_PREDICTION_SIZE, String(SPELLING_POOL));
    try {
      const started = now();
      const results: Array<string[] | null> = [];
      for (const { word, before } of words) {
        if (results.length > 0 && now() - started >= budgetMs) break;
        let answer = this.spellingAnswer(`${before}${word}`, word);
        // A full pool may hold only completions more frequent than the word itself
        // ("Re" under a thousand words starting with "re"): asked again in the
        // typing-sized rounds, where the spellers' lists get their share.
        if (answer && answer.length >= SPELLING_POOL && partialSize) {
          this.libPresage.config(PARTIAL_PREDICTION_SIZE, partialSize);
          answer = this.spellingAnswer(`${before}${word}`, word);
          this.libPresage.config(PARTIAL_PREDICTION_SIZE, String(SPELLING_POOL));
        }
        results.push(answer && answer.slice(0, SPELLING_CANDIDATES));
      }
      return results;
    } finally {
      // Nothing of the reviewed text stays in the engine.
      this.callback.pastStream = "";
      if (partialSize) this.libPresage.config(PARTIAL_PREDICTION_SIZE, partialSize);
      this.setConfig(this.config);
    }
  }

  /** Null when the dictionary knows `word`, else the whole candidate pool for it. */
  private spellingAnswer(input: string, word: string): string[] | null {
    const pool = this.predict(input).map((candidate) => candidate.trim());
    const key = word.toLowerCase();
    // Hunspell offers a word it knows as typed, however rare; any casing counts only
    // among the top candidates, so a speller's "WA" does not vouch for "wa".
    const known =
      pool.includes(word) ||
      pool.slice(0, SPELLING_CANDIDATES).some((candidate) => candidate.toLowerCase() === key);
    return known ? null : pool;
  }

  private createLibPresage(): Presage {
    tuneHunspellSuggestions(this.module, this.lang);
    return new this.module.Presage(this.callbackImpl, `resources_js/${this.lang}/presage.xml`);
  }

  /**
   * A text expansion arrives JSON-quoted (setTextExpansions); anything else is a word,
   * so "true", "null" or "42" stay words instead of parsing to non-strings.
   */
  private parsePrediction(rawPrediction: string): string | null {
    if (!rawPrediction.startsWith('"')) return rawPrediction;
    try {
      const parsedPrediction: unknown = JSON.parse(rawPrediction);
      return typeof parsedPrediction === "string" ? parsedPrediction : null;
    } catch {
      return rawPrediction;
    }
  }
}
