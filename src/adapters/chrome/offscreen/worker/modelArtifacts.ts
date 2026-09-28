import type { AppConfig } from "@mlc-ai/web-llm";
import type { LocalAiModelRecord } from "@core/domain/localAi/modelRegistry";

/**
 * Where a registry model's artifacts live, and what is cached of them.
 *
 * The AppConfig is built only from the curated registry record (never
 * WebLLM's prebuilt list): weights from the pinned Hugging Face revision, the
 * model library from the extension package (WebLLM fetches a non-http
 * `model_lib` with plain `fetch` and never caches it), SRI-checked.
 */

/** WebLLM 0.2.85 Cache API scopes that hold model data (the library is packaged, not cached). */
const CONFIG_SCOPE = "webllm/config";
const MODEL_SCOPE = "webllm/model";

export type CacheStorageLike = Pick<CacheStorage, "has" | "open">;

export function modelWeightsUrl(record: LocalAiModelRecord): string {
  return `https://huggingface.co/${record.weightsRepo}/resolve/${record.weightsRevision}/`;
}

export function localAiAppConfig(record: LocalAiModelRecord, extensionOrigin: string): AppConfig {
  return {
    model_list: [
      {
        model: modelWeightsUrl(record),
        model_id: record.modelId,
        model_lib: `${extensionOrigin}/${record.modelLibPath}`,
        integrity: { model_lib: record.modelLibSri, onFailure: "error" },
        overrides: { context_window_size: record.contextWindow },
        required_features: [...record.requiredFeatures],
      },
    ],
    cacheBackend: "cache",
  };
}

async function openIfPresent(caches: CacheStorageLike, scope: string): Promise<Cache | null> {
  return (await caches.has(scope)) ? caches.open(scope) : null;
}

async function readJson(response: Response | undefined): Promise<unknown> {
  if (!response) {
    return null;
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** The tokenizer file WebLLM would load for this config (tokenizer.json preferred). */
function tokenizerFile(config: unknown): string | null {
  const files = (config as { tokenizer_files?: unknown } | null)?.tokenizer_files;
  if (!Array.isArray(files)) {
    return null;
  }
  if (files.includes("tokenizer.json")) {
    return "tokenizer.json";
  }
  return files.includes("tokenizer.model") ? "tokenizer.model" : null;
}

function shardPaths(tensorCache: unknown): string[] | null {
  const records = (tensorCache as { records?: unknown } | null)?.records;
  if (!Array.isArray(records) || records.length === 0) {
    return null;
  }
  const paths = records.map((record) => (record as { dataPath?: unknown } | null)?.dataPath);
  return paths.every((path): path is string => typeof path === "string") ? paths : null;
}

/**
 * complete: config, the tokenizer it names, tensor-cache.json and every shard
 * it lists are cached under the pinned URL. none: nothing of this model is
 * cached. partial: anything in between (never "available offline").
 */
export async function modelCacheState(
  caches: CacheStorageLike,
  record: LocalAiModelRecord,
): Promise<"none" | "partial" | "complete"> {
  const baseUrl = modelWeightsUrl(record);
  const configCache = await openIfPresent(caches, CONFIG_SCOPE);
  const modelCache = await openIfPresent(caches, MODEL_SCOPE);
  const config = await readJson(
    await configCache?.match(new URL("mlc-chat-config.json", baseUrl).href),
  );
  const modelKeys = new Set(
    ((await modelCache?.keys()) ?? [])
      .map((request) => request.url)
      .filter((url) => url.startsWith(baseUrl)),
  );
  if (config === null && modelKeys.size === 0) {
    return "none";
  }
  const tensorCache = await readJson(
    await modelCache?.match(new URL("tensor-cache.json", baseUrl).href),
  );
  const tokenizer = tokenizerFile(config);
  const shards = shardPaths(tensorCache);
  if (!tokenizer || !shards) {
    return "partial";
  }
  const required = [tokenizer, ...shards].map((path) => new URL(path, baseUrl).href);
  return required.every((url) => modelKeys.has(url)) ? "complete" : "partial";
}

/**
 * Deletes every cached entry under this model's pinned URL, in FluentTyper's
 * own WebLLM scopes only. (WebLLM's deleteModelAllInfoInCache is not used: in
 * 0.2.85 it re-fetches tensor-cache.json from the network when it is missing,
 * so it fails, or downloads, on a partial cache.)
 */
export async function deleteModelArtifacts(
  caches: CacheStorageLike,
  record: LocalAiModelRecord,
): Promise<void> {
  const baseUrl = modelWeightsUrl(record);
  for (const scope of [CONFIG_SCOPE, MODEL_SCOPE]) {
    const cache = await openIfPresent(caches, scope);
    if (!cache) {
      continue;
    }
    for (const request of await cache.keys()) {
      if (request.url.startsWith(baseUrl)) {
        await cache.delete(request);
      }
    }
  }
}
