/**
 * Browser side of the Local AI Review benchmark: Transformers.js (ONNX Runtime
 * Web on WebGPU), the product engine. Bundled by run.ts and served from
 * http://localhost so WebGPU is available; uses the product's prompt and parse
 * code. The driver talks to `window.ftBench`. Nothing here ships.
 *
 * - ONNX Runtime's WASM/JS is served by the harness from node_modules (by
 *   default Transformers.js would fetch it from cdn.jsdelivr.net), and
 *   useWasmCache is off so no blob: module is created (MV3 CSP forbids it).
 * - Weights/tokenizer/config come from the pinned Hugging Face revision and are
 *   cached by Transformers.js in CacheStorage ("transformers-cache").
 * - Correct is greedy; there is no grammar-constrained output in Transformers.js
 *   4.3.0, so the JSON contract is unconstrained.
 *
 * Synthetic fixture text only.
 */
import {
  AutoModelForCausalLM,
  AutoTokenizer,
  Gemma4ForConditionalGeneration,
  InterruptableStoppingCriteria,
  TextStreamer,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Tensor,
} from "@huggingface/transformers";
import {
  AI_PROMPT_VERSION,
  aiMaxOutputTokens,
} from "../../src/core/domain/grammar/review/ai/prompts";
import { parseAiResponse } from "../../src/core/domain/grammar/review/ai/parse";
import type {
  AiGenerationOutcome,
  AiGenerationRequest,
} from "../../src/core/domain/grammar/review/ai/types";
import {
  parseTextContract,
  textContractMessages,
  variantMessages,
  type PromptVariant,
} from "./promptVariants";
import type { BenchModel } from "./tjsModels";

export interface GenParams {
  /** 0 = greedy (Correct); > 0 samples at this temperature (Rewrite). */
  temperature: number;
  /** "product" is prompts.ts as shipped; others are benchmark-only experiments. */
  prompt: PromptVariant;
  /** Benchmark-only: "text" = one corrected sentence as plain text instead of the JSON contract. */
  contract?: "json" | "text";
}

