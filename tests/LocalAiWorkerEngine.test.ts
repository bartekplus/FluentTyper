import { describe, expect, jest, test } from "bun:test";
import type { ChatCompletionChunk, ChatCompletionRequestStreaming } from "@mlc-ai/web-llm";
import {
  LocalAiWorkerEngine,
  probeGpu,
  type EngineLike,
  type GpuLike,
  type WorkerEngineDeps,
} from "../src/adapters/chrome/offscreen/worker/LocalAiWorkerEngine";
import {
  installNetworkGuard,
  NETWORK_BLOCKED_ERROR_NAME,
} from "../src/adapters/chrome/offscreen/worker/networkGuard";
import {
  deleteModelArtifacts,
  localAiAppConfig,
  modelCacheState,
  modelWeightsUrl,
} from "../src/adapters/chrome/offscreen/worker/modelArtifacts";
import { LOCAL_AI_MODELS } from "../src/core/domain/localAi/modelRegistry";
import { AI_RESPONSE_SCHEMA } from "../src/core/domain/grammar/review/ai/prompts";
import type { AiGenerationRequest } from "../src/core/domain/grammar/review/ai/types";
import type { WorkerReply } from "../src/adapters/chrome/offscreen/workerProtocol";

const STANDARD = LOCAL_AI_MODELS[0];
const QUALITY = LOCAL_AI_MODELS[1];
const SENTINEL = "SENTINEL-7f3a-private-text";
const ORIGIN = "chrome-extension://ftext";

const REQUEST: AiGenerationRequest = {
  mode: "correct",
  lang: "en",
  style: null,
  contextBefore: "",
  contextAfter: "",
  segments: [{ id: "s0", text: `${SENTINEL} teh cat` }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function chunk(content: string, finish: string | null = null): ChatCompletionChunk {
  return {
    id: "c",
    created: 0,
    model: "m",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content }, finish_reason: finish }],
  } as unknown as ChatCompletionChunk;
}

class FakeEngine implements EngineLike {
  requests: ChatCompletionRequestStreaming[] = [];
  resets = 0;
  unloads = 0;
  interrupts = 0;
  chunks: ChatCompletionChunk[] = [chunk('{"segments":'), chunk("[]}", "stop")];
  failWith: Error | null = null;
  chat = {
    completions: {
      create: async (request: ChatCompletionRequestStreaming) => {
        this.requests.push(request);
        if (this.failWith) {
          throw this.failWith;
        }
        const chunks = this.chunks;
        return (async function* () {
          yield* chunks;
        })();
      },
    },
  };
  interruptGenerate(): void {
    this.interrupts += 1;
  }
  async resetChat(): Promise<void> {
    this.resets += 1;
  }
  async unload(): Promise<void> {
    this.unloads += 1;
  }
}

function makeEngine(overrides: Partial<WorkerEngineDeps> = {}) {
  const guard = { allowed: false, history: [] as boolean[] };
  const parse = jest.fn((raw: string) => ({
    ok: true as const,
    segments: [{ id: "s0", text: `parsed:${raw.length}` }],
  }));
  const deps: WorkerEngineDeps = {
    createEngine: jest.fn(async () => new FakeEngine()),
    caches: { has: async () => false, open: async () => ({}) as Cache },
    gpu: undefined,
    guard: {
      setNetworkAllowed: (allowed) => {
        guard.allowed = allowed;
        guard.history.push(allowed);
      },
    },
    extensionOrigin: ORIGIN,
    ai: {
      buildAiMessages: () => [
        { role: "system", content: "sys" },
        { role: "user", content: "data" },
      ],
      aiMaxOutputTokens: () => 321,
      parseAiResponse: parse,
    },
    ...overrides,
  };
  return { engine: new LocalAiWorkerEngine(deps), deps, guard, parse };
}

