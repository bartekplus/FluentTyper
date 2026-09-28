/**
 * Packaged Local AI Review model libraries (executable WASM).
 *
 * The libraries ship inside the extension (Chrome MV3 forbids remote code), so
 * they are fetched at build time from a pinned commit of mlc-ai/binary-mlc-llm-libs
 * and verified against the SHA-256, SRI and size recorded in the model registry.
 * They are gitignored under public/local-ai/libs/; build.ts calls
 * ensureLocalAiLibs() and re-verifies every copied file.
 *
 *   bun scripts/fetch-local-ai-assets.ts            fetch missing libs, verify all
 *   bun scripts/fetch-local-ai-assets.ts --probe    print refreshed registry metadata
 *   ... --probe --lib-commit=<sha>                  probe libs at another commit
 */
import path from "path";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { parseArgs } from "node:util";
import {
  LOCAL_AI_MODEL_LIB_ABI,
  LOCAL_AI_MODELS,
  type LocalAiModelRecord,
} from "../src/core/domain/localAi/modelRegistry";

export const LOCAL_AI_LIBS_REPO = "mlc-ai/binary-mlc-llm-libs";
/** Pinned binary-mlc-llm-libs commit; the registry hashes were verified at it. */
export const LOCAL_AI_LIBS_COMMIT = "025bcaf3780fa8254f5e5efd3bfea0a5397248f4";

const ROOT_DIR = path.resolve(import.meta.dir, "..");
export const LOCAL_AI_PUBLIC_DIR = path.join(ROOT_DIR, "public");

export function localAiLibSourceUrl(
  model: LocalAiModelRecord,
  commit = LOCAL_AI_LIBS_COMMIT,
): string {
  const file = path.posix.basename(model.modelLibPath);
  return `https://raw.githubusercontent.com/${LOCAL_AI_LIBS_REPO}/${commit}/web-llm-models/${LOCAL_AI_MODEL_LIB_ABI}/${file}`;
}

function describeBytes(bytes: Uint8Array) {
  return {
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    sri: `sha384-${new Bun.CryptoHasher("sha384").update(bytes).digest("base64")}`,
    bytes: bytes.byteLength,
  };
}

/** Throws unless `bytes` is exactly the registry's library for `model`. */
export function assertLocalAiLib(bytes: Uint8Array, model: LocalAiModelRecord, label: string) {
  const actual = describeBytes(bytes);
  const expected = {
    sha256: model.modelLibSha256,
    sri: model.modelLibSri,
    bytes: model.modelLibBytes,
  };
  if (
    actual.sha256 !== expected.sha256 ||
    actual.sri !== expected.sri ||
    actual.bytes !== expected.bytes
  ) {
    throw new Error(
      `Local AI model library verification failed for ${label}: ` +
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export async function verifyLocalAiLibFile(filePath: string, model: LocalAiModelRecord) {
  assertLocalAiLib(new Uint8Array(await readFile(filePath)), model, filePath);
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function readIfPresent(filePath: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(filePath));
  } catch {
    return null;
  }
}

/**
 * Makes `<publicDir>/<modelLibPath>` hold the verified library for every
 * registry model, downloading only missing or mismatching files.
 */
export async function ensureLocalAiLibs(
  publicDir = LOCAL_AI_PUBLIC_DIR,
  log: (message: string) => void = console.log,
): Promise<void> {
  for (const model of LOCAL_AI_MODELS) {
    const target = path.join(publicDir, model.modelLibPath);
    const existing = await readIfPresent(target);
    if (existing) {
      try {
        assertLocalAiLib(existing, model, target);
        continue;
      } catch {
        log(`[local-ai] ${model.modelLibPath} does not match the registry; re-fetching`);
      }
    }
    const url = localAiLibSourceUrl(model);
    log(`[local-ai] fetching ${url}`);
    const bytes = await download(url);
    assertLocalAiLib(bytes, model, url);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, target);
  }
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

async function weightBytes(repo: string, revision: string): Promise<number> {
  const cache = await fetchJson(
    `https://huggingface.co/${repo}/resolve/${revision}/tensor-cache.json`,
  );
  const records = Array.isArray(cache.records)
    ? (cache.records as Array<{ nbytes?: unknown }>)
    : [];
  return records.reduce((sum, record) => sum + (Number(record.nbytes) || 0), 0);
}

/** Maintainer helper: current upstream metadata next to what the registry pins. */
async function probe(libCommit: string): Promise<void> {
  const libsHead = await fetchJson(
    `https://api.github.com/repos/${LOCAL_AI_LIBS_REPO}/commits/HEAD`,
  ).catch(() => ({ sha: "unavailable" }));
  const models = [];
  for (const model of LOCAL_AI_MODELS) {
    const info = await fetchJson(`https://huggingface.co/api/models/${model.weightsRepo}`);
    const latestRevision = String(info.sha);
    const lib = describeBytes(await download(localAiLibSourceUrl(model, libCommit)));
    models.push({
      modelId: model.modelId,
      weightsRevision: { pinned: model.weightsRevision, latest: latestRevision },
      downloadBytes: {
        pinned: model.downloadBytes,
        atPinnedRevision: await weightBytes(model.weightsRepo, model.weightsRevision),
        atLatestRevision: await weightBytes(model.weightsRepo, latestRevision),
      },
      modelLib: {
        commit: libCommit,
        registry: {
          sha256: model.modelLibSha256,
          sri: model.modelLibSri,
          bytes: model.modelLibBytes,
        },
        fetched: lib,
        matchesRegistry:
          lib.sha256 === model.modelLibSha256 &&
          lib.sri === model.modelLibSri &&
          lib.bytes === model.modelLibBytes,
      },
    });
  }
  console.log(
    JSON.stringify(
      {
        abi: LOCAL_AI_MODEL_LIB_ABI,
        libsCommit: { pinned: LOCAL_AI_LIBS_COMMIT, head: libsHead.sha },
        models,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { probe: { type: "boolean" }, "lib-commit": { type: "string" } },
  });
  if (values.probe) {
    await probe(values["lib-commit"] ?? LOCAL_AI_LIBS_COMMIT);
  } else {
    await ensureLocalAiLibs();
    console.log(`[local-ai] ${LOCAL_AI_MODELS.length} model libraries verified`);
  }
}
