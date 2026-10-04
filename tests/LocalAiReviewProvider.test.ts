import { describe, expect, test } from "bun:test";
import {
  LocalAiReviewProvider,
  type LocalAiRuntime,
} from "../src/adapters/chrome/content-script/review/LocalAiReviewProvider";
import {
  CMD_LOCAL_AI_DISMISS_SETUP_OFFER,
  CMD_LOCAL_AI_ENSURE_HOST,
  CMD_LOCAL_AI_GET_STATUS,
  CMD_LOCAL_AI_OPEN_SETUP,
} from "../src/core/domain/constants";
import { LOCAL_AI_REVIEW_PORT, type LocalAiStatus } from "../src/core/domain/contracts/localAi";
import type { AiGenerationRequest } from "../src/core/domain/grammar/review/ai/types";
import { FakePort, readyStatus } from "./support/localAiFakes";

const STATUS = readyStatus();

const REQUEST: AiGenerationRequest = {
  mode: "correct",
  lang: "en_US",
  style: null,
  contextBefore: "",
  contextAfter: "",
  segments: [{ id: "s0", text: "She go home." }],
};

function runtime({ ensure = { ok: true, status: STATUS } as unknown } = {}) {
  const sent: string[] = [];
  const ports: FakePort[] = [];
  const names: string[] = [];
  const fake: LocalAiRuntime = {
    sendMessage: (message) => {
      sent.push(message.command);
      if (message.command === CMD_LOCAL_AI_ENSURE_HOST) return Promise.resolve(ensure);
      return Promise.resolve({ ok: true, status: STATUS });
    },
    connect: ({ name }) => {
      names.push(name);
      const port = new FakePort();
      ports.push(port);
      return port;
    },
  };
  return { fake, sent, ports, names };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LocalAiReviewProvider", () => {
  test("status comes from the background; a refusal rejects", async () => {
    const r = runtime();
    expect(await new LocalAiReviewProvider(r.fake).status()).toEqual(STATUS);
    const refusing: LocalAiRuntime = {
      ...r.fake,
      sendMessage: () => Promise.resolve({ ok: false, error: "unavailable" }),
    };
    await expect(new LocalAiReviewProvider(refusing).status()).rejects.toThrow();
  });

  test("nothing connects until the first generation; then one port, after the host is ensured", async () => {
    const r = runtime();
    const provider = new LocalAiReviewProvider(r.fake);
    const statuses: LocalAiStatus[] = [];
    provider.onStatus((status) => statuses.push(status));
    expect(r.ports).toHaveLength(0);

    const first = provider.generate(REQUEST, new AbortController().signal);
    await tick();
    expect(r.sent).toEqual([CMD_LOCAL_AI_ENSURE_HOST]);
    expect(r.names).toEqual([LOCAL_AI_REVIEW_PORT]);
    const port = r.ports[0];
    expect(port.messages[0]).toMatchObject({ type: "generate", request: REQUEST });
    const requestId = port.lastRequestId();

    // Malformed and unknown messages are dropped.
    port.emit({ type: "result", requestId, outcome: { ok: true, segments: [{ id: 1 }] } });
    port.emit({ type: "result", requestId, modelId: "m", promptVersion: "p", outcome: "x" });
    port.emit({ type: "surprise", requestId });
    port.emit(null);
    port.emit({ type: "status", status: { enabled: "yes" } });
    port.emit({ type: "status", status: { ...STATUS, runtime: "generating" } });
    expect(statuses.map((status) => status.runtime)).toEqual(["ready", "generating"]);

    const outcome = { ok: true as const, segments: [{ id: "s0", text: "She goes home." }] };
    port.emit({ type: "result", requestId, modelId: "model-a", promptVersion: "v1", outcome });
    expect(await first).toEqual({ outcome, modelId: "model-a", promptVersion: "v1" });

    // A second generation reuses the port and the host.
    const second = provider.generate(REQUEST, new AbortController().signal);
    await tick();
    expect(r.ports).toHaveLength(1);
    expect(r.sent).toEqual([CMD_LOCAL_AI_ENSURE_HOST]);
    expect(port.lastRequestId()).not.toBe(requestId);
    port.emit({
      type: "result",
      requestId: port.lastRequestId(),
      modelId: "model-a",
      promptVersion: "v1",
      outcome: { ok: false, error: "busy" },
    });
    expect((await second).outcome).toEqual({ ok: false, error: "busy" });
  });

  test("abort posts a cancel and resolves cancelled once the host settles it", async () => {
    const r = runtime();
    const provider = new LocalAiReviewProvider(r.fake);
    const abort = new AbortController();
    const pending = provider.generate(REQUEST, abort.signal);
    await tick();
    const port = r.ports[0];
    const requestId = port.lastRequestId();
    let settled = false;
    void pending.then(() => (settled = true));
    abort.abort();
    expect(port.messages.at(-1)).toEqual({ type: "cancel", requestId });
    await tick();
    expect(settled).toBe(false);
    port.emit({
      type: "result",
      requestId,
      modelId: "model-a",
      promptVersion: "v1",
      outcome: { ok: true, segments: [{ id: "s0", text: "late" }] },
    });
    expect((await pending).outcome).toEqual({ ok: false, error: "cancelled" });
  });

  test("an aborted job the host never answers is given up after a bound", async () => {
    const r = runtime();
    const provider = new LocalAiReviewProvider(r.fake, 5);
    const abort = new AbortController();
    const pending = provider.generate(REQUEST, abort.signal);
    await tick();
    abort.abort();
    expect((await pending).outcome).toEqual({ ok: false, error: "cancelled" });
  });

  test("a lost host is reconnected once per generation, then reported unavailable", async () => {
    const r = runtime();
    const provider = new LocalAiReviewProvider(r.fake);
    const pending = provider.generate(REQUEST, new AbortController().signal);
    await tick();
    r.ports[0].close();
    await tick();
    expect(r.ports).toHaveLength(2);
    expect(r.sent).toEqual([CMD_LOCAL_AI_ENSURE_HOST, CMD_LOCAL_AI_ENSURE_HOST]);
    expect(r.ports[1].messages[0]).toMatchObject({ type: "generate", request: REQUEST });
    r.ports[1].close();
    expect((await pending).outcome).toEqual({ ok: false, error: "unavailable" });
  });

  test("no host (no consent, unsupported) means unavailable without a port", async () => {
    const r = runtime({ ensure: { ok: false, error: "forbidden" } });
    const provider = new LocalAiReviewProvider(r.fake);
    const result = await provider.generate(REQUEST, new AbortController().signal);
    expect(result.outcome).toEqual({ ok: false, error: "unavailable" });
    expect(r.ports).toHaveLength(0);
  });

  test("dispose disconnects and cancels what is pending; setup commands go to the background", async () => {
    const r = runtime();
    const provider = new LocalAiReviewProvider(r.fake);
    const pending = provider.generate(REQUEST, new AbortController().signal);
    await tick();
    provider.openSetup();
    provider.dismissSetupOffer();
    provider.dispose();
    expect(r.ports[0].disconnected).toBe(true);
    expect((await pending).outcome).toEqual({ ok: false, error: "cancelled" });
    expect(r.sent).toContain(CMD_LOCAL_AI_OPEN_SETUP);
    expect(r.sent).toContain(CMD_LOCAL_AI_DISMISS_SETUP_OFFER);
    const after = await provider.generate(REQUEST, new AbortController().signal);
    expect(after.outcome).toEqual({ ok: false, error: "cancelled" });
    expect(r.ports).toHaveLength(1);
  });

  test("without a port, returning to the tab re-reads the status (setup finished elsewhere)", async () => {
    const r = runtime();
    const provider = new LocalAiReviewProvider(r.fake);
    const statuses: LocalAiStatus[] = [];
    provider.onStatus((status) => statuses.push(status));
    document.dispatchEvent(new Event("visibilitychange"));
    await tick();
    expect(r.sent).toEqual([CMD_LOCAL_AI_GET_STATUS]);
    expect(statuses).toEqual([STATUS]);
    provider.dispose();
    document.dispatchEvent(new Event("visibilitychange"));
    await tick();
    expect(r.sent).toEqual([CMD_LOCAL_AI_GET_STATUS]);
  });

  test("a review that finds the engine failed connects once, for the host's fresh start", async () => {
    const failed: LocalAiStatus = { ...STATUS, runtime: "error", error: "load-failed" };
    const ports: FakePort[] = [];
    const sent: string[] = [];
    const fake: LocalAiRuntime = {
      sendMessage: (message) => {
        sent.push(message.command);
        return Promise.resolve({ ok: true, status: failed });
      },
      connect: () => {
        const port = new FakePort();
        ports.push(port);
        return port;
      },
    };
    const provider = new LocalAiReviewProvider(fake, 5, 5);
    const statuses: string[] = [];
    provider.onStatus((status) => statuses.push(status.runtime));
    await provider.status();
    await tick();
    expect(sent).toContain(CMD_LOCAL_AI_ENSURE_HOST);
    expect(ports).toHaveLength(1);
    ports[0].emit({ type: "status", status: STATUS });
    expect(statuses.at(-1)).toBe(STATUS.runtime);
    await provider.status();
    await tick();
    expect(ports).toHaveLength(1);
    provider.dispose();
  });

  test("without a port, a status still changing (install) is re-read until it settles", async () => {
    const answers: LocalAiStatus[] = [
      { ...STATUS, runtime: "downloading" },
      { ...STATUS, runtime: "loading" },
      STATUS,
    ];
    let reads = 0;
    const fake: LocalAiRuntime = {
      sendMessage: () => Promise.resolve({ ok: true, status: answers[Math.min(reads++, 2)] }),
      connect: () => new FakePort(),
    };
    const provider = new LocalAiReviewProvider(fake, 5, 5);
    const statuses: string[] = [];
    provider.onStatus((status) => statuses.push(status.runtime));
    await provider.status();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(statuses).toEqual(["loading", STATUS.runtime]);
    // Settled: no more reads.
    expect(reads).toBe(3);
    provider.dispose();
  });
});
