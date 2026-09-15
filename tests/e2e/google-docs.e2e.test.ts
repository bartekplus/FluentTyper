import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import puppeteer, { type Browser, type Page, type CDPSession } from "puppeteer";
import { waitUntil } from "./e2e-helpers";

let browser: Browser;
let page: Page;
let cdp: CDPSession;
let isolated: number;

let mainCode: string;
let controllerCode: string;
const fixturePath = `${import.meta.dir}/fixtures/google-docs/`;
async function evaluate<T>(expression: string): Promise<T> {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    contextId: isolated,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value as T;
}
async function model(): Promise<{ text: string; pastes: number }> {
  return page.evaluate(
    () => (window as unknown as { model: { text: string; pastes: number } }).model,
  );
}
async function seed(
  text: string,
  predictions: string[],
  options: object = {},
  anchor = text.length,
  focus = anchor,
) {
  await evaluate(
    `predictions=${JSON.stringify(predictions)};events=[];requests=[];startDocs(${JSON.stringify(options)});`,
  );
  await page.evaluate(
    (state) => {
      const f = window as unknown as {
        setModel: (text: string, a: number, f: number) => void;
        focusEditor: () => void;
      };
      f.setModel(state.text, state.anchor, state.focus);
      f.focusEditor();
    },
    { text, anchor, focus },
  );
  await evaluate("docs.triggerActiveSuggestion()");
  await waitUntil("Docs suggestions", () =>
    evaluate<boolean>("document.querySelector('iframe').hasAttribute('data-ft-docs-key-state')"),
  );
}
async function expectText(text: string) {
  await waitUntil("verified model text", async () => (await model()).text === text);
}

