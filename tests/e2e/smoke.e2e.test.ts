import {
  grammarRuleSelectionToOverrides,
  resolveGrammarRuleSelection,
} from "../../src/core/domain/grammar/GrammarRuleSettings";
import type { Browser, Page } from "puppeteer";
import type { BackgroundContext } from "./e2e-helpers";
import {
  BROWSER_TYPE,
  ensureWorker,
  getSetting,
  getTimeoutProfile,
  isFirefox,
  launchBrowser,
  notifyConfigChange,
  openExtensionPage,
  openPopupPage,
  findLayoutOverflow,
  reacquireWorker,
  removeSettings,
  sendCommand,
  setSetting,
  setSettings,
  sleep,
  startTestPageServer,
  takeSettingsWritten,
  waitForVisibleSuggestionMenu,
  waitForVisibleSuggestionTexts,
  waitUntil,
  suiteTimeout,
  clickReviewControl,
  triggerReview,
  waitForReview,
} from "./e2e-helpers";
import {
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  KEY_DOMAIN_LIST_MODE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_EXTENSION_LANGUAGE,
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_ENABLED_LANGUAGES,
  KEY_INLINE_SUGGESTION,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_LANGUAGE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_NUM_SUGGESTIONS,
  KEY_SITE_PROFILES,
  KEY_TEXT_EXPANSIONS,
} from "../../src/core/domain/constants";
import { DEFAULT_CURRENT_GRAMMAR_RULES } from "../../src/core/domain/grammar/ruleCatalog";
import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "../../src/core/domain/themeDefaults";

const RUN_E2E = process.env.RUN_E2E === "1" || process.env.RUN_E2E === "true";
const describeE2E = RUN_E2E ? describe : describe.skip;

const TEST_HOST = "localhost";
const WORKER_TIMEOUT_MS = suiteTimeout(5000, 10000);
const timeoutProfile = getTimeoutProfile();

let domainTestUrl = "";

const STATIC_DEFAULT_SETTINGS = {
  [KEY_MIN_WORD_LENGTH_TO_PREDICT]: 1,
  [KEY_NUM_SUGGESTIONS]: 5,
  [KEY_INLINE_SUGGESTION]: false,
  [KEY_SITE_PROFILES]: {},
  enable: true,
};

const PER_TEST_RESET_SETTINGS = {
  [KEY_AUTOCOMPLETE_ON_ENTER]: true,
  [KEY_ENABLED_LANGUAGES]: ["en_US", "de_DE", "textExpander"],
  [KEY_LANGUAGE]: "en_US",
  [KEY_TEXT_EXPANSIONS]: [],
  [KEY_ENABLED_GRAMMAR_RULES]: grammarRuleSelectionToOverrides([]),
  [KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE]: true,
  [KEY_DOMAIN_LIST_MODE]: "blackList",
  domainBlackList: [],
  ...DEFAULT_SUGGESTION_THEME_SETTINGS,
};

async function openOptionsPage(browser: Browser, worker: BackgroundContext): Promise<Page> {
  const optionsPage = await openExtensionPage(browser, worker, "options/options.html");
  await optionsPage.waitForSelector("#content", { timeout: timeoutProfile.navigationMs });
  return optionsPage;
}

async function waitForInputReady(page: Page, selector: string): Promise<void> {
  await page.waitForSelector(selector, { timeout: timeoutProfile.inputReadyMs });
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.hasAttribute("data-suggestion") ?? false,
    { timeout: timeoutProfile.inputReadyMs },
    selector,
  );
}

async function gotoTestPage(page: Page): Promise<void> {
  await page.goto(domainTestUrl, {
    waitUntil: "domcontentloaded",
    timeout: timeoutProfile.navigationMs,
  });
}

async function resetTestPageState(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __ftResetTestPage?: () => void;
      }
    ).__ftResetTestPage?.();
  });

  await waitUntil(
    "test page reset",
    async () =>
      page.evaluate(() => {
        const valuesCleared = Array.from(
          document.querySelectorAll("textarea, input, [contenteditable='true']"),
        ).every((element) => {
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            return element.value === "";
          }
          return (
            !(element instanceof HTMLElement && element.isContentEditable) ||
            element.textContent === ""
          );
        });

        const disabledInput = document.getElementById("test-disabled");
        const readonlyInput = document.getElementById("test-readonly");

        return (
          valuesCleared &&
          disabledInput instanceof HTMLInputElement &&
          disabledInput.disabled &&
          readonlyInput instanceof HTMLInputElement &&
          readonlyInput.readOnly &&
          !document.querySelector("ft-shadow-test-component") &&
          !document.getElementById("ft-late-shadow-host") &&
          !document.getElementById("ft-nested-shadow-outer-host")
        );
      }),
    { timeoutMs: suiteTimeout(1500, 3000) },
  );
}

async function prepareReusableTestPage(browser: Browser, page: Page | null): Promise<Page> {
  let nextPage = page;
  if (!nextPage || nextPage.isClosed()) {
    nextPage = await browser.newPage();
    nextPage.setDefaultNavigationTimeout(timeoutProfile.navigationMs);
  }

  await nextPage.bringToFront();
  if (!nextPage.url().startsWith(domainTestUrl)) {
    await gotoTestPage(nextPage);
  } else {
    await resetTestPageState(nextPage);
  }

  await waitForInputReady(nextPage, "#test-input");
  return nextPage;
}

async function typeInInput(page: Page, selector: string, text: string): Promise<void> {
  await page.focus(selector);
  const element = await page.$(selector);
  if (!element) {
    throw new Error(`Input element not found for selector: ${selector}`);
  }
  await element.type(text);
}

async function clearInputContent(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const target = document.querySelector(sel);
    if (!target) {
      return;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.value = "";
      return;
    }
    target.textContent = "";
  }, selector);
}

