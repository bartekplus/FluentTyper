/**
 * Curated, versioned registry of local AI Review models (application-owned).
 *
 * Only models listed here can be installed; there are no user-supplied model
 * URLs or remote registries. Each record pins the Hugging Face weight revision
 * and the model library (executable WASM) that ships INSIDE the extension,
 * with its SHA-256 (build check) and SRI hash (runtime check by WebLLM).
 *
 * Sizes: `downloadBytes` is the sum of the pinned revision's weight shards
 * (tensor-cache.json) and does not include small tokenizer/config files.
 * `vramEstimateMB` is WebLLM's registry estimate, not a measurement.
 *
 * Refresh with `bun scripts/fetch-local-ai-assets.ts --probe`.
 */

/** @mlc-ai/web-llm version these records were validated against (bun.lock resolution). */
export const LOCAL_AI_RUNTIME_VERSION = "0.2.85";
/** WebLLM model-library ABI directory the packaged libraries come from. */
export const LOCAL_AI_MODEL_LIB_ABI = "v0_2_84/base";

export type LocalAiModelTier = "standard" | "compact";

/** Evaluation status; a model is promoted only with recorded real-device evidence. */
export type LocalAiQualityStatus = "unevaluated" | "evaluated" | "rejected";

export interface LocalAiModelRecord {
  tier: LocalAiModelTier;
  /** Exact WebLLM model id. */
  modelId: string;
  displayName: string;
  /** Hugging Face repository (weights and tokenizer are data, fetched after consent). */
  weightsRepo: string;
  /** Immutable weight revision (git commit). */
  weightsRevision: string;
  /** Packaged model library, relative to the extension root. */
  modelLibPath: string;
  modelLibSha256: string;
  modelLibSri: string;
  modelLibBytes: number;
  quantization: "q4f16_1";
  contextWindow: number;
  requiredFeatures: readonly string[];
  downloadBytes: number;
  vramEstimateMB: number;
  /** How to switch reasoning off for fast editing; checked per family. */
  thinking: "qwen3-enable-thinking" | "none";
  /** Languages evaluated for Correct / Rewrite. */
  languages: readonly string[];
  quality: LocalAiQualityStatus;
  license: string;
  source: string;
}

/**
 * Chosen from the real-GPU evaluation (docs/local-ai-evaluation.md, prompt
 * review-ai-2): Qwen3 4B was the only candidate with no false positives, no
 * meaning-changing edits and useful recall, so it is the default. Qwen3 1.7B is
 * the smaller fallback: equally conservative, but it finds far fewer mistakes.
 */
export const LOCAL_AI_MODELS: readonly LocalAiModelRecord[] = [
  {
    tier: "standard",
    modelId: "Qwen3-4B-q4f16_1-MLC",
    displayName: "Recommended (Qwen3 4B)",
    weightsRepo: "mlc-ai/Qwen3-4B-q4f16_1-MLC",
    weightsRevision: "a5c9fab855e3ccbdfed2e7e69683d75f30332161",
    modelLibPath: "local-ai/libs/Qwen3-4B-q4f16_1_cs1k-webgpu.wasm",
    modelLibSha256: "a986a53c92579714eb7ec36856004f5fb75272c9f69091f14eb6b2086eea4440",
    modelLibSri: "sha384-QB/WFnhX7QZqBd40Q9xBb2zuTizKdvrjjH17IaigUbSuqhrLSogN8Hv8uHPlBzlO",
    modelLibBytes: 5_847_049,
    quantization: "q4f16_1",
    contextWindow: 4096,
    requiredFeatures: ["shader-f16"],
    downloadBytes: 2_262_920_192,
    vramEstimateMB: 3431.59,
    thinking: "qwen3-enable-thinking",
    languages: ["en"],
    quality: "evaluated",
    license: "Apache-2.0 (Qwen/Qwen3-4B); MLC conversion by mlc-ai",
    source: "https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC",
  },
  {
    tier: "compact",
    modelId: "Qwen3-1.7B-q4f16_1-MLC",
    displayName: "Compact (Qwen3 1.7B)",
    weightsRepo: "mlc-ai/Qwen3-1.7B-q4f16_1-MLC",
    weightsRevision: "80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc",
    modelLibPath: "local-ai/libs/Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm",
    modelLibSha256: "8161aaa4b40bccf19fcedb2f2e8c221eb9efb72d2198681f1958c9c1e05a682f",
    modelLibSri: "sha384-7QJDec7NGvNVHjD9ZRdHNFxHlk/iXvbqQ7xDxoO6lpVF7/GmSvWboR66CTWhsRL8",
    modelLibBytes: 5_566_554,
    quantization: "q4f16_1",
    contextWindow: 4096,
    requiredFeatures: ["shader-f16"],
    downloadBytes: 968_001_536,
    vramEstimateMB: 2036.66,
    thinking: "qwen3-enable-thinking",
    languages: ["en"],
    quality: "evaluated",
    license: "Apache-2.0 (Qwen/Qwen3-1.7B); MLC conversion by mlc-ai",
    source: "https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC",
  },
];

export const DEFAULT_LOCAL_AI_TIER: LocalAiModelTier = "standard";

export function localAiModelForTier(tier: unknown): LocalAiModelRecord {
  return (
    LOCAL_AI_MODELS.find((model) => model.tier === tier) ??
    LOCAL_AI_MODELS.find((model) => model.tier === DEFAULT_LOCAL_AI_TIER)!
  );
}

export function localAiModelById(modelId: unknown): LocalAiModelRecord | null {
  return LOCAL_AI_MODELS.find((model) => model.modelId === modelId) ?? null;
}

/**
 * Only these origins may serve model DATA (weights, tokenizer, config); they
 * also form the production CSP connect-src. Executable WASM never comes from
 * the network.
 */
export const LOCAL_AI_DOWNLOAD_ORIGINS: readonly string[] = [
  "https://huggingface.co",
  "https://cdn-lfs.huggingface.co",
  "https://cdn-lfs-us-1.huggingface.co",
  "https://cdn-lfs-us-1.hf.co",
  "https://cas-bridge.xethub.hf.co",
  // Xet-backed files (weights, tokenizer) redirect here from /resolve/<rev>/.
  "https://us.aws.cdn.hf.co",
];
