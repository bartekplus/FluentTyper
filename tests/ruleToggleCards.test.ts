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
    sectionSafeLabel: "Safe defaults",
    sectionAdvancedLabel: "Advanced (optional)",
    filterAllLabel: "All",
    filterSafeLabel: "Safe",
    filterAdvancedLabel: "Advanced",
    filterRecommendedLabel: "Recommended",
    filterEnglishOnlyLabel: "English only",
    filterEnabledOnlyLabel: "Enabled only",
    actions: [
      {
        text: "Safe defaults",
        values: ["safePunctuation", "englishPronounI"],
      },
      {
        text: "Enable all",
        values: ["safePunctuation", "advancedEllipsis", "englishPronounI"],
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
    const grammarSetting = manifest.settings.find(
      (entry) => entry.name === KEY_ENABLED_GRAMMAR_RULES,
    ) as Record<string, unknown> | undefined;

    expect(grammarSetting).toBeDefined();
    expect(grammarSetting?.tab).toBe(i18n.get("grammar_tab"));
    expect(i18n.get("grammar_tab")).not.toBe("grammar_tab");

    const options = (grammarSetting?.options || []) as Array<Record<string, unknown>>;
    expect(options.length).toBeGreaterThan(0);
    const sample = options[0];
    expect(["safe", "advanced"]).toContain(sample.safetyTier);
    expect(["all", "en_US"]).toContain(sample.languageScope);
  });

  test("search and tier/language filters narrow visible grammar cards", () => {
    const { host } = buildRuleToggleCardsHost();

    expect(visibleRuleValues(host)).toEqual([
      "safePunctuation",
      "englishPronounI",
      "advancedEllipsis",
    ]);

    clickFilter(host, "advanced");
    expect(visibleRuleValues(host)).toEqual(["advancedEllipsis"]);

    clickFilter(host, "english");
    expect(visibleRuleValues(host)).toEqual(["englishPronounI"]);

    clickFilter(host, "recommended");
    expect(visibleRuleValues(host)).toEqual(["safePunctuation"]);

    clickFilter(host, "all");
    const searchInput = host.querySelector(".grammar-rule-search-input");
    expect(searchInput).toBeInstanceOf(HTMLElement);
    const input = searchInput as HTMLInputElement;
    input.value = "ellipsis";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(visibleRuleValues(host)).toEqual(["advancedEllipsis"]);
  });

  test("bulk actions and enabled-only filter stay in sync with selected rule values", () => {
    const { host, bundle } = buildRuleToggleCardsHost();

    const safeDefaultsButton = host.querySelector(".grammar-rule-selector-actions .button");
    expect(safeDefaultsButton).toBeInstanceOf(HTMLElement);
    (safeDefaultsButton as HTMLElement).dispatchEvent(new Event("click", { bubbles: true }));

    expect(bundle.get()).toEqual(["safePunctuation", "englishPronounI"]);

    clickFilter(host, "enabled");
    expect(visibleRuleValues(host)).toEqual(["safePunctuation", "englishPronounI"]);

    const noMatches = host.querySelector(".grammar-rule-selector-no-results");
    expect(noMatches).toBeInstanceOf(HTMLElement);
    expect((noMatches as HTMLElement).classList.contains("is-hidden")).toBe(true);
  });
});