describe("Google Docs cross-world fixture (not live Docs)", () => {
  beforeAll(async () => {
    const build = async (entry: string) => {
      const result = await Bun.build({
        entrypoints: [fixturePath + entry],
        target: "browser",
        format: "iife",
        // Resolve the repository alias explicitly in the test-runner build context.
        plugins: [
          {
            name: "fixture-repository-alias",
            setup(build) {
              build.onResolve({ filter: /^@core\// }, (args) => ({
                path: Bun.resolveSync(
                  `./src/core/${args.path.slice(6)}`,
                  `${import.meta.dir}/../..`,
                ),
              }));
            },
          },
        ],
      });
      if (!result.success) throw new Error(result.logs.join("\n"));
      return result.outputs[0].text();
    };
    mainCode = await build("main.ts");
    controllerCode = await build("controller.ts");

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  });
  beforeEach(async () => {
    if (page) await page.close();
    page = await browser.newPage();
    await page.setContent(await Bun.file(fixturePath + "editor.html").text());
    await page.addScriptTag({ content: mainCode });
    await page.frames()[1].addScriptTag({ content: mainCode });
    cdp = await page.createCDPSession();
    const { frameTree } = await cdp.send("Page.getFrameTree");
    isolated = (
      await cdp.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "fluenttyper-fixture",
      })
    ).executionContextId;
    await evaluate(controllerCode);
  });
  afterAll(async () => {
    await browser?.close();
  });
  test("real typing crosses worlds and Tab commits exactly once", async () => {
    await evaluate('predictions=["hello"]');
    await page.keyboard.type("hel");
    await waitUntil("completion", () =>
      evaluate<boolean>("document.querySelector('iframe').hasAttribute('data-ft-docs-key-state')"),
    );
    await page.keyboard.press("Tab");
    await expectText("hello");
    await waitUntil("accepted statistics", () => evaluate<boolean>('events.includes("accepted")'));
    expect((await model()).pastes).toBe(1);
    expect((await evaluate<string[]>("events")).filter((v) => v === "accepted")).toHaveLength(1);
  });
  test("visible suggestions remain usable across repeated snapshot refreshes", async () => {
    await seed("hel", ["hello"]);
    // Model-driven refreshes, not a fixed sleep: exceed the bridge's eight-token cache.
    for (let index = 0; index < 12; index += 1) await evaluate("docs.refresh()");
    await page.keyboard.press("Tab");
    await expectText("hello");
    expect((await model()).pastes).toBe(1);
  });
  test("non-prefix spelling and mid-word replacement", async () => {
    await seed("hellp world", ["hello"], {}, 3);
    await page.keyboard.press("Tab");
    await expectText("hello world");
  });
  test("title and comment fields retain the ordinary FluentTyper helper", async () => {
    await evaluate('predictions=["hello"]');
    for (const selector of ["#title", "#comment"]) {
      await page.click(selector);
      await page.keyboard.type("hel");
      await waitUntil("generic popup", () =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>('[id^="ft-menu-"]')).some(
            (menu) => menu.id !== "ft-menu--1" && menu.style.display === "block",
          ),
        ),
      );
      await page.keyboard.press("Tab");
      await waitUntil("generic completion", () =>
        page.$eval(
          selector,
          (el) => (el as HTMLInputElement | HTMLTextAreaElement).value === "hello",
        ),
      );
    }
    expect((await model()).text).toBe("");
    expect((await model()).pastes).toBe(0);
  });
  test("the shared menu honors existing theme variables", async () => {
    await page.evaluate(() => {
      document.documentElement.style.setProperty(
        "--ft-theme-suggestion-bg-light",
        "rgb(12, 34, 56)",
      );
    });
    await seed("hel", ["hello"]);
    expect(
      await page.$eval(
        "#ft-menu--1",
        (el) =>
          getComputedStyle(el.shadowRoot!.querySelector(".ft-suggestion-panel")!).backgroundColor,
      ),
    ).toBe("rgb(12, 34, 56)");
  });
  test("digit shortcuts select the requested suggestion", async () => {
    await seed("hel", ["hello", "help"]);
    await page.keyboard.press("2");
    await expectText("help");
  });
  test("arrow navigation and Enter acceptance", async () => {
    await seed("hel", ["hello", "help"]);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expectText("help");
  });
  test("space acceptance follows the configured setting", async () => {
    await seed("hel", ["hello "], { autocomplete: true });
    await page.keyboard.press("Space");
    await expectText("hello ");
  });
  test("multiline snippets preserve their line breaks", async () => {
    await seed("brb", ["Hello,\n\nBartosz\n"]);
    await page.keyboard.press("Tab");
    await expectText("Hello,\n\nBartosz\n");
  });
  test("next-word prediction uses the shared coordinator", async () => {
    await seed("Hello ", ["world "]);
    await page.keyboard.press("Tab");
    await expectText("Hello world ");
    expect((await evaluate<Array<{ text: string }>>("requests")).at(-1)?.text).toContain("Hello ");
  });
  test("inline mode renders an owned ghost and accepts it", async () => {
    await seed("hel", ["hello"], { inline_suggestion: true });
    expect(await page.$(".ft-suggestion-inline")).not.toBeNull();
    expect(
      await page.$eval(".ft-suggestion-inline", (el) => parseFloat(getComputedStyle(el).maxWidth)),
    ).toBeGreaterThan(20);
    expect(await page.$eval(".ft-suggestion-inline", (el) => getComputedStyle(el).whiteSpace)).toBe(
      "pre",
    );
    await page.keyboard.press("Tab");
    await expectText("hello");
  });
  test("inline spelling fallback stays selectable", async () => {
    await seed("helo", ["hello"], { inline_suggestion: true });
    expect(await page.$(".ft-suggestion-inline")).toBeNull();
    await page.keyboard.press("Tab");
    await expectText("hello");
  });
  test("explicit noncollapsed selection replacement", async () => {
    await seed("The bad phrase.", ["good sentence"], {}, 14, 4);
    await page.keyboard.press("Tab");
    await expectText("The good sentence.");
  });
  test("mouse acceptance retains editor focus", async () => {
    await seed("hel", ["hello"]);
    await page.locator("#ft-menu--1 >>> li").click();
    await expectText("hello");
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
  });
  test("ignored writes are never learned or retried", async () => {
    await seed("helo", ["hello"]);
    await page.evaluate(() => {
      (window as unknown as { model: { mode: string } }).model.mode = "ignore";
    });
    await page.keyboard.press("Tab");
    await waitUntil(
      "unverified notice",
      async () =>
        (await page.$eval('[role="status"]', (el) => el.textContent))?.includes(
          "could not be verified",
        ) ?? false,
    );
    expect((await evaluate<string[]>("events")).includes("accepted")).toBe(false);
    expect((await model()).pastes).toBe(1);
  });
  test("native undo observation reverses personalization once", async () => {
    await seed("helo", ["hello"]);
    await page.keyboard.press("Tab");
    await expectText("hello");
    await waitUntil("learning", () => evaluate<boolean>('events.includes("learned")'));
    await page.evaluate(() =>
      (window as unknown as { setModel: (text: string) => void }).setModel("helo"),
    );
    await waitUntil("reversal", () => evaluate<boolean>('events.includes("reverted")'));
    expect((await evaluate<string[]>("events")).filter((v) => v === "reverted")).toHaveLength(1);
  });
  test("IME composition suppresses accepting suggestions", async () => {
    await seed("hel", ["hello"]);
    await page
      .frames()[1]
      .evaluate(() =>
        document.activeElement!.dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true }),
        ),
      );
    expect(
      await page.$eval("iframe", (frame) => frame.hasAttribute("data-ft-docs-key-state")),
    ).toBe(false);
  });
  test("the shared local grammar catalog performs automatic correction", async () => {
    await evaluate(
      'predictions=[];startDocs({enabledGrammarRules:["englishTypoWhitelistCorrection"]})',
    );
    await page.keyboard.type("teh ");
    await expectText("the ");
    expect((await evaluate<string[]>("events")).includes("accepted")).toBe(false);
  });
  test("multiple visible carets use a fixed palette without choosing a collaborator", async () => {
    await page.evaluate(() => {
      const remote = document.querySelector(".kix-cursor-caret")!.cloneNode(true) as HTMLElement;
      remote.style.left = "500px";
      document.body.appendChild(remote);
    });
    await seed("hel", ["hello"], { inline_suggestion: true });
    expect(await page.$(".ft-suggestion-inline")).toBeNull();
    await page.keyboard.press("Tab");
    await expectText("hello");
  });
  test("RTL text uses logical offsets and a direction-aware menu", async () => {
    await page.$eval(".kix-cursor-caret", (element) => {
      (element as HTMLElement).style.direction = "rtl";
    });
    await seed("של", ["שלום"], { inline_suggestion: true });
    await page.keyboard.press("Tab");
    await expectText("שלום");
  });
  test("offline fixture uses no network service for local suggestions", async () => {
    await page.setOfflineMode(true);
    await seed("hel", ["hello"]);
    await page.keyboard.press("Tab");
    await expectText("hello");
  });
  test("document tab changes invalidate the old snapshot before editing", async () => {
    await seed("helo", ["hello"]);
    await page.evaluate(() => {
      (window as unknown as { fixtureScope: string }).fixtureScope += "&changed-tab=2";
    });
    await page.keyboard.press("Tab");
    await waitUntil("fresh prediction after rejection", () =>
      evaluate<boolean>("requests.length > 1"),
    );
    expect((await model()).pastes).toBe(0);
  });
  test("late acknowledged writes recover and learn only once", async () => {
    await seed("helo", ["hello"]);
    await page.evaluate(() => {
      (window as unknown as { model: { mode: string } }).model.mode = "ignore";
    });
    await page.keyboard.press("Tab");
    await waitUntil(
      "uncertain edit",
      async () =>
        (await page.$eval('[role="status"]', (el) => el.textContent))?.includes(
          "could not be verified",
        ) ?? false,
    );
    await page.evaluate(() =>
      (window as unknown as { setModel: (text: string) => void }).setModel("hello"),
    );
    await waitUntil("late acceptance", () => evaluate<boolean>('events.includes("accepted")'));
    expect((await model()).pastes).toBe(1);
    expect((await evaluate<string[]>("events")).filter((v) => v === "accepted")).toHaveLength(1);
  });
  test("disposing removes UI and keyboard interception", async () => {
    await seed("hel", ["hello"]);
    await evaluate("docs.dispose()");
    expect(await page.$("#ft-menu--1")).toBeNull();
    expect(
      await page.$eval("iframe", (frame) => frame.hasAttribute("data-ft-docs-key-state")),
    ).toBe(false);
  });
});
