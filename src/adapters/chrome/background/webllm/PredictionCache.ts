import type { PredictorRequest } from "./types";

interface CacheEntry {
  expiresAt: number;
  predictions: string[];
}

export class PredictionCache {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly cacheTtlMs: number) {}

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  getCacheKey(modelId: string, request: PredictorRequest): string {
    return [modelId, request.lang, request.numSuggestions, request.predictionInput].join("|");
  }

  get(cacheKey: string): string[] | null {
    const entry = this.cache.get(cacheKey);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(cacheKey);
      return null;
    }
    return entry.predictions.slice();
  }

  set(cacheKey: string, predictions: string[]): void {
    this.cache.set(cacheKey, {
      predictions: predictions.slice(),
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }
}
