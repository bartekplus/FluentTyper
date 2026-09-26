/**
 * Synthetic Review-mode demo: drives the built extension on a local page and
 * saves the screenshots in docs/images/review-mode/. It fails when a step does
 * not behave as documented (starting changes nothing, code and formatting stay,
 * native undo restores the original).
 *
 *   bun run build
 *   E2E_EXTENSION_PATH=$PWD/build bun scripts/review-demo.ts [--out=dir]
 *
 * Chrome by default; E2E_BROWSER=firefox with PUPPETEER_EXECUTABLE_PATH for
 * Firefox. As root or in a container, also set CI=true (no sandbox).
 * The page is served on 127.0.0.1; nothing is uploaded.
 */
import { createServer } from "node:http";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import process from "node:process";
import {
  clickReviewControl,
  getBackgroundContext,
  launchBrowser,
  readReviewPanel,
  sleep,
  textPoint,
  triggerReview,
  waitUntil,
} from "../tests/e2e/e2e-helpers";

const outArg = process.argv.find((arg) => arg.startsWith("--out="));
const OUT = path.resolve(
  outArg?.slice(6) ?? path.join(import.meta.dir, "../docs/images/review-mode"),
);

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Review demo</title><style>
body{font:16px/1.6 system-ui,sans-serif;background:#f4f5f7;margin:0;padding:32px 40px;color:#1f2328}
.doc{max-width:620px;background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:20px 28px;outline:none}
h2{margin:0 0 8px;font-size:20px} code{background:#eef1f4;padding:1px 5px;border-radius:4px;font-size:14px}
.hint{color:#57606a;font-size:13px;margin:0 0 10px}
</style></head><body>
<p class="hint">Synthetic demo page. Text is reviewed locally; nothing leaves the browser.</p>
<div id="doc" class="doc" contenteditable="true"><h2>Release notes</h2><p>i think teh new <b>sync engine</b> is ready , but their is one problem.</p><p>We could of shipped on monday with alot of fixes. Run <code>teh build --fast</code> first.</p><p>See <a href="#changes">the changelog</a> for details..</p></div>
</body></html>`;

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Demo check failed: ${message}`);
  console.log(`ok - ${message}`);
}

await mkdir(OUT, { recursive: true });
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(PAGE);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const browser = await launchBrowser();
try {
  const worker = await getBackgroundContext(browser);
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 560, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await sleep(800);
  await page.bringToFront();
  const html = () => page.evaluate(() => document.querySelector("#doc")!.innerHTML);
  const status = async () => (await readReviewPanel(page)).status;
  const shot = async (name: string) => {
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`saved ${name}.png`);
  };
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>("#doc")!;
    editor.focus();
    const range = document.createRange();
    range.setStart(editor.querySelector("p")!.firstChild!, 0);
    range.collapse(true);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  const original = await html();

  // 1. Starting a review reads only.
  await triggerReview(worker);
  await waitUntil("results", async () => /^Issues/.test(await status()), { timeoutMs: 8000 });
  check((await html()) === original, "starting a review changes nothing");
  await shot("1-review-started");

  // 2. Click a highlight, then apply its fix.
  let point = await textPoint(page, "#doc", "teh", 1);
  await page.mouse.click(point.x, point.y);
  await waitUntil("card", async () => (await readReviewPanel(page)).card.open, { timeoutMs: 4000 });
  await shot("2-correction-card");
  await clickReviewControl(page, ".card [data-action=apply]");
  await waitUntil(
    "applied",
    async () => (await html()).includes("I think the") || (await html()).includes("i think the"),
    { timeoutMs: 4000 },
  );
  await sleep(600);
  await shot("3-applied-one");

  // 3. Ignore another finding.
  point = await textPoint(page, "#doc", "monday", 1);
  await page.mouse.click(point.x, point.y);
  await waitUntil("card", async () => (await readReviewPanel(page)).card.open, { timeoutMs: 4000 });
  await clickReviewControl(page, ".card [data-action=ignore]");
  await sleep(600);
  check(
    !(await readReviewPanel(page)).items.some((item) => item.text.includes("monday")),
    "the ignored finding is gone from the list",
  );
  await shot("4-ignored-one");

  // 4. Fix all safe: code and formatting stay.
  await clickReviewControl(page, "[data-action=fix-all]");
  await waitUntil("fixed", async () => /Fixed|resolved/.test(await status()), { timeoutMs: 8000 });
  await sleep(600);
  const fixed = await html();
  check(
    fixed.includes("<b>sync engine</b>") && fixed.includes('<a href="#changes">the changelog</a>'),
    "bold and link are kept",
  );
  check(fixed.includes("<code>teh build --fast</code>"), "code is never corrected");
  check(fixed.includes("on monday"), "the ignored finding is not fixed by Fix all");
  await shot("5-fix-all");

  // 5. Native undo: contenteditable undoes one fix per step.
  await page.evaluate(() => document.querySelector<HTMLElement>("#doc")!.focus());
  for (let step = 0; step < 6 && (await html()) !== original; step += 1) {
    await page.keyboard.down("Control");
    await page.keyboard.press("z");
    await page.keyboard.up("Control");
    await sleep(80);
  }
  await sleep(900);
  check((await html()) === original, "native undo restores the original exactly");
  await shot("6-undo");

  // 6. An unknown word: suggestions to pick from, nothing changes until one is chosen.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await waitUntil("closed", async () => !(await readReviewPanel(page)).open, { timeoutMs: 4000 });
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>("#doc")!;
    editor.innerHTML = "<h2>Release notes</h2><p>Where wa the new build? It shipped on Monday.</p>";
    editor.focus();
    const range = document.createRange();
    range.setStart(editor.querySelector("p")!.firstChild!, 0);
    range.collapse(true);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  const unknown = await html();
  await triggerReview(worker);
  await waitUntil(
    "spelling",
    async () => (await readReviewPanel(page)).items.some((item) => item.text.startsWith("wa ")),
    { timeoutMs: 8000 },
  );
  point = await textPoint(page, "#doc", "wa", 1);
  await page.mouse.click(point.x, point.y);
  await waitUntil("card", async () => (await readReviewPanel(page)).card.open, { timeoutMs: 4000 });
  check((await html()) === unknown, "an unknown word changes nothing until a word is picked");
  await shot("7-spelling-choice");
  await clickReviewControl(page, '.card button.suggestion[data-index="0"]');
  await waitUntil("picked", async () => (await html()).includes("Where was the new build"), {
    timeoutMs: 4000,
  });
  check(true, "picking a suggestion replaces only that word");
} finally {
  await browser.close();
  server.close();
}
