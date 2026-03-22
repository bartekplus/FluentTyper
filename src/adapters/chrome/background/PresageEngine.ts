import type { Presage, PresageModule, PresageCallback } from "./PresageTypes";

export interface PresagePrediction {
  prediction: string;
  probability: number;
}

export interface PresageEngineConfig {
  numSuggestions: number;
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
