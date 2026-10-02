import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  launchBrowser,
  getBackgroundContext,
  openExtensionPage,
  sleep,
  waitUntil,
  readReviewPanel,
  waitForReview,
  clickReviewControl,
  textPoint,
} from "../../../tests/e2e/e2e-helpers";
const out = resolve(import.meta.dir, "../assets/ui");
await mkdir(out, { recursive: true });
await mkdir(resolve(import.meta.dir, "../evidence"), { recursive: true });
const PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><title>FluentTyper synthetic composer</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f5fb;color:#0f172a;font:16px/1.5 system-ui,sans-serif;padding:22px 26px}.composer{background:white;border:1px solid #cbd5e1;border-radius:14px;overflow:hidden;width:580px;box-shadow:0 8px 24px #0f172a0b}.top{padding:15px 22px;border-bottom:1px solid #e2e8f0;font-weight:600;font-size:16px;display:flex;justify-content:space-between}.top span{color:#64748b;font-weight:400}.meta{padding:12px 22px;font-size:14px;color:#475569;border-bottom:1px solid #e2e8f0}.meta b{color:#0f172a;margin-right:18px}#doc{font:26px/1.55 system-ui,sans-serif;min-height:260px;padding:20px 22px;outline:none;white-space:pre-wrap}.bottom{padding:10px 22px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b}.subject{font-size:15px;color:#334155}</style><body><main class="composer"><div class="top">New message <span>Draft</span></div><div class="meta"><b>To</b>Demo team<div class="subject"><b>Subject</b>Quick update</div></div><div id="doc" contenteditable="true" spellcheck="false"></div><div class="bottom">Message composer · synthetic example</div></main></body></html>`;
const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(PAGE);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as AddressInfo).port;
const browser = await launchBrowser();
const evidence = {
  sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  launcher: { x: 0, y: 0 },
  highlightClick: { x: 0, y: 0 },
  apply: null as { x: number; y: number } | null,
  fixAll: null as { x: number; y: number } | null,
  captureVersion: "2026.27.0",
  synthetic: true,
  viewport: { width: 1000, height: 480, deviceScaleFactor: 2 },
  states: [] as Record<string, unknown>[],
  network: [] as Record<string, unknown>[],
};
try {
  const worker = await getBackgroundContext(browser);
  const options = await openExtensionPage(browser, worker, "options/options.html");
  const config = async (values: Record<string, unknown>) => {
    await options.evaluate(async (values) => {
      const data = Object.fromEntries(
        Object.entries(values).map(([k, v]) => ["store.settings." + k, JSON.stringify(v)]),
      );
      await chrome.storage.local.set(data);
      await chrome.runtime.sendMessage({ command: "CMD_OPTIONS_PAGE_CONFIG_CHANGE", context: {} });
    }, values);
    await sleep(450);
  };
  await config({
    language: "en_US",
    enabled_languages: ["en_US", "textExpander"],
    minWordLengthToPredict: 2,
    numSuggestions: 3,
    inline_suggestion: false,
    autocompleteOnTab: true,
    textExpansions: [["callMe", "Call me back once you're free"]],
    localAiReviewEnabled: false,
    localAiSetupOfferDismissed: true,
  });
  const page = await browser.newPage();
  await page.setViewport(evidence.viewport);
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  page.on("request", (req) =>
    evidence.network.push({ url: req.url(), method: req.method(), type: req.resourceType() }),
  );
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await sleep(1000);
  await page.bringToFront();
  const text = () => page.$eval("#doc", (el) => (el as HTMLElement).innerText);
  const reset = async (t: string) => {
    await page.evaluate((t) => {
      const d = document.querySelector<HTMLElement>("#doc")!;
      d.textContent = t;
      d.focus();
      const r = document.createRange();
      r.selectNodeContents(d);
      r.collapse(false);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    }, t);
    await sleep(300);
  };
  const shot = async (name: string, extra: Record<string, unknown> = {}) => {
    await sleep(150);
    await page.screenshot({ path: resolve(out, name + ".png") });
    evidence.states.push({ name, text: await text(), ...extra });
    console.log(name, JSON.stringify(await text()));
  };
  const suggestions = () =>
    page.evaluate(() => {
      const roots: ParentNode[] = [document];
      for (const el of document.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
      return roots
        .flatMap((root) =>
          Array.from(root.querySelectorAll("li[data-index]")).map(
            (li) => li.querySelector(".ft-suggestion-label")?.textContent ?? li.textContent,
          ),
        )
        .filter(Boolean);
    });
  await reset("Thanks for the ");
  await page.keyboard.type("repor", { delay: 100 });
  const actual = await waitUntil(
    "actual autocomplete",
    async () => {
      const s = await suggestions();
      return s.length ? s : false;
    },
    { timeoutMs: 10000 },
  );
  await shot("01-autocomplete", { suggestions: actual });
  await page.keyboard.press("Tab");
  await sleep(500);
  await shot("02-autocomplete-accepted");
  if (
    !(await text())
      .toLowerCase()
      .startsWith("thanks for the " + String(actual[0]).trim().toLowerCase())
  )
    throw new Error("Tab did not insert the actual first suggestion");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");
  let charIndex = 0;
  for (const character of ".\nI'll review it today.") {
    await page.keyboard.type(character);
    await page.keyboard.press("Escape");
    await shot("typing-" + String(charIndex++).padStart(2, "0"));
  }
  await shot("02c-compose");
  await reset("");
  await page.keyboard.type("callMe", { delay: 90 });
  const snippet = await waitUntil(
    "snippet",
    async () => {
      const s = await suggestions();
      return s.some((x) => x?.includes("Call me back")) ? s : false;
    },
    { timeoutMs: 10000 },
  );
  await shot("03-snippet", { suggestions: snippet });
  await page.keyboard.press("Tab");
  await sleep(500);
  await shot("04-snippet-expanded");
  if ((await text()).trim() !== "Call me back once you're free")
    throw new Error("Snippet acceptance mismatch");
  await page.keyboard.press("Escape");
  await reset("i received teh report.We should of reviewed it on monday.");
  await sleep(900);
  await shot("05-review-before");
  // Native in-field button, with an actual mouse click.
  const launcher = await waitUntil(
    "Review launcher",
    () =>
      page.evaluate(() => {
        const b = document
          .querySelector("[data-fluenttyper-review-launcher]")
          ?.shadowRoot?.querySelector("button");
        if (!b || b.hidden) return false;
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }),
    { timeoutMs: 6000 },
  );
  evidence.launcher = launcher;
  await page.mouse.click(launcher.x, launcher.y);
  await waitForReview(page, "native diagnostics", (p) => p.items.length > 0);
  await shot("06-review-highlights", { panel: await readReviewPanel(page) });
  if ((await text()) !== "i received teh report.We should of reviewed it on monday.")
    throw new Error("Opening Review changed draft");
  const p = await textPoint(page, "#doc", "teh", 1);
  evidence.highlightClick = p;
  await page.mouse.click(p.x, p.y);
  await waitForReview(page, "correction card", (p) => p.card.open);
  await shot("07-review-card", { panel: await readReviewPanel(page) });
  const controlPoint = async (selector: string) =>
    page.evaluate((selector) => {
      const e = document
        .querySelector("[data-fluenttyper-review]")
        ?.shadowRoot?.querySelector(selector);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, selector);
  evidence.apply = await controlPoint(".card [data-action=apply]");
  await clickReviewControl(page, ".card [data-action=apply]");
  await sleep(700);
  await shot("08-review-one-fixed", { panel: await readReviewPanel(page) });
  evidence.fixAll = await controlPoint("[data-action=fix-all]");
  await clickReviewControl(page, "[data-action=fix-all]");
  await sleep(1000);
  await shot("09-review-safe-fixed", { panel: await readReviewPanel(page) });
  const remaining = await readReviewPanel(page);
  if (remaining.items.length)
    throw new Error("Unexpected remaining findings: " + JSON.stringify(remaining.items));
  if ((await text()).trim() !== "I received the report. We should have reviewed it on Monday.")
    throw new Error("Final draft mismatch: " + (await text()));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await sleep(500);
  await shot("12-clean-final");
  await writeFile(
    resolve(import.meta.dir, "../evidence/interactions.json"),
    JSON.stringify(evidence, null, 2),
  );
} finally {
  await browser.close();
  server.close();
}
