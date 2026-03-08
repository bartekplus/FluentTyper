import "./setup";
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { KEY_ENABLED_GRAMMAR_RULES } from "../src/core/domain/constants";
import { manifest } from "../src/ui/options/settingsManifest.js";
import { i18n } from "../src/ui/options/fluenttyperI18n.js";
import { RuleToggleCardsControl } from "../src/ui/settings-engine/controls/RuleToggleCardsControl.js";
import { Store } from "../src/ui/settings-engine/store/Store.js";

function buildRuleToggleCardsHost() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const store = new Store("test");
  const control = new RuleToggleCardsControl(
    {
      type: "ruleToggleCards",
      tab: "",
      group: "",
      label: "Grammar Rules",
      summaryLabel: "Active rules",
      emptyStateText: "No grammar rules enabled.",
      noMatchesText: "No grammar rules match your search.",
      searchPlaceholder: "Search grammar rules...",
      sectionSafeLabel: "Safe rules",
      sectionAdvancedLabel: "Advanced (optional)",
      filterAllLabel: "All",
      filterSafeLabel: "Safe",
      filterAdvancedLabel: "Advanced",
      filterEnglishOnlyLabel: "English only",
      filterEnabledOnlyLabel: "Enabled only",
      actions: [
        {
          actionKey: "recommended",
          text: "Recommended",
          values: ["safePunctuation", "englishPronounI"],
        },
        {
          actionKey: "enable_all",
          text: "Enable all",
          values: ["safePunctuation", "advancedEllipsis", "englishPronounI"],
        },
        {
          actionKey: "disable_all",
          text: "Disable all",
          values: [],
        },
      ],
      options: [
        {
          value: "safePunctuation",
          text: "Safe punctuation spacing",
          description: "Fixes punctuation spacing in common prose.",
          example: 'Example: "Hello ,world" -> "Hello, world"',
          safetyTier: "safe",
          languageScope: "all",
        },
        {
          value: "advancedEllipsis",
          text: "Ellipsis shortcut",
          description: "Converts three dots into an ellipsis.",
          example: 'Example: "..." -> "…"',
          safetyTier: "advanced",
          languageScope: "all",
        },
        {
          value: "englishPronounI",
          text: "English pronoun I",
          description: 'Capitalizes standalone English "i".',
          example: 'Example: "i am" -> "I am"',
          safetyTier: "safe",
          languageScope: "en_US",
        },
      ],
      default: [],
    },
    store,
  );
  host.appendChild(control.rootElement);
  return { host, bundle: control };
}

function visibleRuleValues(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll(".grammar-rule-card"))
    .filter((card) => !card.classList.contains("is-hidden"))
    .map((card) => (card.querySelector(".grammar-rule-card-toggle") as HTMLInputElement).value);
}

function visibleRuleCards(host: HTMLElement): HTMLLabelElement[] {
  return Array.from(host.querySelectorAll(".grammar-rule-card")).filter(
    (card): card is HTMLLabelElement =>
      card instanceof HTMLElement &&
      card.tagName.toLowerCase() === "label" &&
      !card.classList.contains("is-hidden"),
  );
}

function findRuleCard(host: HTMLElement, value: string): HTMLLabelElement {
  const input = host.querySelector(
    `.grammar-rule-card-toggle[value="${value}"]`,
  ) as HTMLInputElement | null;
  if (
    !(input instanceof HTMLElement) ||
    input.tagName.toLowerCase() !== "input" ||
    !(input.parentElement instanceof HTMLElement) ||
    input.parentElement.tagName.toLowerCase() !== "label"
  ) {
    throw new Error(`Missing rule card ${value}`);
  }
  return input.parentElement as HTMLLabelElement;
}

function pressKey(target: HTMLElement, key: string): void {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true });
  target.dispatchEvent(event);
}

