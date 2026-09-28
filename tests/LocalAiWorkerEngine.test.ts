import { describe, expect, jest, test } from "bun:test";
import { createHash } from "crypto";
import {
  LocalAiWorkerEngine,
  probeGpu,
  type GpuLike,
  type ModelLike,
  type StopperLike,
  type TensorLike,
  type TokenizerLike,
  type WorkerEngineDeps,
} from "../src/adapters/chrome/offscreen/worker/LocalAiWorkerEngine";
import {
  installNetworkGuard,
  NetworkBlockedError,
} from "../src/adapters/chrome/offscreen/worker/networkGuard";
import { MODEL_CACHE } from "../src/adapters/chrome/offscreen/worker/modelArtifacts";
import { Sha256 } from "../src/adapters/chrome/offscreen/worker/sha256";
import {
  LOCAL_AI_DOWNLOAD_ORIGINS,
  localAiModelFileUrl,
  type LocalAiModelRecord,
} from "../src/core/domain/localAi/modelRegistry";
import type { AiGenerationRequest } from "../src/core/domain/grammar/review/ai/types";
import { aiMaxOutputTokens } from "../src/core/domain/grammar/review/ai/prompts";
import type { WorkerReply } from "../src/adapters/chrome/offscreen/workerProtocol";

const SENTINEL = "SENTINEL-7f3a-private-text";
const ORIGIN = "chrome-extension://ftext";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const REQUEST: AiGenerationRequest = {
  mode: "correct",
  lang: "en",
  style: null,
  contextBefore: "",
  contextAfter: "",
  segments: [{ id: "s0", text: `${SENTINEL} teh cat` }],
};

// ------------------------------------------------------------------ tiny synthetic models

const hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const encode = (text: string) => new TextEncoder().encode(text);

function makeRecord(
  name: string,
  contents: Record<string, string>,
  loader: "gemma4" | "causal-lm",
) {
  const files = Object.entries(contents).map(([path, text]) => {
    const bytes = encode(text);
    return { path, bytes: bytes.length, sha256: hex(bytes) };
  });
  const record: LocalAiModelRecord = {
    tier: loader === "gemma4" ? "standard" : "compact",
    modelId: `${name}@test`,
    displayName: name,
    repo: `test-org/${name}`,
    revision: "0123456789abcdef0123456789abcdef01234567",
    dtype: "q4f16",
    loader,
    files,
    downloadBytes: files.reduce((total, file) => total + file.bytes, 0),
    requiredFeatures: ["shader-f16"],
    disableThinking: loader === "gemma4",
    languages: ["en"],
    license: "test",
  };
  const served = new Map(
    files.map((file, i) => [localAiModelFileUrl(record, file), Object.values(contents)[i]]),
  );
  return { record, served };
}

const GEMMA = makeRecord(
  "gemma",
  {
    "config.json": '{"model_type":"gemma4"}',
    "tokenizer.json": "{}",
    "onnx/model.onnx_data": "weights-gemma",
  },
  "gemma4",
);
const QWEN = makeRecord(
  "qwen",
  { "config.json": '{"model_type":"qwen3"}', "onnx/model.onnx_data": "weights-qwen" },
  "causal-lm",
);
const MODELS = [GEMMA.record, QWEN.record];
const findModel = (modelId: unknown) => MODELS.find((model) => model.modelId === modelId) ?? null;

// ------------------------------------------------------------------ fakes

class FakeCaches {
  readonly stores = new Map<string, Map<string, { body: Uint8Array; headers: Headers }>>();
  async has(name: string) {
    return this.stores.has(name);
  }
  async open(name: string): Promise<Cache> {
    const store =
      this.stores.get(name) ?? new Map<string, { body: Uint8Array; headers: Headers }>();
    this.stores.set(name, store);
    const key = (request: RequestInfo | URL) =>
      typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    return {
      match: async (request: RequestInfo | URL) => {
        const entry = store.get(key(request));
        return entry ? new Response(entry.body.slice(), { headers: entry.headers }) : undefined;
      },
      put: async (request: RequestInfo | URL, response: Response) => {
        store.set(key(request), {
          body: new Uint8Array(await response.arrayBuffer()),
          headers: new Headers(response.headers),
        });
      },
      delete: async (request: RequestInfo | URL) => store.delete(key(request)),
      keys: async () => [...store.keys()].map((url) => new Request(url)),
    } as unknown as Cache;
  }
  urls(name = MODEL_CACHE): string[] {
    return [...(this.stores.get(name)?.keys() ?? [])];
  }
}

