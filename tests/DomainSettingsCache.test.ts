import "./setup";
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { DomainSettingsCache } from "../src/adapters/chrome/background/config/DomainSettingsCache";
import type { DomainRuntimeSettings } from "../src/adapters/chrome/background/config/runtimeSettings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeSettings(): DomainRuntimeSettings {
  return {
    language: "en_US",
    enabledLanguages: ["en_US"],
    inlineSuggestion: false,
    numSuggestions: 5,
    hasNumSuggestionsOverride: false,
  };
}

/**
 * Subclass that overrides the protected resolver so tests never touch
 * chrome.storage.  The `resolveDelayMs` field simulates storage latency.
 */
class InstrumentedCache extends DomainSettingsCache {
  public resolveCount = 0;
  public resolveDelayMs = 0;
  public resolveResult: DomainRuntimeSettings = makeFakeSettings();

  protected override async resolveFromStorage(): Promise<DomainRuntimeSettings> {
    this.resolveCount++;
    if (this.resolveDelayMs > 0) {
      await new Promise<void>((r) => setTimeout(r, this.resolveDelayMs));
    }
    return { ...this.resolveResult };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DomainSettingsCache", () => {
  beforeEach(() => {
    jest.spyOn(console, "debug").mockImplementation(() => undefined);
    jest.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("cache hit / miss", () => {
    test("returns a value on the first call (cache miss)", async () => {
      // The real resolveDomainRuntimeSettings is not available in unit-test
      // env (no chrome.storage), so all tests use InstrumentedCache which
      // overrides the protected resolver.
      const ic = new InstrumentedCache();
      const result = await ic.resolve({} as never, "example.com");
      expect(result.language).toBe("en_US");
      expect(ic.misses).toBe(1);
      expect(ic.hits).toBe(0);
    });

    test("returns cached value on second call within TTL", async () => {
      const ic = new InstrumentedCache(500);
      await ic.resolve({} as never, "example.com");
      await ic.resolve({} as never, "example.com");
      await ic.resolve({} as never, "example.com");

      expect(ic.resolveCount).toBe(1);
      expect(ic.hits).toBe(2);
      expect(ic.misses).toBe(1);
    });

    test("re-resolves after TTL expires", async () => {
      const ic = new InstrumentedCache(10 /* 10 ms TTL */);
      await ic.resolve({} as never, "example.com");
      await new Promise<void>((r) => setTimeout(r, 20));
      await ic.resolve({} as never, "example.com");

      expect(ic.resolveCount).toBe(2);
      expect(ic.misses).toBe(2);
    });

    test("caches entries per domain independently", async () => {
      const ic = new InstrumentedCache(500);
      await ic.resolve({} as never, "alpha.com");
      await ic.resolve({} as never, "beta.com");
      await ic.resolve({} as never, "alpha.com"); // hit
      await ic.resolve({} as never, "beta.com"); // hit

      expect(ic.resolveCount).toBe(2);
      expect(ic.hits).toBe(2);
    });

    test("treats undefined domain as a distinct cache key", async () => {
      const ic = new InstrumentedCache(500);
      await ic.resolve({} as never, undefined);
      await ic.resolve({} as never, undefined); // hit
      await ic.resolve({} as never, "something.com"); // miss

      expect(ic.resolveCount).toBe(2);
      expect(ic.hits).toBe(1);
    });
  });

  describe("invalidate()", () => {
    test("forces a re-resolve on the next call", async () => {
      const ic = new InstrumentedCache(500);
      await ic.resolve({} as never, "example.com");
      ic.invalidate();
      await ic.resolve({} as never, "example.com");

      expect(ic.resolveCount).toBe(2);
    });

    test("invalidates all domains", async () => {
      const ic = new InstrumentedCache(500);
      await ic.resolve({} as never, "alpha.com");
      await ic.resolve({} as never, "beta.com");
      ic.invalidate();
      await ic.resolve({} as never, "alpha.com");
      await ic.resolve({} as never, "beta.com");

      expect(ic.resolveCount).toBe(4);
    });

    test("size resets to 0 after invalidate", async () => {
      const ic = new InstrumentedCache(500);
      await ic.resolve({} as never, "alpha.com");
      await ic.resolve({} as never, "beta.com");
      expect(ic.size).toBe(2);
      ic.invalidate();
      expect(ic.size).toBe(0);
    });
  });

  describe("performance — cache eliminates redundant storage reads", () => {
    /**
     * Simulates rapid keystroke prediction requests (50 calls in quick
     * succession for the same domain) and asserts that the underlying
     * storage resolver is called only once per domain while hits dominate.
     */
    test("50 consecutive requests for the same domain make 1 storage read", async () => {
      const ic = new InstrumentedCache(500);
      const REQUESTS = 50;

      for (let i = 0; i < REQUESTS; i++) {
        await ic.resolve({} as never, "typing.example.com");
      }

      expect(ic.resolveCount).toBe(1);
      expect(ic.hits).toBe(REQUESTS - 1);
      expect(ic.misses).toBe(1);
    });

    /**
     * Measures wall-clock time: 50 cached requests must complete much faster
     * than 50 uncached requests (which incur simulated 2 ms storage delay).
     *
     * This is the concrete latency regression guard — if the cache is removed
     * or broken, this test will fail.
     */
    test("cached requests are at least 5x faster than uncached for slow storage", async () => {
      const DELAY_MS = 2;
      const REQUESTS = 50;

      // Uncached baseline: a fresh cache per call so every request misses.
      const uncachedStart = Date.now();
      for (let i = 0; i < REQUESTS; i++) {
        const fresh = new InstrumentedCache(500);
        fresh.resolveDelayMs = DELAY_MS;
        await fresh.resolve({} as never, "example.com");
      }
      const uncachedMs = Date.now() - uncachedStart;

      // Cached: single cache instance, all requests after the first hit.
      const cachedCache = new InstrumentedCache(500);
      cachedCache.resolveDelayMs = DELAY_MS;
      const cachedStart = Date.now();
      for (let i = 0; i < REQUESTS; i++) {
        await cachedCache.resolve({} as never, "example.com");
      }
      const cachedMs = Date.now() - cachedStart;

      // Cached must be at least 5× faster than uncached.
      expect(cachedMs * 5).toBeLessThan(uncachedMs);
    });

    /**
     * Multi-word typing sequence benchmark: simulates typing a full word
     * character by character ("hello") with two domains. Each keystroke
     * triggers a prediction request. Asserts O(domains) storage reads, not
     * O(keystrokes).
     */
    test("typing a 5-char word on 2 domains makes 2 storage reads total", async () => {
      const ic = new InstrumentedCache(500);
      const word = "hello";
      const domains = ["site-a.com", "site-b.com"];

      for (const domain of domains) {
        for (let i = 1; i <= word.length; i++) {
          // Each "keystroke" dispatches a prediction request for the same domain.
          await ic.resolve({} as never, domain);
        }
      }

      expect(ic.resolveCount).toBe(domains.length);
      expect(ic.hits).toBe(word.length * domains.length - domains.length);
    });
  });
});
