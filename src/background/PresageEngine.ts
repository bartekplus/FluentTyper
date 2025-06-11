// filepath: src/background/PresageEngine.ts
import { SUPPORTED_LANGUAGES } from "../shared/lang";

export interface PresagePrediction {
  prediction: string;
  probability?: number;
}

export interface PresageEngineConfig {
  numSuggestions: number;
  minWordLengthToPredict: number;
  insertSpaceAfterAutocomplete: boolean;
}

// Define minimal types for Module and Presage if not available
interface PresageCallback {
  pastStream: string;
  get_past_stream: () => string;
  get_future_stream: () => string;
}

interface Presage {
  predictWithProbability: () => { size: () => number; get: (i: number) => { prediction: string } };
  config: (key: string, value: string) => void;
}

interface PresageModule {
  PresageCallback: { implement: (cb: PresageCallback) => unknown };
  Presage: new (cbImpl: unknown, path: string) => Presage;
}

export class PresageEngine {
  private Module: PresageModule;
  private libPresage: Record<string, Presage> = {};
  private libPresageCallback: Record<string, PresageCallback> = {};
  private libPresageCallbackImpl: Record<string, unknown> = {};
  private lastPrediction: Record<string, { pastStream: string; predictions: string[] }> = {};
  private config: PresageEngineConfig;

  constructor(Module: PresageModule, config: PresageEngineConfig) {
    this.Module = Module;
    this.config = config;
    this.initializeEngines();
  }

  private initializeEngines() {
    for (const [lang] of Object.entries(SUPPORTED_LANGUAGES)) {
      if (lang === "auto_detect") continue;
      try {
        this.lastPrediction[lang] = { pastStream: "", predictions: [] };
        this.libPresageCallback[lang] = {
          pastStream: "",
          get_past_stream: function () {
            return this.pastStream;
          },
          get_future_stream: function () {
            return "";
          },
        };
        this.libPresageCallbackImpl[lang] = this.Module.PresageCallback.implement(this.libPresageCallback[lang]);
        this.libPresage[lang] = new this.Module.Presage(
          this.libPresageCallbackImpl[lang],
          "resources_js/" + lang + "/presage.xml"
        );
      } catch (error) {
        console.log(
          "Failed to create Presage instance for %s language: %s",
          lang,
          error
        );
      }
    }
  }

  setConfig(config: PresageEngineConfig) {
    this.config = config;
    for (const [, libPresage] of Object.entries(this.libPresage)) {
      libPresage.config(
        "Presage.Selector.SUGGESTIONS",
        this.config.numSuggestions.toString()
      );
    }
  }

  predict(predictionInput: string, lang: string): string[] {
    if (predictionInput === this.lastPrediction[lang]?.pastStream) {
      return this.lastPrediction[lang].predictions.slice();
    }
    this.libPresageCallback[lang].pastStream = predictionInput;
    const predictions: string[] = [];
    const predictionsNative = this.libPresage[lang].predictWithProbability();
    for (let i = 0; i < predictionsNative.size(); i++) {
      let text: string | null = null;
      try {
        text = JSON.parse(predictionsNative.get(i).prediction);
      } catch {
        text = predictionsNative.get(i).prediction;
      }
      if (text) predictions.push(text);
    }
    this.lastPrediction[lang] = {
      pastStream: predictionInput,
      predictions: predictions.slice(),
    };
    return predictions;
  }

  hasLanguage(lang: string): boolean {
    return !!this.libPresage[lang];
  }
}