describe("LocalAiWorkerEngine lifecycle", () => {
  test("a load that finishes after unload is discarded and unloaded", async () => {
    const pending = deferred<EngineLike>();
    const { engine } = makeEngine({ createEngine: () => pending.promise });
    const load = engine.load(STANDARD.modelId, false, () => undefined);
    await flush();
    const unload = engine.unload();
    const late = new FakeEngine();
    pending.resolve(late);
    expect(await load).toEqual({ ok: false, error: "load-failed" });
    await unload;
    expect(late.unloads).toBe(1);
    expect(await engine.generate(STANDARD.modelId, REQUEST)).toEqual({
      ok: false,
      error: "not-ready",
    });
  });

  test("loads are single-flight per model; a model switch discards the earlier load", async () => {
    const first = deferred<EngineLike>();
    const created: string[] = [];
    const quality = new FakeEngine();
    const { engine } = makeEngine({
      createEngine: (modelId) => {
        created.push(modelId);
        return modelId === STANDARD.modelId ? first.promise : Promise.resolve(quality);
      },
    });
    const a1 = engine.load(STANDARD.modelId, false, () => undefined);
    const a2 = engine.load(STANDARD.modelId, false, () => undefined);
    expect(a2).toBe(a1);
    await flush();
    expect(created).toEqual([STANDARD.modelId]);
    const b = engine.load(QUALITY.modelId, false, () => undefined);
    const stale = new FakeEngine();
    first.resolve(stale);
    expect(await a1).toEqual({ ok: false, error: "load-failed" });
    expect(await a2).toEqual({ ok: false, error: "load-failed" });
    expect(await b).toEqual({ ok: true });
    expect(stale.unloads).toBe(1);
    expect(created).toEqual([STANDARD.modelId, QUALITY.modelId]);
    expect((await engine.generate(QUALITY.modelId, REQUEST)).ok).toBe(true);
  });

  test("network is allowed only while an explicit install loads", async () => {
    let allowedDuringCreate: boolean[] = [];
    const { engine, guard } = makeEngine({
      createEngine: async () => {
        allowedDuringCreate.push(guard.allowed);
        return new FakeEngine();
      },
    });
    expect(await engine.load(STANDARD.modelId, false, () => undefined)).toEqual({ ok: true });
    expect(allowedDuringCreate).toEqual([false]);
    allowedDuringCreate = [];
    await engine.unload();
    expect(await engine.install(STANDARD.modelId, () => undefined)).toEqual({ ok: true });
    expect(allowedDuringCreate).toEqual([true]);
    expect(guard.allowed).toBe(false);
  });

  test("the app config comes only from the registry record", () => {
    const config = localAiAppConfig(STANDARD, ORIGIN);
    expect(config.cacheBackend).toBe("cache");
    expect(config.model_list).toEqual([
      {
        model: `https://huggingface.co/${STANDARD.weightsRepo}/resolve/${STANDARD.weightsRevision}/`,
        model_id: STANDARD.modelId,
        model_lib: `${ORIGIN}/${STANDARD.modelLibPath}`,
        integrity: { model_lib: STANDARD.modelLibSri, onFailure: "error" },
        overrides: { context_window_size: STANDARD.contextWindow },
        required_features: ["shader-f16"],
      },
    ]);
  });
});

