/** Operator-assisted smoke check on a NEW, EMPTY, DISPOSABLE real Google Doc.
 * No mocked API, test predictor, clipboard access or document-API edits are used.
 * The operator authenticates locally and explicitly approves persistence testing.
 */
import process from "node:process";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import puppeteer, { type Page } from "puppeteer";
import { readModel } from "../src/adapters/chrome/content-script/google-docs/GoogleDocsModel";

const args = process.argv.slice(2);
const value = (key: string) => args.find((arg) => arg.startsWith(`${key}=`))?.slice(key.length + 1);
if (args.includes("--help")) {
  console.log(`Real Google Docs operator-assisted smoke test (writes to the chosen document).

bun run test:e2e:docs:live -- \\
  --url=https://docs.google.com/document/d/DISPOSABLE_ID/edit \\
  --extension=/absolute/path/to/unpacked/chrome-build \\
  --profile=/absolute/path/to/DEDICATED-test-profile \\
  --allow-edits

Use a new empty, single-tab document and a dedicated browser profile. Configure
FluentTyper for English, enable it on docs.google.com, and enable Tab acceptance.
The browser must permit unpacked extensions (Chrome for Testing is suitable).
PUPPETEER_EXECUTABLE_PATH may specify your browser executable.
The script refuses nonempty documents. It checks a real offered completion,
native undo/redo, then asks you to verify the Saved-to-Drive indicator before reload.
It does not certify formatting, collaboration, every IME or other document topologies.
No Google credentials, cookies, document text or account data are uploaded.`);
  process.exit(0);
}

async function main(): Promise<void> {
  const urlValue = value("--url");
  const extensionValue = value("--extension");
  const profileValue = value("--profile");
  if (!args.includes("--allow-edits") || !urlValue || !extensionValue || !profileValue) {
    throw new Error(
      "Explicit --allow-edits, --url, --extension and --profile are required. Use --help.",
    );
  }
  const url = new URL(urlValue);
  if (
    url.origin !== "https://docs.google.com" ||
    !/^\/document\/(?:u\/\d+\/)?d\/[\w-]+\/edit$/.test(url.pathname)
  ) {
    throw new Error("A real Google Docs document edit URL is required.");
  }
  url.searchParams.set("fluentTyperDocs", "1");
  const extension = path.resolve(extensionValue);
  const profile = path.resolve(profileValue);
  await mkdir(profile, { recursive: true });
  const report: { checks: Array<{ name: string; status: string }>; error?: string } = {
    checks: [],
  };
  const cli = createInterface({ input: process.stdin, output: process.stdout });
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: profile,
    enableExtensions: [extension],
  });
  try {
    const page = await browser.newPage();
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    await cli.question(
      "Sign in locally if necessary. Set up FluentTyper, open this disposable document, and click its empty writing area. Then press Enter here. ",
    );
    const current = new URL(page.url());
    if (
      current.origin !== url.origin ||
      current.pathname !== url.pathname ||
      current.searchParams.get("fluentTyperDocs") !== "1"
    ) {
      throw new Error(
        "The selected page is not the specified opted-in test document. No typing was attempted.",
      );
    }
    const before = await read(page);
    if (before.text !== "" || before.anchor !== before.focus) {
      throw new Error("Refusing to edit: the document is not empty with a collapsed caret.");
    }
    report.checks.push({ name: "real annotated API and empty document", status: "passed" });
    const frame = await page.$("iframe.docs-texteventtarget-iframe");
    const editor = await frame?.contentFrame();
    if (!editor) throw new Error("Docs input frame is unavailable.");
    await page.bringToFront();
    await editor.evaluate(() => {
      const target = document.querySelector<HTMLElement>('[contenteditable="true"]');
      if (!target) throw new Error("Docs input element is unavailable.");
      target.focus();
    });
    await page.keyboard.type("hel");
    await waitForText(page, "hel");
    await page.waitForFunction(
      () => {
        const frame = document.querySelector("iframe.docs-texteventtarget-iframe");
        const state = JSON.parse(frame?.getAttribute("data-ft-docs-key-state") ?? "null");
        return state && Array.isArray(state.keys) && state.keys.includes("Tab");
      },
      { timeout: 15000 },
    );
    const offered = await page.evaluate(() => {
      const menu = document.getElementById("ft-menu--1");
      const selected = menu?.shadowRoot?.querySelector(
        '[aria-selected="true"] .ft-suggestion-label',
      );
      if (menu && getComputedStyle(menu).display !== "none" && selected?.textContent)
        return selected.textContent;
      const ghost =
        document.querySelector<HTMLElement>(
          '.ft-suggestion-inline[data-ft-suggestion-owned="true"]',
        ) ?? document.querySelector<HTMLElement>(".ft-suggestion-inline");
      return ghost?.textContent ? "hel" + ghost.textContent : null;
    });
    if (!offered || offered === "hel")
      throw new Error("No actual, usable FluentTyper suggestion is visible.");
    await page.keyboard.press("Tab");
    await waitForText(page, offered);
    report.checks.push({ name: "actual prediction and Tab acceptance", status: "passed" });
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+z`);
    await waitForText(page, "hel");
    report.checks.push({ name: "native undo returns the typed trigger", status: "passed" });
    await page.keyboard.press(`${modifier}+Shift+z`);
    await waitForText(page, offered);
    report.checks.push({ name: "native redo restores the completion", status: "passed" });
    const saved = await cli.question(
      'Verify Google Docs shows the document saved to Drive. Type "saved" to allow reload; anything else stops without reloading: ',
    );
    if (saved.trim().toLowerCase() !== "saved")
      throw new Error("Persistence check not approved; document was not reloaded.");
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForText(page, offered);
    report.checks.push({
      name: "text persists after operator-confirmed save and reload",
      status: "passed",
    });
  } catch (error) {
    // Local diagnostic only. Do not publish a user's URL/account text in shared CI logs.
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await writeFile(
      path.join(profile, "fluenttyper-docs-smoke-report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    cli.close();
    await browser.close();
  }
  console.log(
    "The narrow real-document smoke checks passed. The full release matrix remains separate.",
  );
}

async function read(page: Page) {
  const value = await page.evaluate(async () => {
    const get = (
      window as unknown as {
        _docs_annotate_getAnnotatedText?: () => Promise<{
          getText(): unknown;
          getSelection(): unknown;
        }>;
      }
    )._docs_annotate_getAnnotatedText;
    if (typeof get !== "function")
      throw new Error("Annotated text capability is unavailable for this extension ID.");
    const api = await get();
    return { raw: api.getText(), selection: api.getSelection() };
  });
  const model = readModel(value.raw, value.selection);
  if (!model) throw new Error("Unsupported or unavailable Google Docs text/selection metadata.");
  return model;
}
async function waitForText(page: Page, expected: string): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await read(page)).text === expected) return;
    } catch {
      // A reload can temporarily make the capability unavailable. No edits are retried.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    "Expected logical text was not observed; no automatic retry or repair was attempted.",
  );
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
