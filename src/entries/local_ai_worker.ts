import {
  AutoModelForCausalLM,
  AutoTokenizer,
  Gemma4ForConditionalGeneration,
  InterruptableStoppingCriteria,
  env,
} from "@huggingface/transformers";
import { LOCAL_AI_DOWNLOAD_ORIGINS } from "@core/domain/localAi/modelRegistry";
import {
  LocalAiWorkerEngine,
  type GpuLike,
  type ModelLike,
  type TokenizerLike,
} from "@adapters/chrome/offscreen/worker/LocalAiWorkerEngine";
import {
  installNetworkGuard,
  type GuardScope,
} from "@adapters/chrome/offscreen/worker/networkGuard";
import { MODEL_CACHE } from "@adapters/chrome/offscreen/worker/modelArtifacts";
import type { WorkerReply, WorkerRequest } from "@adapters/chrome/offscreen/workerProtocol";

/** Dedicated worker owning the only Local AI engine; spawned by the offscreen document. */
type WorkerScope = GuardScope & {
  caches: CacheStorage;
  navigator: { gpu?: GpuLike };
  postMessage(message: WorkerReply): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

const scope = globalThis as unknown as WorkerScope;
const guard = installNetworkGuard(scope, LOCAL_AI_DOWNLOAD_ORIGINS);

// Models come only from the pinned Hugging Face files the install cached; the
// ONNX Runtime WASM ships in the extension (never the default CDN, never a blob: copy).
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.cacheKey = MODEL_CACHE;
env.useWasmCache = false;
env.fetch = scope.fetch;
const onnxWasm = env.backends.onnx.wasm;
if (onnxWasm) {
  // Explicit files (as Transformers.js itself picks them for WebGPU), copied by build.ts.
  const ort = `${scope.location.origin}/local-ai/ort/ort-wasm-simd-threaded.asyncify`;
  onnxWasm.wasmPaths = { mjs: `${ort}.mjs`, wasm: `${ort}.wasm` };
  // No cross-origin isolation in an extension worker: single-threaded WASM.
  onnxWasm.numThreads = 1;
}

const engine = new LocalAiWorkerEngine({
  runtime: {
    loadTokenizer: async (record): Promise<TokenizerLike> =>
      (await AutoTokenizer.from_pretrained(record.repo, {
        revision: record.revision,
      })) as unknown as TokenizerLike,
    loadModel: async (record): Promise<ModelLike> => {
      const options = { revision: record.revision, dtype: record.dtype, device: "webgpu" } as const;
      const model =
        record.loader === "gemma4"
          ? await Gemma4ForConditionalGeneration.from_pretrained(record.repo, options)
          : await AutoModelForCausalLM.from_pretrained(record.repo, options);
      return model as unknown as ModelLike;
    },
    createStopper: () => new InterruptableStoppingCriteria(),
  },
  caches: scope.caches,
  gpu: scope.navigator.gpu,
  guard,
  fetch: (url) => scope.fetch(url),
});

scope.onmessage = (event) => {
  void engine.handle(event.data, (reply) => scope.postMessage(reply));
};
