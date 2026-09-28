import { describe, expect, test } from "bun:test";
import { LocalAiHost, type PortLike } from "../src/adapters/chrome/offscreen/LocalAiHost";
import {
  JobScheduler,
  MAX_PENDING_PER_PORT,
  MAX_PENDING_TOTAL,
} from "../src/adapters/chrome/offscreen/JobScheduler";
import type { WorkerLike } from "../src/adapters/chrome/offscreen/WorkerClient";
import type {
  WorkerCall,
  WorkerRequest,
  WorkerResults,
} from "../src/adapters/chrome/offscreen/workerProtocol";
import { LOCAL_AI_HOST_PORT, LOCAL_AI_REVIEW_PORT } from "../src/core/domain/contracts/localAi";
import { LOCAL_AI_MODELS } from "../src/core/domain/localAi/modelRegistry";
import type { AiGenerationRequest } from "../src/core/domain/grammar/review/ai/types";

const STANDARD = LOCAL_AI_MODELS[0];
const SENTINEL = "SENTINEL-host-9c21";

const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function request(text: string): AiGenerationRequest {
  return {
    mode: "correct",
    lang: "en",
    style: null,
    contextBefore: "",
    contextAfter: "",
    segments: [{ id: "s0", text }],
  };
}

// ------------------------------------------------------------------ fakes

class FakePort implements PortLike {
  messages: Array<Record<string, unknown>> = [];
  disconnected = false;
  private readonly messageListeners: Array<(message: unknown) => void> = [];
  private readonly disconnectListeners: Array<() => void> = [];
  onMessage = {
    addListener: (listener: (message: unknown) => void) => this.messageListeners.push(listener),
  };
  onDisconnect = { addListener: (listener: () => void) => this.disconnectListeners.push(listener) };

  constructor(
    readonly name: string,
    readonly sender?: { tab?: unknown },
  ) {}

  postMessage(message: unknown): void {
    this.messages.push(message as Record<string, unknown>);
  }
  disconnect(): void {
    this.disconnected = true;
  }
  emit(message: unknown): void {
    this.messageListeners.forEach((listener) => listener(message));
  }
  close(): void {
    this.disconnectListeners.forEach((listener) => listener());
  }
  results(): Array<Record<string, unknown>> {
    return this.messages.filter((message) => message.type === "result");
  }
}

type Handler = (call: WorkerCall) => unknown;

class FakeWorker implements WorkerLike {
  calls: WorkerCall[] = [];
  interrupts = 0;
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onInterrupt: () => void = () => undefined;

  constructor(private readonly handlers: Partial<Record<WorkerCall["type"], Handler>>) {}

  postMessage(message: WorkerRequest): void {
    if (message.type === "interrupt") {
      this.interrupts += 1;
      this.onInterrupt();
      return;
    }
    const { id, ...call } = message;
    this.calls.push(call as WorkerCall);
    const handler = this.handlers[call.type] ?? DEFAULT_HANDLERS[call.type];
    void Promise.resolve(handler(call as WorkerCall)).then((result) => {
      if (!this.terminated) {
        this.onmessage?.({ data: { id, type: "result", result } } as MessageEvent);
      }
    });
  }
  terminate(): void {
    this.terminated = true;
  }
  crash(): void {
    this.onerror?.({} as ErrorEvent);
  }
}

const DEFAULT_HANDLERS: Record<WorkerCall["type"], Handler> = {
  probe: (): WorkerResults["probe"] => ({ unavailable: null }),
  "cache-state": (): WorkerResults["cache-state"] => ({ install: "complete" }),
  install: (): WorkerResults["install"] => ({ ok: true }),
  load: (): WorkerResults["load"] => ({ ok: true }),
  generate: (call) => ({
    ok: true,
    segments: (call as Extract<WorkerCall, { type: "generate" }>).request.segments,
  }),
  unload: () => null,
  delete: (): WorkerResults["delete"] => ({ ok: true }),
};

function makeHost(
  handlers: Partial<Record<WorkerCall["type"], Handler>> = {},
  options: { configure?: boolean; idleMs?: number } = {},
) {
  const background = new FakePort(LOCAL_AI_HOST_PORT);
  const workers: FakeWorker[] = [];
  const host = new LocalAiHost({
    connectBackground: () => background,
    createWorker: () => {
      const worker = new FakeWorker(handlers);
      workers.push(worker);
      return worker;
    },
    validateRequest: (value) =>
      value && typeof value === "object" && "segments" in value
        ? (value as AiGenerationRequest)
        : null,
    idleMs: options.idleMs ?? 10_000,
    cancelSettleMs: 20,
    jobTimeoutMs: 5_000,
  });
  host.start();
  if (options.configure !== false) {
    background.emit({
      type: "configure",
      model: { modelId: STANDARD.modelId, tier: "standard" },
      enabled: true,
    });
  }
  const review = (tabId = 1) => {
    const port = new FakePort(LOCAL_AI_REVIEW_PORT, { tab: { id: tabId } });
    host.acceptReviewPort(port);
    return port;
  };
  const upStates = () =>
    background.messages.filter((message) => message.type === "state") as Array<{
      runtime: string;
      error?: string;
    }>;
  return { host, background, workers, review, upStates };
}

