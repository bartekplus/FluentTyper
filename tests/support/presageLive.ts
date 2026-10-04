import libPresageMod from "../../src/third_party/libpresage/libpresage.js";
import { PresageHandler } from "../../src/adapters/chrome/background/PresageHandler";
import type { PresageModule } from "../../src/adapters/chrome/background/PresageTypes";
import { predictionConfig } from "./predictionConfig";

export { runPrediction } from "./predictionConfig";

// The Emscripten loader is plain JavaScript. Give it the type that src uses.
const loadPresage = libPresageMod as (options?: {
  locateFile: (name: string) => string;
}) => Promise<PresageModule>;

export function createLiveConfig(textExpansions: Array<[string, string]>) {
  return predictionConfig({
    insertSpaceAfterAutocomplete: true,
    textExpansions: textExpansions as unknown as Array<[string, object]>,
  });
}

export async function createLiveHandler(
  options?: ConstructorParameters<typeof PresageHandler>[1],
): Promise<PresageHandler> {
  const root = process.cwd();
  const Module = await loadPresage({
    locateFile: (name: string) =>
      name.endsWith(".wasm")
        ? `${root}/src/third_party/libpresage/${name}`
        : `${root}/public/third_party/libpresage/${name}`,
  });
  return new PresageHandler(Module, options);
}
