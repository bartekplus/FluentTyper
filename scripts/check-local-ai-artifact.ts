/**
 * Release gate for a PRODUCTION build: permissions, CSP, the packaged ONNX
 * Runtime files, Local AI engine isolation, and dev-only code stripped.
 *
 *   bun run build [--platform=edge|firefox]
 *   bun run check:local-ai:artifact [--platform=edge|firefox] [--dir=build]
 */
import path from "path";
import { readFile, readdir, stat } from "fs/promises";
import { parseArgs } from "node:util";
import { LOCAL_AI_DOWNLOAD_ORIGINS } from "../src/core/domain/localAi/modelRegistry";

/** Build directory background.js loads the ONNX Runtime WASM from (env.backends.onnx.wasm.wasmPaths). */
export const LOCAL_AI_ORT_DIR = "local-ai/ort";
/**
 * The ONNX Runtime WASM shipped for `onnxruntime-web/webgpu` (the asyncify build
 * that Transformers.js imports), pinned by SHA-256. Its JavaScript glue is part of
 * ORT's bundle build, which is bundled into background.js (a service worker cannot
 * import() a separate .mjs).
 * onnxruntime-web 1.31.0-dev.20260914-8d85527a0 (pinned by @huggingface/transformers 4.3.0).
 */
export const LOCAL_AI_ORT_FILES: Record<string, { bytes: number; sha256: string }> = {
  "ort-wasm-simd-threaded.asyncify.wasm": {
    bytes: 26_861_777,
    sha256: "49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082",
  },
};
/** String literals of ONNX Runtime / Transformers.js (survive minification): only in a Local AI background.js. */
export const LOCAL_AI_ENGINE_MARKERS = [
  "ort-wasm-simd-threaded",
  "onnxruntime",
  "transformers-cache",
];
/** Only src/adapters/chrome/background/testing/RuntimeTestHooks.ts (dev) contains these. */
const TEST_HOOK_MARKERS = ["TEST_TRIGGER_COMMAND", "triggerCommandForTesting"];
/** content_script.js installs its observability relay only when __FT_DEV_BUILD__ is true. */
const DEV_BUILD_CONTENT_SCRIPT_MARKER = "CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_EVENT";
const REPO_ROOT = path.resolve(import.meta.dir, "..");
/** Transformers.js' default wasmPaths; inert only when background.js overrides it. */
const ORT_CDN_ORIGIN = "https://cdn.jsdelivr.net";

export const APP_BUNDLES = [
  "background.js",
  "content_script.js",
  "content_script_main_world_start.js",
  "content_script_main_world.js",
  "popup/popup.js",
  "options/settings.js",
  "new_installation/onboarding.js",
];
/** The only bundle that may hold the Local AI engine (Chrome/Edge). */
const ENGINE_BUNDLE = "background.js";

/**
 * URL origins that may appear in the engine bundle without being contacted:
 * documentation links in dependency error/warning strings. CSP connect-src
 * blocks all of them at runtime regardless.
 */
const INERT_URL_ORIGINS: Record<string, string> = {
  "https://github.com": "dependency error/help links",
  "https://gist.github.com": "Transformers.js help link",
  "https://developer.mozilla.org": "dependency help link",
  "https://web.dev": "ONNX Runtime cross-origin-isolation help link",
  "https://fluenttyper.invalid": "synthetic CacheStorage key (RFC 2606 .invalid, never resolves)",
  "http://www.w3.org": "XML/SVG namespace constants",
  "https://www.w3.org": "XML/SVG namespace constants",
};

const PERMISSIONS = ["activeTab", "storage"];

interface ArtifactReport {
  failures: string[];
  notes: string[];
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().join(" ") === [...right].sort().join(" ");
}

function cspDirectives(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) {
      directives.set(name, sources);
    }
  }
  return directives;
}