export interface GenResult {
  raw: string;
  finish: string | null;
  ttftMs: number | null;
  /** Request start to generation end. */
  genMs: number;
  /** Including strict parse (validation against the snapshot runs in the driver). */
  parsedMs: number;
  maxTokens: number;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  outcome: AiGenerationOutcome | null;
  error: string | null;
}

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = false;
const onnxWasm = env.backends.onnx.wasm;
if (onnxWasm) {
  onnxWasm.wasmPaths = {
    mjs: `${location.origin}/ort/ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: `${location.origin}/ort/ort-wasm-simd-threaded.asyncify.wasm`,
  };
}

let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;
let current: BenchModel | null = null;
const stopper = new InterruptableStoppingCriteria();

interface MinimalGpu {
  requestAdapter(options: { powerPreference: string }): Promise<{
    features: ReadonlySet<string>;
    info: { vendor: string; architecture: string; description: string };
  } | null>;
}

async function probe(): Promise<{ ok: boolean; detail: string; f16: boolean; ua: string }> {
  const ua = navigator.userAgent;
  const gpu = (navigator as Navigator & { gpu?: MinimalGpu }).gpu;
  if (!gpu) return { ok: false, detail: "no navigator.gpu", f16: false, ua };
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return { ok: false, detail: "null adapter", f16: false, ua };
  const f16 = adapter.features.has("shader-f16");
  const detail = `${adapter.info.vendor} ${adapter.info.architecture}`.trim();
  return { ok: f16, detail: f16 ? detail : `${detail} (no shader-f16)`, f16, ua };
}

const repoPrefix = (m: BenchModel) => `https://huggingface.co/${m.repo}/resolve/${m.revision}/`;

async function cachedKeys(m: BenchModel): Promise<Request[]> {
  const cache = await caches.open(env.cacheKey);
  return (await cache.keys()).filter((request) => request.url.startsWith(repoPrefix(m)));
}

/** Cached when the ONNX graph of the chosen dtype is in CacheStorage. */
async function isCached(m: BenchModel): Promise<boolean> {
  return (await cachedKeys(m)).some((request) => request.url.includes(`_${m.dtype}.onnx`));
}

async function deleteModel(m: BenchModel): Promise<void> {
  const cache = await caches.open(env.cacheKey);
  for (const request of await cachedKeys(m)) await cache.delete(request);
}

async function load(m: BenchModel): Promise<{ ms: number }> {
  const t0 = performance.now();
  current = m;
  tokenizer = await AutoTokenizer.from_pretrained(m.repo, { revision: m.revision });
  const options = { revision: m.revision, dtype: m.dtype, device: "webgpu" } as const;
  model =
    m.loader === "gemma4"
      ? await Gemma4ForConditionalGeneration.from_pretrained(m.repo, options)
      : await AutoModelForCausalLM.from_pretrained(m.repo, options);
  return { ms: performance.now() - t0 };
}

async function unload(): Promise<void> {
  await model?.dispose();
  model = null;
  tokenizer = null;
}

type ChatMessage = { role: "system" | "user"; content: string };

async function generateMessages(
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number,
  onStart?: () => void,
): Promise<Omit<GenResult, "outcome" | "parsedMs">> {
  if (!model || !tokenizer || !current) throw new Error("engine not loaded");
  const tok = tokenizer;
  stopper.reset();
  const t0 = performance.now();
  let ttftMs: number | null = null;
  let finish: string | null = null;
  let error: string | null = null;
  let raw = "";
  let usage: GenResult["usage"] = null;
  try {
    const inputs = tok.apply_chat_template(messages, {
      add_generation_prompt: true,
      return_dict: true,
      ...(current.disableThinking ? { enable_thinking: false } : {}),
    }) as { input_ids: Tensor; attention_mask: Tensor };
    const promptTokens = inputs.input_ids.dims.at(-1)!;
    const streamer = new TextStreamer(tok, {
      skip_prompt: true,
      skip_special_tokens: true,
      token_callback_function: () => {
        ttftMs ??= performance.now() - t0;
      },
    });
    onStart?.();
    const output = (await model.generate({
      ...inputs,
      max_new_tokens: maxTokens,
      ...(temperature > 0 ? { do_sample: true, temperature } : { do_sample: false }),
      streamer,
      stopping_criteria: [stopper],
    })) as Tensor;
    const generated = output.slice(null, [promptTokens, output.dims.at(-1)!]);
    raw = tok.batch_decode(generated, { skip_special_tokens: true })[0] ?? "";
    const newTokens = generated.dims.at(-1)!;
    usage = {
      prompt_tokens: promptTokens,
      completion_tokens: newTokens,
      total_tokens: promptTokens + newTokens,
    };
    finish = stopper.interrupted ? "abort" : newTokens >= maxTokens ? "length" : "stop";
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : "unknown";
  }
  return { raw, finish, ttftMs, genMs: performance.now() - t0, maxTokens, usage, error };
}

function messagesFor(request: AiGenerationRequest, params: GenParams): ChatMessage[] {
  return params.contract === "text"
    ? textContractMessages(request)
    : variantMessages(params.prompt, request);
}

async function generate(request: AiGenerationRequest, params: GenParams): Promise<GenResult> {
  const maxTokens = aiMaxOutputTokens(request);
  const t0 = performance.now();
  const result = await generateMessages(
    messagesFor(request, params),
    maxTokens,
    params.temperature,
  );
  const outcome: AiGenerationOutcome =
    result.error !== null
      ? { ok: false, error: "engine-failed" }
      : result.finish === "length"
        ? { ok: false, error: "truncated" }
        : result.finish !== "stop"
          ? { ok: false, error: "cancelled" }
          : params.contract === "text"
            ? parseTextContract(result.raw, request)
            : parseAiResponse(result.raw, request);
  return { ...result, outcome, parsedMs: performance.now() - t0 };
}

async function generateTrivial(): Promise<Omit<GenResult, "outcome" | "parsedMs">> {
  return generateMessages(
    [
      { role: "system", content: 'Reply with JSON only: {"segments":[{"id":"s0","text":"..."}]}' },
      {
        role: "user",
        content: JSON.stringify({ segments: [{ id: "s0", text: "She dont know." }] }),
      },
    ],
    64,
    0,
  );
}

async function cancelToSettle(
  request: AiGenerationRequest,
  params: GenParams,
  delayMs: number,
): Promise<{
  settleMs: number;
  finish: string | null;
  charsBeforeCancel: number;
  error: string | null;
}> {
  let interruptAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = generateMessages(
    messagesFor(request, params),
    aiMaxOutputTokens(request),
    params.temperature,
    () => {
      timer = setTimeout(() => {
        interruptAt = performance.now();
        stopper.interrupt();
      }, delayMs);
    },
  );
  const result = await run;
  clearTimeout(timer);
  const settled = performance.now();
  return {
    settleMs: interruptAt ? settled - interruptAt : -1,
    finish: result.finish,
    charsBeforeCancel: result.raw.length,
    error: result.error,
  };
}

/** Runs one load + short generation inside a dedicated worker (see tjsWorker.ts). */
function workerCheck(m: BenchModel): Promise<Record<string, unknown>> {
  const worker = new Worker(`${location.origin}/worker.js`, { type: "module" });
  return new Promise((resolve) => {
    worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      resolve(event.data);
      worker.terminate();
    };
    worker.onerror = (event) => resolve({ ok: false, error: String(event.message).slice(0, 300) });
    worker.postMessage({ repo: m.repo, revision: m.revision, loader: m.loader });
  });
}

/** Stops a running generation (harness timeout path). */
function interrupt(): void {
  stopper.interrupt();
}

const api = {
  promptVersion: AI_PROMPT_VERSION,
  interrupt,
  workerCheck,
  probe,
  isCached,
  load,
  unload,
  deleteModel,
  generate,
  generateTrivial,
  cancelToSettle,
};
declare global {
  interface Window {
    ftBench: typeof api;
  }
}
window.ftBench = api;
