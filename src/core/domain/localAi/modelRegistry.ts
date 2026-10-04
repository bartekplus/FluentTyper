/**
 * Curated, versioned registry of local AI Review models (application-owned).
 *
 * Only models listed here can be installed; there are no user-supplied model
 * URLs or remote registries. Engine: Transformers.js (ONNX Runtime Web on
 * WebGPU). The runtime (JavaScript + ONNX Runtime WASM) ships INSIDE the
 * extension; a model is only data: each record pins a Hugging Face revision
 * and lists every file the loader fetches, with its size and SHA-256. The
 * worker downloads nothing else, only after explicit consent, and verifies
 * each file's hash after download.
 *
 * Refresh file lists with `bun run probe:local-ai`.
 */

export type LocalAiModelTier = "standard" | "compact";

export function isLocalAiModelTier(value: unknown): value is LocalAiModelTier {
  return value === "standard" || value === "compact";
}

export interface LocalAiModelFile {
  /** Path inside the pinned repository revision. */
  path: string;
  bytes: number;
  /** Hex SHA-256 of the file content (Hugging Face LFS oid for large files). */
  sha256: string;
}

export interface LocalAiModelRecord {
  tier: LocalAiModelTier;
  /** Stable id stored in the consent record; changes whenever the pinned files change. */
  modelId: string;
  displayName: string;
  /** Hugging Face repository with the ONNX export. */
  repo: string;
  /** Immutable revision (git commit). */
  revision: string;
  /** ONNX weight variant loaded by Transformers.js. */
  dtype: "q4f16";
  /** How the model is loaded: a plain causal LM, or Gemma 4's multimodal export used for text only. */
  loader: "causal-lm" | "gemma4";
  /** Every file the loader fetches for this dtype (nothing else is ever downloaded). */
  files: readonly LocalAiModelFile[];
  /** Sum of `files` bytes. */
  downloadBytes: number;
  requiredFeatures: readonly string[];
  /** Pass `enable_thinking: false` to the chat template (models with a thinking switch). */
  disableThinking: boolean;
  /** Languages evaluated for Correct / Rewrite. */
  languages: readonly string[];
  license: string;
}

const sum = (files: readonly LocalAiModelFile[]) =>
  files.reduce((total, file) => total + file.bytes, 0);

const GEMMA_4_E4B_FILES: readonly LocalAiModelFile[] = [
  {
    path: "chat_template.jinja",
    bytes: 16_317,
    sha256: "781d10940fbc44be40064b5d43a056fc486c84ceaa55538226368b57314132bf",
  },
  {
    path: "config.json",
    bytes: 5_741,
    sha256: "3251c77df50bccec2037f7e06a023105aeacbc89b784d990b1d279fc83ff9b1f",
  },
  {
    path: "generation_config.json",
    bytes: 238,
    sha256: "e6a0b50de21a511f15ac4857b7f227f68ee60ecb1f11255d07b75e0bdc60e155",
  },
  {
    path: "onnx/decoder_model_merged_q4f16.onnx",
    bytes: 850_610,
    sha256: "43aa27452be3dd7fbb9524257dd66af957add748ddab20ea63ae71923e59aa08",
  },
  {
    path: "onnx/decoder_model_merged_q4f16.onnx_data",
    bytes: 2_074_847_232,
    sha256: "b6aa13eab3ecdf4721293e93c806c279ca0516956187f7aec63ee90ec7216e73",
  },
  {
    path: "onnx/decoder_model_merged_q4f16.onnx_data_1",
    bytes: 812_318_720,
    sha256: "84e1c5f09ba88a5351959e4f73f62bce46f92dc19a7d7c82376ef36771c26a30",
  },
  {
    path: "onnx/embed_tokens_q4f16.onnx",
    bytes: 5_619,
    sha256: "aa48aa1806eda0ea42b79cd8eea355aebaf3b6ae3b04190bfee7ceef308603a4",
  },
  {
    path: "onnx/embed_tokens_q4f16.onnx_data",
    bytes: 2_017_460_224,
    sha256: "fd0f39c08f7e20a31145c2351a76a408b6c4ab60d15cc33f40e29cf30c0b2451",
  },
  {
    path: "preprocessor_config.json",
    bytes: 43,
    sha256: "4457c6e8a09070d7d5d1cd983fbfb67ebafe602bd98120c3543a024f5d07056b",
  },
  {
    path: "processor_config.json",
    bytes: 1_689,
    sha256: "32bdf45d2ad4cc29a0822ddd157a182de76644f0419a6228d151495256e9813c",
  },
  {
    path: "tokenizer.json",
    bytes: 19_439_251,
    sha256: "47bd35616c7c782aaca6ccf48c75f3461d5877170984b8836b375107d0a9f566",
  },
  {
    path: "tokenizer_config.json",
    bytes: 18_807,
    sha256: "06afbf54e228050cba79c4a0afd83543cc89070a2d62b8337d0aa8b4cdc348c3",
  },
];

