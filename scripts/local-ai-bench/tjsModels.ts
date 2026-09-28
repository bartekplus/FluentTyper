/**
 * Models the benchmark can run. The shipped models come from the product
 * registry (src/core/domain/localAi/modelRegistry.ts), so the bench loads
 * exactly the repo/revision/dtype/loader that ships; `TJS_MODELS` below are
 * extra, benchmark-only candidates (onnx-community or official exports; the
 * revisions are the commits probed on 2026-09-28). `bytes` = the dtype's ONNX
 * graph + external data (+ small files for registry models).
 */
import { LOCAL_AI_MODELS } from "../../src/core/domain/localAi/modelRegistry";

export interface BenchModel {
  /** Short id used for --models and result file names. */
  id: string;
  repo: string;
  revision: string;
  dtype: "q4f16" | "q4";
  bytes: number;
  /** Pass enable_thinking=false to the chat template (templates with a thinking switch). */
  disableThinking: boolean;
  license: string;
  /**
   * "gemma4": multimodal export (embed_tokens + decoder + audio/vision encoders),
   * loaded with Gemma4ForConditionalGeneration and used for text only.
   */
  loader?: "causal-lm" | "gemma4";
  /** Registry models only: every file the product fetches (checked against what the bench fetched). */
  files?: readonly string[];
}

const MB = 1e6;

export const TJS_MODELS: readonly BenchModel[] = [
  {
    id: "tjs-gemma-4-E2B-it",
    repo: "onnx-community/gemma-4-E2B-it-ONNX",
    revision: "9f4bef82ea6e296bc69f8a2f5939f73af81b07a6",
    dtype: "q4f16",
    // decoder + embed_tokens + audio/vision encoders (loaded, unused for text)
    bytes: (1520 + 1590 + 170 + 100) * MB,
    disableThinking: true,
    license: "apache-2.0 (google/gemma-4-E2B-it)",
    loader: "gemma4",
  },
  {
    id: "tjs-gemma-4-E4B-it",
    repo: "onnx-community/gemma-4-E4B-it-ONNX",
    revision: "843f250f23bc91754def1e0f0db390dacd1e6b05",
    dtype: "q4f16",
    bytes: (2890 + 2020 + 170 + 100) * MB,
    disableThinking: true,
    license: "apache-2.0 (google/gemma-4-E4B-it)",
    loader: "gemma4",
  },
  {
    id: "tjs-Qwen3-4B",
    repo: "onnx-community/Qwen3-4B-ONNX",
    revision: "98ddba15d05dede4435afb63f13280abcdbc2a48",
    dtype: "q4f16",
    bytes: (59 + 2096 + 677) * MB,
    disableThinking: true,
    license: "apache-2.0 (Qwen/Qwen3-4B)",
  },
  {
    id: "tjs-Phi-4-mini-instruct",
    repo: "onnx-community/Phi-4-mini-instruct-ONNX",
    revision: "e61f45fc5fabba2aee31ff85ba4cf99219b4bf28",
    dtype: "q4f16",
    bytes: (26 + 2087 + 438) * MB,
    disableThinking: false,
    license: "mit (microsoft/Phi-4-mini-instruct)",
  },
  {
    id: "tjs-Llama-3.2-3B-Instruct",
    repo: "onnx-community/Llama-3.2-3B-Instruct-ONNX",
    revision: "cab364e7d0e1de7aa09e3abc932be92361c5b55f",
    dtype: "q4f16",
    bytes: (2095 + 311) * MB,
    disableThinking: false,
    license: "llama3.2",
  },
  {
    id: "tjs-Qwen3-1.7B",
    repo: "onnx-community/Qwen3-1.7B-ONNX",
    revision: "cc6a06a21d614e9b8e92a6adfab1074d4e7d2438",
    dtype: "q4f16",
    bytes: 1426 * MB,
    disableThinking: true,
    license: "apache-2.0 (Qwen/Qwen3-1.7B)",
  },
  {
    id: "tjs-Qwen3-4B-Instruct-2507",
    repo: "onnx-community/Qwen3-4B-Instruct-2507-ONNX",
    revision: "41a4dd4d147229f83043afb98a4d4c803b8bfcbb",
    dtype: "q4f16",
    bytes: (2094 + 794) * MB,
    disableThinking: false,
    license: "apache-2.0 (Qwen/Qwen3-4B-Instruct-2507)",
  },
  {
    id: "tjs-gemma-3-1b-it",
    repo: "onnx-community/gemma-3-1b-it-ONNX",
    revision: "a58439f40017d3b99c7d378ff525e54e0ba08ebf",
    dtype: "q4f16",
    bytes: 763 * MB,
    disableThinking: false,
    license: "gemma",
  },
  {
    id: "tjs-gemma-3-270m-it",
    repo: "onnx-community/gemma-3-270m-it-ONNX",
    revision: "2dbbfdb1b59bd034eb959428c6a7da9dd7ea27f0",
    dtype: "q4f16",
    bytes: 272 * MB,
    disableThinking: false,
    license: "gemma",
  },
  {
    id: "tjs-SmolLM3-3B",
    repo: "HuggingFaceTB/SmolLM3-3B-ONNX",
    revision: "af50613703fb6f10ffcb21b27ad48edcb8334232",
    dtype: "q4f16",
    bytes: (0.3 + 2124) * MB,
    disableThinking: true,
    license: "apache-2.0",
  },
  {
    id: "tjs-SmolLM2-1.7B-Instruct",
    repo: "HuggingFaceTB/SmolLM2-1.7B-Instruct",
    revision: "31b70e2e869a7173562077fd711b654946d38674",
    dtype: "q4f16",
    bytes: 1109 * MB,
    disableThinking: false,
    license: "apache-2.0",
  },
  {
    id: "tjs-LFM2-2.6B",
    repo: "onnx-community/LFM2-2.6B-ONNX",
    revision: "9655cd41239618886d6ebf9b4ff20b892b295f78",
    dtype: "q4f16",
    bytes: 1654 * MB,
    disableThinking: false,
    license: "other (LFM Open License v1.0)",
  },
  {
    id: "tjs-granite-4.0-micro",
    repo: "onnx-community/granite-4.0-micro-ONNX-web",
    revision: "33934a228c1c06167ddcbf0781db817fd934bbec",
    dtype: "q4f16",
    bytes: (2088 + 212) * MB,
    disableThinking: false,
    license: "apache-2.0",
  },
];

/** Registry records as bench models; `--models=standard|compact` or the record's modelId selects one. */
export const REGISTRY_MODELS: readonly (BenchModel & { tier: string })[] = LOCAL_AI_MODELS.map(
  (record) => ({
    id: record.modelId,
    tier: record.tier,
    repo: record.repo,
    revision: record.revision,
    dtype: record.dtype,
    bytes: record.downloadBytes,
    disableThinking: record.disableThinking,
    license: record.license,
    loader: record.loader,
    files: record.files.map((file) => file.path),
  }),
);

export function benchModel(id: string): BenchModel | undefined {
  return (
    REGISTRY_MODELS.find((model) => model.id === id || model.tier === id) ??
    TJS_MODELS.find((model) => model.id === id)
  );
}
