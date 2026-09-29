import {
  AutoModelForCausalLM,
  AutoTokenizer,
  Gemma4ForCausalLM,
  InterruptableStoppingCriteria,
  DynamicCache,
  Tensor,
  env,
  type PreTrainedTokenizer,
} from "@huggingface/transformers";
import {
  LOCAL_AI_DOWNLOAD_ORIGINS,
  type LocalAiModelRecord,
} from "@core/domain/localAi/modelRegistry";
import { LocalAiEngine, type GpuLike, type ModelLike, type TokenizerLike } from "./LocalAiEngine";
import { createNetworkGuard } from "./networkGuard";
import { withPromptPrefix } from "./promptPrefix";
import { MODEL_CACHE } from "./modelArtifacts";

/**
 * The only module that imports Transformers.js + ONNX Runtime Web (Chrome/Edge
 * background). build.ts swaps it for engineRuntime.noop.ts where the build
 * ships no Local AI runtime (Firefox).
 */

const guard = createNetworkGuard(
  globalThis.fetch.bind(globalThis),
  globalThis.location.origin,
  LOCAL_AI_DOWNLOAD_ORIGINS,
);

// Models come only from the pinned Hugging Face files the install cached; the
// ONNX Runtime WASM ships in the extension (never the default CDN, never a blob: copy).
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.cacheKey = MODEL_CACHE;
env.useWasmCache = false;
env.fetch = guard.fetch;
const onnxWasm = env.backends.onnx.wasm;
if (onnxWasm) {
  // Only the .wasm: a service worker cannot import() the .mjs glue, so ONNX Runtime's
  // bundle build (glue embedded) is bundled into background.js; build.ts copies the .wasm.
  onnxWasm.wasmPaths = {
    wasm: chrome.runtime.getURL("local-ai/ort/ort-wasm-simd-threaded.asyncify.wasm"),
  };
  // No cross-origin isolation and no Worker in a service worker: single-threaded WASM.
  onnxWasm.numThreads = 1;
}

/**
 * Some Transformers.js 4.3.0 lookups ignore the `revision` option (the tokenizer's
 * `tokenizer_config.json` probe asks for `resolve/main/`). Pinning the revision in the
 * path template makes every request name the pinned, cached file. One model loads at a time.
 */
function pinRevision(record: LocalAiModelRecord): void {
  env.remotePathTemplate = `{model}/resolve/${record.revision}/`;
}

export const localAiEngine: LocalAiEngine | null = new LocalAiEngine({
  runtime: {
    loadTokenizer: async (record): Promise<TokenizerLike> => {
      pinRevision(record);
      return (await AutoTokenizer.from_pretrained(record.repo, {
        revision: record.revision,
      })) as unknown as TokenizerLike;
    },
    loadModel: async (record, tokenizer): Promise<ModelLike> => {
      pinRevision(record);
      const options = { revision: record.revision, dtype: record.dtype, device: "webgpu" } as const;
      const model =
        record.loader === "gemma4"
          ? await Gemma4ForCausalLM.from_pretrained(record.repo, options)
          : await AutoModelForCausalLM.from_pretrained(record.repo, options);
      return record.loader === "gemma4"
        ? withPromptPrefix(model, tokenizer as unknown as PreTrainedTokenizer, {
            DynamicCache,
            Tensor,
          })
        : (model as unknown as ModelLike);
    },
    createStopper: () => new InterruptableStoppingCriteria(),
  },
  caches: globalThis.caches,
  gpu: (globalThis.navigator as Navigator & { gpu?: GpuLike }).gpu,
  guard,
});

// Erased types for the prefix helper; keep all Transformers imports at this boundary.
export type {
  DynamicCache,
  Tensor,
  PreTrainedModel,
  PreTrainedTokenizer,
} from "@huggingface/transformers";
