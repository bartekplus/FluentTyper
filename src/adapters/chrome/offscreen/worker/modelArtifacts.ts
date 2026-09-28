import {
  localAiModelFileUrl,
  type LocalAiModelFile,
  type LocalAiModelRecord,
} from "@core/domain/localAi/modelRegistry";
import { Sha256 } from "./sha256";

/**
 * A registry model's files in CacheStorage.
 *
 * Files live in Transformers.js's own cache ("transformers-cache"), keyed by
 * their pinned download URL, which is exactly where its loader looks. The
 * install downloads them itself, hashing each one while it streams into the
 * cache, so the loader later finds every file cached and never needs the
 * network. A marker in FluentTyper's own cache records that all files of the
 * model were verified and loaded once; without it the model is never "complete".
 */

export const MODEL_CACHE = "transformers-cache";
const MARKER_CACHE = "fluenttyper-local-ai";
export const INTEGRITY_ERROR_NAME = "IntegrityError";

export type CacheStorageLike = Pick<CacheStorage, "has" | "open">;

class IntegrityError extends Error {
  constructor() {
    super("Local AI model file failed verification");
    this.name = INTEGRITY_ERROR_NAME;
  }
}

class DownloadError extends Error {
  constructor() {
    super("Local AI model file download failed");
    this.name = "LocalAiDownloadError";
  }
}

/** Cache keys must be http(s); this host is reserved and never resolved. */
function markerUrl(record: LocalAiModelRecord): string {
  return `https://fluenttyper.invalid/local-ai/verified/${encodeURIComponent(record.modelId)}`;
}

async function openIfPresent(caches: CacheStorageLike, name: string): Promise<Cache | null> {
  return (await caches.has(name)) ? caches.open(name) : null;
}

/**
 * complete: every listed file is cached and the verified marker exists.
 * none: nothing of this model is cached. partial: anything in between
 * (never "available offline").
 */
export async function modelCacheState(
  caches: CacheStorageLike,
  record: LocalAiModelRecord,
): Promise<"none" | "partial" | "complete"> {
  const files = await openIfPresent(caches, MODEL_CACHE);
  const markers = await openIfPresent(caches, MARKER_CACHE);
  const present = await Promise.all(
    record.files.map(async (file) =>
      Boolean(await files?.match(localAiModelFileUrl(record, file))),
    ),
  );
  const marked = Boolean(await markers?.match(markerUrl(record)));
  if (marked && present.every(Boolean)) {
    return "complete";
  }
  return marked || present.some(Boolean) ? "partial" : "none";
}

/** Deletes this model's files and marker only (never another model's or Presage's data). */
export async function deleteModelArtifacts(
  caches: CacheStorageLike,
  record: LocalAiModelRecord,
): Promise<void> {
  await (await openIfPresent(caches, MARKER_CACHE))?.delete(markerUrl(record));
  const files = await openIfPresent(caches, MODEL_CACHE);
  for (const file of record.files) {
    await files?.delete(localAiModelFileUrl(record, file));
  }
}

export async function markModelVerified(
  caches: CacheStorageLike,
  record: LocalAiModelRecord,
): Promise<void> {
  await (await caches.open(MARKER_CACHE)).put(markerUrl(record), new Response(""));
}

/** Passes `body` through SHA-256; `result()` is final once the stream is fully read. */
function hashingStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (bytes: number) => void = () => undefined,
): {
  stream: ReadableStream<Uint8Array>;
  result: () => { bytes: number; sha256: string };
} {
  const hash = new Sha256();
  let bytes = 0;
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        hash.update(chunk);
        bytes += chunk.byteLength;
        onChunk(chunk.byteLength);
        controller.enqueue(chunk);
      },
    }),
  );
  return { stream, result: () => ({ bytes, sha256: hash.digestHex() }) };
}

async function cachedFileMatches(cache: Cache, url: string, file: LocalAiModelFile) {
  const response = await cache.match(url);
  if (!response?.body) {
    return false;
  }
  const { stream, result } = hashingStream(response.body);
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // Drain: hashing happens in the transform.
  }
  const { bytes, sha256 } = result();
  return bytes === file.bytes && sha256 === file.sha256;
}

/**
 * Downloads every listed file not yet cached intact, verifying size and
 * SHA-256 as it streams into the cache. A mismatch deletes all of this
 * model's entries and throws an IntegrityError. `fetchFile` is the worker's
 * guarded fetch; `onBytes` receives the running total of verified bytes.
 */
export async function downloadModelFiles(
  caches: CacheStorageLike,
  record: LocalAiModelRecord,
  fetchFile: (url: string) => Promise<Response>,
  onBytes: (bytes: number) => void,
): Promise<void> {
  const cache = await caches.open(MODEL_CACHE);
  let done = 0;
  for (const file of record.files) {
    const url = localAiModelFileUrl(record, file);
    if (await cachedFileMatches(cache, url, file)) {
      done += file.bytes;
      onBytes(done);
      continue;
    }
    await cache.delete(url);
    const response = await fetchFile(url);
    if (!response.ok || !response.body) {
      throw new DownloadError();
    }
    const base = done;
    const { stream, result } = hashingStream(response.body, (bytes) => {
      done += bytes;
      onBytes(Math.min(done, base + file.bytes));
    });
    const headers = new Headers({ "content-length": String(file.bytes) });
    const type = response.headers.get("content-type");
    if (type) {
      headers.set("content-type", type);
    }
    await cache.put(url, new Response(stream, { headers }));
    const { bytes, sha256 } = result();
    if (bytes !== file.bytes || sha256 !== file.sha256) {
      await deleteModelArtifacts(caches, record);
      throw new IntegrityError();
    }
    done = base + file.bytes;
  }
}
