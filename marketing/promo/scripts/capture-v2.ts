/**
 * Records the promo v2 product shots from the production build (synthetic text only).
 *
 *   cd ../.. && E2E_EXTENSION_PATH=$PWD/build bun marketing/promo/scripts/capture-v2.ts
 *
 * Every shot asserts the real product state first, so a changed behavior stops the run
 * instead of filming something the product no longer does. Local AI is recorded by
 * capture-ai.ts, WordPress by capture-wordpress.ts.
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import packageMetadata from "../../../package.json";
import {
  clickReviewControl,
  getBackgroundContext,
  launchBrowser,
  openExtensionPage,
  readReviewPanel,
  REVIEW_HOST_SELECTOR,
  sleep,
  textPoint,
  triggerReview,
  waitForReview,
  waitUntil,
} from "../../../tests/e2e/e2e-helpers";
import { COMPOSER_PAGE } from "./composer";
import { isReviewWriteComplete } from "./review-write-state.mjs";

const ROOT = resolve(import.meta.dir, "../../..");
const OUT = resolve(import.meta.dir, "../assets/ui");
await mkdir(OUT, { recursive: true });
await mkdir(resolve(import.meta.dir, "../evidence"), { recursive: true });

// A synthetic notes app around the real Slate editor library from the e2e fixtures.
const slate = await Bun.build({
  entrypoints: [resolve(ROOT, "tests/e2e/fixtures/slate-test-editor.ts")],
  target: "browser",
  format: "iife",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!slate.success) throw new Error(slate.logs.join("\n"));
const SLATE_JS = await slate.outputs[0].text();
const NOTES_PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Notes</title><style>
*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:#fbfbfd;color:#1d1d1f;font:16px/1.5 system-ui,sans-serif;display:grid;grid-template-columns:260px 1fr}
aside{border-right:1px solid #e5e5ea;padding:28px 22px;color:#6e6e73;font-size:15px;display:grid;align-content:start;gap:14px}
aside b{color:#1d1d1f;font-size:13px;letter-spacing:.06em;text-transform:uppercase}aside .on{color:#1d1d1f;font-weight:600}
main{padding:40px 48px}h1{font-size:28px;margin:0 0 18px;letter-spacing:-0.02em}
#test-slate [contenteditable]{font:30px/1.5 system-ui,sans-serif;outline:none;min-height:300px;letter-spacing:-0.01em}
</style><body><aside><b>Notes</b><span class="on">Launch checklist</span><span>Team sync</span><span>Ideas</span></aside>
<main><h1>Launch checklist</h1><div id="test-slate"></div></main><script>${SLATE_JS.replace(/<\/script/g, "<\\/script")}</script></body></html>`;

const pages: Record<string, string> = { "/": COMPOSER_PAGE, "/notes": NOTES_PAGE };
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(pages[req.url ?? "/"] ?? COMPOSER_PAGE);
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const evidence = {
  sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  captureVersion: packageMetadata.version,
  synthetic: true,
  viewport: { width: 1200, height: 640, deviceScaleFactor: 2 },
  points: {} as Record<string, { x: number; y: number } | null>,
  states: [] as Record<string, unknown>[],
  network: [] as Record<string, unknown>[],
};
const browser = await launchBrowser();
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
    enabled_languages: ["en_US", "es_ES", "de_DE", "pl_PL", "el_GR", "ar_SA", "textExpander"],
    minWordLengthToPredict: 2,
    numSuggestions: 3,
    inline_suggestion: false,
    autocompleteOnTab: true,
    textExpansions: [["callMe", "Call me back once you're free."]],
    reviewRuleOverrides: {},
    localAiReviewEnabled: false,
    localAiSetupOfferDismissed: true,
  });
  const newTab = async () => {
    const tab = await browser.newPage();
    await tab.setViewport(evidence.viewport);
    await tab.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    tab.on("request", (req) =>
      evidence.network.push({ url: req.url(), method: req.method(), type: req.resourceType() }),
    );
    return tab;
  };
  let page = await newTab();
  const open = async (path: string, field: string) => {
    await page.goto(origin + path, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(field);
    await sleep(1000);
    await page.bringToFront();
  };
  let field = "#doc";
  await open("/", field);
  const text = () => page.$eval(field, (el) => (el as HTMLElement).innerText.replace(/\n$/, ""));
  const reset = async (value: string) => {
    await page.evaluate(
      (selector, value) => {
        const doc = document.querySelector<HTMLElement>(selector)!;
        doc.textContent = value;
        doc.focus();
        const range = document.createRange();
        range.selectNodeContents(doc);
        range.collapse(false);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
      },
      field,
      value,
    );
    await sleep(300);
  };
  const shot = async (name: string, extra: Record<string, unknown> = {}) => {
    await sleep(150);
    await page.screenshot({ path: resolve(OUT, name + ".png") });
    evidence.states.push({ name, text: await text(), ...extra });
    console.log(name, JSON.stringify(await text()));
  };
  const panelShot = async (name: string) => {
    const panel = await page.evaluateHandle(
      (host) => document.querySelector(host)?.shadowRoot?.querySelector(".panel"),
      REVIEW_HOST_SELECTOR,
    );
    await (panel.asElement() as import("puppeteer").ElementHandle<Element>).screenshot({
      path: resolve(OUT, name + ".png"),
    });
    console.log(name, "(panel)");
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
        .filter(Boolean)
        .map((s) => String(s).trim());
    });
  const waitSuggestions = (label: string, wanted: (list: string[]) => boolean) =>
    waitUntil(
      label,
      async () => {
        const list = await suggestions();
        return wanted(list) ? list : false;
      },
      { timeoutMs: 10000 },
    );
  const inlineGhost = () =>
    page.evaluate(
      () => document.querySelector('[data-ft-suggestion-role="inline"]')?.textContent ?? "",
    );
  const closeReview = async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await sleep(400);
  };
  const expectText = async (want: string) => {
    const got = await text();
    if (got !== want)
      throw new Error(`Expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };

  // Frame 2: "This message was typed with Tab."
  await reset("This ");
  await page.keyboard.type("mes", { delay: 110 });
  const opening = await waitSuggestions("opening popup", (list) => list.includes("message"));
  await shot("v2-open-popup", { suggestions: opening });
  while ((await suggestions())[0] !== "message") await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await sleep(400);
  await page.keyboard.press("Escape");
  if (!(await text()).startsWith("This message")) throw new Error("Tab did not insert message");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(" was typed with Tab.", { delay: 40 });
  await page.keyboard.press("Escape");
  await expectText("This message was typed with Tab.");
  await shot("v2-open-done");

  // Frame 3: popup on "Thanks for the rep".
  await reset("Thanks for the ");
  await page.keyboard.type("rep", { delay: 110 });
  const popup = await waitSuggestions("report popup", (list) => list[0] === "report");
  await shot("v2-popup", { suggestions: popup });
  await page.keyboard.press("Tab");
  await sleep(400);
  await page.keyboard.press("Escape");
  if (!(await text()).startsWith("Thanks for the report"))
    throw new Error("Tab did not insert report");
  await shot("v2-popup-accepted");
  await shot("v2-editor-mail");

  // Frame 4: inline mode.
  await config({ inline_suggestion: true });
  await reset("Thanks for the report.\nI'll review it ");
  await page.keyboard.type("tod", { delay: 110 });
  const ghost = await waitUntil(
    "inline ending",
    async () => {
      const now = await inlineGhost();
      if (process.env.PROMO_DEBUG) console.log("ghost:", JSON.stringify(now), await suggestions());
      return now.trim() === "ay" ? now : false;
    },
    { timeoutMs: 10000, intervalMs: 1000 },
  );
  await shot("v2-inline", { ghost });
  await page.keyboard.press("Tab");
  await sleep(400);
  await page.keyboard.press("Backspace");
  await page.keyboard.type(".");
  await page.keyboard.press("Escape");
  await expectText("Thanks for the report.\nI'll review it today.");
  await shot("v2-inline-accepted");

  // Frame 14: inline mode with the network off.
  await page.setOfflineMode(true);
  await reset("See you ");
  await page.keyboard.type("tomo", { delay: 110 });
  const offline = await waitUntil(
    "offline inline ending",
    async () => {
      const now = await inlineGhost();
      if (process.env.PROMO_DEBUG) console.log("offline ghost:", JSON.stringify(now));
      return now.trim() === "rrow" ? now : false;
    },
    { timeoutMs: 10000 },
  );
  await shot("v2-offline", { ghost: offline, offline: true });
  await page.keyboard.press("Escape");
  await page.setOfflineMode(false);
  await config({ inline_suggestion: false });

  // Frame 5: saved reply.
  await reset("");
  await page.keyboard.type("callMe", { delay: 90 });
  const snippet = await waitSuggestions("snippet", (list) =>
    list.some((s) => s.includes("Call me back")),
  );
  await shot("v2-snippet", { suggestions: snippet });
  await page.keyboard.press("Tab");
  await sleep(500);
  await page.keyboard.press("Escape");
  if ((await text()).trim() !== "Call me back once you're free.")
    throw new Error("Snippet mismatch");
  await shot("v2-snippet-expanded");

  // Frames 6–8: Review, opened by the keyboard command's own path (Alt+Shift+R).
  const draft = "i received teh report.We should of reviewed it on monday.";
  await reset(draft);
  await sleep(600);
  await triggerReview(worker);
  await waitForReview(page, "native diagnostics", (p) => p.items.length >= 4);
  await shot("v2-review-highlights", { panel: await readReviewPanel(page) });
  await expectText(draft);
  const teh = await textPoint(page, field, "teh", 1);
  evidence.points.teh = teh;
  await page.mouse.click(teh.x, teh.y);
  await waitForReview(page, "correction card", (p) => p.card.open);
  await shot("v2-review-card", { panel: await readReviewPanel(page) });
  const controlPoint = (selector: string) =>
    page.evaluate(
      (host, selector) => {
        const e = document.querySelector(host)?.shadowRoot?.querySelector(selector);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
      REVIEW_HOST_SELECTOR,
      selector,
    );
  evidence.points.apply = await controlPoint(".card [data-action=apply]");
  await clickReviewControl(page, ".card [data-action=apply]");
  const oneFixed = await waitUntil(
    "Apply result",
    async () => {
      const panel = await readReviewPanel(page);
      return isReviewWriteComplete(await text(), panel, draft.replace("teh", "the"), 4)
        ? panel
        : false;
    },
    { timeoutMs: 10000 },
  );
  await shot("v2-review-one-fixed", { panel: oneFixed });
  await panelShot("v2-review-panel");
  evidence.points.fixAll = await controlPoint("[data-action=fix-all]");
  await clickReviewControl(page, "[data-action=fix-all]");
  const clean = "I received the report. We should have reviewed it on Monday.";
  const allFixed = await waitUntil(
    "Fix all safe result",
    async () => {
      const panel = await readReviewPanel(page);
      return isReviewWriteComplete(await text(), panel, clean, 0) ? panel : false;
    },
    { timeoutMs: 10000 },
  );
  await shot("v2-review-safe-fixed", { panel: allFixed });
  await closeReview();

  // Frame 9: style advice (opt-in native check).
  await config({ reviewRuleOverrides: { styleRedundancy: true } });
  await reset("Enter your PIN at the ATM machine.");
  await triggerReview(worker);
  await waitForReview(page, "style finding", (p) => p.items.some((i) => i.category === "style"));
  await clickReviewControl(page, '.item[data-id*="styleRedundancy"]');
  const style = await waitForReview(page, "style card", (p) => p.card.open);
  await shot("v2-style-card", { panel: style });
  await closeReview();
  await config({ reviewRuleOverrides: {} });

  // Frame 10: every language, found by auto-detect.
  await config({ language: "auto_detect", fallbackLanguage: "en_US" });
  const stored = await options.evaluate(
    async () =>
      (await chrome.storage.local.get("store.settings.language"))["store.settings.language"],
  );
  console.log("language setting:", stored);
  await open("/", field);
  const languages: Array<[string, string, string]> = [
    ["es", "Spanish", "Gracias por el informe. Lo revisaré esta tarde con todo el equipo."],
    ["de", "German", "Danke für den Bericht. Ich sehe ihn mir heute Nachmittag mit dem Team an."],
    ["pl", "Polish", "Dziękuję za raport. Przejrzę go dziś po południu razem z całym zespołem."],
    ["el", "Greek", "Ευχαριστώ για την αναφορά. Θα την κοιτάξω σήμερα το απόγευμα με την ομάδα."],
    ["ar", "Arabic", "شكرًا على التقرير. سأراجعه اليوم بعد الظهر مع الفريق بأكمله."],
  ];
  for (const [code, name, sentence] of languages) {
    // Auto-detect learns a language per site and tab: each language gets a fresh tab
    // and no learned prior, as on a site where the user writes it first.
    await config({ autoLanguageSitePriors: {} });
    await page.close();
    page = await newTab();
    await open("/", field);
    await reset(sentence);
    await triggerReview(worker);
    const detected = await waitForReview(
      page,
      `${name} auto-detect`,
      // The page's detected language reaches Review as its language (menu: "Spanish").
      (p) => [name, `Auto detect: ${name}`].includes(p.language) && p.spelling === "done",
    );
    await shot(`v2-lang-${code}`, { panel: detected });
    await panelShot(`v2-lang-${code}-panel`);
    await closeReview();
  }
  await config({ language: "en_US" });

  // Frame 11: the notes app on the real Slate editor.
  field = "#test-slate [contenteditable]";
  await open("/notes", field);
  // Slate owns its text model: type everything, never set the DOM.
  await page.click(field);
  await page.keyboard.type("Share the launch ", { delay: 40 });
  await page.keyboard.press("Escape");
  await page.keyboard.type("rep", { delay: 110 });
  const notes = await waitSuggestions("notes popup", (list) => list.length > 0);
  await shot("v2-editor-notes", { suggestions: notes });

  await writeFile(
    resolve(import.meta.dir, "../evidence/interactions-v2.json"),
    JSON.stringify(evidence, null, 2),
  );
} finally {
  await browser.close();
  server.close();
}
