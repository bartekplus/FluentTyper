/**
 * Transformers.js benchmark candidates (benchmark-only; nothing here ships).
 * Repos are onnx-community or official exports; revisions are the commits
 * probed on 2026-09-28. `bytes` = the q4f16 ONNX graph + external data files
 * of that revision (tokenizer/config files are small and not included).
 */
export interface TjsModel {
  /** Short id used for --models and result file names. */
  id: string;
  repo: string;
  revision: string;
  dtype: "q4f16" | "q4";
  bytes: number;
  /** Pass enable_thinking=false to the chat template (templates with a thinking switch: Qwen3, SmolLM3). */
  disableThinking: boolean;
  license: string;
  /** WebLLM model with the same weights family, for the like-for-like table. */
  webllm?: string;
}

const MB = 1e6;

export const TJS_MODELS: readonly TjsModel[] = [
  {
    id: "tjs-Qwen3-4B",
    repo: "onnx-community/Qwen3-4B-ONNX",
    revision: "98ddba15d05dede4435afb63f13280abcdbc2a48",
    dtype: "q4f16",
    bytes: (59 + 2096 + 677) * MB,
    disableThinking: true,
    license: "apache-2.0 (Qwen/Qwen3-4B)",
    webllm: "Qwen3-4B-q4f16_1-MLC",
  },
  {
    id: "tjs-Phi-4-mini-instruct",
    repo: "onnx-community/Phi-4-mini-instruct-ONNX",
    revision: "e61f45fc5fabba2aee31ff85ba4cf99219b4bf28",
    dtype: "q4f16",
    bytes: (26 + 2087 + 438) * MB,
    disableThinking: false,
    license: "mit (microsoft/Phi-4-mini-instruct)",
    webllm: "Phi-4-mini-instruct-q4f16_1-MLC",
  },
  {
    id: "tjs-Llama-3.2-3B-Instruct",
    repo: "onnx-community/Llama-3.2-3B-Instruct-ONNX",
    revision: "cab364e7d0e1de7aa09e3abc932be92361c5b55f",
    dtype: "q4f16",
    bytes: (2095 + 311) * MB,
    disableThinking: false,
    license: "llama3.2",
    webllm: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
  },
  {
    id: "tjs-Qwen3-1.7B",
    repo: "onnx-community/Qwen3-1.7B-ONNX",
    revision: "cc6a06a21d614e9b8e92a6adfab1074d4e7d2438",
    dtype: "q4f16",
    bytes: 1426 * MB,
    disableThinking: true,
    license: "apache-2.0 (Qwen/Qwen3-1.7B)",
    webllm: "Qwen3-1.7B-q4f16_1-MLC",
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

export function tjsModel(id: string): TjsModel | undefined {
  return TJS_MODELS.find((model) => model.id === id);
}
