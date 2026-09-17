import type { PresageModule } from "./PresageTypes";
import type { PresageEngine } from "./PresageEngine";

type PresageEngines = Record<string, PresageEngine>;

function writePresageFile(
  module: PresageModule,
  engines: PresageEngines,
  path: string,
  contents: string,
  configKey: string,
): void {
  module.FS.writeFile(path, contents);
  for (const presageEngine of Object.values(engines)) {
    presageEngine.libPresage.config(configKey, path);
  }
}

export function setTextExpansions(
  module: PresageModule,
  engines: PresageEngines,
  textExpansions: Array<[string, object]> | null | undefined,
): void {
  const lines = (Array.isArray(textExpansions) ? textExpansions : []).map(
    ([shortcut, value]) => `${shortcut.toLowerCase()}\t${JSON.stringify(value)}`,
  );
  writePresageFile(
    module,
    engines,
    "/textExpansions.txt",
    lines.length > 0 ? `${lines.join("\n")}\n` : "",
    "Presage.Predictors.DefaultAbbreviationExpansionPredictor.ABBREVIATIONS",
  );
}

export function setUserDictionaryList(
  module: PresageModule,
  engines: PresageEngines,
  userDictionaryList: string[],
): void {
  writePresageFile(
    module,
    engines,
    "/userDictionary.txt",
    userDictionaryList.join("\n"),
    "Presage.Predictors.DefaultDictionaryPredictor.DICTIONARY",
  );
}
