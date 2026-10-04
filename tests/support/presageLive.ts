import libPresageMod from "../../src/third_party/libpresage/libpresage.js";
import { PresageHandler } from "../../src/adapters/chrome/background/PresageHandler";

export function createLiveConfig(textExpansions: Array<[string, string]>) {
  return {
    numSuggestions: 5,
    engineNumSuggestions: 10,
    minWordLengthToPredict: 0,
    insertSpaceAfterAutocomplete: true,
    autoCapitalize: false,
    prefixOnlyMode: false,
    textExpansions,
    timeFormat: "",
    dateFormat: "",
    userDictionaryList: [],
  };
}

export async function createLiveHandler(
  options?: ConstructorParameters<typeof PresageHandler>[1],
): Promise<PresageHandler> {
  const root = process.cwd();
  const Module = await libPresageMod({
    locateFile: (name: string) =>
      name.endsWith(".wasm")
        ? `${root}/src/third_party/libpresage/${name}`
        : `${root}/public/third_party/libpresage/${name}`,
  });
  return new PresageHandler(Module, options);
}
