import { PersonalizationRepository } from "../src/core/application/personalization/PersonalizationRepository";
import type { StorageBackend } from "../src/core/application/storage/StorageBackend";

class MemoryStorageBackend implements StorageBackend {
  values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key);
  }

  async set(key: string, value: string) {
    this.values.set(key, value);
  }

  async remove(key: string) {
    this.values.delete(key);
  }

  async getAll(prefix: string) {
    return Object.fromEntries(
      [...this.values.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key.slice(prefix.length), value]),
    );
  }
}

describe("PersonalizationRepository", () => {
  test("loads, saves, and clears the dedicated record", async () => {
    const backend = new MemoryStorageBackend();
    const repository = new PersonalizationRepository(backend);
    const store = {
      version: 1 as const,
      languages: {
        en_US: {
          hello: { display: "Hello", score: 2, updatedAtMs: 100 },
        },
      },
      recentEvents: {},
    };

    await repository.save(store);
    await expect(repository.load()).resolves.toEqual(store);
    await repository.clear();
    await expect(repository.load()).resolves.toBeUndefined();
  });

  test("treats unreadable data as empty", async () => {
    const backend = new MemoryStorageBackend();
    backend.values.set("fluenttyper.personalization", "{invalid");
    const repository = new PersonalizationRepository(backend);
    await expect(repository.load()).resolves.toBeUndefined();
  });
});