export async function checkLocalAiArtifact(
  buildDir: string,
  platform: string,
): Promise<ArtifactReport> {
  if (!["chrome", "edge", "firefox"].includes(platform)) {
    throw new Error(`Unknown platform "${platform}"`);
  }
  const localAi = platform !== "firefox";
  const failures: string[] = [];
  const notes: string[] = [];
  const fail = (message: string) => failures.push(message);
  const read = (relative: string) => readFile(path.join(buildDir, relative), "utf8");

  // Manifest: permissions, page exposure, CSP.
  const manifest = JSON.parse(await read("manifest.json")) as Record<string, unknown>;
  const permissions = (manifest.permissions as string[] | undefined) ?? [];
  if (!sameSet(permissions, PERMISSIONS)) {
    fail(`permissions ${JSON.stringify(permissions)} != ${JSON.stringify(PERMISSIONS)}`);
  }
  if (
    !sameSet((manifest.optional_host_permissions as string[] | undefined) ?? [], ["<all_urls>"])
  ) {
    fail("optional_host_permissions changed");
  }
  for (const key of ["host_permissions", "externally_connectable", "minimum_chrome_version"]) {
    if (key in manifest) {
      fail(`manifest must not declare ${key}`);
    }
  }
  if (JSON.stringify(manifest.web_accessible_resources ?? []).includes("local-ai")) {
    fail("local-ai files must not be web accessible");
  }
  const csp = manifest.content_security_policy as Record<string, unknown> | undefined;
  if (csp && "sandbox" in csp) {
    fail("manifest must not declare a sandbox CSP");
  }
  const directives = cspDirectives(String(csp?.extension_pages ?? ""));
  if (!sameSet(directives.get("script-src") ?? [], ["'self'", "'wasm-unsafe-eval'"])) {
    fail(`script-src is ${JSON.stringify(directives.get("script-src"))}`);
  }
  const connectSrc = directives.get("connect-src");
  if (localAi) {
    if (!connectSrc || !sameSet(connectSrc, ["'self'", ...LOCAL_AI_DOWNLOAD_ORIGINS])) {
      fail(`connect-src is ${JSON.stringify(connectSrc)}, expected 'self' + Hugging Face origins`);
    }
  } else if (connectSrc) {
    fail(`connect-src must be unset on ${platform}, got ${JSON.stringify(connectSrc)}`);
  }

  // Local AI files: present and verified on Chrome/Edge, absent elsewhere.
  if (localAi) {
    const localAiEntries = await readdir(path.join(buildDir, "local-ai")).catch(() => []);
    const expectedEntries = [
      "ort",
      "THIRD_PARTY_NOTICES.md",
      "ONNXRUNTIME_THIRD_PARTY_NOTICES.txt",
    ];
    if (!sameSet(localAiEntries, expectedEntries)) {
      fail(
        `local-ai/ holds ${JSON.stringify(localAiEntries)}, expected ${JSON.stringify(expectedEntries)}`,
      );
    }
    const ortDir = path.join(buildDir, LOCAL_AI_ORT_DIR);
    const shipped = await readdir(ortDir).catch(() => [] as string[]);
    if (!sameSet(shipped, Object.keys(LOCAL_AI_ORT_FILES))) {
      fail(
        `${LOCAL_AI_ORT_DIR} holds ${JSON.stringify(shipped)}, expected ${JSON.stringify(Object.keys(LOCAL_AI_ORT_FILES))}`,
      );
    }
    for (const [name, pinned] of Object.entries(LOCAL_AI_ORT_FILES)) {
      const bytes = await readFile(path.join(ortDir, name)).catch(() => null);
      const sha256 = bytes && new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
      if (!bytes || sha256 !== pinned.sha256 || bytes.byteLength !== pinned.bytes) {
        fail(`${LOCAL_AI_ORT_DIR}/${name} does not match its pinned SHA-256/size`);
      }
    }
  } else if (await stat(path.join(buildDir, "local-ai")).catch(() => null)) {
    fail(`${platform} build must not contain local-ai/`);
  }

  // Bundles: engine isolation and production stripping.
  const contents = new Map<string, string>();
  for (const bundle of APP_BUNDLES) {
    const content = await read(bundle).catch(() => null);
    if (content === null) {
      fail(`missing ${bundle}`);
    } else {
      contents.set(bundle, content);
    }
  }
  for (const [bundle, content] of contents) {
    const isEngine = localAi && bundle === ENGINE_BUNDLE;
    for (const marker of TEST_HOOK_MARKERS) {
      if (content.includes(marker)) {
        fail(`${bundle} contains runtime test hooks ("${marker}")`);
      }
    }
    if (content.includes(REPO_ROOT)) {
      fail(`${bundle} embeds the build machine path ${REPO_ROOT}`);
    }
    if (!isEngine) {
      for (const marker of LOCAL_AI_ENGINE_MARKERS) {
        if (content.includes(marker)) {
          fail(`${bundle} contains the Local AI engine ("${marker}")`);
        }
      }
      continue;
    }
    // background.js must replace Transformers.js' CDN wasmPaths with the packaged runtime.
    const ortOverridden = content.includes(`${LOCAL_AI_ORT_DIR}/`);
    const origins = new Map<string, number>();
    for (const url of content.match(/https?:\/\/[a-z0-9.-]+/gi) ?? []) {
      origins.set(url.toLowerCase(), (origins.get(url.toLowerCase()) ?? 0) + 1);
    }
    for (const [origin, count] of origins) {
      if (LOCAL_AI_DOWNLOAD_ORIGINS.includes(origin)) {
        notes.push(`${bundle}: ${origin} x${count} (allowlisted download origin)`);
      } else if (origin === ORT_CDN_ORIGIN && ortOverridden) {
        notes.push(
          `${bundle}: ${origin} x${count} (inert: Transformers.js default wasmPaths, overridden with ${LOCAL_AI_ORT_DIR}/)`,
        );
      } else if (origin in INERT_URL_ORIGINS) {
        notes.push(`${bundle}: ${origin} x${count} (inert: ${INERT_URL_ORIGINS[origin]})`);
      } else {
        fail(`${bundle} references unexpected origin ${origin} (x${count})`);
      }
    }
  }
  if (contents.get("content_script.js")?.includes(DEV_BUILD_CONTENT_SCRIPT_MARKER)) {
    fail("content_script.js was built with __FT_DEV_BUILD__ = true");
  }
  const engine = localAi ? (contents.get(ENGINE_BUNDLE) ?? "") : null;
  if (engine !== null && !engine.includes(LOCAL_AI_ENGINE_MARKERS[0])) {
    fail(`${ENGINE_BUNDLE} does not contain the Local AI engine`);
  }
  if (engine !== null && !engine.includes(`${LOCAL_AI_ORT_DIR}/`)) {
    fail(`${ENGINE_BUNDLE} does not point ONNX Runtime at ${LOCAL_AI_ORT_DIR}/`);
  }

  return { failures, notes };
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { platform: { type: "string" }, dir: { type: "string" } },
  });
  const platform = values.platform ?? "chrome";
  const buildDir = path.resolve(values.dir ?? "build");
  const { failures, notes } = await checkLocalAiArtifact(buildDir, platform);
  for (const note of notes) {
    console.log(`note: ${note}`);
  }
  for (const failure of failures) {
    console.error(`FAIL: ${failure}`);
  }
  console.log(
    failures.length === 0
      ? `Local AI artifact check passed (${platform}, ${buildDir})`
      : `Local AI artifact check failed: ${failures.length} problem(s)`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}
