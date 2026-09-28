/**
 * Release gate for a PRODUCTION build: permissions, CSP, packaged model
 * libraries, WebLLM isolation, and dev-only code stripped.
 *
 *   bun run build [--platform=edge|firefox]
 *   bun run check:local-ai:artifact [--platform=edge|firefox] [--dir=build]
 */
import path from "path";
import { readFile, readdir, stat } from "fs/promises";
import { parseArgs } from "node:util";
import {
  LOCAL_AI_DOWNLOAD_ORIGINS,
  LOCAL_AI_MODELS,
} from "../src/core/domain/localAi/modelRegistry";
import { verifyLocalAiLibFile } from "./fetch-local-ai-assets";

/** Strings only present when the real WebLLM engine / TVM runtime is bundled. */
export const WEBLLM_ENGINE_MARKERS = ["WebGPUNotAvailableError", "wasmLibraryProvider"];
/** Error message of src/adapters/chrome/background/webllm-disabled-runtime.ts. */
const DISABLED_RUNTIME_MARKER = "WebLLM runtime is disabled in this build";
/** Only src/adapters/chrome/background/testing/RuntimeTestHooks.ts (dev) contains these. */
const TEST_HOOK_MARKERS = [
  "TEST_TRIGGER_COMMAND",
  "TEST_SET_WEBLLM_PREDICTIONS",
  "TEST_GET_WEBLLM_PREDICTION_CALLS",
  "__fluentTyperWebLLMTestOverride__",
];
/** content_script.js installs its observability relay only when __FT_DEV_BUILD__ is true. */
const DEV_BUILD_CONTENT_SCRIPT_MARKER = "CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_EVENT";
const REPO_ROOT = path.resolve(import.meta.dir, "..");
/** The legacy predictor's text-bearing debug fields must never reach Local AI bundles. */
const LEGACY_DEBUG_TEXT_FIELDS = ["lastPredictInput", "lastRawOutputPreview"];

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
];

/**
 * URL origins that may appear in Local AI bundles without being contacted:
 * WebLLM's built-in prebuiltAppConfig (never used: the worker passes an
 * appConfig built from our registry, whose model_lib is extension-local) and
 * documentation links in dependency comments/error strings. CSP connect-src
 * blocks all of them at runtime regardless.
 */
const INERT_URL_ORIGINS: Record<string, string> = {
  "https://raw.githubusercontent.com": "WebLLM prebuiltAppConfig model_lib entries (unused)",
  "https://github.com": "dependency error/help links",
  "https://www.apache.org": "license header text",
  "http://www.apache.org": "license header text",
  "https://llm.mlc.ai": "WebLLM documentation links",
  "https://developer.chrome.com": "WebGPU documentation links",
  "https://webgpureport.org": "WebGPU troubleshooting link",
  "https://gpuweb.github.io": "WebGPU specification links",
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

export interface ArtifactReport {
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
    const libsDir = path.join(buildDir, "local-ai", "libs");
    const shipped = await readdir(libsDir).catch(() => [] as string[]);
    const registry = LOCAL_AI_MODELS.map((model) => path.posix.basename(model.modelLibPath));
    if (!sameSet(shipped, registry)) {
      fail(`local-ai/libs holds ${JSON.stringify(shipped)}, expected ${JSON.stringify(registry)}`);
    }
    for (const model of LOCAL_AI_MODELS) {
      await verifyLocalAiLibFile(path.join(buildDir, model.modelLibPath), model).catch(
        (error: unknown) => fail(String(error)),
      );
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

  // Bundles: WebLLM isolation and production stripping.
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
    if (!isLocalAi) {
      for (const marker of WEBLLM_ENGINE_MARKERS) {
        if (content.includes(marker)) {
          fail(`${bundle} contains the WebLLM engine ("${marker}")`);
        }
      }
      continue;
    }
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
  const background = contents.get("background.js") ?? "";
  if (!background.includes(DISABLED_RUNTIME_MARKER)) {
    fail("background.js does not use the disabled WebLLM runtime stub");
  }
  if (expected.localAi && !contents.get("local-ai/worker.js")?.includes(WEBLLM_ENGINE_MARKERS[0])) {
    fail("local-ai/worker.js does not contain the WebLLM engine");
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
