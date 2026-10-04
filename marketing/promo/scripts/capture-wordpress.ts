/**
 * Records the promo's WordPress shot (frame 11): a real suggestion in the real block
 * editor of a local WordPress Playground site (the repo's own E2E runtime).
 *
 *   cd ../.. && WORDPRESS_NODE_BIN=/path/to/node22 E2E_EXTENSION_PATH=$PWD/build \
 *     bun marketing/promo/scripts/capture-wordpress.ts
 *
 * Playground needs Node.js 22 or 24. The site is in memory, on localhost only, and
 * uses Playground's default local admin account, as the WordPress E2E tests do.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getBackgroundContext,
  launchBrowser,
  openExtensionPage,
  sleep,
  waitUntil,
} from "../../../tests/e2e/e2e-helpers";

const ROOT = resolve(import.meta.dir, "../../..");
const OUT = resolve(import.meta.dir, "../assets/ui");
const NODE = process.env.WORDPRESS_NODE_BIN ?? "node";
const URL = "http://localhost:8890";
await mkdir(OUT, { recursive: true });
const home = resolve(ROOT, ".tmp/wordpress-e2e/promo");
await mkdir(home, { recursive: true });
const blueprint = resolve(home, "blueprint.json");
await writeFile(
  blueprint,
  JSON.stringify({
    steps: [
      {
        step: "writeFile",
        path: "/wordpress/wp-content/mu-plugins/fluenttyper-e2e.php",
        data: await Bun.file(resolve(ROOT, "tests/e2e/fixtures/wordpress-e2e.php")).text(),
      },
    ],
  }),
);
// PROMO_WP_ZIP: a local copy of the same core (for example GitHub's WordPress mirror),
// served on localhost because Playground takes a URL or a version.
const zip = process.env.PROMO_WP_ZIP;
const zipServer = zip
  ? Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(Bun.file(zip)) })
  : null;
const core = zipServer
  ? `http://127.0.0.1:${zipServer.port}/wordpress.zip`
  : ((await Bun.file(resolve(ROOT, ".wp-env.json")).json()) as { core: string }).core;
const server = spawn(
  NODE,
  [
    resolve(ROOT, "node_modules/@wp-playground/cli/wp-playground.js"),
    "server",
    `--wp=${core}`,
    "--php=8.2",
    "--workers=1",
    "--port=8890",
    `--site-url=${URL}`,
    `--blueprint=${blueprint}`,
    "--define-bool",
    "DISABLE_WP_CRON",
    "true",
  ],
  { cwd: ROOT, env: { ...process.env, WP_ENV_HOME: home }, stdio: "inherit" },
);
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
try {
  await waitUntil(
    "WordPress Playground",
    () =>
      fetch(URL, { signal: AbortSignal.timeout(2000) }).then(
        (response) => response.ok,
        () => false,
      ),
    { timeoutMs: 180_000, intervalMs: 1000 },
  );
  browser = await launchBrowser();
  const worker = await getBackgroundContext(browser);
  const options = await openExtensionPage(browser, worker, "options/options.html");
  await options.evaluate(async () => {
    const values = {
      language: "en_US",
      enabled_languages: ["en_US", "textExpander"],
      numSuggestions: 3,
      inline_suggestion: false,
      autocompleteOnTab: true,
      localAiReviewEnabled: false,
      localAiSetupOfferDismissed: true,
    };
    await chrome.storage.local.set(
      Object.fromEntries(
        Object.entries(values).map(([k, v]) => ["store.settings." + k, JSON.stringify(v)]),
      ),
    );
    await chrome.runtime.sendMessage({ command: "CMD_OPTIONS_PAGE_CONFIG_CHANGE", context: {} });
  });
  await sleep(500);
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 640, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.goto(`${URL}/wp-login.php`, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (await page.$("#user_login")) {
    await page.evaluate(() => {
      (document.querySelector("#user_login") as HTMLInputElement).value = "admin";
      (document.querySelector("#user_pass") as HTMLInputElement).value = "password";
    });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
      page.click("#wp-submit"),
    ]);
  }
  await page.goto(`${URL}/wp-admin/post-new.php`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.bringToFront();
  await page.waitForFunction("window.wp?.data?.select('core/editor')?.getCurrentPostId()", {
    timeout: 60000,
  });
  await page.evaluate(`
    wp.data.dispatch('core/preferences').set('core/edit-post', 'welcomeGuide', false);
    wp.data.dispatch('core/preferences').set('core/editor', 'welcomeGuide', false);
    wp.data.dispatch('core/editor').editPost({ title: 'Launch notes' });
    wp.data.dispatch('core/block-editor').resetBlocks([wp.blocks.createBlock('core/paragraph', { content: '' })]);
  `);
  await sleep(1500);
  // The canvas is an iframe when every block uses API version 3.
  const canvas =
    page.frames().find((frame) => frame.name() === "editor-canvas") ?? page.mainFrame();
  const field =
    ".block-editor-rich-text__editable[data-type='core/paragraph'], p.block-editor-rich-text__editable";
  await canvas.waitForSelector(field, { timeout: 30000 });
  await canvas.click(field);
  await page.keyboard.type("We published the launch ", { delay: 40 });
  await page.keyboard.press("Escape");
  await page.keyboard.type("rep", { delay: 110 });
  const list = await waitUntil(
    "WordPress suggestions",
    () =>
      canvas.evaluate(() => {
        const roots: ParentNode[] = [document];
        for (const el of document.querySelectorAll("*"))
          if (el.shadowRoot) roots.push(el.shadowRoot);
        const items = roots.flatMap((root) =>
          Array.from(root.querySelectorAll("li[data-index]")).map((li) => li.textContent?.trim()),
        );
        return items.length ? items : false;
      }),
    { timeoutMs: 15000 },
  );
  await sleep(300);
  await page.screenshot({ path: resolve(OUT, "v2-editor-wordpress.png") });
  console.log("v2-editor-wordpress", JSON.stringify(list));
} finally {
  await browser?.close();
  server.kill();
  zipServer?.stop(true);
}
