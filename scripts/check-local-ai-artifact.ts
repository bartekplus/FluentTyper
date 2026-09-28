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

/** Build directory the worker loads ONNX Runtime from (env.backends.onnx.wasm.wasmPaths). */
export const LOCAL_AI_ORT_DIR = "local-ai/ort";
/**
 * The ONNX Runtime files shipped for `onnxruntime-web/webgpu` (the asyncify
 * build that Transformers.js imports), pinned by SHA-256. The .mjs is the
 * WASM glue ORT imports when wasmPaths names a directory.
 * onnxruntime-web 1.31.0-dev.20260914-8d85527a0 (pinned by @huggingface/transformers 4.3.0).
 */
export const LOCAL_AI_ORT_FILES: Record<string, { bytes: number; sha256: string }> = {
  "ort-wasm-simd-threaded.asyncify.wasm": {
    bytes: 26_861_777,
    sha256: "49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082",
  },
  "ort-wasm-simd-threaded.asyncify.mjs": {
    bytes: 53_057,
    sha256: "0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611",
  },
};
/** String literals of ONNX Runtime / Transformers.js (survive minification): only in local-ai/worker.js. */
export const LOCAL_AI_ENGINE_MARKERS = [
  "ort-wasm-simd-threaded",
  "onnxruntime",
  "transformers-cache",
];
/** WebLLM (and its TVM runtime) must not appear in any bundle. */
export const WEBLLM_MARKERS = [
  "WebGPUNotAvailableError",
  "wasmLibraryProvider",
  "MLCEngine",
  "@mlc-ai",
  "WebLLM",
];
/** Only src/adapters/chrome/background/testing/RuntimeTestHooks.ts (dev) contains these. */
const TEST_HOOK_MARKERS = ["TEST_TRIGGER_COMMAND", "triggerCommandForTesting"];
/** content_script.js installs its observability relay only when __FT_DEV_BUILD__ is true. */
const DEV_BUILD_CONTENT_SCRIPT_MARKER = "CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_EVENT";
const REPO_ROOT = path.resolve(import.meta.dir, "..");
/** The legacy predictor's text-bearing debug fields must never reach Local AI bundles. */
const LEGACY_DEBUG_TEXT_FIELDS = ["lastPredictInput", "lastRawOutputPreview"];
/** Transformers.js' default wasmPaths; inert only when the worker overrides it. */
const ORT_CDN_ORIGIN = "https://cdn.jsdelivr.net";

const APP_BUNDLES = [
  "background.js",
  "content_script.js",
  "content_script_main_world_start.js",
  "content_script_main_world.js",
  "popup/popup.js",
  "options/settings.js",
  "new_installation/onboarding.js",
];
const LOCAL_AI_BUNDLES = ["local-ai/offscreen.js", "local-ai/worker.js"];
const LOCAL_AI_FILES = [
  ...LOCAL_AI_BUNDLES,
  "local-ai/offscreen.html",
  "local-ai/THIRD_PARTY_NOTICES.md",
  "local-ai/ONNXRUNTIME_THIRD_PARTY_NOTICES.txt",
];