// ------------------------------------------------------------------ scheduler

describe("JobScheduler", () => {
  test("bounds pending jobs per port and in total", () => {
    const scheduler = new JobScheduler<string>();
    for (let i = 0; i < MAX_PENDING_PER_PORT; i += 1) {
      expect(scheduler.enqueue("a", `a${i}`, request(`a${i}`))).toBe("queued");
    }
    expect(scheduler.enqueue("a", "a-extra", request("a-extra"))).toBe("busy");
    let port = 0;
    while (scheduler.pendingCount < MAX_PENDING_TOTAL) {
      scheduler.enqueue(`p${port}`, "r", request(`p${port}-${scheduler.pendingCount}`));
      port += 1;
    }
    expect(scheduler.enqueue("fresh", "r", request("fresh"))).toBe("busy");
  });

  test("serves ports round-robin and joins identical in-flight payloads", () => {
    const scheduler = new JobScheduler<string>();
    scheduler.enqueue("a", "a1", request("a1"));
    scheduler.enqueue("a", "a2", request("a2"));
    scheduler.enqueue("b", "b1", request("b1"));
    expect(scheduler.enqueue("a", "a1-again", request("a1"))).toBe("joined");
    // Same payload on another port is a separate job.
    expect(scheduler.enqueue("b", "b-dup", request("a1"))).toBe("queued");
    const order: string[] = [];
    for (let job = scheduler.next(); job; job = scheduler.next()) {
      order.push(job.requestIds.join("+"));
      scheduler.finish(job);
    }
    expect(order).toEqual(["a1+a1-again", "b1", "a2", "b-dup"]);
  });
});

// ------------------------------------------------------------------ host

describe("LocalAiHost review ports", () => {
  test("accepts only content-script review ports and drops protocol violations", async () => {
    const { host, review } = makeHost();
    const noTab = new FakePort(LOCAL_AI_REVIEW_PORT, {});
    host.acceptReviewPort(noTab);
    expect(noTab.disconnected).toBe(true);
    const other = new FakePort("something-else", { tab: { id: 1 } });
    host.acceptReviewPort(other);
    expect(other.disconnected).toBe(false);
    expect(other.messages).toEqual([]);

    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: { nope: SENTINEL } });
    expect(port.results()).toEqual([
      expect.objectContaining({
        requestId: "r1",
        outcome: { ok: false, error: "invalid-request" },
      }),
    ]);
    port.emit({ type: "shutdown", requestId: "r2" });
    expect(port.disconnected).toBe(true);
    expect(JSON.stringify(port.messages)).not.toContain(SENTINEL);
  });

  test("results go only to the originating port, rebuilt without extra fields", async () => {
    const { review } = makeHost({
      generate: (call) => ({
        ok: true,
        debug: SENTINEL,
        segments: (call as Extract<WorkerCall, { type: "generate" }>).request.segments.map(
          (segment) => ({ ...segment, raw: SENTINEL }),
        ),
      }),
    });
    const a = review(1);
    const b = review(2);
    await flush();
    a.emit({ type: "generate", requestId: "same-id", request: request("from a") });
    await flush(5);
    expect(a.results()).toEqual([
      {
        type: "result",
        requestId: "same-id",
        modelId: STANDARD.modelId,
        promptVersion: expect.any(String),
        outcome: { ok: true, segments: [{ id: "s0", text: "from a" }] },
      },
    ]);
    expect(b.results()).toEqual([]);
    expect(JSON.stringify(a.messages)).not.toContain(SENTINEL);
  });

  test("a cancel only affects its own port; every generate gets exactly one result", async () => {
    let release!: () => void;
    const { review } = makeHost({
      generate: (call) =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              ok: true,
              segments: (call as Extract<WorkerCall, { type: "generate" }>).request.segments,
            });
        }),
    });
    const a = review(1);
    const b = review(2);
    await flush();
    a.emit({ type: "generate", requestId: "r1", request: request("a") });
    b.emit({ type: "generate", requestId: "r1", request: request("b") });
    await flush(5);
    b.emit({ type: "cancel", requestId: "r1" });
    expect(b.results()).toEqual([
      expect.objectContaining({ requestId: "r1", outcome: { ok: false, error: "cancelled" } }),
    ]);
    release();
    await flush(5);
    release();
    await flush(5);
    expect(a.results()).toEqual([
      expect.objectContaining({
        requestId: "r1",
        outcome: { ok: true, segments: [{ id: "s0", text: "a" }] },
      }),
    ]);
    expect(b.results()).toHaveLength(1);
  });

  test("jobs wait until configured and are refused without consent or install", async () => {
    const unconfigured = makeHost({}, { configure: false });
    const port = unconfigured.review();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    expect(port.results()).toEqual([]);
    unconfigured.background.emit({
      type: "configure",
      model: { modelId: STANDARD.modelId, tier: "standard" },
      enabled: true,
    });
    await flush(5);
    expect(port.results()).toHaveLength(1);

    const notConsented = makeHost({}, { configure: false });
    notConsented.background.emit({ type: "configure", model: null, enabled: true });
    const p2 = notConsented.review();
    p2.emit({ type: "generate", requestId: "r1", request: request("x") });
    expect(p2.results()[0]).toMatchObject({ outcome: { ok: false, error: "not-ready" } });

    const partial = makeHost({ "cache-state": () => ({ install: "partial" }) });
    const p3 = partial.review();
    await flush(5);
    p3.emit({ type: "generate", requestId: "r1", request: request("x") });
    expect(p3.results()[0]).toMatchObject({ outcome: { ok: false, error: "not-installed" } });
    expect(partial.workers[0].calls.some((call) => call.type === "load")).toBe(false);
  });

  test("a disconnect cancels that port's running job", async () => {
    const { review, workers } = makeHost({ generate: () => new Promise(() => undefined) });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    port.close();
    expect(workers[0].interrupts).toBe(1);
  });
});

