// Handles Presage prediction logic for FluentTyper
import { PresageModule } from "./PresageTypes";
import {
  PresageHandler,
  PredictionResult,
  PresageConfig,
} from "./PresageHandler";
import libPresageMod from "../third_party/libpresage/libpresage.js";

export class PredictionManager {
  private libPresageMod: () => Promise<PresageModule>;
  private presageHandler: PresageHandler | undefined;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    this.libPresageMod = libPresageMod as () => Promise<PresageModule>;
    this.initialize();
  }

  async initialize(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this._doInitializePresage();
    }
    return this.initializationPromise;
  }

  private async _doInitializePresage(): Promise<void> {
    const Module = await this.libPresageMod();
    this.presageHandler = new PresageHandler(Module);
  }

  async runPrediction(
    text: string,
    nextChar: string,
    lang: string,
  ): Promise<PredictionResult> {
    await this.initialize();
    if (!this.presageHandler) throw new Error("Presage not initialized");
    return this.presageHandler.runPrediction(text, nextChar, lang);
  }

  setConfig(config: PresageConfig): void {
    if (!this.presageHandler) throw new Error("Presage not initialized");
    this.presageHandler.setConfig(config);
  }
}
