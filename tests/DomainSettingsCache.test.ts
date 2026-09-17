import "./setup";
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { SettingsManager } from "../src/core/application/settingsManager";
import { DomainSettingsCache } from "../src/adapters/chrome/background/config/DomainSettingsCache";

/**
 * Fake SettingsManager that counts every storage read. Returning `undefined`
 * for every key makes `resolveDomainRuntimeSettings` fall back to defaults,
 * which is enough to observe how often it hits storage.
 */
function makeFakeSettingsManager(readDelayMs = 0) {
  const read = jest.fn(async () => {
    if (readDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, readDelayMs));
    }
    return undefined;
  });
  const manager = {
    get: read,
    getRaw: read,
    set: jest.fn(async () => undefined),
    setRaw: jest.fn(async () => undefined),
    removeRaw: jest.fn(async () => undefined),
  } as unknown as SettingsManager;
  return { manager, read };
}

describe("DomainSettingsCache", () => {
  beforeEach(() => {
    jest.spyOn(console, "debug").mockImplementation(() => undefined);
    jest.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("cache hit / miss", () => {
    test("resolves settings on the first call", async () => {
      const { manager, read } = makeFakeSettingsManager();
      const cache = new DomainSettingsCache();

      const result = await cache.resolve(manager, "example.com");

      expect(result.language).toBe("en_US");
      expect(read.mock.calls.length).toBeGreaterThan(0);
    });

    test("returns cached value without re-reading storage within TTL", async () => {
      const { manager, read } = makeFakeSettingsManager();
      const cache = new DomainSettingsCache(500);

      const first = await cache.resolve(manager, "example.com");
      const readsAfterFirst = read.mock.calls.length;
      const second = await cache.resolve(manager, "example.com");
      await cache.resolve(manager, "example.com");

      expect(second).toBe(first);
      expect(read.mock.calls.length).toBe(readsAfterFirst);
    });

    test("re-resolves after TTL expires", async () => {
      const { manager, read } = makeFakeSettingsManager();
      const cache = new DomainSettingsCache(10);

      await cache.resolve(manager, "example.com");
      const readsPerResolve = read.mock.calls.length;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      await cache.resolve(manager, "example.com");

      expect(read.mock.calls.length).toBe(readsPerResolve * 2);
    });

    test("caches entries per domain independently", async () => {
      const { manager, read } = makeFakeSettingsManager();
      const cache = new DomainSettingsCache(500);

      await cache.resolve(manager, "alpha.com");
      const readsPerResolve = read.mock.calls.length;
      await cache.resolve(manager, "beta.com");
      await cache.resolve(manager, "alpha.com");
      await cache.resolve(manager, "beta.com");

      expect(read.mock.calls.length).toBe(readsPerResolve * 2);
    });

    test("treats undefined domain as a distinct cache key", async () => {
      const { manager, read } = makeFakeSettingsManager();
      const cache = new DomainSettingsCache(500);

      await cache.resolve(manager, undefined);
      const readsPerResolve = read.mock.calls.length;
      await cache.resolve(manager, undefined);
      await cache.resolve(manager, "something.com");

      expect(read.mock.calls.length).toBe(readsPerResolve * 2);
    });
  });

  describe("invalidate()", () => {
    test("forces a re-resolve on the next call", async () => {
      const { manager, read } = makeFakeSettingsManager();
      const cache = new DomainSettingsCache(500);

      await cache.resolve(manager, "example.com");
      const readsPerResolve = read.mock.calls.length;
      cache.invalidate();
      await cache.resolve(manager, "example.com");

      expect(read.mock.calls.length).toBe(readsPerResolve * 2);
    });

    test("invalidates all domains", async () => {
      const { manager, read } = makeFakeSettingsManager();
      const cache = new DomainSettingsCache(500);

      await cache.resolve(manager, "alpha.com");
      const readsPerResolve = read.mock.calls.length;
      await cache.resolve(manager, "beta.com");
      cache.invalidate();
      await cache.resolve(manager, "alpha.com");
      await cache.resolve(manager, "beta.com");

      expect(read.mock.calls.length).toBe(readsPerResolve * 4);
    });
  });

  describe("performance — cache eliminates redundant storage reads", () => {
    test("50 consecutive requests for the same domain make 1 storage resolve", async () => {
      const { manager, read } = makeFakeSettingsManager();
      const cache = new DomainSettingsCache(500);

      await cache.resolve(manager, "typing.example.com");
      const readsPerResolve = read.mock.calls.length;
      for (let i = 1; i < 50; i++) {
        await cache.resolve(manager, "typing.example.com");
      }

      expect(read.mock.calls.length).toBe(readsPerResolve);
    });

    /**
     * Concrete latency regression guard: if the cache is removed or broken,
     * the cached loop pays the simulated storage delay on every request.
     */
    test("cached requests are at least 5x faster than uncached for slow storage", async () => {
      const DELAY_MS = 2;
      const REQUESTS = 50;

      const uncachedStart = Date.now();
      for (let i = 0; i < REQUESTS; i++) {
        const { manager } = makeFakeSettingsManager(DELAY_MS);
        await new DomainSettingsCache(500).resolve(manager, "example.com");
      }
      const uncachedMs = Date.now() - uncachedStart;

      const { manager } = makeFakeSettingsManager(DELAY_MS);
      const cache = new DomainSettingsCache(500);
      const cachedStart = Date.now();
      for (let i = 0; i < REQUESTS; i++) {
        await cache.resolve(manager, "example.com");
      }
      const cachedMs = Date.now() - cachedStart;

      expect(cachedMs * 5).toBeLessThan(uncachedMs);
    });

    test("typing a 5-char word on 2 domains resolves storage twice", async () => {
      const { manager, read } = makeFakeSettingsManager();
      const cache = new DomainSettingsCache(500);
      const word = "hello";
      const domains = ["site-a.com", "site-b.com"];

      await cache.resolve(manager, domains[0]);
      const readsPerResolve = read.mock.calls.length;
      for (const domain of domains) {
        for (let i = 1; i <= word.length; i++) {
          await cache.resolve(manager, domain);
        }
      }

      expect(read.mock.calls.length).toBe(readsPerResolve * domains.length);
    });
  });
});
