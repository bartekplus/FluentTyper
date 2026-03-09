import type { SettingsManager } from "@core/application/settingsManager";
import type { DomainRuntimeSettings } from "./runtimeSettings";
import { resolveDomainRuntimeSettings } from "./runtimeSettings";

const DEFAULT_TTL_MS = 500;

interface CacheEntry {
  value: DomainRuntimeSettings;
  expiresAt: number;
}

/**
 * Short-lived cache for per-domain runtime settings.
 *
 * `resolveDomainRuntimeSettings` performs 5 parallel chrome.storage reads on
 * every call. During rapid typing each keystroke triggers a new prediction
 * request, so without this cache those reads dominate end-to-end latency.
 *
 * TTL is deliberately short (~500 ms) so that user-initiated settings changes
 * (language toggle, options page save) still take effect quickly.
 * Call `invalidate()` to flush immediately after a settings change.
 */
export class DomainSettingsCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private _hits = 0;
  private _misses = 0;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  async resolve(
    settingsManager: SettingsManager,
    domainURL?: string,
  ): Promise<DomainRuntimeSettings> {
    const key = domainURL ?? "";
    const now = Date.now();
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > now) {
      this._hits++;
      return entry.value;
    }
    this._misses++;
    const value = await this.resolveFromStorage(settingsManager, domainURL);
    this.cache.set(key, { value, expiresAt: now + this.ttlMs });
    return value;
  }

  /**
   * Overridable in tests to inject a fake storage resolver without needing
   * a full chrome.storage mock.
   */
  protected async resolveFromStorage(
    settingsManager: SettingsManager,
    domainURL?: string,
  ): Promise<DomainRuntimeSettings> {
    return resolveDomainRuntimeSettings(settingsManager, domainURL);
  }

  /** Flush all cached entries — call after any settings change. */
  invalidate(): void {
    this.cache.clear();
  }

  get hits(): number {
    return this._hits;
  }

  get misses(): number {
    return this._misses;
  }

  get size(): number {
    return this.cache.size;
  }
}
