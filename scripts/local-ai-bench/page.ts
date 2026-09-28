/**
 * Browser side of the Local AI Review benchmark (bundled by run.ts, served
 * from http://localhost so WebGPU is available). Uses the REAL WebLLM runtime
 * and the product's prompt/parse code; the driver talks to `window.ftBench`.
 *
 * Synthetic fixture text only. Nothing here is shipped in the extension.
 */
import {
  MLCEngine,
  hasModelInCache,
  deleteModelAllInfoInCache,
  type AppConfig,
  type ChatCompletionMessageParam,
  type CompletionUsage,
} from "@mlc-ai/web-llm";
import {
  AI_PROMPT_VERSION,
  AI_RESPONSE_SCHEMA,
  aiMaxOutputTokens,
} from "../../src/core/domain/grammar/review/ai/prompts";
import {
  parseTextContract,
  textContractMessages,
  variantMessages,
  type PromptVariant,
} from "./promptVariants";
import { parseAiResponse } from "../../src/core/domain/grammar/review/ai/parse";
import type {
  AiGenerationOutcome,
  AiGenerationRequest,
} from "../../src/core/domain/grammar/review/ai/types";

export interface BenchModel {
  modelId: string;
  repo: string;
  revision: string;
  /** Absolute URL of the locally served model library. */
  libUrl: string;
  libSri: string;
  /** WebLLM prebuilt overrides for this id (e.g. Qwen3.5 max_history_size), plus our 4k context. */
  overrides: Record<string, unknown>;
}

export interface GenParams {
  temperature: number;
  seed: number;
  /** undefined = omit extra_body entirely. */
  enableThinking: boolean | undefined;
  /**
   * "schema": json_object + the response-contract JSON schema. "object": bare
   * json_object, which WebLLM 0.2.85 rejects (GrammarMatcherInitError: it
   * passes an undefined schema to xgrammar). "none": unconstrained.
   */
  json: "schema" | "object" | "none";
  /** "product" = prompts.ts as shipped; others are benchmark-only experiments. */
  prompt: PromptVariant;
  /**
   * Benchmark-only: extra output tokens for Qwen3 reasoning (enable_thinking
   * on, json "none"). A complete leading <think>…</think> block is stripped in
   * the harness before the product parser runs; the product rejects it.
   */
  thinkBudget?: number;
  /** Benchmark-only: "text" = one corrected sentence as plain text (engine comparison). */
  contract?: "json" | "text";
}

/** The shipped response-contract schema (re-exported for the driver's reports). */
export const RESPONSE_SCHEMA = AI_RESPONSE_SCHEMA;

export interface GenResult {
  raw: string;
  finish: string | null;
  ttftMs: number | null;
  /** chatCompletion start to stream end. */
  genMs: number;
  /** Including strict parse (validation against the snapshot runs in the driver). */
  parsedMs: number;
  maxTokens: number;
  usage: CompletionUsage | null;
  outcome: AiGenerationOutcome | null;
  error: string | null;
}

interface MinimalGpu {
  requestAdapter(options: { powerPreference: string }): Promise<{
    features: ReadonlySet<string>;
    info: { vendor: string; architecture: string; description: string };
  } | null>;
}

let engine: MLCEngine | null = null;

function appConfigFor(model: BenchModel): AppConfig {
  // Built like the product record: pinned revision, packaged lib + SRI, 4k context.
  return {
    model_list: [
      {
        model: `https://huggingface.co/${model.repo}/resolve/${model.revision}/`,
        model_id: model.modelId,
        model_lib: model.libUrl,
        integrity: { model_lib: model.libSri, onFailure: "error" },
        required_features: ["shader-f16"],
        overrides: { ...model.overrides, context_window_size: 4096 },
      },
    ],
  };
}

async function probe(): Promise<{ ok: boolean; detail: string; f16: boolean; ua: string }> {
  const ua = navigator.userAgent;
  const gpu = (navigator as Navigator & { gpu?: MinimalGpu }).gpu;
  if (!gpu) return { ok: false, detail: "no navigator.gpu", f16: false, ua };
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return { ok: false, detail: "null adapter", f16: false, ua };
  const f16 = adapter.features.has("shader-f16");
  const info = adapter.info;
  const detail = `${info.vendor} ${info.architecture} ${info.description}`.trim();
  return { ok: f16, detail: f16 ? detail : `${detail} (no shader-f16)`, f16, ua };
}

