// Manages user dictionary logic for Presage
import type { PresageInstance, PresageModule } from "./PresageTypes";

export class UserDictionaryManager {
  private userDictionaryList: string[] = [];
  private module: PresageModule;
  private libPresage: Record<string, PresageInstance>;

  constructor(
    module: PresageModule,
    libPresage: Record<string, PresageInstance>,
  ) {
    this.module = module;
    this.libPresage = libPresage;
  }

  setUserDictionaryList(userDictionaryList: string[]) {
    this.userDictionaryList = userDictionaryList;
    this.setupUserDictionary();
  }

  private setupUserDictionary() {
    const userDictionaryStr = this.userDictionaryList.join("\n");
    this.module.FS.writeFile("/userDictionary.txt", userDictionaryStr);
    for (const [, libPresage] of Object.entries(this.libPresage)) {
      libPresage.config(
        "Presage.Predictors.DefaultDictionaryPredictor.DICTIONARY",
        "/userDictionary.txt",
      );
    }
  }
}
