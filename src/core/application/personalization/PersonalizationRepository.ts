import type { StorageBackend } from "../storage/StorageBackend";
import type { PersonalizationStoreV1 } from "@core/domain/personalization/types";

export const PERSONALIZATION_STORAGE_KEY = "fluenttyper.personalization";

export class PersonalizationRepository {
  constructor(private readonly storage: StorageBackend) {}

  async load(): Promise<unknown> {
    const serialized = await this.storage.get(PERSONALIZATION_STORAGE_KEY);
    if (serialized === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(serialized) as unknown;
    } catch {
      return undefined;
    }
  }

  async save(store: PersonalizationStoreV1): Promise<void> {
    await this.storage.set(PERSONALIZATION_STORAGE_KEY, JSON.stringify(store));
  }

  async clear(): Promise<void> {
    await this.storage.remove(PERSONALIZATION_STORAGE_KEY);
  }
}