/**
 * URL origins that may appear in Local AI bundles without being contacted:
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

interface PlatformExpectation {
  permissions: string[];
  localAi: boolean;
}

const PLATFORMS: Record<string, PlatformExpectation> = {
  chrome: { permissions: ["activeTab", "offscreen", "storage"], localAi: true },
  edge: { permissions: ["activeTab", "offscreen", "storage"], localAi: true },
  firefox: { permissions: ["activeTab", "storage"], localAi: false },
};

interface ArtifactReport {
  failures: string[];
  notes: string[];
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath).then(
    () => true,
    () => false,
  );
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
  const expected = PLATFORMS[platform];
  if (!expected) {
    throw new Error(`Unknown platform "${platform}"`);
  }
  const failures: string[] = [];
  const notes: string[] = [];
  const fail = (message: string) => failures.push(message);
  const read = (relative: string) => readFile(path.join(buildDir, relative), "utf8");

  // Manifest: permissions, page exposure, CSP.
  const manifestText = await read("manifest.json");
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  const permissions = (manifest.permissions as string[] | undefined) ?? [];
  if (!sameSet(permissions, expected.permissions)) {
    fail(`permissions ${JSON.stringify(permissions)} != ${JSON.stringify(expected.permissions)}`);
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
  if (manifestText.includes("raw.githubusercontent.com")) {
    fail("manifest mentions raw.githubusercontent.com");
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
  if (expected.localAi) {
    if (!connectSrc || !sameSet(connectSrc, ["'self'", ...LOCAL_AI_DOWNLOAD_ORIGINS])) {
      fail(`connect-src is ${JSON.stringify(connectSrc)}, expected 'self' + Hugging Face origins`);
    }
  } else if (connectSrc) {
    fail(`connect-src must be unset on ${platform}, got ${JSON.stringify(connectSrc)}`);
  }

  // Local AI files: present and verified on Chrome/Edge, absent elsewhere.
  if (expected.localAi) {
    for (const file of LOCAL_AI_FILES) {
      if (!(await exists(path.join(buildDir, file)))) {
        fail(`missing ${file}`);
      }
    }
    const localAiEntries = await readdir(path.join(buildDir, "local-ai")).catch(() => []);
    const expectedEntries = [
      "offscreen.html",
      "offscreen.js",
      "worker.js",
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
    const offscreenHtml = await read("local-ai/offscreen.html").catch(() => "");
    const scripts = offscreenHtml.match(/<script\b[^>]*>/gi) ?? [];
    if (
      scripts.length !== 1 ||
      !/\ssrc="(\.\/)?offscreen\.js"/.test(scripts[0]) ||
      /<script\b[^>]*>(?!\s*<\/script>)/i.test(offscreenHtml)
    ) {
      fail("local-ai/offscreen.html must load only ./offscreen.js, with no inline script");
    }
  } else if (await exists(path.join(buildDir, "local-ai"))) {
    fail(`${platform} build must not contain local-ai/`);
  }

  // Bundles: engine isolation and production stripping.
  const bundles = [...APP_BUNDLES, ...(expected.localAi ? LOCAL_AI_BUNDLES : [])];
  const contents = new Map<string, string>();
  for (const bundle of bundles) {
    const content = await read(bundle).catch(() => null);
    if (content === null) {
      fail(`missing ${bundle}`);
    } else {
      contents.set(bundle, content);
    }
  }
  for (const [bundle, content] of contents) {
    const isLocalAi = LOCAL_AI_BUNDLES.includes(bundle);
    for (const marker of TEST_HOOK_MARKERS) {
      if (content.includes(marker)) {
        fail(`${bundle} contains runtime test hooks ("${marker}")`);
      }
    }
    if (content.includes(REPO_ROOT)) {
      fail(`${bundle} embeds the build machine path ${REPO_ROOT}`);
    }
    for (const marker of WEBLLM_MARKERS) {
      if (content.includes(marker)) {
        fail(`${bundle} contains WebLLM ("${marker}")`);
      }
    }
    const isWorker = bundle === "local-ai/worker.js";
    if (!isWorker) {
      for (const marker of LOCAL_AI_ENGINE_MARKERS) {
        if (content.includes(marker)) {
          fail(`${bundle} contains the Local AI engine ("${marker}")`);
        }
      }
    }
    if (!isLocalAi) {
      continue;
    }
    // The worker must replace Transformers.js' CDN wasmPaths with the packaged runtime.
    const ortOverridden = isWorker && content.includes(`${LOCAL_AI_ORT_DIR}/`);
    for (const field of LEGACY_DEBUG_TEXT_FIELDS) {
      if (content.includes(field)) {
        fail(`${bundle} contains the legacy debug text field "${field}"`);
      }
    }
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
  const worker = contents.get("local-ai/worker.js");
  if (expected.localAi && !worker?.includes(LOCAL_AI_ENGINE_MARKERS[0])) {
    fail("local-ai/worker.js does not contain the Local AI engine");
  }
  if (worker && !worker.includes(`${LOCAL_AI_ORT_DIR}/`)) {
    fail(`local-ai/worker.js does not point ONNX Runtime at ${LOCAL_AI_ORT_DIR}/`);
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
