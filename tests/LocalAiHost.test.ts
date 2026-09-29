import { describe, expect, test } from "bun:test";
import {
  LocalAiHost,
  type EngineLike,
  type HostState,
  type PortLike,
} from "../src/adapters/chrome/background/localAi/LocalAiHost";
import {
  JobScheduler,
  MAX_PENDING_PER_PORT,
  MAX_PENDING_TOTAL,
} from "../src/adapters/chrome/background/localAi/JobScheduler";
import { LOCAL_AI_REVIEW_PORT } from "../src/core/domain/contracts/localAi";
import { LOCAL_AI_MODELS } from "../src/core/domain/localAi/modelRegistry";
import type { AiGenerationRequest } from "../src/core/domain/grammar/review/ai/types";

const STANDARD = LOCAL_AI_MODELS[0];
const SENTINEL = "SENTINEL-host-9c21";

const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const never = () => new Promise<never>(() => undefined);

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
  readonly name = LOCAL_AI_REVIEW_PORT;

  constructor(readonly sender: chrome.runtime.MessageSender) {}

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

/** A fake engine; `calls` records the method names in order. */
function fakeEngine(overrides: Partial<EngineLike>) {
  const calls: string[] = [];
  const defaults: EngineLike = {
    probe: async () => null,
    cacheState: async () => "complete",
    install: async () => ({ ok: true }),
    load: async () => ({ ok: true }),
    generate: async (_modelId, job) => ({ ok: true, segments: job.segments }),
    interrupt: () => undefined,
    unload: async () => undefined,
    delete: async () => undefined,
    deleteAllExcept: async () => undefined,
    deleteDropped: async () => undefined,
  };
  const engine = Object.fromEntries(
    Object.entries(defaults).map(([name, fallback]) => [
      name,
      (...args: unknown[]) => {
        calls.push(name);
        const impl = (overrides[name as keyof EngineLike] ?? fallback) as (
          ...rest: unknown[]
        ) => unknown;
        return impl(...args);
      },
    ]),
  ) as unknown as EngineLike;
  return { engine, calls };
}

function makeHost(
  overrides: Partial<EngineLike> = {},
  options: { configure?: boolean; idleMs?: number; loadTimeoutMs?: number } = {},
) {
  const { engine, calls } = fakeEngine(overrides);
  const states: HostState[] = [];
  let pings = 0;
  const host: LocalAiHost = new LocalAiHost({
    engine,
    onChange: () => states.push(host.state()),
    keepAlive: () => (pings += 1),
    keepAliveMs: 5,
    idleMs: options.idleMs ?? 10_000,
    cancelSettleMs: 20,
    jobTimeoutMs: 5_000,
    loadTimeoutMs: options.loadTimeoutMs ?? 5_000,
  });
  if (options.configure !== false) {
    host.configure({ modelId: STANDARD.modelId }, true);
  }
  const review = (tabId = 1) => {
    const port = new FakePort({ id: "ftext", tab: { id: tabId } as chrome.tabs.Tab });
    host.acceptReviewPort(port);
    return port;
  };
  const count = (name: string) => calls.filter((call) => call === name).length;
  return { host, calls, count, states, review, pings: () => pings };
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
    while (scheduler.pending < MAX_PENDING_TOTAL) {
      scheduler.enqueue(`p${port}`, "r", request(`p${port}-${scheduler.pending}`));
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
  test("drops protocol violations; invalid requests get a bounded error", async () => {
    const { review } = makeHost();
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
      generate: async (_modelId, job) =>
        ({
          ok: true,
          debug: SENTINEL,
          segments: job.segments.map((segment) => ({ ...segment, raw: SENTINEL })),
        }) as never,
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
      generate: (_modelId, job) =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, segments: job.segments });
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
    unconfigured.host.configure({ modelId: STANDARD.modelId }, true);
    await flush(5);
    expect(port.results()).toHaveLength(1);

    const notConsented = makeHost({}, { configure: false });
    notConsented.host.configure(null, true);
    const p2 = notConsented.review();
    p2.emit({ type: "generate", requestId: "r1", request: request("x") });
    expect(p2.results()[0]).toMatchObject({ outcome: { ok: false, error: "not-ready" } });

    const partial = makeHost({ cacheState: async () => "partial" });
    const p3 = partial.review();
    await flush(5);
    p3.emit({ type: "generate", requestId: "r1", request: request("x") });
    expect(p3.results()[0]).toMatchObject({ outcome: { ok: false, error: "not-installed" } });
    expect(partial.count("load")).toBe(0);
  });

  test("a failed support/cache probe answers waiting jobs instead of leaving them queued", async () => {
    const { review } = makeHost({
      cacheState: async () => {
        throw new Error("boom");
      },
    });
    const port = review();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    expect(port.results()).toEqual([
      expect.objectContaining({ requestId: "r1", outcome: { ok: false, error: "engine-failed" } }),
    ]);
  });

  test("a disconnect cancels that port's running job", async () => {
    const { review, count } = makeHost({ generate: never });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    port.close();
    expect(count("interrupt")).toBe(1);
  });
});

