// filepath: src/background/PresageEngine.ts
import type { Presage, PresageModule, PresageCallback } from "./PresageTypes";

export interface PresagePrediction {
  prediction: string;
  probability: number;
}

export interface PresageEngineConfig {
  numSuggestions: number;
}

export class PresageEngine {
  private readonly Module: PresageModule;
  private readonly lang: string;
  public libPresage: Presage;
  private libPresageCallback: PresageCallback;
  private libPresageCallbackImpl: unknown = {};
  private config: PresageEngineConfig;

  constructor(Module: PresageModule, config: PresageEngineConfig, lang: string) {
    this.Module = Module;
    this.lang = lang;
    this.config = config;

    this.libPresageCallback = {
      pastStream: "",
      get_past_stream() {
        return this.pastStream;
      },
      get_future_stream() {
        return "";
      },
    };
    this.libPresageCallbackImpl = Module.PresageCallback.implement(this.libPresageCallback);
    this.libPresage = this.createLibPresage();
    this.setConfig(config);
  }

  setConfig(config: PresageEngineConfig) {
    this.config = config;
    this.libPresage.config("Presage.Selector.SUGGESTIONS", this.config.numSuggestions.toString());
  }

  reinitialize(): void {
    this.libPresage = this.createLibPresage();
    this.setConfig(this.config);
  }

  predict(predictionInput: string): string[] {
    this.libPresageCallback.pastStream = predictionInput;
    const predictions: string[] = [];
    const predictionsNative = this.libPresage.predictWithProbability();
    for (let i = 0; i < predictionsNative.size(); i++) {
      let text: string | null;
      try {
        const parsedPrediction: unknown = JSON.parse(predictionsNative.get(i).prediction);
        text = typeof parsedPrediction === "string" ? parsedPrediction : null;
      } catch {
        text = predictionsNative.get(i).prediction;
      }
      if (text) {
        predictions.push(text);
      }
    }
    return predictions;
  }

  private createLibPresage(): Presage {
    return new this.Module.Presage(
      this.libPresageCallbackImpl,
      `resources_js/${this.lang}/presage.xml`,
    );
  }
}
