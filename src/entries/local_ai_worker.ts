import { CreateMLCEngine } from "@mlc-ai/web-llm";
import { LOCAL_AI_DOWNLOAD_ORIGINS } from "@core/domain/localAi/modelRegistry";
import {
  LocalAiWorkerEngine,
  type GpuLike,
} from "@adapters/chrome/offscreen/worker/LocalAiWorkerEngine";
import {
  installNetworkGuard,
  type GuardScope,
} from "@adapters/chrome/offscreen/worker/networkGuard";
import type { WorkerReply, WorkerRequest } from "@adapters/chrome/offscreen/workerProtocol";

/** Dedicated worker owning the only WebLLM engine; spawned by the Local AI offscreen document. */
type WorkerScope = GuardScope & {
  caches: CacheStorage;
  navigator: { gpu?: GpuLike };
  postMessage(message: WorkerReply): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

const scope = globalThis as unknown as WorkerScope;
const guard = installNetworkGuard(scope, LOCAL_AI_DOWNLOAD_ORIGINS);
const engine = new LocalAiWorkerEngine({
  createEngine: (modelId, appConfig, onProgress) =>
    CreateMLCEngine(modelId, { appConfig, initProgressCallback: onProgress, logLevel: "SILENT" }),
  caches: scope.caches,
  gpu: scope.navigator.gpu,
  guard,
  extensionOrigin: scope.location.origin,
});

scope.onmessage = (event) => {
  void engine.handle(event.data, (reply) => scope.postMessage(reply));
};