describe("LocalAiHost lifecycle", () => {
  test("a generation that does not settle after cancel is abandoned; the next job reloads", async () => {
    const { review, calls, count } = makeHost({ generate: never });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    port.emit({ type: "cancel", requestId: "r1" });
    expect(count("interrupt")).toBe(1);
    expect(count("unload")).toBe(0);
    await flush(40);
    expect(count("unload")).toBe(1);
    port.emit({ type: "generate", requestId: "r2", request: request("y") });
    await flush(5);
    expect(calls.slice(-2)).toEqual(["load", "generate"]);
  });

  test("a generation that settles after interrupt keeps the model", async () => {
    let stop!: () => void;
    const { review, count } = makeHost({
      generate: () =>
        new Promise((resolve) => (stop = () => resolve({ ok: false, error: "cancelled" }))),
      interrupt: () => stop(),
    });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    port.emit({ type: "cancel", requestId: "r1" });
    await flush(40);
    expect(count("unload")).toBe(0);
    expect(port.results()).toHaveLength(1);
  });

  test("an evicted cache is detected before a cold load", async () => {
    let cached: "complete" | "partial" = "complete";
    const { review, host, count } = makeHost({ cacheState: async () => cached });
    const port = review();
    await flush();
    cached = "partial";
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    expect(count("load")).toBe(0);
    expect(count("generate")).toBe(0);
    expect(host.state().install).toBe("partial");
    expect(host.state().error).toBeUndefined();
    expect(port.results()).toHaveLength(1);
    expect(port.results()[0].outcome).toEqual({ ok: false, error: "not-installed" });
  });

  test("closing during the cache recheck never starts a late model allocation", async () => {
    let release: (() => void) | undefined;
    let hold = false;
    const { review, count } = makeHost({
      cacheState: async () => {
        if (hold)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return "complete";
      },
    });
    const port = review();
    await flush();
    hold = true;
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush();
    port.close();
    release!();
    await flush(5);
    expect(count("load")).toBe(0);
    expect(count("generate")).toBe(0);
  });

  test("a model load that never finishes is abandoned and the job answered", async () => {
    const { review, count } = makeHost({ load: never }, { loadTimeoutMs: 30 });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(60);
    expect(count("unload")).toBe(1);
    expect(port.results()).toEqual([
      expect.objectContaining({ outcome: { ok: false, error: "engine-failed" } }),
    ]);
  });

  test("an engine failure disposes and reloads once, then the host stays in error", async () => {
    const { review, host, count } = makeHost({
      generate: async () => ({ ok: false, error: "engine-failed" }),
    });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    expect(count("unload")).toBe(1);
    port.emit({ type: "generate", requestId: "r2", request: request("y") });
    await flush(5);
    expect(count("load")).toBe(2);
    port.emit({ type: "generate", requestId: "r3", request: request("z") });
    expect(port.results().at(-1)).toMatchObject({
      requestId: "r3",
      outcome: { ok: false, error: "engine-failed" },
    });
    expect(host.state()).toMatchObject({ runtime: "error", error: "load-failed" });
  });

  test("a delete the cache refuses is reported, and the files stay installed", async () => {
    const { host } = makeHost({
      delete: async () => {
        throw new DOMException("refused", "UnknownError");
      },
    });
    await flush(5);
    await host.deleteModel(STANDARD.modelId);
    expect(host.state()).toMatchObject({ install: "complete", error: "delete-failed" });
  });

  test("a delete that succeeds on retry clears the earlier delete error", async () => {
    let refuse = true;
    let cached: "complete" | "none" = "complete";
    const { host } = makeHost({
      cacheState: async () => cached,
      delete: async () => {
        if (refuse) throw new DOMException("refused", "UnknownError");
        cached = "none";
      },
    });
    await flush(5);
    await host.deleteModel(STANDARD.modelId);
    refuse = false;
    await host.deleteModel(STANDARD.modelId);
    expect(host.state()).toMatchObject({ install: "none" });
    expect(host.state().error).toBeUndefined();
  });

  test("a probe requested while one is still queued runs once", async () => {
    const { host, count } = makeHost({}, { configure: false });
    host.configure({ modelId: STANDARD.modelId }, true);
    void host.refresh();
    await flush(10);
    expect(count("probe")).toBe(1);
  });

  test("with the preference off, the consented model's cache is still checked", async () => {
    const { host, count } = makeHost({}, { configure: false });
    host.configure({ modelId: STANDARD.modelId }, false);
    await host.refresh();
    expect(count("cacheState")).toBe(1);
    expect(host.state()).toMatchObject({ modelId: STANDARD.modelId, install: "complete" });
  });

  test("a good probe clears the error a failed one left", async () => {
    let fail = true;
    const { host } = makeHost(
      {
        probe: async () => {
          if (fail) throw new Error("gone");
          return null;
        },
      },
      { configure: false },
    );
    host.configure({ modelId: STANDARD.modelId }, true);
    await flush(5);
    expect(host.state().error).toBe("load-failed");
    fail = false;
    await host.refresh();
    expect(host.state().error).toBeUndefined();
  });

  test("a good probe keeps a newer error than the failed probe's", async () => {
    let fail = true;
    const { host } = makeHost(
      {
        probe: async () => {
          if (fail) throw new Error("gone");
          return null;
        },
        delete: async () => {
          throw new DOMException("refused", "UnknownError");
        },
      },
      { configure: false },
    );
    host.configure({ modelId: STANDARD.modelId }, true);
    await flush(5);
    await host.deleteModel(STANDARD.modelId);
    expect(host.state().error).toBe("delete-failed");
    fail = false;
    await host.refresh();
    expect(host.state().error).toBe("delete-failed");
  });

  test("cancelling the only job during a cold load abandons the load, not as a failure", async () => {
    const { review, host, count } = makeHost({ load: never }, { loadTimeoutMs: 60_000 });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    expect(count("load")).toBe(1);
    port.emit({ type: "cancel", requestId: "r1" });
    await flush(5);
    expect(count("unload")).toBeGreaterThan(0);
    expect(port.results()).toEqual([
      expect.objectContaining({ outcome: { ok: false, error: "cancelled" } }),
    ]);
    expect(host.state().error).toBeUndefined();
  });

  test("a load kept for a queued job is abandoned once that job is cancelled too", async () => {
    const { review, count } = makeHost({ load: never }, { loadTimeoutMs: 60_000 });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    port.emit({ type: "generate", requestId: "r2", request: request("y") });
    port.emit({ type: "cancel", requestId: "r1" });
    await flush(5);
    // r2 still needs the model: the load goes on.
    expect(count("unload")).toBe(0);
    port.emit({ type: "cancel", requestId: "r2" });
    await flush(5);
    expect(count("unload")).toBeGreaterThan(0);
  });

  test("disabling Local AI ends a load an earlier cancel kept for queued work", async () => {
    const { review, host, count } = makeHost({ load: never }, { loadTimeoutMs: 60_000 });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    port.emit({ type: "generate", requestId: "r2", request: request("y") });
    port.emit({ type: "cancel", requestId: "r1" });
    await flush(5);
    expect(count("unload")).toBe(0);
    host.configure({ modelId: STANDARD.modelId }, false);
    await flush(5);
    expect(count("unload")).toBeGreaterThan(0);
  });

  test("a load that succeeds after a failed one clears the load error", async () => {
    let fail = true;
    const { review, host } = makeHost({
      load: async () => (fail ? { ok: false, error: "load-failed" } : { ok: true }),
    });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    expect(host.state().error).toBe("load-failed");
    fail = false;
    port.emit({ type: "generate", requestId: "r2", request: request("y") });
    await flush(5);
    expect(host.state().error).toBeUndefined();
  });

  test("model loads that keep failing end in error instead of retrying", async () => {
    const { review, host, count } = makeHost({
      load: async () => ({ ok: false, error: "load-failed" }),
    });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    port.emit({ type: "generate", requestId: "r2", request: request("y") });
    await flush(5);
    expect(count("load")).toBe(2);
    expect(host.state()).toMatchObject({ runtime: "error", error: "load-failed" });
    port.emit({ type: "generate", requestId: "r3", request: request("z") });
    await flush(5);
    expect(count("load")).toBe(2);
  });

  test("disable during a load answers the job and unloads", async () => {
    let finishLoad!: () => void;
    const { review, host, calls } = makeHost({
      load: () => new Promise((resolve) => (finishLoad = () => resolve({ ok: true }))),
    });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    host.configure(null, false);
    expect(port.results()).toEqual([
      expect.objectContaining({ outcome: { ok: false, error: "not-ready" } }),
    ]);
    finishLoad();
    await flush(5);
    expect(calls).not.toContain("generate");
    expect(calls.at(-1)).toBe("unload");
    expect(port.results()).toHaveLength(1);
  });

  test("closing the last review mid-job settles the job first, then unloads at once", async () => {
    let stop!: () => void;
    const { review, calls } = makeHost({
      generate: () =>
        new Promise((resolve) => (stop = () => resolve({ ok: false, error: "cancelled" }))),
      interrupt: () => stop(),
    });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    port.close();
    await flush(5);
    expect(calls.slice(-3)).toEqual(["generate", "interrupt", "unload"]);
  });

  test("another open review keeps the model; the last one closing unloads it", async () => {
    const { review, calls, count } = makeHost();
    const a = review(1);
    const b = review(2);
    await flush();
    a.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    a.close();
    await flush(5);
    expect(count("unload")).toBe(0);
    b.close();
    await flush(5);
    expect(calls.at(-1)).toBe("unload");
  });

  test("an open but idle review unloads after the idle interval; the next job reloads", async () => {
    const { review, calls } = makeHost({}, { idleMs: 20 });
    const port = review();
    await flush();
    port.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(40);
    expect(calls.at(-1)).toBe("unload");
    port.emit({ type: "generate", requestId: "r2", request: request("y") });
    await flush(5);
    expect(calls.slice(-2)).toEqual(["load", "generate"]);
    expect(port.results()).toHaveLength(2);
  });

  test("a review and job arriving during an unload load the model again", async () => {
    let finishUnload!: () => void;
    const { review, calls } = makeHost({
      unload: () => new Promise((resolve) => (finishUnload = () => resolve())),
    });
    const first = review(1);
    await flush();
    first.emit({ type: "generate", requestId: "r1", request: request("x") });
    await flush(5);
    first.close();
    await flush(5);
    const second = review(2);
    second.emit({ type: "generate", requestId: "r2", request: request("y") });
    finishUnload();
    await flush(5);
    expect(calls.slice(-4)).toEqual(["unload", "cacheState", "load", "generate"]);
    expect(second.results()).toEqual([
      expect.objectContaining({ requestId: "r2", outcome: expect.objectContaining({ ok: true }) }),
    ]);
  });

  test("keepalive runs only while Local AI is in use", async () => {
    const { review, pings } = makeHost();
    await flush(20);
    expect(pings()).toBe(0);
    const port = review();
    await flush(20);
    expect(pings()).toBeGreaterThan(0);
    port.close();
    await flush(5);
    const stopped = pings();
    await flush(20);
    expect(pings()).toBe(stopped);
  });
});

