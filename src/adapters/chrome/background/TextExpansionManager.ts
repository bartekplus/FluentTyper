import type { PresageModule } from "./PresageTypes";
import type { PresageEngine } from "./PresageEngine";

export class TextExpansionManager {
  private textExpansions: Array<[string, object]> = [];
  private readonly module: PresageModule;
  private readonly presageEngineRecord: Record<string, PresageEngine>;

  constructor(module: PresageModule, presageEngineRecord: Record<string, PresageEngine>) {
    this.module = module;
    this.presageEngineRecord = presageEngineRecord;
  }

  setTextExpansions(textExpansions: Array<[string, object]> | null | undefined) {
    this.textExpansions = Array.isArray(textExpansions) ? textExpansions : [];
    this.setupTextExpansions();
  }

  private setupTextExpansions() {
    const lines = this.textExpansions.map(
      ([shortcut, value]) => `${shortcut.toLowerCase()}\t${JSON.stringify(value)}`,
    );
    this.writeConfigFile("/textExpansions.txt", lines);
    this.applyConfigToEngines(
      "Presage.Predictors.DefaultAbbreviationExpansionPredictor.ABBREVIATIONS",
      "/textExpansions.txt",
    );
  }

  private writeConfigFile(path: string, lines: string[]): void {
    const payload = lines.length > 0 ? `${lines.join("\n")}\n` : "";
    this.module.FS.writeFile(path, payload);
  }

  private applyConfigToEngines(configKey: string, valuePath: string): void {
    for (const presageEngine of Object.values(this.presageEngineRecord)) {
      presageEngine.libPresage.config(configKey, valuePath);
    }
  }
}
