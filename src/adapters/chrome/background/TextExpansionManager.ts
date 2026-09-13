import type { PresageModule } from "./PresageTypes";
import type { PresageEngine } from "./PresageEngine";

export class TextExpansionManager {
  private readonly module: PresageModule;
  private readonly presageEngineRecord: Record<string, PresageEngine>;

  constructor(module: PresageModule, presageEngineRecord: Record<string, PresageEngine>) {
    this.module = module;
    this.presageEngineRecord = presageEngineRecord;
  }

  setTextExpansions(textExpansions: Array<[string, object]> | null | undefined) {
    const lines = (Array.isArray(textExpansions) ? textExpansions : []).map(
      ([shortcut, value]) => `${shortcut.toLowerCase()}\t${JSON.stringify(value)}`,
    );
    const path = "/textExpansions.txt";
    const payload = lines.length > 0 ? `${lines.join("\n")}\n` : "";
    this.module.FS.writeFile(path, payload);
    for (const presageEngine of Object.values(this.presageEngineRecord)) {
      presageEngine.libPresage.config(
        "Presage.Predictors.DefaultAbbreviationExpansionPredictor.ABBREVIATIONS",
        path,
      );
    }
  }
}