describe("LocalAiHost install", () => {
  test("a finished install with no review open unloads the model", async () => {
    const { host, calls } = makeHost({ cacheState: async () => "none" });
    await flush(5);
    await host.installModel("standard", Promise.resolve());
    await flush(5);
    expect(calls).toContain("install");
    expect(calls.at(-1)).toBe("unload");
  });

  test("a successful install removes the other tiers' files; a failed one removes nothing", async () => {
    const kept: string[] = [];
    const ok = makeHost({
      cacheState: async () => "none",
      deleteAllExcept: async (modelId) => void kept.push(modelId),
    });
    await flush(5);
    await ok.host.installModel("standard", Promise.resolve());
    expect(kept).toEqual([STANDARD.modelId]);

    const failed = makeHost({
      cacheState: async () => "none",
      install: async () => ({ ok: false, error: "download-failed" }),
    });
    await flush(5);
    await failed.host.installModel("standard", Promise.resolve());
    expect(failed.count("deleteAllExcept")).toBe(0);
  });

  test("a refresh removes dropped revisions even without consent or a new install", async () => {
    const { host, count } = makeHost({}, { configure: false });
    host.configure(null, true);
    await host.refresh();
    expect(count("deleteDropped")).toBe(1);
  });

  test("a replaced tier whose cleanup failed is removed on a later refresh", async () => {
    let refuse = true;
    const kept: string[] = [];
    const { host } = makeHost({
      deleteAllExcept: async (modelId) => {
        if (refuse) throw new DOMException("refused", "UnknownError");
        kept.push(modelId);
      },
    });
    await flush(5);
    expect(kept).toEqual([]);
    refuse = false;
    await host.refresh();
    expect(kept).toEqual([STANDARD.modelId]);
  });

  test("nothing downloads before consent is recorded; the status never flashes download-required", async () => {
    let recordConsent!: () => void;
    const { host, states, count } = makeHost(
      { cacheState: async () => "none", install: never },
      { configure: false },
    );
    const consent = new Promise<void>((resolve) => (recordConsent = resolve));
    void host.installModel("standard", consent);
    host.configure({ modelId: STANDARD.modelId }, true);
    await flush(10);
    expect(count("install")).toBe(0);
    recordConsent();
    await flush(10);
    expect(count("install")).toBe(1);
    const runtimes = states.map((state) => state.runtime);
    expect(runtimes.at(-1)).toBe("downloading");
    expect(runtimes).not.toContain("download-required");
  });

  test("an install arriving while another runs is ignored", async () => {
    const { host } = makeHost({ cacheState: async () => "none", install: never });
    await flush(5);
    void host.installModel("standard", Promise.resolve());
    await flush(5);
    void host.installModel("compact", Promise.resolve());
    await flush(5);
    expect(host.state()).toMatchObject({ runtime: "downloading", modelId: STANDARD.modelId });
  });

  test("cancel aborts the download and reports download-cancelled", async () => {
    let signal!: AbortSignal;
    const { host, calls } = makeHost({
      cacheState: async () => "none",
      install: (_modelId, _onProgress, abort) => {
        signal = abort;
        return new Promise((resolve) =>
          abort.addEventListener("abort", () =>
            resolve({ ok: false, error: "download-cancelled" }),
          ),
        );
      },
    });
    await flush(5);
    const installing = host.installModel("standard", Promise.resolve());
    await flush(5);
    expect(host.state().runtime).toBe("downloading");
    host.cancelInstall();
    await installing;
    await flush(5);
    expect(signal.aborted).toBe(true);
    expect(host.state()).toMatchObject({
      runtime: "download-required",
      error: "download-cancelled",
    });
    expect(calls.at(-1)).toBe("unload");
  });
});