async function waitForInputContentMatch(
  page: Page,
  selector: string,
  pattern: RegExp,
): Promise<string> {
  const handle = await page.waitForFunction(
    (sel, patternSource, patternFlags) => {
      const element = document.querySelector(sel) as HTMLInputElement | HTMLElement | null;
      const currentValue =
        (element as HTMLInputElement | null)?.value ?? element?.textContent ?? "";
      return new RegExp(patternSource, patternFlags).test(currentValue) ? currentValue : false;
    },
    { timeout: timeoutProfile.suggestionMs },
    selector,
    pattern.source,
    pattern.flags,
  );
  return (await handle.jsonValue()) as string;
}

async function closePageSafely(pageToClose: Page | null | undefined): Promise<void> {
  if (!pageToClose || pageToClose.isClosed()) {
    return;
  }
  try {
    await pageToClose.close();
  } catch {
    // Ignore teardown races (target/session already closing).
  }
}

describeE2E(`E2E Smoke [${BROWSER_TYPE}]`, () => {
  let browser: Browser;
  let worker: BackgroundContext;
  let page: Page | null = null;
  let testPageServer: ReturnType<typeof startTestPageServer>;

  beforeAll(async () => {
    browser = await launchBrowser();
    worker = await reacquireWorker(browser, WORKER_TIMEOUT_MS);
    testPageServer = startTestPageServer();
    domainTestUrl = testPageServer.url;

    await setSettings(worker, STATIC_DEFAULT_SETTINGS);
    await notifyConfigChange(browser, worker);
    takeSettingsWritten();
  }, 60000);

  beforeEach(async () => {
    worker = await ensureWorker(browser, worker, WORKER_TIMEOUT_MS);
    if (takeSettingsWritten()) {
      await setSettings(worker, PER_TEST_RESET_SETTINGS);
      await notifyConfigChange(browser, worker);
      takeSettingsWritten();
    }
    // Worker recovery and storage reset each have their own bounded waits;
    // the hook must allow both before Bun tears down the shared browser.
  }, 15000);

  afterAll(async () => {
    await testPageServer?.stop();
    await closePageSafely(page);
    if ("isClosed" in worker && typeof worker.isClosed === "function") {
      await closePageSafely(worker);
    }
    try {
      await browser.close();
    } catch {
      // Ignore teardown races during browser shutdown.
    }
  }, 30000);

  test(
    "extension installation page is reachable",
    async () => {
      const installationPage = await openExtensionPage(
        browser,
        worker,
        "new_installation/index.html",
      );
      try {
        await installationPage.waitForSelector("body", {
          timeout: suiteTimeout(3000, 7000),
        });
      } finally {
        if (!installationPage.isClosed()) {
          await installationPage.close();
        }
      }
    },
    suiteTimeout(7000, 12000),
  );

  test(
    "onboarding playground manual attach icon enables the native autocomplete field",
    async () => {
      const installationPage = await openExtensionPage(
        browser,
        worker,
        "new_installation/index.html",
      );
      try {
        await installationPage.waitForSelector("#try-me-textarea", {
          timeout: suiteTimeout(3000, 7000),
        });
        await installationPage.waitForSelector("#try-native-list-input", {
          timeout: suiteTimeout(3000, 7000),
        });

        await installationPage.waitForFunction(
          () =>
            document
              .querySelector("#try-native-list-input")
              ?.parentElement?.querySelector(".ft-manual-attach-button") instanceof
            HTMLButtonElement,
          { timeout: suiteTimeout(3000, 7000) },
        );

        const initialState = await installationPage.evaluate(() => ({
          standardAttached:
            document.querySelector("#try-me-textarea")?.hasAttribute("data-suggestion") ?? false,
          nativeAttached:
            document.querySelector("#try-native-list-input")?.hasAttribute("data-suggestion") ??
            false,
        }));
        expect(initialState.standardAttached).toBe(true);
        expect(initialState.nativeAttached).toBe(false);

        await installationPage.evaluate(() => {
          const button = document
            .querySelector("#try-native-list-input")
            ?.parentElement?.querySelector(".ft-manual-attach-button") as HTMLButtonElement | null;
          button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
          button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });

        await installationPage.waitForFunction(
          () => {
            const field = document.querySelector("#try-native-list-input");
            return field?.hasAttribute("data-suggestion") && document.activeElement === field;
          },
          { timeout: suiteTimeout(3000, 7000) },
        );
      } finally {
        if (!installationPage.isClosed()) {
          await installationPage.close();
        }
      }
    },
    suiteTimeout(8000, 14000),
  );

  test(
    "popup page loads",
    async () => {
      const popupPage = await openPopupPage(browser, worker);
      try {
        await popupPage.waitForSelector("body", {
          timeout: suiteTimeout(3000, 7000),
        });
        // Chrome caps popups at 600px tall: nothing may scroll or spill out of its card.
        expect(await findLayoutOverflow(popupPage, 600)).toEqual([]);
      } finally {
        if (!popupPage.isClosed()) {
          await popupPage.close();
        }
      }
    },
    suiteTimeout(6000, 10000),
  );

  test(
    "fresh install suggestion popup keeps the default opaque theme",
    async () => {
      await removeSettings(worker, Object.keys(DEFAULT_SUGGESTION_THEME_SETTINGS));
      await notifyConfigChange(browser, worker);

      page = await prepareReusableTestPage(browser, page);

      await typeInInput(page, "#test-input", "h");
      await waitForVisibleSuggestionTexts(page);

      const themeSnapshot = await waitForVisibleSuggestionMenu(page);

      expect(themeSnapshot.overrideCssText).toContain(
        `--suggestion-bg-light: ${DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBgLight}`,
      );
      expect(themeSnapshot.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(themeSnapshot.backgroundColor).not.toBe("transparent");
    },
    suiteTimeout(8000, 12000),
  );

  test("does not expose runtime command test hooks", async () => {
    const hasRuntimeHook = await worker.evaluate(() => {
      return (
        typeof (globalThis as { triggerCommandForTesting?: unknown }).triggerCommandForTesting ===
        "function"
      );
    });
    expect(hasRuntimeHook).toBe(false);
  }, 7000);

  test(
    "options workspace localizes shell copy and honors deep links",
    async () => {
      await setSetting(worker, KEY_EXTENSION_LANGUAGE, "fr_FR");

      if (isFirefox()) {
        await worker.evaluate(() => {
          localStorage.setItem("store.settings.extensionLanguage", JSON.stringify("fr_FR"));
        });
      }

      const optionsPage = await openExtensionPage(
        browser,
        worker,
        "options/options.html#advanced_tab",
      );
      try {
        if (!isFirefox()) {
          await optionsPage.evaluate(() => {
            localStorage.setItem("store.settings.extensionLanguage", JSON.stringify("fr_FR"));
          });
          await optionsPage.reload({ waitUntil: "domcontentloaded" });
        }

        await optionsPage.waitForSelector("#advanced_tab:not(.is-hidden)", {
          timeout: suiteTimeout(3000, 7000),
        });

        const snapshot = await optionsPage.evaluate(() => ({
          workspaceTitle: document.querySelector(".options-brand-title")?.textContent?.trim(),
          searchPlaceholder: (
            document.getElementById("options-search-input") as HTMLInputElement | null
          )?.placeholder,
          activeTabId:
            document.querySelector(".content-tab.is-active")?.getAttribute("data-tab-id") ?? "",
        }));

        expect(snapshot.workspaceTitle).toBe("Paramètres");
        expect(snapshot.searchPlaceholder).toBe("Rechercher dans les paramètres");
        expect(snapshot.activeTabId).toBe("advanced_tab");
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.evaluate(() => {
            localStorage.setItem("store.settings.extensionLanguage", JSON.stringify("auto_detect"));
          });
          await optionsPage.close();
        }
        await setSetting(worker, KEY_EXTENSION_LANGUAGE, "auto_detect");
      }
    },
    suiteTimeout(8000, 14000),
  );

  test(
    "mobile section switcher changes the active options section and hash",
    async () => {
      const optionsPage = await openOptionsPage(browser, worker);
      try {
        // Firefox BiDi rejects setViewport on extension (privileged) pages.
        if (!isFirefox()) {
          await optionsPage.setViewport({ width: 390, height: 844, isMobile: true });
        }

        await optionsPage.select("#mobile-section-select", "site_mgmt_tab");
        await optionsPage.waitForFunction(() => window.location.hash === "#site_mgmt_tab", {
          timeout: suiteTimeout(2000, 6000),
        });

        const state = await optionsPage.evaluate(() => ({
          activeTabId:
            document.querySelector(".content-tab.is-active")?.getAttribute("data-tab-id") ?? "",
        }));

        expect(state.activeTabId).toBe("site_mgmt_tab");
        for (const tab of ["core_settings", "grammar_tab", "advanced_tab"]) {
          await optionsPage.evaluate((hash) => (window.location.hash = hash), tab);
          await optionsPage.waitForSelector(`#${tab}:not(.is-hidden)`);
          expect({ tab, overflow: await findLayoutOverflow(optionsPage) }).toEqual({
            tab,
            overflow: [],
          });
        }
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }
    },
    suiteTimeout(7000, 12000),
  );

  test(
    "popup advanced stats opens the options page at the advanced tab anchor",
    async () => {
      const popupPage = await openPopupPage(browser, worker);
      let advancedPage: Page | null = null;
      try {
        await popupPage.waitForSelector("#openStatsOptionsBtn", {
          timeout: suiteTimeout(3000, 7000),
        });
        const targetPromise = browser.waitForTarget(
          (target) =>
            target.type() === "page" && target.url().includes("options/options.html#advanced_tab"),
          { timeout: suiteTimeout(3000, 7000) },
        );

        // DOM click: Firefox BiDi rejects input actions on extension (privileged) pages.
        await popupPage.$eval("#openStatsOptionsBtn", (el) => (el as HTMLElement).click());
        const target = await targetPromise;
        advancedPage = await target.asPage();
        expect(target.url()).toContain("options/options.html#advanced_tab");
      } finally {
        if (advancedPage && !advancedPage.isClosed()) {
          await advancedPage.close();
        }
        if (!popupPage.isClosed()) {
          await popupPage.close();
        }
      }
    },
    suiteTimeout(7000, 12000),
  );

  test(
    "keeps predictor debug panel hidden in options page",
    async () => {
      const optionsPage = await openOptionsPage(browser, worker);
      try {
        const debugRoot = await optionsPage.$("#predictorDebugRoot");
        expect(debugRoot).toBeNull();
        const toggleButtonCount = await optionsPage.$$eval(
          '[data-action="set-predictor-toggle"]',
          (buttons) => buttons.length,
        );
        expect(toggleButtonCount).toBe(0);
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }
    },
    suiteTimeout(7000, 12000),
  );

  test(
    "grammar rule matrix groups rules, searches them, and restores defaults",
    async () => {
      await setSetting(worker, KEY_ENABLED_GRAMMAR_RULES, grammarRuleSelectionToOverrides([]));
      await notifyConfigChange(browser, worker);

      const optionsPage = await openOptionsPage(browser, worker);
      try {
        await optionsPage.evaluate(() => (location.hash = "grammar_tab"));
        await optionsPage.waitForSelector("#grammar_tab:not(.is-hidden) .rule-matrix", {
          timeout: suiteTimeout(3000, 7000),
        });
        const probe = await optionsPage.evaluate(() => {
          const matrix = document.querySelector(".rule-matrix")!;
          const search = matrix.querySelector<HTMLInputElement>('input[type="search"]')!;
          const visibleRows = () =>
            Array.from(matrix.querySelectorAll<HTMLElement>(".rule-matrix-row[data-rule]")).filter(
              (row) => !row.classList.contains("is-hidden"),
            );
          const typingChecked = () =>
            Array.from(
              matrix.querySelectorAll<HTMLInputElement>(
                'input[data-setting="enabledGrammarRules"]',
              ),
            ).filter((input) => input.checked).length;

          const sections = matrix.querySelectorAll(".rule-matrix-section").length;
          const closedByDefault = Array.from(
            matrix.querySelectorAll<HTMLDetailsElement>(".rule-matrix-section"),
          ).every((section) => !section.open);
          const allRows = visibleRows().length;
          const typingOnBefore = typingChecked();

          search.value = "ellipsis";
          search.dispatchEvent(new Event("input", { bubbles: true }));
          const searchRows = visibleRows();
          const matchOpened = searchRows.every(
            (row) => row.closest<HTMLDetailsElement>("details")?.open,
          );
          search.value = "definitely-no-such-rule";
          search.dispatchEvent(new Event("input", { bubbles: true }));
          const noMatchRows = visibleRows().length;
          const noResultsVisible = Array.from(matrix.querySelectorAll("p")).some(
            (p) => !p.classList.contains("is-hidden") && p.textContent?.includes("No grammar"),
          );
          search.value = "";
          search.dispatchEvent(new Event("input", { bubbles: true }));

          matrix.querySelector<HTMLButtonElement>('[data-action="restore-defaults"]')!.click();
          return {
            sections,
            closedByDefault,
            allRows,
            typingOnBefore,
            searchRows: searchRows.length,
            matchOpened,
            noMatchRows,
            noResultsVisible,
            typingOnAfter: typingChecked(),
          };
        });

        expect(probe.sections).toBeGreaterThanOrEqual(2);
        expect(probe.closedByDefault).toBe(true);
        expect(probe.typingOnBefore).toBe(0);
        expect(probe.searchRows).toBeGreaterThan(0);
        expect(probe.searchRows).toBeLessThan(probe.allRows);
        expect(probe.matchOpened).toBe(true);
        expect(probe.noMatchRows).toBe(0);
        expect(probe.noResultsVisible).toBe(true);
        expect(probe.typingOnAfter).toBe(DEFAULT_CURRENT_GRAMMAR_RULES.length);
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }

      const stored = await waitUntil(
        "grammar matrix restore persistence",
        async () => {
          const value = await getSetting<Record<string, boolean>>(
            worker,
            KEY_ENABLED_GRAMMAR_RULES,
          );
          return value && !Array.isArray(value) && Object.keys(value).length === 0 ? value : false;
        },
        { timeoutMs: suiteTimeout(5000, 10000) },
      );
      expect(resolveGrammarRuleSelection(stored).sort()).toEqual(
        [...DEFAULT_CURRENT_GRAMMAR_RULES].sort(),
      );
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "domain whitelist enables predictions for exact host",
    async () => {
      await setSetting(worker, KEY_DOMAIN_LIST_MODE, "whiteList");
      await setSetting(worker, "domainBlackList", ["[", TEST_HOST]);
      await notifyConfigChange(browser, worker);

      page = await prepareReusableTestPage(browser, page);

      const attached = await page.$eval("#test-input", (el) => el.hasAttribute("data-suggestion"));
      expect(attached).toBe(true);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "prediction popup accepts suggestion with TAB in #test-input",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      await page.focus("#test-input");
      const element = await page.$("#test-input");
      await element!.type("h");

      const [firstSuggestion] = await waitForVisibleSuggestionTexts(page);
      expect(firstSuggestion?.toLowerCase()).toMatch(/^h\S*[ \xa0]$/);

      await page.keyboard.press("Tab");
      const value = await waitForInputContentMatch(page, "#test-input", /^h\S*[ \xa0]$/i);
      expect(value.toLowerCase()).toBe(firstSuggestion?.toLowerCase());
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "Enter selection uses the default and follows off/on updates in an open page",
    async () => {
      await setSetting(worker, KEY_ENABLED_GRAMMAR_RULES, grammarRuleSelectionToOverrides([]));
      const configPage = await openExtensionPage(browser, worker, "popup/popup.html");
      try {
        for (const enabled of [undefined, false, true]) {
          if (enabled === undefined) {
            await removeSettings(worker, [KEY_AUTOCOMPLETE_ON_ENTER]);
          } else {
            await setSetting(worker, KEY_AUTOCOMPLETE_ON_ENTER, enabled);
          }
          await sendCommand(configPage, CMD_OPTIONS_PAGE_CONFIG_CHANGE, {}, { requireOk: true });
          page = await prepareReusableTestPage(browser, page);
          await page.focus("#test-textarea");
          await page.keyboard.type("h");
          const [suggestion] = await waitForVisibleSuggestionTexts(page);
          expect(suggestion).toBeTruthy();
          await page.keyboard.press("Enter");
          await waitUntil(
            "Enter selection text",
            async () =>
              (await page!.$eval("#test-textarea", (el) => (el as HTMLTextAreaElement).value)) ===
              (enabled === false ? "h\n" : suggestion),
            { timeoutMs: suiteTimeout(5000, 8000) },
          ).catch(async (cause) => {
            const value = await page!.$eval(
              "#test-textarea",
              (el) => (el as HTMLTextAreaElement).value,
            );
            throw new Error(
              `Enter setting ${String(enabled)}: ${JSON.stringify(value)}, expected ${JSON.stringify(enabled === false ? "h\n" : suggestion)}`,
              { cause },
            );
          });
        }
      } finally {
        await configPage.close();
      }
    },
    suiteTimeout(20000, 35000),
  );

  test(
    "automatic spacing uses the default and follows off/on updates in an open page",
    async () => {
      // Options writes defaults on open. A Popup tab preserves the missing setting and stays open.
      const configPage = await openExtensionPage(browser, worker, "popup/popup.html");
      try {
        for (const enabled of [undefined, false, true]) {
          if (enabled === undefined) {
            await removeSettings(worker, [KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE]);
          } else {
            await setSetting(worker, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, enabled);
          }
          await sendCommand(configPage, CMD_OPTIONS_PAGE_CONFIG_CHANGE, {}, { requireOk: true });
          expect(await getSetting(worker, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE)).toBe(enabled);
          page = await prepareReusableTestPage(browser, page);
          await page.focus("#test-input");
          await page.keyboard.type("h");

          const [suggestion] = await waitForVisibleSuggestionTexts(page);
          expect(suggestion).toBeTruthy();
          expect(/[ \xa0]$/.test(suggestion!)).toBe(enabled ?? true);
          await page.keyboard.press("Tab");
          await waitUntil(
            "accepted suggestion text",
            async () =>
              (await page!.$eval("#test-input", (el) => (el as HTMLInputElement).value)) ===
              suggestion,
            { timeoutMs: suiteTimeout(5000, 8000) },
          );
          await page.keyboard.type("s");
          await waitUntil(
            "typed character after acceptance",
            async () =>
              (await page!.$eval("#test-input", (el) => (el as HTMLInputElement).value)) ===
              `${suggestion}s`,
            { timeoutMs: suiteTimeout(5000, 8000) },
          );
        }
      } finally {
        await configPage.close();
      }
    },
    suiteTimeout(20000, 35000),
  );

  test(
    "prediction popup does not inject a delayed space after accept when insertSpaceAfterAutocomplete is disabled",
    async () => {
      await setSetting(worker, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, false);
      await notifyConfigChange(browser, worker);

      page = await prepareReusableTestPage(browser, page);

      await page.focus("#test-input");
      const element = await page.$("#test-input");
      await element!.type("h");

      const [firstSuggestion] = await waitForVisibleSuggestionTexts(page);
      expect(firstSuggestion?.toLowerCase()).toMatch(/^h\S*$/);

      await page.keyboard.press("Tab");
      const acceptedValue = await waitForInputContentMatch(page, "#test-input", /^h\S*$/i);
      expect(acceptedValue.toLowerCase()).toBe(firstSuggestion?.toLowerCase());

      await page.keyboard.type("s");
      const suffixedValue = await waitUntil(
        "accepted suggestion to append typed suffix without injected space",
        async () => {
          const current = await page!.$eval("#test-input", (el) => (el as HTMLInputElement).value);
          return current === `${acceptedValue}s` ? current : false;
        },
        { timeoutMs: suiteTimeout(5000, 8000) },
      );
      expect(suffixedValue).toBe(`${acceptedValue}s`);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "text expansion accepts first suggestion in #test-input",
    async () => {
      await setSetting(worker, KEY_ENABLED_LANGUAGES, ["textExpander"]);
      await setSetting(worker, KEY_LANGUAGE, "textExpander");
      await setSetting(worker, KEY_TEXT_EXPANSIONS, [["asap", "as soon as possible"]]);
      await notifyConfigChange(browser, worker);

      page = await prepareReusableTestPage(browser, page);

      const element = await page.$("#test-input");
      await element!.type("asap");

      const [firstSuggestion] = await waitForVisibleSuggestionTexts(page);
      expect(firstSuggestion?.toLowerCase()).toMatch(/^as soon as possible[ \xa0]$/);

      await page.keyboard.press("Tab");
      const value = await waitForInputContentMatch(
        page,
        "#test-input",
        /^as soon as possible[ \xa0]$/i,
      );
      expect(value.toLowerCase()).toMatch(/^as soon as possible[ \xa0]$/);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "text expansion popup shows duplicate shortcut entries and accepts a non-default selection",
    async () => {
      await setSetting(worker, KEY_ENABLED_LANGUAGES, ["textExpander"]);
      await setSetting(worker, KEY_LANGUAGE, "textExpander");
      await setSetting(worker, KEY_TEXT_EXPANSIONS, [
        ["asap", "as soon as possible"],
        ["asap", "at some available point"],
      ]);
      await notifyConfigChange(browser, worker);

      page = await prepareReusableTestPage(browser, page);

      const element = await page.$("#test-input");
      await element!.type("asap");

      const suggestions = await waitForVisibleSuggestionTexts(page);
      expect(suggestions).toHaveLength(2);
      expect(
        suggestions.some((suggestion) => /^as soon as possible[ \xa0]$/i.test(suggestion)),
      ).toBe(true);
      expect(
        suggestions.some((suggestion) => /^at some available point[ \xa0]$/i.test(suggestion)),
      ).toBe(true);

      const selectedSuggestion = suggestions[1];
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Tab");

      const value = await waitUntil(
        "selected duplicate text expansion to be accepted",
        async () => {
          const current = await page!.$eval("#test-input", (el) => (el as HTMLInputElement).value);
          return current === selectedSuggestion ? current : false;
        },
        { timeoutMs: timeoutProfile.suggestionMs },
      );
      expect(value).toBe(selectedSuggestion);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "options config change command updates grammar rules in runtime storage",
    async () => {
      await setSetting(worker, KEY_ENABLED_GRAMMAR_RULES, grammarRuleSelectionToOverrides([]));
      await notifyConfigChange(browser, worker);

      const optionsPage = await openOptionsPage(browser, worker);
      try {
        await optionsPage.evaluate(
          (key, command, rules) => {
            const storageKey = `store.settings.${key}`;
            localStorage.setItem(storageKey, JSON.stringify(rules));
            chrome.storage.local.set({ [storageKey]: JSON.stringify(rules) });
            chrome.runtime.sendMessage({ command, context: {} });
          },
          KEY_ENABLED_GRAMMAR_RULES,
          CMD_OPTIONS_PAGE_CONFIG_CHANGE,
          grammarRuleSelectionToOverrides(["capitalizeSentenceStart", "commaPeriodSpacing"]),
        );
      } finally {
        if (!optionsPage.isClosed()) {
          await optionsPage.close();
        }
      }

      const storedRules = await waitUntil<string[]>(
        "grammar rules to update",
        async () => {
          const stored = await getSetting<Record<string, boolean>>(
            worker,
            KEY_ENABLED_GRAMMAR_RULES,
          );
          if (!stored || Array.isArray(stored)) return false;
          const current = resolveGrammarRuleSelection(stored);
          if (
            Array.isArray(current) &&
            current.includes("capitalizeSentenceStart") &&
            current.includes("commaPeriodSpacing")
          ) {
            return current;
          }
          return false;
        },
        { timeoutMs: suiteTimeout(5000, 10000) },
      );

      expect(storedRules).toEqual(
        expect.arrayContaining(["capitalizeSentenceStart", "commaPeriodSpacing"]),
      );
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "keeps email and url inputs manual by default",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      const results = await page.evaluate(() => ({
        email: document.querySelector("#test-email")?.hasAttribute("data-suggestion") ?? false,
        url: document.querySelector("#test-url")?.hasAttribute("data-suggestion") ?? false,
      }));

      expect(results.email).toBe(false);
      expect(results.url).toBe(false);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "does not attach to tel, disabled, or readonly inputs",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      const results = await page.evaluate(() => ({
        tel: document.querySelector("#test-tel")?.hasAttribute("data-suggestion") ?? false,
        disabled:
          document.querySelector("#test-disabled")?.hasAttribute("data-suggestion") ?? false,
        readonly:
          document.querySelector("#test-readonly")?.hasAttribute("data-suggestion") ?? false,
      }));

      expect(results.tel).toBe(false);
      expect(results.disabled).toBe(false);
      expect(results.readonly).toBe(false);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "prefers native/page autocomplete for conflicting fields",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      const results = await page.evaluate(() => ({
        nativeList:
          document.querySelector("#test-native-list")?.hasAttribute("data-suggestion") ?? false,
        nativeListButton:
          document
            .querySelector("#test-native-list")
            ?.parentElement?.querySelector(".ft-manual-attach-button") instanceof HTMLButtonElement,
        semanticEmail:
          document.querySelector("#test-semantic-email")?.hasAttribute("data-suggestion") ?? false,
        semanticEmailButton:
          document
            .querySelector("#test-semantic-email")
            ?.parentElement?.querySelector(".ft-manual-attach-button") instanceof HTMLButtonElement,
        combobox:
          document.querySelector("#test-combobox")?.hasAttribute("data-suggestion") ?? false,
        comboboxButton:
          document
            .querySelector("#test-combobox")
            ?.parentElement?.querySelector(".ft-manual-attach-button") instanceof HTMLButtonElement,
        toolbarFont:
          document.querySelector("#test-toolbar-font")?.hasAttribute("data-suggestion") ?? false,
        toolbarButton: !!document
          .querySelector("#test-toolbar-font")
          ?.parentElement?.querySelector(".ft-manual-attach-button"),
        emojiSearch:
          document.querySelector("#test-emoji-search")?.hasAttribute("data-suggestion") ?? false,
        emojiButton: !!document
          .querySelector("#test-emoji-search")
          ?.parentElement?.querySelector(".ft-manual-attach-button"),
        normalText: document.querySelector("#test-input")?.hasAttribute("data-suggestion") ?? false,
      }));

      expect(results.nativeList).toBe(false);
      expect(results.nativeListButton).toBe(true);
      expect(results.semanticEmail).toBe(false);
      expect(results.semanticEmailButton).toBe(true);
      expect(results.combobox).toBe(true);
      expect(results.comboboxButton).toBe(false);
      expect(results.toolbarFont).toBe(false);
      expect(results.toolbarButton).toBe(false);
      expect(results.emojiSearch).toBe(false);
      expect(results.emojiButton).toBe(false);
      expect(results.normalText).toBe(true);

      // Marker changes must reconcile both attached fields and manual activation UI.
      await page.evaluate(() => {
        document.querySelector("#test-emoji-search")!.parentElement!.removeAttribute("data-qa");
      });
      await page.waitForFunction(() =>
        document.querySelector("#test-emoji-search")?.hasAttribute("data-suggestion"),
      );
      await page.evaluate(() => {
        document
          .querySelector("#test-emoji-search")!
          .parentElement!.setAttribute("data-qa", "emoji-picker");
        document
          .querySelector("#test-native-list")!
          .parentElement!.setAttribute("data-qa", "emoji-picker");
      });
      await page.waitForFunction(() =>
        ["#test-emoji-search", "#test-native-list"].every((selector) => {
          const input = document.querySelector(selector)!;
          return (
            !input.hasAttribute("data-suggestion") &&
            !input.parentElement?.querySelector(".ft-manual-attach-button")
          );
        }),
      );
      await page.evaluate(() => {
        document.querySelector("#test-native-list")!.parentElement!.removeAttribute("data-qa");
      });
      await page.waitForFunction(
        () =>
          !!document
            .querySelector("#test-native-list")
            ?.parentElement?.querySelector(".ft-manual-attach-button"),
      );

      // A stale expanded flag without a visible popup does not suppress prose.
      await page.evaluate(() => {
        document.querySelector<HTMLElement>("#test-combobox-list")!.hidden = true;
        document.querySelector("#test-combobox")!.setAttribute("aria-expanded", "true");
      });
      await typeInInput(page, "#test-combobox", "th");
      expect((await waitForVisibleSuggestionTexts(page)).length).toBeGreaterThan(0);
      await clearInputContent(page, "#test-combobox");
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "manual attach icon force-enables FluentTyper for a conflicting field",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      await page.waitForFunction(
        () =>
          document
            .querySelector("#test-native-list")
            ?.parentElement?.querySelector(".ft-manual-attach-button") instanceof HTMLButtonElement,
        { timeout: timeoutProfile.inputReadyMs },
      );

      await page.evaluate(() => {
        const button = document
          .querySelector("#test-native-list")
          ?.parentElement?.querySelector(".ft-manual-attach-button") as HTMLButtonElement | null;
        button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      await waitUntil(
        "native list input to gain data-suggestion after manual attach",
        async () => {
          return await page!.$eval(
            "#test-native-list",
            (el) => el.hasAttribute("data-suggestion") && document.activeElement === el,
          );
        },
        { timeoutMs: suiteTimeout(3000, 6000) },
      );

      await typeInInput(page, "#test-native-list", "th");
      const suggestions = await waitForVisibleSuggestionTexts(page);
      expect(suggestions.length).toBeGreaterThan(0);
    },
    suiteTimeout(10000, 15000),
  );

  test(
    "manual attach icon force-enables structured autocomplete fields",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      for (const selector of ["#test-semantic-email"]) {
        await page.waitForFunction(
          (fieldSelector) =>
            document
              .querySelector(fieldSelector)
              ?.parentElement?.querySelector(".ft-manual-attach-button") instanceof
            HTMLButtonElement,
          { timeout: timeoutProfile.inputReadyMs },
          selector,
        );

        await page.evaluate((fieldSelector) => {
          const button = document
            .querySelector(fieldSelector)
            ?.parentElement?.querySelector(".ft-manual-attach-button") as HTMLButtonElement | null;
          button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
          button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        }, selector);

        await waitUntil(
          `${selector} to gain data-suggestion after manual attach`,
          async () => {
            return await page!.$eval(
              selector,
              (el) => el.hasAttribute("data-suggestion") && document.activeElement === el,
            );
          },
          { timeoutMs: suiteTimeout(3000, 6000) },
        );

        await typeInInput(page, selector, "th");
        const suggestions = await waitForVisibleSuggestionTexts(page);
        expect(suggestions.length).toBeGreaterThan(0);
        await clearInputContent(page, selector);
      }
    },
    suiteTimeout(12000, 18000),
  );

  test(
    "attaches to input inside open shadow root and shows suggestions on typing",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      // Inject a custom element with an open shadow root containing a text input.
      await page.evaluate(() => {
        class FtShadowTestComponent extends HTMLElement {
          constructor() {
            super();
            const shadow = this.attachShadow({ mode: "open" });
            const input = document.createElement("input");
            input.type = "text";
            shadow.appendChild(input);
          }
        }
        customElements.define("ft-shadow-test-component", FtShadowTestComponent);
        document.body.appendChild(document.createElement("ft-shadow-test-component"));
      });

      // Focus the shadow-hosted input so the runtime's late-discovery
      // listeners can detect it and attach a suggestion helper.
      await page.evaluate(() => {
        const host = document.querySelector("ft-shadow-test-component");
        (host?.shadowRoot?.querySelector("input") as HTMLInputElement | null)?.focus();
      });

      // Wait for the extension to attach to the shadow-hosted input.
      await waitUntil(
        "shadow root input to gain data-suggestion",
        async () => {
          const attached = await page!.evaluate(() => {
            const host = document.querySelector("ft-shadow-test-component");
            return (
              host?.shadowRoot?.querySelector("input")?.hasAttribute("data-suggestion") ?? false
            );
          });
          return attached;
        },
        { timeoutMs: timeoutProfile.inputReadyMs },
      );

      // Type and verify the suggestion popup appears.
      await page.keyboard.type("h");

      const suggestions = await waitForVisibleSuggestionTexts(page);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]?.toLowerCase()).toMatch(/^h\S*/);
    },
    suiteTimeout(15000, 22000),
  );

  test(
    "discovers input in shadow root created on a host already in the DOM",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      // Step 1: Insert a bare host element with no shadow root.
      // The extension processes this mutation but finds nothing to attach to.
      await page.evaluate(() => {
        const host = document.createElement("div");
        host.id = "ft-late-shadow-host";
        document.body.appendChild(host);
      });

      // Wait long enough for the extension's mutation coalesce cycle to finish.
      await sleep(100);

      // Step 2: Call attachShadow() on the now-stationary host and append an
      // input.  No DOM mutation fires on the parent, so the extension must use
      // the attachShadow() interceptor to detect this shadow root.
      await page.evaluate(() => {
        const host = document.getElementById("ft-late-shadow-host")!;
        const shadow = host.attachShadow({ mode: "open" });
        const input = document.createElement("input");
        input.type = "text";
        shadow.appendChild(input);
      });

      // Focus the late shadow-hosted input so the runtime's interaction fallback
      // can attach helpers even if attachShadow interception is unavailable.
      await page.evaluate(() => {
        const host = document.getElementById("ft-late-shadow-host");
        (host?.shadowRoot?.querySelector("input") as HTMLInputElement | null)?.focus();
      });

      // Wait for the extension to attach to the shadow-hosted input.
      await waitUntil(
        "late shadow root input to gain data-suggestion",
        async () => {
          const attached = await page!.evaluate(() => {
            const host = document.getElementById("ft-late-shadow-host");
            return (
              host?.shadowRoot?.querySelector("input")?.hasAttribute("data-suggestion") ?? false
            );
          });
          return attached;
        },
        { timeoutMs: timeoutProfile.inputReadyMs },
      );

      // Verify suggestions appear when the user types.
      await page.keyboard.type("h");

      const suggestions = await waitForVisibleSuggestionTexts(page);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]?.toLowerCase()).toMatch(/^h\S*/);
    },
    suiteTimeout(15000, 22000),
  );

  test(
    "discovers input in nested shadow root created on a host inside another shadow tree",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      // Step 1: Create an outer shadow tree with an inner host but no inner
      // shadow root yet. This exercises browser event retargeting when the late
      // attachShadow() notification bubbles back to the document listener.
      await page.evaluate(() => {
        const outerHost = document.createElement("div");
        outerHost.id = "ft-nested-shadow-outer-host";
        document.body.appendChild(outerHost);

        const outerShadow = outerHost.attachShadow({ mode: "open" });
        const innerHost = document.createElement("div");
        innerHost.id = "ft-nested-shadow-inner-host";
        outerShadow.appendChild(innerHost);
      });

      await sleep(100);

      // Step 2: Attach an inner shadow root after the host is already stable in
      // the outer shadow tree, then add an input. The extension must recover the
      // original dispatcher via composedPath()[0], not the retargeted event.target.
      await page.evaluate(() => {
        const outerHost = document.getElementById("ft-nested-shadow-outer-host");
        const innerHost = outerHost?.shadowRoot?.querySelector("#ft-nested-shadow-inner-host");
        const innerShadow = (innerHost as HTMLElement | null)?.attachShadow({ mode: "open" });
        const input = document.createElement("input");
        input.type = "text";
        innerShadow?.appendChild(input);
      });

      await page.evaluate(() => {
        const outerHost = document.getElementById("ft-nested-shadow-outer-host");
        const innerHost = outerHost?.shadowRoot?.querySelector("#ft-nested-shadow-inner-host");
        (
          (innerHost as HTMLElement | null)?.shadowRoot?.querySelector(
            "input",
          ) as HTMLInputElement | null
        )?.focus();
      });

      await waitUntil(
        "nested late shadow root input to gain data-suggestion",
        async () => {
          const attached = await page!.evaluate(() => {
            const outerHost = document.getElementById("ft-nested-shadow-outer-host");
            const innerHost = outerHost?.shadowRoot?.querySelector("#ft-nested-shadow-inner-host");
            return (
              (innerHost as HTMLElement | null)?.shadowRoot
                ?.querySelector("input")
                ?.hasAttribute("data-suggestion") ?? false
            );
          });
          return attached;
        },
        { timeoutMs: timeoutProfile.inputReadyMs },
      );

      await page.keyboard.type("h");

      const suggestions = await waitForVisibleSuggestionTexts(page);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]?.toLowerCase()).toMatch(/^h\S*/);
    },
    suiteTimeout(15000, 22000),
  );

  test(
    "reattaches to input when disabled attribute is removed and shows suggestions on typing",
    async () => {
      page = await prepareReusableTestPage(browser, page);

      const beforeEnable = await page.evaluate(
        () => document.querySelector("#test-disabled")?.hasAttribute("data-suggestion") ?? false,
      );
      expect(beforeEnable).toBe(false);

      await page.evaluate(() => {
        document.querySelector("#test-disabled")?.removeAttribute("disabled");
      });

      // Wait for the extension to detect the attribute change and attach the helper.
      await waitUntil(
        "disabled input to gain data-suggestion after re-enable",
        async () => {
          const attached = await page!.evaluate(
            () =>
              document.querySelector("#test-disabled")?.hasAttribute("data-suggestion") ?? false,
          );
          return attached;
        },
        { timeoutMs: suiteTimeout(5000, 8000) },
      );

      // Verify the full user experience: focus the now-enabled input, type a
      // character, and assert the suggestion popup actually appears on screen.
      await page.focus("#test-disabled");
      const element = await page.$("#test-disabled");
      await element!.type("h");

      const suggestions = await waitForVisibleSuggestionTexts(page);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]?.toLowerCase()).toMatch(/^h\S*/);
    },
    suiteTimeout(15000, 22000),
  );

  test(
    "review mode fixes a textarea from one snapshot without changing it on start",
    async () => {
      await setSetting(
        worker,
        KEY_ENABLED_GRAMMAR_RULES,
        grammarRuleSelectionToOverrides(DEFAULT_CURRENT_GRAMMAR_RULES),
      );
      await notifyConfigChange(browser, worker);
      page = await prepareReusableTestPage(browser, page);
      await waitForInputReady(page, "#test-textarea");
      const original = "i saw teh cat , and their is more.";
      await page.evaluate((value) => {
        const field = document.querySelector("#test-textarea") as HTMLTextAreaElement;
        field.value = value;
        field.focus();
        field.setSelectionRange(0, 0);
      }, original);

      await triggerReview(worker);
      const panel = await waitForReview(page, "smoke review findings", (p) =>
        /^Issues: \d+$/.test(p.status),
      );
      expect(panel.items.length).toBe(4);
      expect(await page.$eval("#test-textarea", (el) => (el as HTMLTextAreaElement).value)).toBe(
        original,
      );

      await clickReviewControl(page, "[data-action=fix-all]");
      await waitUntil(
        "smoke review fix all",
        async () =>
          (await page!.$eval("#test-textarea", (el) => (el as HTMLTextAreaElement).value)) ===
          "I saw the cat, and there is more.",
        { timeoutMs: suiteTimeout(4000, 6000) },
      );
      await page.keyboard.press("Escape");
      await waitForReview(page, "smoke review closed", (p) => !p.open);
    },
    suiteTimeout(15000, 22000),
  );
});
