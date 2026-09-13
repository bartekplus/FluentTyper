import type { PresageModule } from "./PresageTypes";
import type { PresageEngine } from "./PresageEngine";

export class UserDictionaryManager {
  private readonly module: PresageModule;
  private readonly presageEngineRecord: Record<string, PresageEngine>;

  constructor(module: PresageModule, presageEngineRecord: Record<string, PresageEngine>) {
    this.module = module;
    this.presageEngineRecord = presageEngineRecord;
  }

  setUserDictionaryList(userDictionaryList: string[]) {
    const path = "/userDictionary.txt";
    this.module.FS.writeFile(path, userDictionaryList.join("\n"));
    for (const presageEngine of Object.values(this.presageEngineRecord)) {
      presageEngine.libPresage.config(
        "Presage.Predictors.DefaultDictionaryPredictor.DICTIONARY",
        path,
      );
    }
  }
}
