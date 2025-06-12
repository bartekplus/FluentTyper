// Manages text expansion logic for Presage
import type { PresageModule } from "./PresageTypes";
import { PresageEngine } from "./PresageEngine";

export class TextExpansionManager {
  private textExpansions: Array<[string, object]> = [];
  private module: PresageModule;
  private presageEngineRecord: Record<string, PresageEngine>;

  constructor(
    module: PresageModule,
    presageEngineRecord: Record<string, PresageEngine>,
  ) {
    this.module = module;
    this.presageEngineRecord = presageEngineRecord;
  }

  setTextExpansions(textExpansions: Array<[string, object]>) {
    this.textExpansions = textExpansions;
    this.setupTextExpansions();
  }

  private setupTextExpansions() {
    if (!this.textExpansions) return;
    let textExpansionsStr = "";
    this.textExpansions.forEach((textExpansion) => {
      const jsonObj = JSON.stringify(textExpansion[1]);
      textExpansionsStr += `${textExpansion[0].toLowerCase()}\t${jsonObj}\n`;
    });
    this.module.FS.writeFile("/textExpansions.txt", textExpansionsStr);
    for (const [, presageEngine] of Object.entries(this.presageEngineRecord)) {
      presageEngine.libPresage.config(
        "Presage.Predictors.DefaultAbbreviationExpansionPredictor.ABBREVIATIONS",
        "/textExpansions.txt",
      );
    }
  }
}
