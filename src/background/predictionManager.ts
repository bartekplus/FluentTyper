// Handles Presage prediction logic for FluentTyper
import { PresageModule } from "./PresageTypes";
import { PresageHandler, PredictionResult, PresageConfig } from "./presageHandler";

export class PredictionManager {
  private PresageHandlerClass: typeof PresageHandler;
  private libPresageMod: () => Promise<PresageModule>;
  private presageHandler: PresageHandler | undefined;
  private initializationPromise: Promise<void> | null = null;

  constructor(PresageHandlerClass: typeof PresageHandler, libPresageMod: () => Promise<PresageModule>) {
    this.PresageHandlerClass = PresageHandlerClass;
    this.libPresageMod = libPresageMod;
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
    this.presageHandler = new this.PresageHandlerClass(Module);
  }

  runPrediction(text: string, nextChar: string, lang: string): PredictionResult  {
    if (!this.presageHandler) throw new Error("Presage not initialized");
    return this.presageHandler.runPrediction(text, nextChar, lang);
  }

  setConfig(config: PresageConfig): void {
    if (!this.presageHandler) throw new Error("Presage not initialized");
    this.presageHandler.setConfig(config);
  }
}
