import { jest } from "bun:test";
import { PersonalizationRepository } from "../src/core/application/personalization/PersonalizationRepository";
import { PersonalizationService } from "../src/core/application/personalization/PersonalizationService";
import type { StorageBackend } from "../src/core/application/storage/StorageBackend";
import { PERSONALIZATION_DECAY_WINDOW_MS } from "../src/core/domain/personalization/PersonalizationPolicy";

class CountingMemoryStorageBackend implements StorageBackend {
  values = new Map<string, string>();
  reads = 0;
  writes = 0;
  removes = 0;
  removeError: Error | null = null;

  async get(key: string) {
    this.reads += 1;
    return this.values.get(key);
  }

  async set(key: string, value: string) {
    this.writes += 1;
    this.values.set(key, value);
  }

  async remove(key: string) {
    this.removes += 1;
    if (this.removeError) {
      throw this.removeError;
    }
    this.values.delete(key);
  }

  async getAll(prefix: string) {
    this.reads += 1;
    return Object.fromEntries(
      [...this.values.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key.slice(prefix.length), value]),
    );
  }
}

function accepted(eventId: string, suggestion = "hello", language = "en_US") {
  return {
    eventType: "suggestion_accepted" as const,
    eventId,
    suggestion,
    triggerText: "hel",
    language,
  };
}

describe("PersonalizationService", () => {
  test("loads, mutates, persists, restarts, and serves storage-free snapshots", async () => {
    const backend = new CountingMemoryStorageBackend();
    const repository = new PersonalizationRepository(backend);
    const service = new PersonalizationService({
      repository,
      isEnabled: () => true,
      now: () => 1_000,
    });

    await service.initialize();
    expect(await service.handleEvent(accepted("one"))).toBe(true);
    expect(await service.handleEvent(accepted("two"))).toBe(true);
    expect(service.getRankingSnapshot().en_US.hello.score).toBe(2);

    const readsBeforeSnapshot = backend.reads;
    service.getRankingSnapshot();
    service.getRankingSnapshot();
    expect(backend.reads).toBe(readsBeforeSnapshot);

    const restarted = new PersonalizationService({
      repository,
      isEnabled: () => true,
      now: () => 1_000,
    });
    await restarted.initialize();
    expect(restarted.getRankingSnapshot().en_US.hello.score).toBe(2);
  });

  test("serializes concurrent acceptances without losing updates", async () => {
    const backend = new CountingMemoryStorageBackend();
    const service = new PersonalizationService({
      repository: new PersonalizationRepository(backend),
      isEnabled: () => true,
      now: () => 1_000,
    });

    await Promise.all(
      Array.from({ length: 20 }, (_, index) => service.accept(accepted(`event-${index}`))),
    );
    expect(service.getRankingSnapshot().en_US.hello.score).toBe(20);
  });

  test("makes duplicate acceptance and reversal idempotent", async () => {
    const service = new PersonalizationService({
      repository: new PersonalizationRepository(new CountingMemoryStorageBackend()),
      isEnabled: () => true,
      now: () => 1_000,
    });

    expect(await service.accept(accepted("same"))).toBe(true);
    expect(await service.accept(accepted("same"))).toBe(false);
    expect(await service.revert("same")).toBe(true);
    expect(await service.revert("same")).toBe(false);
    expect(await service.revert("unknown")).toBe(false);
    expect(service.getRankingSnapshot()).toEqual({});
  });

  test("keeps newer acceptance evidence when reverting one event", async () => {
    let nowMs = 1_000;
    const service = new PersonalizationService({
      repository: new PersonalizationRepository(new CountingMemoryStorageBackend()),
      isEnabled: () => true,
      now: () => nowMs,
    });
    await service.accept(accepted("first"));
    nowMs += PERSONALIZATION_DECAY_WINDOW_MS;
    await service.accept(accepted("second"));

    expect(await service.revert("first")).toBe(true);
    expect(service.getRankingSnapshot().en_US.hello.score).toBeCloseTo(1, 5);
  });

  test("learns prototype-named words as own persisted entries", async () => {
    const backend = new CountingMemoryStorageBackend();
    const repository = new PersonalizationRepository(backend);
    const service = new PersonalizationService({
      repository,
      isEnabled: () => true,
      now: () => 1_000,
    });

    expect(await service.accept(accepted("constructor", "constructor"))).toBe(true);
    expect(await service.accept(accepted("__proto__", "__proto__"))).toBe(true);

    const restarted = new PersonalizationService({
      repository,
      isEnabled: () => true,
      now: () => 1_000,
    });
    await restarted.initialize();
    const words = restarted.getRankingSnapshot().en_US;
    expect(Object.hasOwn(words, "constructor")).toBe(true);
    expect(words.constructor.score).toBe(1);
    expect(Object.hasOwn(words, "__proto__")).toBe(true);
    expect(words.__proto__.score).toBe(1);
  });

  test("disabled mode and text expansions do not learn or persist events", async () => {
    const backend = new CountingMemoryStorageBackend();
    const isEnabled = jest.fn(() => false);
    const service = new PersonalizationService({
      repository: new PersonalizationRepository(backend),
      isEnabled,
      isTextExpansionTrigger: (trigger) => trigger.toLowerCase() === "asap",
      now: () => 1_000,
    });
    await service.initialize();
    const writesAfterRepair = backend.writes;

    expect(await service.accept(accepted("disabled"))).toBe(false);
    isEnabled.mockReturnValue(true);
    expect(
      await service.accept({
        ...accepted("expansion", "output"),
        triggerText: "ASAP",
      }),
    ).toBe(false);
    expect(service.getRankingSnapshot()).toEqual({});
    expect(backend.writes).toBe(writesAfterRepair);
  });

  test("clears persisted data and in-memory ranking immediately", async () => {
    const backend = new CountingMemoryStorageBackend();
    const service = new PersonalizationService({
      repository: new PersonalizationRepository(backend),
      isEnabled: () => true,
      now: () => 1_000,
    });
    await service.accept(accepted("one"));

    await service.clear();
    expect(service.getRankingSnapshot()).toEqual({});
    expect(backend.removes).toBe(1);
  });

  test("preserves in-memory ranking when persisted data cannot be cleared", async () => {
    const backend = new CountingMemoryStorageBackend();
    const service = new PersonalizationService({
      repository: new PersonalizationRepository(backend),
      isEnabled: () => true,
      now: () => 1_000,
    });
    await service.accept(accepted("one"));
    backend.removeError = new Error("remove denied");

    await expect(service.clear()).rejects.toThrow("remove denied");
    expect(service.getRankingSnapshot().en_US.hello.score).toBe(1);
  });

  test("repairs malformed persisted data without breaking initialization", async () => {
    const backend = new CountingMemoryStorageBackend();
    backend.values.set(
      "fluenttyper.personalization",
      JSON.stringify({
        version: 1,
        languages: {
          en_US: {
            valid: { display: "Valid", score: 2, updatedAtMs: 100 },
            bad: { display: "Bad", score: "no", updatedAtMs: 100 },
          },
        },
        recentEvents: {},
      }),
    );
    const service = new PersonalizationService({
      repository: new PersonalizationRepository(backend),
      isEnabled: () => true,
      now: () => 1_000,
    });

    await expect(service.initialize()).resolves.toBeUndefined();
    expect(service.getRankingSnapshot()).toEqual({
      en_US: { valid: { display: "Valid", score: 2, updatedAtMs: 100 } },
    });
    expect(backend.writes).toBe(1);
  });
});