function tensor(tokens: number, text = ""): TensorLike & { text: string } {
  return {
    dims: [1, tokens],
    text,
    slice: (_rows: unknown, range: unknown) => {
      const start = Array.isArray(range) && typeof range[0] === "number" ? range[0] : 0;
      return tensor(tokens - start, text);
    },
  } as TensorLike & { text: string };
}

class FakeTokenizer implements TokenizerLike {
  templateOptions: Array<Record<string, unknown>> = [];
  apply_chat_template(_messages: unknown, options: Record<string, unknown>) {
    this.templateOptions.push(options);
    return { input_ids: tensor(10), attention_mask: "mask" };
  }
  batch_decode(batch: TensorLike): string[] {
    return [(batch as TensorLike & { text: string }).text];
  }
}

class FakeModel implements ModelLike {
  calls: Array<Record<string, unknown>> = [];
  disposed = 0;
  generateImpl: (options: { stopping_criteria: StopperLike[] }) => Promise<unknown> = async () =>
    tensor(13, '{"segments":[{"id":"s0","text":"fixed"}]}');
  async generate(options: Parameters<ModelLike["generate"]>[0]) {
    this.calls.push(options as unknown as Record<string, unknown>);
    return this.generateImpl(options);
  }
  async dispose() {
    this.disposed += 1;
  }
}

class FakeStopper implements StopperLike {
  interrupted = false;
  interrupt() {
    this.interrupted = true;
  }
}

interface Setup {
  served?: Map<string, string>;
  redirects?: Map<string, string>;
  /** A fake loader; `workerFetch` is the worker's guarded fetch. */
  loadModel?: (record: LocalAiModelRecord, workerFetch: typeof fetch) => Promise<ModelLike>;
}

function makeEngine(setup: Setup = {}) {
  const served = setup.served ?? new Map([...GEMMA.served, ...QWEN.served]);
  const network: string[] = [];
  const nativeFetch = jest.fn(async (input: Request, _init?: RequestInit) => {
    network.push(input.url);
    const body = served.get(input.url);
    const response = new Response(body === undefined ? null : body, {
      status: body === undefined ? 404 : 200,
    });
    const finalUrl = setup.redirects?.get(input.url) ?? input.url;
    Object.defineProperty(response, "url", { value: finalUrl });
    return response;
  });
  const scope = { fetch: nativeFetch as unknown as typeof fetch, location: { origin: ORIGIN } };
  const guard = installNetworkGuard(scope, LOCAL_AI_DOWNLOAD_ORIGINS);
  const caches = new FakeCaches();
  const tokenizer = new FakeTokenizer();
  const model = new FakeModel();
  const deps: WorkerEngineDeps = {
    runtime: {
      loadTokenizer: async () => tokenizer,
      loadModel: (record) =>
        setup.loadModel ? setup.loadModel(record, scope.fetch) : Promise.resolve(model),
      createStopper: () => new FakeStopper(),
    },
    caches,
    gpu: undefined,
    guard,
    fetch: (url) => scope.fetch(url),
    findModel,
  };
  return {
    engine: new LocalAiWorkerEngine(deps),
    scope,
    network,
    nativeFetch,
    caches,
    tokenizer,
    model,
  };
}

const noProgress = () => undefined;

// ------------------------------------------------------------------ install and cache

