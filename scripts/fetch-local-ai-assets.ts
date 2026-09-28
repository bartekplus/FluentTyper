/**
 * Maintainer probe for the Local AI model registry.
 *
 *   bun scripts/fetch-local-ai-assets.ts --probe
 *
 * For every record in src/core/domain/localAi/modelRegistry.ts, lists the files
 * of its pinned Hugging Face revision that the registry names (size + SHA-256,
 * as used to write the registry), flags drift against the registry and whether
 * the repository's main branch has moved. Nothing is downloaded into the repo:
 * model files are data fetched by the extension after consent, and the ONNX
 * Runtime files come from node_modules (pinned in scripts/check-local-ai-artifact.ts).
 */
import { parseArgs } from "node:util";
import { LOCAL_AI_MODELS } from "../src/core/domain/localAi/modelRegistry";

interface TreeEntry {
  type: string;
  path: string;
  size: number;
  lfs?: { oid: string; size: number };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return (await response.json()) as T;
}

/** SHA-256 of a file: the LFS oid for LFS files, else hashed from the pinned content. */
async function fileSha256(repo: string, revision: string, entry: TreeEntry): Promise<string> {
  if (entry.lfs) {
    return entry.lfs.oid;
  }
  const response = await fetch(`https://huggingface.co/${repo}/resolve/${revision}/${entry.path}`);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${entry.path}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

async function probe(): Promise<boolean> {
  let drift = false;
  for (const record of LOCAL_AI_MODELS) {
    const [tree, info] = await Promise.all([
      fetchJson<TreeEntry[]>(
        `https://huggingface.co/api/models/${record.repo}/tree/${record.revision}?recursive=true`,
      ),
      fetchJson<{ sha: string }>(`https://huggingface.co/api/models/${record.repo}`),
    ]);
    const byPath = new Map(tree.filter((e) => e.type === "file").map((e) => [e.path, e]));
    const files = [];
    for (const pinned of record.files) {
      const entry = byPath.get(pinned.path);
      if (!entry) {
        drift = true;
        files.push({ path: pinned.path, status: "missing at pinned revision" });
        continue;
      }
      const bytes = entry.lfs?.size ?? entry.size;
      const sha256 = await fileSha256(record.repo, record.revision, entry);
      const matches = bytes === pinned.bytes && sha256 === pinned.sha256;
      drift ||= !matches;
      files.push({ path: pinned.path, bytes, sha256, status: matches ? "ok" : "DRIFT" });
    }
    const downloadBytes = files.reduce((sum, file) => sum + (file.bytes ?? 0), 0);
    console.log(
      JSON.stringify(
        {
          modelId: record.modelId,
          repo: record.repo,
          revision: {
            pinned: record.revision,
            latest: info.sha,
            moved: info.sha !== record.revision,
          },
          dtype: record.dtype,
          downloadBytes: { registry: record.downloadBytes, probed: downloadBytes },
          files,
        },
        null,
        2,
      ),
    );
  }
  return !drift;
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { probe: { type: "boolean" } },
  });
  if (!values.probe) {
    console.error("Usage: bun scripts/fetch-local-ai-assets.ts --probe");
    process.exit(2);
  }
  const clean = await probe();
  console.log(clean ? "Registry matches the pinned revisions." : "DRIFT: update the registry.");
  process.exit(clean ? 0 : 1);
}
