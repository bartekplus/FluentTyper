// Manages text expansion logic for Presage
import type { PresageInstance, PresageModule } from "./PresageTypes";

export class TextExpansionManager {
  private textExpansions: Array<[string, object]> = [];
  private module: PresageModule;
  private libPresage: Record<string, PresageInstance>;

  constructor(
    module: PresageModule,
    libPresage: Record<string, PresageInstance>,
  ) {
    this.module = module;
    this.libPresage = libPresage;
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
    for (const [, libPresage] of Object.entries(this.libPresage)) {
      libPresage.config(
        "Presage.Predictors.DefaultAbbreviationExpansionPredictor.ABBREVIATIONS",
        "/textExpansions.txt",
      );
    }
  }
}