describe("install, integrity and cache state", () => {
  test("downloads exactly the listed files, verifies them, loads from cache, marks complete", async () => {
    const { engine, caches, network, nativeFetch } = makeEngine();
    const progress: Array<[string, number]> = [];
    expect(
      await engine.install(GEMMA.record.modelId, (phase, value) => progress.push([phase, value])),
    ).toEqual({ ok: true });
    expect(network).toEqual([...GEMMA.served.keys()]);
    expect(nativeFetch.mock.calls[0][1]).toEqual({
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    expect(progress).toContainEqual(["download", 1]);
    expect(progress.at(-1)).toEqual(["load", 1]);
    expect(caches.urls().sort()).toEqual([...GEMMA.served.keys()].sort());
    expect(await engine.cacheState(GEMMA.record.modelId)).toEqual({ install: "complete" });
    expect(await engine.cacheState(QWEN.record.modelId)).toEqual({ install: "none" });
  });

  test("a resumed install re-verifies cached files instead of downloading them again", async () => {
    const { engine, network } = makeEngine();
    await engine.install(GEMMA.record.modelId, noProgress);
    network.length = 0;
    await engine.unload();
    const progress: number[] = [];
    const onProgress = (phase: string, value: number) => {
      if (phase === "download") progress.push(value);
    };
    expect(await engine.install(GEMMA.record.modelId, onProgress)).toEqual({ ok: true });
    expect(network).toEqual([]);
    // Verification of the cached files is visible as progress, not silence.
    expect(progress.filter((value) => value > 0 && value < 1).length).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(1);
  });

  test("a tampered file fails integrity and removes the model's entries", async () => {
    const served = new Map(GEMMA.served);
    const weights = [...served.keys()].find((url) => url.endsWith(".onnx_data"))!;
    served.set(weights, "weights-evil!");
    const { engine, caches } = makeEngine({ served });
    expect(await engine.install(GEMMA.record.modelId, noProgress)).toEqual({
      ok: false,
      error: "integrity-failed",
    });
    expect(caches.urls()).toEqual([]);
    expect(await engine.cacheState(GEMMA.record.modelId)).toEqual({ install: "none" });
  });

  test("files present without the verified marker are partial, never complete", async () => {
    const { engine, caches } = makeEngine();
    const store = await caches.open(MODEL_CACHE);
    for (const [url, body] of GEMMA.served) {
      await store.put(url, new Response(body));
    }
    expect(await engine.cacheState(GEMMA.record.modelId)).toEqual({ install: "partial" });
  });

  test("delete removes only that model's files and marker", async () => {
    const { engine, caches } = makeEngine();
    await engine.install(GEMMA.record.modelId, noProgress);
    await engine.install(QWEN.record.modelId, noProgress);
    const presage = await caches.open("presage-dictionaries");
    await presage.put("https://example.invalid/en.db", new Response("dict"));
    await engine.delete(GEMMA.record.modelId);
    expect(await engine.cacheState(GEMMA.record.modelId)).toEqual({ install: "none" });
    expect(await engine.cacheState(QWEN.record.modelId)).toEqual({ install: "complete" });
    expect(caches.urls("presage-dictionaries")).toEqual(["https://example.invalid/en.db"]);
  });
});

// ------------------------------------------------------------------ network guard

describe("network guard", () => {
  test("review-time loads cannot reach the network; a missing listed file is cache-failed", async () => {
    const listed = [...GEMMA.served.keys()][2];
    const made = makeEngine({
      loadModel: async (_record, workerFetch) => {
        await workerFetch(listed);
        return new FakeModel();
      },
    });
    expect(await made.engine.load(GEMMA.record.modelId, noProgress)).toEqual({
      ok: false,
      error: "cache-failed",
    });
    expect(made.network).toEqual([]);
  });

  test("a loader request for a file missing from the registry fails the install and names it", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const unlisted = `https://huggingface.co/${GEMMA.record.repo}/resolve/${GEMMA.record.revision}/special_tokens_map.json`;
    const made = makeEngine({
      loadModel: async (_record, workerFetch) => {
        await workerFetch(unlisted);
        return new FakeModel();
      },
    });
    expect(await made.engine.install(GEMMA.record.modelId, noProgress)).toEqual({
      ok: false,
      error: "load-failed",
    });
    expect(warn).toHaveBeenCalledWith(expect.any(String), unlisted);
    expect(made.network).not.toContain(unlisted);
    expect(await made.engine.cacheState(GEMMA.record.modelId)).toEqual({ install: "partial" });
    warn.mockRestore();
  });

  test("extension URLs always pass; network only for allowlisted URLs and redirects", async () => {
    const extensionUrl = `${ORIGIN}/local-ai/ort/ort-wasm-simd-threaded.asyncify.wasm`;
    const listed = [...GEMMA.served.keys()][0];
    const cdnRedirect = new Map([[listed, "https://us.aws.cdn.hf.co/xet/abc"]]);
    const ok = makeEngine({
      served: new Map([[extensionUrl, "wasm"], ...GEMMA.served]),
      redirects: cdnRedirect,
    });
    await ok.scope.fetch(extensionUrl);
    await expect(ok.scope.fetch(listed)).rejects.toBeInstanceOf(NetworkBlockedError);
    expect(await ok.engine.install(GEMMA.record.modelId, noProgress)).toEqual({ ok: true });

    const evil = makeEngine({ redirects: new Map([[listed, "https://evil.example/x"]]) });
    expect(await evil.engine.install(GEMMA.record.modelId, noProgress)).toEqual({
      ok: false,
      error: "download-failed",
    });
  });
});

// ------------------------------------------------------------------ lifecycle and generation

describe("lifecycle and generation", () => {
  async function loaded(setup: Setup = {}) {
    const made = makeEngine(setup);
    await made.engine.install(GEMMA.record.modelId, noProgress);
    return made;
  }

  test("a load that finishes after unload is disposed; loads are single-flight", async () => {
    let finish!: (model: ModelLike) => void;
    const late = new FakeModel();
    const loads: string[] = [];
    const { engine } = makeEngine({
      loadModel: (record) => {
        loads.push(record.modelId);
        return new Promise((resolve) => (finish = resolve));
      },
    });
    const a = engine.load(GEMMA.record.modelId, noProgress);
    expect(engine.load(GEMMA.record.modelId, noProgress)).toBe(a);
    await flush();
    const unloading = engine.unload();
    finish(late);
    expect(await a).toEqual({ ok: false, error: "load-failed" });
    await unloading;
    expect(late.disposed).toBe(1);
    expect(loads).toEqual([GEMMA.record.modelId]);
    expect(await engine.generate(GEMMA.record.modelId, REQUEST)).toEqual({
      ok: false,
      error: "not-ready",
    });
  });

  test("greedy, bounded generation; the thinking switch goes to Gemma's chat template", async () => {
    const { engine, model, tokenizer } = await loaded();
    const outcome = await engine.generate(GEMMA.record.modelId, REQUEST);
    expect(outcome).toEqual({ ok: true, segments: [{ id: "s0", text: "fixed" }] });
    expect(tokenizer.templateOptions[0]).toEqual({
      add_generation_prompt: true,
      return_dict: true,
      enable_thinking: false,
    });
    expect(model.calls[0]).toMatchObject({
      max_new_tokens: aiMaxOutputTokens(REQUEST),
      do_sample: false,
      attention_mask: "mask",
    });

    const qwen = makeEngine();
    await qwen.engine.install(QWEN.record.modelId, noProgress);
    await qwen.engine.generate(QWEN.record.modelId, REQUEST);
    expect(qwen.tokenizer.templateOptions[0]).not.toHaveProperty("enable_thinking");
  });

  test("interrupt stops through the stopping criteria; hitting the budget is truncation", async () => {
    const { engine, model } = await loaded();
    model.generateImpl = async ({ stopping_criteria }) => {
      engine.interrupt();
      expect(stopping_criteria[0].interrupted).toBe(true);
      return tensor(12, "{");
    };
    expect(await engine.generate(GEMMA.record.modelId, REQUEST)).toEqual({
      ok: false,
      error: "cancelled",
    });
    model.generateImpl = async () => tensor(10 + aiMaxOutputTokens(REQUEST), "{");
    expect(await engine.generate(GEMMA.record.modelId, REQUEST)).toEqual({
      ok: false,
      error: "truncated",
    });
  });

  test("dependency errors become codes; their text never leaves the worker", async () => {
    const replies: WorkerReply[] = [];
    const failing = makeEngine({
      loadModel: async () => {
        throw new Error(`${SENTINEL} load`);
      },
    });
    await failing.engine.handle(
      { id: 1, type: "install", modelId: GEMMA.record.modelId },
      (reply) => replies.push(reply),
    );
    expect(replies.at(-1)).toEqual({
      id: 1,
      type: "result",
      result: { ok: false, error: "load-failed" },
    });

    const { engine, model } = await loaded();
    model.generateImpl = async () => {
      throw new Error(`${SENTINEL} generation`);
    };
    await engine.handle(
      { id: 2, type: "generate", modelId: GEMMA.record.modelId, request: REQUEST },
      (reply) => replies.push(reply),
    );
    expect(replies.at(-1)).toEqual({
      id: 2,
      type: "result",
      result: { ok: false, error: "engine-failed" },
    });
    expect(JSON.stringify(replies)).not.toContain(SENTINEL);
    expect(
      replies.every((reply) => reply.type === "result" || typeof reply.progress === "number"),
    ).toBe(true);
  });
});

describe("probeGpu and SHA-256", () => {
  const gpu = (adapter: unknown): GpuLike => ({
    requestAdapter: async () => adapter as Awaited<ReturnType<GpuLike["requestAdapter"]>>,
  });

  test("classifies support without reading adapter identity", async () => {
    expect(await probeGpu(undefined, GEMMA.record)).toBe("no-webgpu");
    expect(await probeGpu(gpu(null), GEMMA.record)).toBe("no-adapter");
    expect(await probeGpu(gpu({ features: new Set<string>() }), GEMMA.record)).toBe(
      "missing-feature",
    );
    expect(await probeGpu(gpu({ features: new Set(["shader-f16"]) }), GEMMA.record)).toBeNull();
  });

  test("incremental SHA-256 matches a reference across chunk boundaries", () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_003]) {
      const data = new Uint8Array(size).map((_, i) => (i * 131 + 7) & 255);
      const hash = new Sha256();
      for (let offset = 0; offset < size;) {
        const step = Math.min(size - offset, 1 + ((offset * 17) % 97));
        hash.update(data.subarray(offset, offset + step));
        offset += step;
      }
      expect(hash.digestHex()).toBe(hex(data));
    }
  });
});
