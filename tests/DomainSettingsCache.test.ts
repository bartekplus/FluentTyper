import { afterEach, describe, expect, jest, setSystemTime, test } from "bun:test";
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
  afterEach(() => {
    setSystemTime();
  });

  test("bounds distinct domain entries", async () => {
    const { manager } = makeFakeSettingsManager();
    const cache = new DomainSettingsCache();
    for (let i = 0; i < 300; i++) await cache.resolve(manager, `fixture-${i}.test`);
    expect((cache as unknown as { cache: Map<string, unknown> }).cache.size).toBeLessThanOrEqual(
      128,
    );
  });

  test("shares concurrent reads and does not restore invalidated results", async () => {
    const { manager, read } = makeFakeSettingsManager(5);
    const cache = new DomainSettingsCache();
    const pending = cache.resolve(manager, "fixture.test");
    const reads = read.mock.calls.length;
    const joined = cache.resolve(manager, "fixture.test");
    expect(read.mock.calls.length).toBe(reads);
    cache.invalidate();
    await Promise.all([pending, joined]);
    expect((cache as unknown as { cache: Map<string, unknown> }).cache.size).toBe(0);
    await cache.resolve(manager, "fixture.test");
    expect(read.mock.calls.length).toBeGreaterThan(reads);
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

      setSystemTime(1_000);
      await cache.resolve(manager, "example.com");
      const readsPerResolve = read.mock.calls.length;
      setSystemTime(1_020);
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
});
