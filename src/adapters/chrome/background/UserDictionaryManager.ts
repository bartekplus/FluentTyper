// Manages user dictionary logic for Presage
import type { PresageModule } from "./PresageTypes";
import { PresageEngine } from "./PresageEngine";

export class UserDictionaryManager {
  private userDictionaryList: string[] = [];
  private module: PresageModule;
  private presageEngineRecord: Record<string, PresageEngine>;

  constructor(
    module: PresageModule,
    presageEngineRecord: Record<string, PresageEngine>,
  ) {
    this.module = module;
    this.presageEngineRecord = presageEngineRecord;
  }

  setUserDictionaryList(userDictionaryList: string[]) {
    this.userDictionaryList = userDictionaryList;
    this.setupUserDictionary();
  }

  private setupUserDictionary() {
    const userDictionaryStr = this.userDictionaryList.join("\n");
    this.module.FS.writeFile("/userDictionary.txt", userDictionaryStr);
    for (const [, presageEngine] of Object.entries(this.presageEngineRecord)) {
      presageEngine.libPresage.config(
        "Presage.Predictors.DefaultDictionaryPredictor.DICTIONARY",
        "/userDictionary.txt",
      );
    }
  }
}
