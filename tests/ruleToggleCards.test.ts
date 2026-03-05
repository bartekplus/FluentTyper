import "./setup";
import { beforeEach, describe, expect, test } from "bun:test";
import { KEY_ENABLED_GRAMMAR_RULES } from "../src/core/domain/constants";
import { manifest } from "../src/third_party/fancier-settings/manifest.js";
import { i18n } from "../src/third_party/fancier-settings/i18n.js";
import { Setting } from "../src/third_party/fancier-settings/js/classes/setting.js";

function buildRuleToggleCardsHost() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const setting = new Setting(host);
  const bundle = setting.create({
    type: "ruleToggleCards",
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
        recommended: true,
        safetyTier: "safe",
        languageScope: "all",
      },
      {
        value: "advancedEllipsis",
        text: "Ellipsis shortcut",
        description: "Converts three dots into an ellipsis.",
        example: 'Example: "..." -> "…"',
        recommended: false,
        safetyTier: "advanced",
        languageScope: "all",
      },
      {
        value: "englishPronounI",
        text: "English pronoun I",
        description: 'Capitalizes standalone English "i".',
        example: 'Example: "i am" -> "I am"',
        recommended: false,
        safetyTier: "safe",
        languageScope: "en_US",
      },
    ],
    default: [],
  }) as {
    get: () => string[];
  };

  return { host, bundle };
}

function visibleRuleValues(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll(".grammar-rule-card"))
    .filter((card) => !card.classList.contains("is-hidden"))
    .map((card) => (card.querySelector(".grammar-rule-card-toggle") as HTMLInputElement).value);
}

function clickFilter(host: HTMLElement, filterKey: string): void {
  const button = host.querySelector(`.grammar-rule-filter-button[data-filter="${filterKey}"]`);
  if (!(button instanceof HTMLElement)) {
    throw new Error(`Missing filter button ${filterKey}`);
  }
  button.dispatchEvent(new Event("click", { bubbles: true }));
}

describe("ruleToggleCards setting", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
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
    expect(grammarSetting?.tab).toBe(i18n.get("grammar_tab"));
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

  test("search and tier/language filters narrow visible grammar cards", () => {
    const { host } = buildRuleToggleCardsHost();
    const noMatches = host.querySelector(".grammar-rule-selector-no-results");
    expect(noMatches).toBeInstanceOf(HTMLElement);
    expect((noMatches as HTMLElement).classList.contains("is-hidden")).toBe(true);

    expect(visibleRuleValues(host)).toEqual([
      "safePunctuation",
      "englishPronounI",
      "advancedEllipsis",
    ]);

    clickFilter(host, "advanced");
    expect(visibleRuleValues(host)).toEqual(["advancedEllipsis"]);

    clickFilter(host, "english");
    expect(visibleRuleValues(host)).toEqual(["englishPronounI"]);

    const recommendedFilterButton = host.querySelector(
      '.grammar-rule-filter-button[data-filter="recommended"]',
    );
    expect(recommendedFilterButton).toBeNull();

    clickFilter(host, "all");
    const searchInput = host.querySelector(".grammar-rule-search-input");
    expect(searchInput).toBeInstanceOf(HTMLElement);
    const input = searchInput as HTMLInputElement;
    input.value = "ellipsis";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(visibleRuleValues(host)).toEqual(["advancedEllipsis"]);
    expect((noMatches as HTMLElement).classList.contains("is-hidden")).toBe(true);

    input.value = "definitely-no-such-rule";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(visibleRuleValues(host)).toEqual([]);
    expect((noMatches as HTMLElement).classList.contains("is-hidden")).toBe(false);

    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(visibleRuleValues(host).length).toBeGreaterThan(0);
    expect((noMatches as HTMLElement).classList.contains("is-hidden")).toBe(true);
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
