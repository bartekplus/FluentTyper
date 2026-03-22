import type { PresageModule } from "./PresageTypes";
import type { PresageEngine } from "./PresageEngine";

export class UserDictionaryManager {
  private userDictionaryList: string[] = [];
  private readonly module: PresageModule;
  private readonly presageEngineRecord: Record<string, PresageEngine>;

  constructor(module: PresageModule, presageEngineRecord: Record<string, PresageEngine>) {
    this.module = module;
    this.presageEngineRecord = presageEngineRecord;
  }

  setUserDictionaryList(userDictionaryList: string[]) {
    this.userDictionaryList = userDictionaryList;
    this.setupUserDictionary();
  }

  private setupUserDictionary() {
    this.writeDictionaryFile("/userDictionary.txt", this.userDictionaryList);
    this.applyConfigToEngines(
      "Presage.Predictors.DefaultDictionaryPredictor.DICTIONARY",
      "/userDictionary.txt",
    );
  }

  private writeDictionaryFile(path: string, userDictionaryList: string[]): void {
    this.module.FS.writeFile(path, userDictionaryList.join("\n"));
  }

  private applyConfigToEngines(configKey: string, valuePath: string): void {
    for (const presageEngine of Object.values(this.presageEngineRecord)) {
      presageEngine.libPresage.config(configKey, valuePath);
    }
  }
}
