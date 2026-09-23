import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import puppeteer, { type Browser, type Page, type CDPSession } from "puppeteer";
import { waitUntil } from "./e2e-helpers";
import { GRAMMAR_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import { MAX_CONTEXT } from "../../src/adapters/chrome/content-script/google-docs/GoogleDocsModel";

/**
 * [rule id, keys typed, resulting Docs text, resulting text on an ordinary page].
 *
 * Expectations are the observed behaviour of both paths, not a restatement of what each
 * rule does: the point is that Google Docs corrects exactly what a normal field corrects.
 * The fourth entry is present only where the two legitimately differ, and says why.
 */
const GRAMMAR_CASES: Array<[string, string, string] | [string, string, string, string]> = [
  ["capitalizeSentenceStart", "hello. world ", "Hello. World "],
  ["capitalizeAfterLineBreak", "hello\nworld ", "hello\nWorld "],
  ["englishPronounICapitalization", "i am here ", "I am here "],
  ["englishContractionNormalization", "im ready ", "I'm ready "],
  ["englishTypoWhitelistCorrection", "teh cat ", "the cat "],
  ["doubleSpaceToPeriod", "Hello  ", "Hello. "],
  ["englishModalOfCorrection", "could of gone ", "could have gone "],
  ["englishYourWelcomeCorrection", "your welcome.", "you're welcome."],
  ["englishTheirThereBeVerb", "their is one ", "there is one "],
  ["englishAlotCorrection", "alot ", "a lot "],
  ["englishPronounVerbWhitelistAgreement", "you was late ", "you were late "],
  ["englishArticleAnCorrection", "a hour ", "an hour "],
  // Only the unambiguous clock form compacts; "3. 14" is deliberately left alone.
  ["technicalTokenCompaction", "at 12: 30 ", "at 12:30 "],
  ["mathOperatorSpacing", "x=y ", "x = y "],
  // Docs converts every pasted NBSP to a plain space, so the rule's non-breaking space
  // cannot survive the only edit channel Docs offers. A plain space is the best available.
  ["measurementUnitFormatting", "10kg ", "10 kg ", "10\u00a0kg "],
  ["currencySpacing", "250EUR ", "250 EUR ", "250\u00a0EUR "],
  ["slashContextSpacing", "https: //x ", "https://x "],
  ["openingBracketSpacing", "if(x ", "if (x "],
  ["closingBracketSpacing", "Hello (world )", "Hello (world)"],
  // The space after the comma is a deferred repair that needs a typing pause, so both
  // paths stop here while text keeps arriving. Asserted to keep the two in step.
  ["commaPeriodSpacing", "Hello ,world ", "Hello,world "],
  ["collapseRepeatedSpaces", "hello  world ", "hello world "],
  ["trimSpaceBeforeLineBreak", "hello  \n", "hello\n"],
  // Deliberate no-op rule: the assertion guards against a spurious edit.
  ["neutralPunctuationPolicy", "Bonjour : ", "Bonjour : "],
  ["ellipsisShortcut", "wait... ", "wait\u2026 "],
  ["emdashShortcut", "word--x ", "word\u2014x "],
  ["smartQuoteNormalization", 'say "hi" ', "say \u201chi\u201d "],
  ["duplicatePunctuationCollapse", "hello,, ", "hello, "],
  ["autoBracketClose", "f(", "f()"],
];

/**
 * Docs edits are a cross-world round trip, so corrections are judged between keystrokes.
 * The adapter replays the positions a burst skipped, so this does not have to be anywhere
 * near human speed: 25ms/char is ~500 WPM. `FT_DELAY` re-measures the floor, which sits
 * at ~20ms/char once the fixture models the host honestly - the earlier 2ms figure came
 * from a fixture whose reads resolved in a microtask, which made the whole read-write
 * sequence atomic in tests and hid every race it was supposed to measure.
 */
const TYPING_DELAY_MS = Number(process.env.FT_DELAY ?? 25);

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
    // The variable set below is the light one; a dark-mode developer machine reads another.
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
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
  // Hiding and re-rendering the menu for every arrow press replays the panel's pop-in
  // animation, which the user sees as the popup blinking.
  test("arrow navigation moves the highlight without re-rendering the menu", async () => {
    await seed("hel", ["hello", "help"]);
    await page.evaluate(() => {
      const w = window as unknown as { hides: number };
      w.hides = 0;
      const menu = document.querySelector<HTMLElement>("#ft-menu--1")!;
      menu.shadowRoot!.querySelector("li")!.setAttribute("data-kept", "true");
      new MutationObserver(() => {
        if (menu.style.display === "none") w.hides++;
      }).observe(menu, { attributes: true, attributeFilter: ["style"] });
    });
    await page.keyboard.press("ArrowDown");
    await waitUntil("the highlight to move", () =>
      page.$eval("#ft-menu--1", (el) =>
        el.shadowRoot!.querySelectorAll("li")[1].classList.contains("highlight"),
      ),
    );
    expect(
      await page.$eval("#ft-menu--1", (el) => [
        el.shadowRoot!.querySelector("li")!.getAttribute("data-kept"),
        el.shadowRoot!.querySelectorAll("li.highlight").length,
        (window as unknown as { hides: number }).hides,
      ]),
    ).toEqual(["true", 1, 0]);
  });
  // Any second render of unchanged suggestions hides and re-shows the menu, replaying its
  // pop-in animation: the popup blinks once, shortly after it appears.
  test.each([[[]], [["englishTypoWhitelistCorrection"]]])(
    "the menu is rendered once for one set of suggestions (rules: %p)",
    async (rules) => {
      await evaluate(
        `predictions=["hello","help"];startDocs({enabledGrammarRules:${JSON.stringify(rules)}})`,
      );
      await page.evaluate(() => {
        const w = window as unknown as { renders: string[]; model: { text: string } };
        w.renders = [];
        const menu = document.querySelector<HTMLElement>("#ft-menu--1")!;
        new MutationObserver((records) => {
          if (records.some((r) => r.addedNodes.length)) w.renders.push(w.model.text);
        }).observe(menu.shadowRoot!.querySelector("ul")!, { childList: true });
      });
      await page.keyboard.type("hel", { delay: TYPING_DELAY_MS });
      await waitUntil("completion", () =>
        evaluate<boolean>(
          "document.querySelector('iframe').hasAttribute('data-ft-docs-key-state')",
        ),
      );
      // Long enough for the idle trigger (240ms) and several polls (200ms each).
      await new Promise((resolve) => setTimeout(resolve, 800));
      const renders = await page.evaluate(
        () => (window as unknown as { renders: string[] }).renders,
      );
      expect(renders.filter((text) => text === "hel")).toEqual(["hel"]);
      expect((await evaluate<unknown[]>("requests")).length).toBeLessThanOrEqual(3);
    },
  );
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
  // The readable context is a window around the caret, so in a long document it starts at
  // an arbitrary cut. Gating all of grammar on finding a line break inside that window
  // turned every paragraph longer than the window - an ordinary long document - into one
  // where nothing was corrected at all.
  test("corrections still run where the context window starts mid-paragraph", async () => {
    await evaluate(
      'predictions=[];startDocs({enabledGrammarRules:["englishTypoWhitelistCorrection","capitalizeSentenceStart"]})',
    );
    const paragraph = "lorem ipsum dolor sit amet ".repeat(500);
    expect(paragraph.length).toBeGreaterThan(MAX_CONTEXT);
    await page.evaluate((text) => {
      const fixture = window as unknown as {
        setModel: (value: string, a: number, f: number) => void;
        focusEditor: () => void;
      };
      fixture.setModel(text, text.length, text.length);
      fixture.focusEditor();
    }, paragraph);
    await page.keyboard.type("teh ", { delay: TYPING_DELAY_MS });
    await expectText(`${paragraph}the `);
  });
  // Writing to Docs means setting the user's real selection and then pasting over it. If
  // anything is awaited in between, a keystroke arriving in that gap is typed INTO the
  // selected range and destroys the word being corrected. The correction may be lost -
  // that is only latency - but the text must never come out mangled.
  test("a keystroke during an in-flight correction never destroys text", async () => {
    await evaluate(
      'predictions=[];startDocs({enabledGrammarRules:["englishTypoWhitelistCorrection"]})',
    );
    await page.evaluate(() => {
      (window as unknown as { annotateDelayMs: number }).annotateDelayMs = 40;
    });
    // Each pause lands the next keystroke at a different point of the write: 120ms and
    // 140ms used to fall between selecting the range and pasting over it, turning
    // "teh " + "X" into "tX ", and 160ms fell after the paste but before the caret was
    // put back, giving "theX ".
    for (const pause of [120, 140, 160]) {
      await page.evaluate(() => {
        const fixture = window as unknown as {
          setModel: (value: string, a: number, f: number) => void;
          focusEditor: () => void;
        };
        fixture.setModel("", 0, 0);
        fixture.focusEditor();
      });
      await page.keyboard.type("teh ");
      await new Promise((resolve) => setTimeout(resolve, pause));
      await page.keyboard.type("X");
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect([`the X`, `teh X`]).toContain((await model()).text);
    }
  });
  // Reading the model costs one round trip, and on a large document that round trip can
  // be longer than the gap between keystrokes - so no read ever completes inside a
  // sentence. A read that spanned a keystroke is still a self-consistent model and a
  // perfectly good baseline; discarding it left long documents uncorrected entirely.
  test("corrections survive a model read slower than the typing", async () => {
    await evaluate(
      'predictions=[];startDocs({enabledGrammarRules:["englishTypoWhitelistCorrection"]})',
    );
    await page.evaluate(() => {
      (window as unknown as { annotateDelayMs: number }).annotateDelayMs = 120;
    });
    await page.keyboard.type("teh cat ", { delay: 90 });
    await expectText("the cat ");
  });
  // When no read completes for the whole sentence, every position since the last baseline
  // has to be replayed at once. Capping that at 64 and judging only the caret beyond it
  // wrote off the rest of the sentence permanently.
  test("a correction survives a sentence longer than the replay window", async () => {
    await evaluate(
      'predictions=[];startDocs({enabledGrammarRules:["englishTypoWhitelistCorrection"]})',
    );
    await page.evaluate(() => {
      (window as unknown as { annotateDelayMs: number }).annotateDelayMs = 300;
    });
    const rest = "cat sat on the mat and looked at the dog for a while longer now ok ";
    expect(rest.length).toBeGreaterThan(64);
    await page.keyboard.type(`teh ${rest}`, { delay: 15 });
    await expectText(`the ${rest}`);
  });
  // The readable window slides with the caret once the document outgrows it, so the two
  // snapshots of a burst no longer begin at the same offset. Comparing them by position
  // within their own window meant replay never ran at all in a long document, and a
  // correction landed only if a read AND a write fitted between two keystrokes.
  test("a burst is still caught up in a document longer than the window", async () => {
    await evaluate(
      'predictions=[];startDocs({enabledGrammarRules:["englishTypoWhitelistCorrection"]})',
    );
    const paragraph = "lorem ipsum dolor sit amet ".repeat(500);
    expect(paragraph.length).toBeGreaterThan(MAX_CONTEXT);
    await page.evaluate((text) => {
      const fixture = window as unknown as {
        setModel: (value: string, a: number, f: number) => void;
        focusEditor: () => void;
        annotateDelayMs: number;
      };
      fixture.setModel(text, text.length, text.length);
      fixture.focusEditor();
      fixture.annotateDelayMs = 40;
    }, paragraph);
    // Let the adapter see the document once, as it would have long before the user types.
    await waitUntil("a first model read", async () => (await model()).text === paragraph);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.keyboard.type("teh cat sat down ", { delay: 25 });
    await expectText(`${paragraph}the cat sat down `);
  });
  // Rules see the text before the caret, and in a long document that was the whole 8KB
  // window. Measurement formatting refuses any context over 512 characters, so it never
  // fired anywhere but at the top of a short document.
  test("measurement formatting still runs deep inside a long document", async () => {
    await evaluate('predictions=[];startDocs({enabledGrammarRules:["measurementUnitFormatting"]})');
    const paragraph = "lorem ipsum dolor sit amet ".repeat(500);
    expect(paragraph.length).toBeGreaterThan(MAX_CONTEXT);
    await page.evaluate((text) => {
      const fixture = window as unknown as {
        setModel: (value: string, a: number, f: number) => void;
        focusEditor: () => void;
      };
      fixture.setModel(text, text.length, text.length);
      fixture.focusEditor();
    }, paragraph);
    await page.keyboard.type("10kg ", { delay: TYPING_DELAY_MS });
    await expectText(`${paragraph}10 kg `);
  });
  // Typing does not pause for the model read, so by the time the text comes back the
  // boundary that earned the correction is several keystrokes behind the caret. The whole
  // phrase is typed as one burst here: without replaying the skipped positions only the
  // final caret is ever judged, and the correction is lost.
  test("a correction is still made when the burst runs past it", async () => {
    await evaluate(
      'predictions=[];startDocs({enabledGrammarRules:["englishTypoWhitelistCorrection"]})',
    );
    await page.keyboard.type("teh cat sat down ", { delay: 0 });
    await expectText("the cat sat down ");
  });
  // A correction that the host rewrites on insertion (Docs turns a pasted no-break
  // space into an ordinary one) used to fail verification, so the caret was never
  // moved off the spot the paste left it and everything typed next landed mid-word.
  test("the caret follows a correction the host rewrites on insertion", async () => {
    await evaluate('predictions=[];startDocs({enabledGrammarRules:["measurementUnitFormatting"]})');
    await page.keyboard.type("10kg ", { delay: TYPING_DELAY_MS });
    await expectText("10 kg ");
    const caret = await page.evaluate(
      () => (window as unknown as { model: { anchor: number; focus: number } }).model,
    );
    expect([caret.anchor, caret.focus]).toEqual([6, 6]);
    await page.keyboard.type("x", { delay: TYPING_DELAY_MS });
    await expectText("10 kg x");
  });
  // A text diff does not say the user typed it. Only Ctrl/Cmd+V is recognisable from the
  // key, so a paste from the menu or Shift+Insert used to reach the next read unmarked and
  // be replayed as typing, rewriting text the user never typed.
  test.each([
    ["the Edit menu", null],
    ["Shift+Insert", { key: "Insert", shiftKey: true }],
    ["Ctrl+V", { key: "v", ctrlKey: true }],
  ] as Array<[string, KeyboardEventInit | null]>)(
    "a paste from %s is never replayed as typing",
    async (_name, key) => {
      await evaluate(
        'predictions=[];startDocs({enabledGrammarRules:["englishTypoWhitelistCorrection","measurementUnitFormatting"]})',
      );
      await waitUntil("a first model read", () => evaluate<boolean>("events.length >= 0"));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.frames()[1].evaluate((init) => {
        const input = document.querySelector("#input")!;
        if (init) input.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true }));
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", "teh 10kg cat");
        input.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true }));
      }, key);
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(await model()).toMatchObject({ text: "teh 10kg cat", pastes: 1 });
      // Typing resumes as typing once the paste has been accounted for.
      await page.keyboard.type(" teh ", { delay: TYPING_DELAY_MS });
      await expectText("teh 10kg cat the ");
    },
  );
  // The last position of a replayed run is the caret itself. After an earlier correction
  // lands, the key events that would have triggered it are gone, so it was judged with no
  // triggers at all - that is, not judged - and then marked as done.
  test("a burst ending exactly on a second correction gets both", async () => {
    await evaluate(
      'predictions=[];startDocs({enabledGrammarRules:["englishTypoWhitelistCorrection"]})',
    );
    await page.evaluate(() => {
      (window as unknown as { annotateDelayMs: number }).annotateDelayMs = 40;
    });
    await page.keyboard.type("teh teh ", { delay: 0 });
    await expectText("the the ");
  });
  // Trimming the context to 512 characters is not the same as losing the boundary: a real
  // line break or full stop a few characters back is still right there in what is left.
  test.each([
    ["capitalizeAfterLineBreak", `${"a".repeat(600)}\n`, "h", "H"],
    ["capitalizeSentenceStart", `${"lorem ".repeat(100)}done. `, "next ", "Next "],
    ["capitalizeAfterLineBreak", `${"lorem ipsum ".repeat(1200)}\n`, "h", "H"],
    ["capitalizeSentenceStart", `${"lorem ipsum ".repeat(1200)}done. `, "next ", "Next "],
    // The cut is not a beginning: nothing here says this word opens a sentence.
    ["capitalizeSentenceStart", `${"a".repeat(600)}${" ".repeat(520)}`, "next ", "next "],
  ])("%s still sees a real boundary %#  past the context cut", async (rule, before, keys, out) => {
    await evaluate(`predictions=[];startDocs({enabledGrammarRules:["${rule}"]})`);
    const text = before.replace("\\n", "\n");
    await page.evaluate((value) => {
      const fixture = window as unknown as {
        setModel: (value: string, a: number, f: number) => void;
        focusEditor: () => void;
      };
      fixture.setModel(value, value.length, value.length);
      fixture.focusEditor();
    }, text);
    await page.keyboard.type(keys, { delay: TYPING_DELAY_MS });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expectText(text + out);
  });
  // A replayed boundary is judged where it was typed, so what followed it THEN is what
  // counts. Handing it the rest of the burst as if it had already been there tripped the
  // measurement rule's guard against editing mid-text.
  test.each([
    ["10kg cat ", "10 kg cat "],
    ["10kg and 5km ok ", "10 kg and 5 km ok "],
  ])("a measurement is formatted when the burst %p runs past it", async (keys, expected) => {
    await evaluate('predictions=[];startDocs({enabledGrammarRules:["measurementUnitFormatting"]})');
    await page.evaluate(() => {
      (window as unknown as { annotateDelayMs: number }).annotateDelayMs = 40;
    });
    await page.keyboard.type(keys, { delay: 0 });
    await expectText(expected);
  });
  test("a measurement typed in front of existing text is still left alone", async () => {
    await evaluate('predictions=[];startDocs({enabledGrammarRules:["measurementUnitFormatting"]})');
    await page.evaluate(() => {
      const fixture = window as unknown as {
        setModel: (value: string, a: number, f: number) => void;
        focusEditor: () => void;
        annotateDelayMs: number;
      };
      fixture.setModel("cat", 0, 0);
      fixture.focusEditor();
      fixture.annotateDelayMs = 40;
    });
    await page.keyboard.type("10kg and ", { delay: 0 });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(await model()).toMatchObject({ text: "10kg and cat", pastes: 0 });
  });
  test("every catalog rule is covered by a Docs typing case", async () => {
    const covered = new Set(GRAMMAR_CASES.map(([ruleId]) => ruleId));
    expect(GRAMMAR_RULE_IDS.filter((ruleId) => !covered.has(ruleId))).toEqual([]);
  });
  // Docs must correct exactly what an ordinary page corrects. Every catalog rule is
  // typed through the real cross-world path and compared against the generic helper
  // on the same fixture, so a Docs-only regression cannot pass unnoticed again.
  test.each(GRAMMAR_CASES)("grammar rule %s behaves the same in Docs", async (...args) => {
    const [ruleId, typed, expected, genericExpected = expected] = args as [
      string,
      string,
      string,
      string?,
    ];
    await evaluate(`predictions=[];startDocs({enabledGrammarRules:${JSON.stringify([ruleId])}})`);
    await page.evaluate(() => {
      const fixture = window as unknown as {
        setModel: (text: string, a: number, f: number) => void;
        focusEditor: () => void;
      };
      fixture.setModel("", 0, 0);
      fixture.focusEditor();
    });
    await page.keyboard.type(typed, { delay: TYPING_DELAY_MS });
    await expectText(expected);

    await page.focus("#comment");
    await page.keyboard.type(typed, { delay: TYPING_DELAY_MS });
    await waitUntil(
      `generic parity for ${ruleId}`,
      async () => (await page.$eval("#comment", (field) => field.value)) === genericExpected,
    );
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
  test("a colored collaborator caret does not displace the local caret anchor", async () => {
    await page.evaluate(() => {
      const remote = document.querySelector(".kix-cursor-caret")!.cloneNode(true) as HTMLElement;
      remote.style.left = "500px";
      remote.style.borderLeft = "2px solid rgb(66, 133, 244)";
      document.body.appendChild(remote);
    });
    await seed("hel", ["hello"], { inline_suggestion: true });
    expect(await page.$(".ft-suggestion-inline")).not.toBeNull();
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