describe("LocalAiHost lifecycle", () => {
  test("cancel waits for the generation to settle; a hung one tears the worker down", async () => {
    const { review, workers } = makeHost({ generate: () => new Promise(() => undefined) });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    port.emit({ type: "cancel", requestId: "r1" });
    expect(workers[0].interrupts).toBe(1);
    expect(workers[0].terminated).toBe(false);
    await flush(40);
    expect(workers[0].terminated).toBe(true);
    // The next job starts a fresh worker and loads again.
    port.emit({ type: "generate", requestId: "r2", request: request("y") });
    await flush(5);
    expect(workers).toHaveLength(2);
    expect(workers[1].calls.map((call) => call.type)).toContain("load");
  });

  test("a generation that settles after interrupt keeps the worker", async () => {
    const { review, workers } = makeHost({
      generate: () =>
        new Promise((resolve) => {
          workers[0].onInterrupt = () => resolve({ ok: false, error: "cancelled" });
        }),
    });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    port.emit({ type: "cancel", requestId: "r1" });
    await flush(40);
    expect(workers[0].terminated).toBe(false);
    expect(port.results()).toHaveLength(1);
  });

  test("a worker crash is retried once, then the host stays in error", async () => {
    const { review, workers, upStates } = makeHost({
      generate: () => new Promise(() => undefined),
    });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    workers[0].crash();
    await flush(5);
    expect(port.results()[0]).toMatchObject({ outcome: { ok: false, error: "engine-failed" } });
    port.emit({ type: "generate", requestId: "r2", request: request("y") });
    await flush(5);
    expect(workers).toHaveLength(2);
    workers[1].crash();
    await flush(5);
    port.emit({ type: "generate", requestId: "r3", request: request("z") });
    expect(port.results().at(-1)).toMatchObject({
      requestId: "r3",
      outcome: { ok: false, error: "engine-failed" },
    });
    expect(upStates().at(-1)).toMatchObject({ runtime: "error", error: "worker-crashed" });
  });

  test("disable during a load answers the job and unloads", async () => {
    let finishLoad!: () => void;
    const { review, background, workers } = makeHost({
      load: () => new Promise((resolve) => (finishLoad = () => resolve({ ok: true }))),
    });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    background.emit({ type: "configure", model: null, enabled: false });
    expect(port.results()).toEqual([
      expect.objectContaining({ outcome: { ok: false, error: "not-ready" } }),
    ]);
    finishLoad();
    await flush(5);
    expect(workers[0].calls.map((call) => call.type)).not.toContain("generate");
    expect(workers[0].calls.at(-1)?.type).toBe("unload");
    expect(port.results()).toHaveLength(1);
  });

  test("idle interval unloads the engine and reports idle once no review is open", async () => {
    const { review, background, workers } = makeHost({}, { idleMs: 20 });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    port.close();
    await flush(40);
    expect(workers[0].calls.at(-1)?.type).toBe("unload");
    expect(background.messages.at(-1)).toEqual({ type: "idle" });
  });

  test("install streams numeric progress; cancel tears down and reports download-cancelled", async () => {
    const { background, workers, upStates } = makeHost({
      "cache-state": () => ({ install: "none" }),
      install: () => new Promise(() => undefined),
    });
    await flush(5);
    background.emit({ type: "install", tier: "standard" });
    await flush(5);
    expect(upStates().at(-1)).toMatchObject({ runtime: "downloading" });
    background.emit({ type: "cancel-install" });
    await flush(5);
    expect(workers[0].terminated).toBe(true);
    expect(background.messages).toContainEqual({
      type: "installed",
      modelId: STANDARD.modelId,
      ok: false,
      error: "download-cancelled",
    });
    expect(upStates().at(-1)).toMatchObject({ runtime: "download-required" });
  });
});
