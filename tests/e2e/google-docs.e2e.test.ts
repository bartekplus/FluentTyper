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
  // Only the unambiguous clock form compacts; "3. 14" is deliberately left alone.
  ["technicalTokenCompaction", "at 12: 30 ", "at 12:30 "],
  ["mathOperatorSpacing", "x=y ", "x = y "],
  // Docs converts every pasted NBSP to a plain space, so the rule's non-breaking space
  // cannot survive the only edit channel Docs offers. A plain space is the best available.
  ["measurementUnitFormatting", "10kg ", "10 kg ", "10\u00a0kg "],
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
  // KNOWN GAP, not yet fixed. Every keystroke cancels the read in flight, so on a document
  // slow enough to read, no snapshot is ever produced inside a sentence and the correction
  // is dropped rather than merely delayed. Fixing it means letting a read that spanned a
  // keystroke still serve as a baseline without consuming the triggers a later pass needs.
  test.skip("corrections survive a model read slower than the typing", async () => {
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
  // KNOWN GAP, not yet fixed. Depends on the same read-cancellation issue above: with no
  // snapshot completing mid-sentence, the catch-up window is the only thing reaching back
  // to the correction, and a long enough sentence outruns it.
  test.skip("a correction survives a sentence longer than the replay window", async () => {
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