describe("LocalAiWorkerEngine generation", () => {
  async function loaded(fake = new FakeEngine()) {
    const made = makeEngine({ createEngine: async () => fake });
    await made.engine.load(STANDARD.modelId, false, () => undefined);
    return { ...made, fake };
  }

  test("resets chat around each job and uses bounded, JSON, non-thinking parameters", async () => {
    const { engine, fake, parse } = await loaded();
    const outcome = await engine.generate(STANDARD.modelId, REQUEST);
    expect(outcome).toEqual({ ok: true, segments: [{ id: "s0", text: "parsed:15" }] });
    expect(parse).toHaveBeenCalledWith('{"segments":[]}', REQUEST);
    expect(fake.resets).toBe(2);
    expect(fake.requests[0]).toMatchObject({
      stream: true,
      n: 1,
      temperature: 0,
      max_tokens: 321,
      seed: 42,
      // WebLLM 0.2.85 fails every bare json_object request (GrammarMatcherInitError):
      // the response contract must go with it as a schema (real-GPU evaluation finding).
      response_format: { type: "json_object", schema: AI_RESPONSE_SCHEMA },
      extra_body: { enable_thinking: false },
    });
    await engine.generate(STANDARD.modelId, { ...REQUEST, mode: "rewrite", style: "concise" });
    expect(fake.requests[1].temperature).toBe(0.4);
  });

  test("length is truncation, abort and interrupt are cancellation", async () => {
    const { engine, fake } = await loaded();
    fake.chunks = [chunk("{"), chunk("", "length")];
    expect(await engine.generate(STANDARD.modelId, REQUEST)).toEqual({
      ok: false,
      error: "truncated",
    });
    fake.chunks = [chunk("{"), chunk("", "abort")];
    expect(await engine.generate(STANDARD.modelId, REQUEST)).toEqual({
      ok: false,
      error: "cancelled",
    });
  });

  test("dependency errors become codes; their text never leaves the worker", async () => {
    const lost = Object.assign(new Error(`${SENTINEL} device`), { name: "DeviceLostError" });
    const replies: WorkerReply[] = [];
    const { engine } = makeEngine({
      createEngine: async (_modelId, _config, onProgress) => {
        onProgress({ progress: 0.5, timeElapsed: 1, text: `Fetching param cache ${SENTINEL}` });
        throw lost;
      },
    });
    await engine.handle({ id: 1, type: "install", modelId: STANDARD.modelId }, (reply) =>
      replies.push(reply),
    );
    expect(replies).toEqual([
      { id: 1, type: "progress", phase: "download", progress: 0.5 },
      { id: 1, type: "result", result: { ok: false, error: "device-lost" } },
    ]);

    const fake = new FakeEngine();
    fake.failWith = new Error(`${SENTINEL} generation`);
    const { engine: loadedEngine } = await loaded(fake);
    await loadedEngine.handle(
      { id: 2, type: "generate", modelId: STANDARD.modelId, request: REQUEST },
      (reply) => replies.push(reply),
    );
    expect(replies.at(-1)).toEqual({
      id: 2,
      type: "result",
      result: { ok: false, error: "engine-failed" },
    });
    expect(JSON.stringify(replies)).not.toContain(SENTINEL);
  });

  test("a review load that needs the network fails as cache-failed", async () => {
    const blocked = Object.assign(new Error("x"), { name: NETWORK_BLOCKED_ERROR_NAME });
    const { engine } = makeEngine({
      createEngine: async () => {
        throw blocked;
      },
    });
    expect(await engine.load(STANDARD.modelId, false, () => undefined)).toEqual({
      ok: false,
      error: "cache-failed",
    });
    const f16 = Object.assign(new Error("x"), { name: "ShaderF16SupportError" });
    const { engine: noF16 } = makeEngine({
      createEngine: async () => {
        throw f16;
      },
    });
    expect(await noF16.load(STANDARD.modelId, false, () => undefined)).toEqual({
      ok: false,
      unavailable: "missing-feature",
    });
  });
});

describe("probeGpu", () => {
  const goodLimits = {
    maxBufferSize: 1 << 30,
    maxStorageBufferBindingSize: 1 << 30,
    maxComputeWorkgroupStorageSize: 32 << 10,
    maxStorageBuffersPerShaderStage: 10,
  };
  const gpu = (adapter: unknown): GpuLike => ({
    requestAdapter: async () => adapter as Awaited<ReturnType<GpuLike["requestAdapter"]>>,
  });

  test("classifies support without reading adapter identity", async () => {
    expect(await probeGpu(undefined, STANDARD)).toBe("no-webgpu");
    expect(await probeGpu(gpu(null), STANDARD)).toBe("no-adapter");
    expect(await probeGpu(gpu({ features: new Set<string>(), limits: goodLimits }), STANDARD)).toBe(
      "missing-feature",
    );
    expect(
      await probeGpu(
        gpu({ features: new Set(["shader-f16"]), limits: { ...goodLimits, maxBufferSize: 1 } }),
        STANDARD,
      ),
    ).toBe("insufficient-limits");
    expect(
      await probeGpu(gpu({ features: new Set(["shader-f16"]), limits: goodLimits }), STANDARD),
    ).toBeNull();
  });
});