function clickFilter(host: HTMLElement, filterKey: string): void {
  const button = host.querySelector(`.grammar-rule-filter-button[data-filter="${filterKey}"]`);
  if (!(button instanceof HTMLElement)) {
    throw new Error(`Missing filter button ${filterKey}`);
  }
  button.dispatchEvent(new Event("click", { bubbles: true }));
}

describe("ruleToggleCards setting", () => {
  let fakeTimersActive = false;

  beforeEach(() => {
    document.body.innerHTML = "";
    fakeTimersActive = false;
  });

  afterEach(() => {
    if (fakeTimersActive) {
      jest.clearAllTimers();
    }
    jest.useRealTimers();
  });

  test("manifest maps grammar rules to the dedicated grammar tab with metadata", () => {
    const grammarUiI18nKeys = [
      "grammar_tab",
      "grammar_rules_search_placeholder",
      "grammar_rules_no_matches",
      "grammar_rules_filter_all",
      "grammar_rules_filter_safe",
      "grammar_rules_filter_advanced",
      "grammar_rules_filter_english_only",
      "grammar_rules_filter_enabled_only",
      "grammar_rules_section_safe",
      "grammar_rules_section_advanced",
    ] as const;
    for (const key of grammarUiI18nKeys) {
      const translated = i18n.get(key);
      expect(typeof translated).toBe("string");
      expect((translated as string).trim().length).toBeGreaterThan(0);
      expect(translated).not.toBe(key);
    }

    const grammarSetting = manifest.settings.find(
      (entry) => entry.name === KEY_ENABLED_GRAMMAR_RULES,
    ) as Record<string, unknown> | undefined;

    expect(grammarSetting).toBeDefined();
    expect(grammarSetting?.tab).toBe("grammar_tab");
    expect(grammarSetting?.filterRecommendedLabel).toBeUndefined();

    const options = (grammarSetting?.options || []) as Array<Record<string, unknown>>;
    expect(options.length).toBeGreaterThan(0);

    for (const option of options) {
      expect(option).toHaveProperty("safetyTier");
      expect(option).toHaveProperty("languageScope");
      expect(["safe", "advanced"]).toContain(option.safetyTier);
      expect(["all", "en_US"]).toContain(option.languageScope);
    }

    const actions = (grammarSetting?.actions || []) as Array<Record<string, unknown>>;
    const actionLabels = actions.map((action) => action.text);
    expect(actionLabels).toEqual([
      i18n.get("grammar_rules_recommended"),
      i18n.get("grammar_rules_enable_all"),
      i18n.get("grammar_rules_disable_all"),
    ]);
    expect(actionLabels).not.toContain(i18n.get("grammar_rules_safe_defaults"));
  });

  test("search waits for a 300 ms debounce and clear-search restores results immediately", () => {
    jest.useFakeTimers();
    fakeTimersActive = true;

    const { host } = buildRuleToggleCardsHost();
    const noMatches = host.querySelector(".grammar-rule-selector-no-results");
    expect(noMatches).toBeInstanceOf(HTMLElement);
    expect((noMatches as HTMLElement).classList.contains("is-hidden")).toBe(true);

    expect(visibleRuleValues(host)).toEqual([
      "safePunctuation",
      "englishPronounI",
      "advancedEllipsis",
    ]);

    const searchInput = host.querySelector(".grammar-rule-search-input");
    expect(searchInput).toBeInstanceOf(HTMLElement);
    const input = searchInput as HTMLInputElement;
    const clearButton = host.querySelector(".grammar-rule-search-clear");
    expect(clearButton).toBeInstanceOf(HTMLElement);

    input.value = "ellipsis";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(visibleRuleValues(host)).toEqual([
      "safePunctuation",
      "englishPronounI",
      "advancedEllipsis",
    ]);
    jest.advanceTimersByTime(299);
    expect(visibleRuleValues(host)).toEqual([
      "safePunctuation",
      "englishPronounI",
      "advancedEllipsis",
    ]);
    jest.advanceTimersByTime(1);
    expect(visibleRuleValues(host)).toEqual(["advancedEllipsis"]);
    expect((noMatches as HTMLElement).classList.contains("is-hidden")).toBe(true);

    input.value = "definitely-no-such-rule";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    jest.advanceTimersByTime(300);
    expect(visibleRuleValues(host)).toEqual([]);
    expect((noMatches as HTMLElement).classList.contains("is-hidden")).toBe(false);

    (clearButton as HTMLElement).dispatchEvent(new Event("click", { bubbles: true }));

    expect(input.value).toBe("");
    expect(visibleRuleValues(host)).toEqual([
      "safePunctuation",
      "englishPronounI",
      "advancedEllipsis",
    ]);
    expect((noMatches as HTMLElement).classList.contains("is-hidden")).toBe(true);
  });

  test("tier and language filters narrow visible grammar cards", () => {
    const { host } = buildRuleToggleCardsHost();

    clickFilter(host, "advanced");
    expect(visibleRuleValues(host)).toEqual(["advancedEllipsis"]);

    clickFilter(host, "english");
    expect(visibleRuleValues(host)).toEqual(["englishPronounI"]);

    const recommendedFilterButton = host.querySelector(
      '.grammar-rule-filter-button[data-filter="recommended"]',
    );
    expect(recommendedFilterButton).toBeNull();
  });

  test("uses roving tabindex for cards and supports arrow and Space keyboard control", () => {
    const { host, bundle } = buildRuleToggleCardsHost();

    const safeCard = findRuleCard(host, "safePunctuation");
    const englishCard = findRuleCard(host, "englishPronounI");
    const advancedCard = findRuleCard(host, "advancedEllipsis");

    expect(visibleRuleCards(host).map((card) => card.tabIndex)).toEqual([0, -1, -1]);
    expect(
      Array.from(host.querySelectorAll(".grammar-rule-card-toggle")).map((input) =>
        (input as HTMLInputElement).tabIndex,
      ),
    ).toEqual([-1, -1, -1]);

    safeCard.focus();
    expect(document.activeElement).toBe(safeCard);

    pressKey(safeCard, "ArrowDown");
    expect(visibleRuleCards(host).map((card) => card.tabIndex)).toEqual([-1, 0, -1]);
    expect(host.querySelector('.grammar-rule-card[tabindex="0"]')).toBe(englishCard);

    pressKey(englishCard, "ArrowRight");
    expect(visibleRuleCards(host).map((card) => card.tabIndex)).toEqual([-1, -1, 0]);
    expect(host.querySelector('.grammar-rule-card[tabindex="0"]')).toBe(advancedCard);

    pressKey(advancedCard, " ");
    expect(bundle.get()).toEqual(["advancedEllipsis"]);
    expect(
      (advancedCard.querySelector(".grammar-rule-card-toggle") as HTMLInputElement).checked,
    ).toBe(true);

    clickFilter(host, "advanced");
    expect(visibleRuleValues(host)).toEqual(["advancedEllipsis"]);
    expect(visibleRuleCards(host).map((card) => card.tabIndex)).toEqual([0]);
    expect(safeCard.tabIndex).toBe(-1);
    expect(englishCard.tabIndex).toBe(-1);
  });

  test("bulk actions and enabled-only filter stay in sync with selected rule values", () => {
    const { host, bundle } = buildRuleToggleCardsHost();

    const recommendedButton = host.querySelector(
      '.grammar-rule-selector-actions .button[data-action="recommended"]',
    );
    expect(recommendedButton).toBeInstanceOf(HTMLElement);
    (recommendedButton as HTMLElement).dispatchEvent(new Event("click", { bubbles: true }));

    expect(bundle.get()).toEqual(["safePunctuation", "englishPronounI"]);

    clickFilter(host, "enabled");
    expect(visibleRuleValues(host)).toEqual(["safePunctuation", "englishPronounI"]);

    const noMatches = host.querySelector(".grammar-rule-selector-no-results");
    expect(noMatches).toBeInstanceOf(HTMLElement);
    expect((noMatches as HTMLElement).classList.contains("is-hidden")).toBe(true);
  });
});
