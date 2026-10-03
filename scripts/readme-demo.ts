/** Capture real FluentTyper UI on a local page with synthetic text.
 * Run: bun run build && bun scripts/readme-demo.ts
 * Screenshots and provenance go to docs/images/readme/. No uploads.
 */
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import packageMetadata from "../package.json";
import {
  launchBrowser,
  getBackgroundContext,
  openExtensionPage,
  waitUntil,
  triggerReview,
  readReviewPanel,
  textPoint,
  clickReviewControl,
} from "../tests/e2e/e2e-helpers";

const output = resolve("docs/images/readme");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Writing example</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#202328;font:18px/1.6 system-ui,sans-serif;padding:28px 36px}main{width:560px;background:#fff;border:1px solid #d9dde3;border-radius:14px;padding:22px 28px;min-height:268px}h1{margin:0 0 20px;font-size:16px;font-weight:600;color:#57606a}#draft{font:24px/1.65 system-ui,sans-serif;min-height:150px;outline:none;white-space:pre-wrap}p{margin:0 0 16px}
</style><main><h1>A note to the team</h1><div id="draft" contenteditable="true" spellcheck="false"></div></main></html>`;
await mkdir(output, { recursive: true });
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (!address || typeof address === "string") throw new Error("The local server has no port.");
const browser = await launchBrowser();
const states: Record<string, unknown>[] = [];
try {
  const worker = await getBackgroundContext(browser);
  const options = await openExtensionPage(browser, worker, "options/options.html");
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 340, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  const configure = async (inline: boolean) => {
    await options.evaluate(async (inline) => {
      const settings = {
        language: "en_US",
        enabled_languages: ["en_US", "textExpander"],
        minWordLengthToPredict: 2,
        numSuggestions: 3,
        inline_suggestion: inline,
        autocompleteOnTab: true,
        insertSpaceAfterAutocomplete: false,
        localAiReviewEnabled: false,
        localAiSetupOfferDismissed: true,
      };
      await chrome.storage.local.set(
        Object.fromEntries(
          Object.entries(settings).map(([key, value]) => [
            "store.settings." + key,
            JSON.stringify(value),
          ]),
        ),
      );
      await chrome.runtime.sendMessage({ command: "CMD_OPTIONS_PAGE_CONFIG_CHANGE", context: {} });
    }, inline);
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle0" });
    await page.bringToFront();
  };
  const setDraft = async (text: string) => {
    await page.$eval(
      "#draft",
      (element, text) => {
        element.textContent = text;
        (element as HTMLElement).focus();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
      },
      text,
    );
  };
  const text = () => page.$eval("#draft", (element) => element.textContent ?? "");
  const capture = async (name: string, extra: Record<string, unknown>) => {
    await page.screenshot({ path: resolve(output, name + ".png") });
    states.push({ name, text: await text(), ...extra });
  };
  for (const inline of [false, true]) {
    await configure(inline);
    await setDraft("Thanks for the ");
    await page.keyboard.type(inline ? "rep" : "repor", { delay: 100 });
    const suggestion = await waitUntil(
      "word suggestion",
      async () => {
        const value = await page.evaluate((inline) => {
          if (inline) return document.querySelector(".ft-suggestion-inline")?.textContent ?? "";
          const roots: ParentNode[] = [document];
          for (const element of document.querySelectorAll("*"))
            if (element.shadowRoot) roots.push(element.shadowRoot);
          return roots
            .flatMap((root) =>
              Array.from(root.querySelectorAll("li[data-index] .ft-suggestion-label")),
            )
            .map((element) => element.textContent)
            .join(" | ");
        }, inline);
        return value.trim() || false;
      },
      { timeoutMs: 10000 },
    );
    await capture(inline ? "inline" : "popup", { suggestion });
    const before = await text();
    await page.keyboard.press("Tab");
    await waitUntil("accepted completion", async () => (await text()) !== before, {
      timeoutMs: 5000,
    });
    const accepted = await text();
    if (!accepted.startsWith("Thanks for the report"))
      throw new Error("Tab did not accept the report completion.");
    states.push({ name: inline ? "inline-accepted" : "popup-accepted", text: accepted });
  }
  await configure(false);
  await page.setViewport({ width: 1000, height: 460, deviceScaleFactor: 2 });
  await setDraft("Thanks for teh report.\nWe can discuss it on monday.");
  const original = await text();
  await triggerReview(worker);
  await waitUntil(
    "Review results",
    async () => {
      const panel = await readReviewPanel(page);
      return panel.items.length > 0 && panel.spelling !== "checking";
    },
    { timeoutMs: 10000 },
  );
  if ((await text()) !== original) throw new Error("Opening Review changed the draft.");
  const point = await textPoint(page, "#draft", "teh", 1);
  await page.mouse.click(point.x, point.y);
  await waitUntil("correction card", async () => (await readReviewPanel(page)).card.open);
  await capture("review", { panel: await readReviewPanel(page) });
  await clickReviewControl(page, ".card [data-action=apply]");
  await waitUntil("applied correction", async () =>
    (await text()).startsWith("Thanks for the report."),
  );
  states.push({ name: "review-applied", text: await text() });
  await writeFile(
    resolve(output, "capture.json"),
    JSON.stringify(
      {
        version: packageMetadata.version,
        sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        source: "Production Chrome build on a local synthetic page. Screenshots are unmodified.",
        browser: await browser.version(),
        states,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Captured popup, inline, and Review. All acceptance checks passed.");
} finally {
  await browser.close();
  server.close();
}