describe("network guard", () => {
  class FakeCache {
    puts: string[] = [];
    async put(request: Request): Promise<void> {
      this.puts.push(request.url);
    }
  }

  function makeScope(responseUrl?: string) {
    const nativeFetch = jest.fn(async (input: Request) => ({
      ok: true,
      url: responseUrl ?? input.url,
    }));
    const scope = {
      fetch: nativeFetch as unknown as typeof fetch,
      location: { origin: ORIGIN },
      Cache: FakeCache as unknown as { prototype: Cache },
    };
    const guard = installNetworkGuard(scope, ["https://huggingface.co", "https://cdn-lfs.hf.co"]);
    return { scope, guard, nativeFetch };
  }

  test("extension URLs always pass; the network is denied outside an install", async () => {
    const { scope, nativeFetch } = makeScope();
    await scope.fetch(`${ORIGIN}/${STANDARD.modelLibPath}`);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    await expect(scope.fetch("https://huggingface.co/a")).rejects.toMatchObject({
      name: NETWORK_BLOCKED_ERROR_NAME,
    });
    const cache = new (scope.Cache as unknown as typeof FakeCache)() as unknown as Cache;
    await expect(cache.add("https://huggingface.co/a")).rejects.toMatchObject({
      name: NETWORK_BLOCKED_ERROR_NAME,
    });
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  test("during an install only allowlisted origins pass, without credentials or referrer", async () => {
    const { scope, guard, nativeFetch } = makeScope();
    guard.setNetworkAllowed(true);
    await expect(scope.fetch("https://evil.example/a")).rejects.toMatchObject({
      name: NETWORK_BLOCKED_ERROR_NAME,
    });
    const cache = new (scope.Cache as unknown as typeof FakeCache)();
    await (cache as unknown as Cache).add("https://huggingface.co/model/a");
    expect(cache.puts).toEqual(["https://huggingface.co/model/a"]);
    expect(nativeFetch.mock.calls[0][1]).toEqual({
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  });

  test("a redirect off the allowlist is rejected", async () => {
    const { scope, guard } = makeScope("https://evil.example/landed");
    guard.setNetworkAllowed(true);
    await expect(scope.fetch("https://huggingface.co/a")).rejects.toMatchObject({
      name: NETWORK_BLOCKED_ERROR_NAME,
    });
  });
});

describe("model cache state", () => {
  function fakeCaches(entries: Record<string, Record<string, unknown>>) {
    const stores = new Map<string, Map<string, string>>();
    for (const [scope, files] of Object.entries(entries)) {
      stores.set(
        scope,
        new Map(Object.entries(files).map(([url, body]) => [url, JSON.stringify(body)])),
      );
    }
    const caches = {
      has: async (scope: string) => stores.has(scope),
      open: async (scope: string) => {
        const store = stores.get(scope) ?? new Map<string, string>();
        stores.set(scope, store);
        return {
          match: async (url: string) => (store.has(url) ? new Response(store.get(url)) : undefined),
          keys: async () => [...store.keys()].map((url) => new Request(url)),
          delete: async (request: Request) => store.delete(request.url),
        } as unknown as Cache;
      },
    };
    return { caches, stores };
  }

  const base = modelWeightsUrl(STANDARD);
  const config = { [`${base}mlc-chat-config.json`]: { tokenizer_files: ["tokenizer.json"] } };
  const model = {
    [`${base}tokenizer.json`]: {},
    [`${base}tensor-cache.json`]: {
      records: [{ dataPath: "params_shard_0.bin" }, { dataPath: "params_shard_1.bin" }],
    },
    [`${base}params_shard_0.bin`]: 0,
    [`${base}params_shard_1.bin`]: 1,
  };
  const otherRevision = "https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC/resolve/main/";

  test("complete, partial and none, reading every listed shard", async () => {
    expect(await modelCacheState(fakeCaches({}).caches, STANDARD)).toBe("none");
    expect(
      await modelCacheState(
        fakeCaches({ "webllm/config": config, "webllm/model": model }).caches,
        STANDARD,
      ),
    ).toBe("complete");
    const missingShard = { ...model };
    delete missingShard[`${base}params_shard_1.bin`];
    expect(
      await modelCacheState(
        fakeCaches({ "webllm/config": config, "webllm/model": missingShard }).caches,
        STANDARD,
      ),
    ).toBe("partial");
    expect(await modelCacheState(fakeCaches({ "webllm/config": config }).caches, STANDARD)).toBe(
      "partial",
    );
    expect(
      await modelCacheState(
        fakeCaches({ "webllm/model": { [`${otherRevision}tokenizer.json`]: {} } }).caches,
        STANDARD,
      ),
    ).toBe("none");
  });

  test("delete removes only this model's pinned artifacts", async () => {
    const { caches, stores } = fakeCaches({
      "webllm/config": config,
      "webllm/model": { ...model, [`${otherRevision}tokenizer.json`]: {} },
    });
    await deleteModelArtifacts(caches, STANDARD);
    expect(await modelCacheState(caches, STANDARD)).toBe("none");
    expect([...stores.get("webllm/model")!.keys()]).toEqual([`${otherRevision}tokenizer.json`]);
  });
});
