import "@core/application/polyfills/bufferGlobal";
import { localAiEngine } from "@adapters/chrome/background/localAi/engineRuntime";
import { startBackground } from "@adapters/chrome/background/background";

startBackground(localAiEngine);
