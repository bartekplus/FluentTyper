import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { assertNoGrowth, distribution } from "../scripts/performance/metrics";

const probe = readFileSync(new URL("../scripts/performance/probe.js", import.meta.url), "utf8");
function fixture() {
  const dom = new JSDOM("<button>Fixture</button>", { runScripts: "outside-only" });
  dom.window.eval(probe);
  const snapshot = () =>
    (dom.window as unknown as { __ftPerformance(): Record<string, number> }).__ftPerformance();
  return { dom, snapshot };
}

describe("performance harness", () => {
  test("detects one intentionally undisposed synthetic listener", () => {
    const { dom, snapshot } = fixture();
    try {
      const before = snapshot();
      const listener = () => undefined;
      dom.window.document.body.addEventListener("input", listener);
      expect(() => assertNoGrowth(before, snapshot(), ["listeners"])).toThrow("Resource growth");
      dom.window.document.body.removeEventListener("input", listener);
      expect(() => assertNoGrowth(before, snapshot(), ["listeners"])).not.toThrow();
    } finally {
      dom.window.close();
    }
  });

  test("counts duplicate, once, abort, capture and observer lifecycles", () => {
    const { dom, snapshot } = fixture();
    try {
      const target = dom.window.document.body;
      const before = snapshot();
      const listener = () => undefined;
      target.addEventListener("input", listener, { once: true });
      target.addEventListener("input", listener);
      expect(snapshot().listeners - before.listeners).toBe(1);
      target.dispatchEvent(new dom.window.Event("input"));
      expect(snapshot().listeners).toBe(before.listeners);
      const abort = new dom.window.AbortController();
      target.addEventListener("input", listener, { signal: abort.signal, capture: true });
      abort.abort();
      expect(snapshot().listeners).toBe(before.listeners);
      const observer = new dom.window.MutationObserver(() => undefined);
      observer.observe(target, { childList: true });
      observer.observe(target, { childList: true });
      expect(snapshot().observers).toBe(1);
      observer.disconnect();
      observer.disconnect();
      expect(snapshot().observers).toBe(0);
    } finally {
      dom.window.close();
    }
  });

  test("reports empty samples and nearest-rank distributions", () => {
    expect(distribution([])).toEqual({
      n: 0,
      min: null,
      p50: null,
      p95: null,
      p99: null,
      max: null,
    });
    expect(distribution([4, 1, 3, 2])).toEqual({ n: 4, min: 1, p50: 2, p95: 4, p99: 4, max: 4 });
    expect(() => assertNoGrowth({}, {}, ["missing"])).toThrow();
  });
});