const QWEN3_4B_2507_FILES: readonly LocalAiModelFile[] = [
  {
    path: "chat_template.jinja",
    bytes: 2_630,
    sha256: "64f85b198065d0fba2a81f37e10ed68161ce2c19a754c7100e67e0ca2ee9c326",
  },
  {
    path: "config.json",
    bytes: 1_834,
    sha256: "42558142027cd0ce5dca24b1f09883add6c55b1f80dcba2ee046af80ee96e912",
  },
  {
    path: "generation_config.json",
    bytes: 247,
    sha256: "f7d05af39b85275fb5390f14715092795e19ffce8823f87e3296f33eff3af82b",
  },
  {
    path: "onnx/model_q4f16.onnx",
    bytes: 437_655,
    sha256: "6e603b4d2324fa94a1c1fc927d1f985da78413afcffa27b02b008d909eccc4a8",
  },
  {
    path: "onnx/model_q4f16.onnx_data",
    bytes: 2_094_347_264,
    sha256: "d2b17463255a120a6d4e88c60e24bb6be6607ab6e34dd89b62234879bfd6ce0d",
  },
  {
    path: "onnx/model_q4f16.onnx_data_1",
    bytes: 794_787_840,
    sha256: "6c0d3b7ee94fa08c2dc766dfa4c5b790e492077701847b40fa001f648f3ebded",
  },
  {
    path: "tokenizer.json",
    bytes: 9_117_040,
    sha256: "e7a95fce95bf5b0946d0ddb3f9d7caa030b7e850bbe92b0edb26bcf563e9f3d5",
  },
  {
    path: "tokenizer_config.json",
    bytes: 3_503,
    sha256: "2c18685703d8955c439efd1b6703a617f3dfb335dc6bf3f0fe6e8ed10ff39c61",
  },
];

/**
 * Chosen from the real-GPU evaluation (docs/local-ai-evaluation.md): Gemma 4
 * E4B-it found the most errors of every model tested (dense 78%, held-out 84%
 * accepted) with no changes to correct text; Qwen3-4B-Instruct-2507 is the
 * smaller option.
 */
export const LOCAL_AI_MODELS: readonly LocalAiModelRecord[] = [
  {
    tier: "standard",
    modelId: "gemma-4-E4B-it-onnx-q4f16@843f250f",
    displayName: "Recommended (Gemma 4 E4B)",
    repo: "onnx-community/gemma-4-E4B-it-ONNX",
    revision: "843f250f23bc91754def1e0f0db390dacd1e6b05",
    dtype: "q4f16",
    loader: "gemma4",
    files: GEMMA_4_E4B_FILES,
    downloadBytes: sum(GEMMA_4_E4B_FILES),
    requiredFeatures: ["shader-f16"],
    disableThinking: true,
    languages: ["en"],
    license: "Apache-2.0 (google/gemma-4-E4B-it); ONNX export by onnx-community",
  },
  {
    tier: "compact",
    modelId: "qwen3-4b-instruct-2507-onnx-q4f16@41a4dd4d",
    displayName: "Compact (Qwen3 4B Instruct 2507)",
    repo: "onnx-community/Qwen3-4B-Instruct-2507-ONNX",
    revision: "41a4dd4d147229f83043afb98a4d4c803b8bfcbb",
    dtype: "q4f16",
    loader: "causal-lm",
    files: QWEN3_4B_2507_FILES,
    downloadBytes: sum(QWEN3_4B_2507_FILES),
    requiredFeatures: ["shader-f16"],
    disableThinking: false,
    languages: ["en"],
    license: "Apache-2.0 (Qwen/Qwen3-4B-Instruct-2507); ONNX export by onnx-community",
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

/** The pinned download URL of one of a record's files. */
export function localAiModelFileUrl(record: LocalAiModelRecord, file: LocalAiModelFile): string {
  return `https://huggingface.co/${record.repo}/resolve/${record.revision}/${file.path}`;
}

/**
 * True when `url` is served from one of `origins`. An entry "https://*.example"
 * matches HTTPS subdomains of example only, as in CSP source expressions.
 */
export function matchesDownloadOrigin(url: string, origins: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return origins.some((entry) => {
    if (!entry.startsWith("https://*.")) return parsed.origin === entry;
    const suffix = entry.slice("https://*".length);
    return parsed.protocol === "https:" && !parsed.port && parsed.hostname.endsWith(suffix);
  });
}

export const LOCAL_AI_DOWNLOAD_ORIGINS: readonly string[] = [
  "https://huggingface.co",
  "https://cdn-lfs.huggingface.co",
  "https://cdn-lfs-us-1.huggingface.co",
  "https://cdn-lfs-us-1.hf.co",
  "https://cas-bridge.xethub.hf.co",
  // Xet-backed files (weights, tokenizer) redirect from /resolve/<rev>/ to a
  // regional Hugging Face CDN host (us.aws.cdn.hf.co, …): any subdomain of cdn.hf.co.
  "https://*.cdn.hf.co",
];