async function deleteModel(model: BenchModel): Promise<void> {
  await deleteModelAllInfoInCache(model.modelId, appConfigFor(model));
}

async function isCached(model: BenchModel): Promise<boolean> {
  return hasModelInCache(model.modelId, appConfigFor(model));
}

async function load(model: BenchModel): Promise<{ ms: number; progress: string }> {
  const appConfig = appConfigFor(model);
  let progress = "";
  engine = new MLCEngine({
    appConfig,
    initProgressCallback: (report) => {
      progress = report.text;
    },
  });
  const t0 = performance.now();
  await engine.reload(model.modelId);
  return { ms: performance.now() - t0, progress };
}

async function unload(): Promise<void> {
  await engine?.unload();
  engine = null;
}

async function generateMessages(
  messages: ChatCompletionMessageParam[],
  maxTokens: number,
  params: GenParams,
  onStart?: () => void,
): Promise<Omit<GenResult, "outcome" | "parsedMs">> {
  if (!engine) throw new Error("engine not loaded");
  await engine.resetChat();
  const t0 = performance.now();
  let ttftMs: number | null = null;
  let raw = "";
  let finish: string | null = null;
  let usage: CompletionUsage | null = null;
  let error: string | null = null;
  try {
    const stream = await engine.chat.completions.create({
      messages,
      n: 1,
      stream: true,
      stream_options: { include_usage: true },
      temperature: params.temperature,
      seed: params.seed,
      max_tokens: maxTokens,
      ...(params.json === "none"
        ? {}
        : {
            response_format: {
              type: "json_object" as const,
              ...(params.json === "schema" ? { schema: RESPONSE_SCHEMA } : {}),
            },
          }),
      ...(params.enableThinking === undefined
        ? {}
        : { extra_body: { enable_thinking: params.enableThinking } }),
    });
    onStart?.();
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta?.content;
      if (delta) {
        ttftMs ??= performance.now() - t0;
        raw += delta;
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) usage = chunk.usage;
    }
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : "unknown";
  }
  return { raw, finish, ttftMs, genMs: performance.now() - t0, maxTokens, usage, error };
}

async function generate(request: AiGenerationRequest, params: GenParams): Promise<GenResult> {
  const messages =
    params.contract === "text"
      ? textContractMessages(request)
      : variantMessages(params.prompt, request);
  const maxTokens = aiMaxOutputTokens(request) + (params.thinkBudget ?? 0);
  const t0 = performance.now();
  const result = await generateMessages(messages, maxTokens, params);
  // Only a normally finished stream is a candidate result (spec 8.4).
  const outcome: AiGenerationOutcome =
    result.error !== null
      ? { ok: false, error: "engine-failed" }
      : result.finish === "length"
        ? { ok: false, error: "truncated" }
        : result.finish !== "stop"
          ? { ok: false, error: "cancelled" }
          : params.contract === "text"
            ? parseTextContract(result.raw, request)
            : parseAiResponse(
                params.thinkBudget
                  ? result.raw.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "")
                  : result.raw,
                request,
              );
  return { ...result, outcome, parsedMs: performance.now() - t0 };
}

/** Plumbing smoke test that needs no domain code. */
async function generateTrivial(
  params: GenParams,
): Promise<Omit<GenResult, "outcome" | "parsedMs">> {
  return generateMessages(
    [
      { role: "system", content: 'Reply with JSON only: {"segments":[{"id":"s0","text":"..."}]}' },
      {
        role: "user",
        content: JSON.stringify({ segments: [{ id: "s0", text: "She dont know." }] }),
      },
    ],
    64,
    params,
  );
}

/** Starts a long generation, interrupts after `delayMs`, and times interrupt → settle. */
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
    variantMessages(params.prompt, request),
    aiMaxOutputTokens(request),
    params,
    () => {
      timer = setTimeout(() => {
        interruptAt = performance.now();
        engine?.interruptGenerate();
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

declare global {
  interface Window {
    ftBench: typeof api;
  }
}

/** Stops a running generation (harness timeout path). */
function interrupt(): void {
  engine?.interruptGenerate();
}

const api = {
  interrupt,
  promptVersion: AI_PROMPT_VERSION,
  probe,
  isCached,
  deleteModel,
  load,
  unload,
  generate,
  generateTrivial,
  cancelToSettle,
};
window.ftBench = api;
