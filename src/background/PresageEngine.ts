// filepath: src/background/PresageEngine.ts
import { Presage, PresageModule, PresageCallback } from "./PresageTypes";

export interface PresagePrediction {
  prediction: string;
  probability: number;
}

export interface PresageEngineConfig {
  numSuggestions: number;
}

export class PresageEngine {
  public libPresage: Presage;
  private libPresageCallback: PresageCallback;
  private libPresageCallbackImpl: unknown = {};
  private config: PresageEngineConfig;

  constructor(
    Module: PresageModule,
    config: PresageEngineConfig,
    lang: string,
  ) {
    this.config = config;

    this.libPresageCallback = {
      pastStream: "",
      get_past_stream: function () {
        return this.pastStream;
      },
      get_future_stream: function () {
        return "";
      },
    };
    this.libPresageCallbackImpl = Module.PresageCallback.implement(
      this.libPresageCallback,
    );
    this.libPresage = new Module.Presage(
      this.libPresageCallbackImpl,
      "resources_js/" + lang + "/presage.xml",
    );
    this.setConfig(config);
  }

  setConfig(config: PresageEngineConfig) {
    this.config = config;
    this.libPresage.config(
      "Presage.Selector.SUGGESTIONS",
      this.config.numSuggestions.toString(),
    );
  }

  predict(predictionInput: string): string[] {
    this.libPresageCallback.pastStream = predictionInput;
    const predictions: string[] = [];
    const predictionsNative = this.libPresage.predictWithProbability();
    for (let i = 0; i < predictionsNative.size(); i++) {
      let text: string | null = null;
      try {
        text = JSON.parse(predictionsNative.get(i).prediction);
      } catch {
        text = predictionsNative.get(i).prediction;
      }
      if (text) predictions.push(text);
    }
    return predictions;
  }
}
