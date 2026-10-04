import { describe, expect, test } from "bun:test";
import { renderGrammarWorkspacePanel } from "../src/ui/options/GrammarWorkspacePanel.js";
import {
  DATA_CARDS,
  ESSENTIALS_CARDS,
  OBSERVABILITY_CARDS,
} from "../src/ui/options/settingsManifest.js";
import { renderControlCards } from "../src/ui/options/workspacePanelUtils.js";
import { i18n } from "../src/ui/options/fluenttyperI18n.js";
import {
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_REVIEW_RULE_OVERRIDES,
  KEY_REVIEW_LONG_SENTENCE_WORDS,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_INLINE_SUGGESTION,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_NUM_SUGGESTIONS,
  KEY_PERSONALIZATION_ENABLED,
  KEY_OBSERVABILITY_DEFAULT_LEVEL,
  KEY_OBSERVABILITY_ENABLED,
  KEY_OBSERVABILITY_MODULE_OVERRIDES,
  KEY_PREFER_NATIVE_AUTOCOMPLETE,
  KEY_SELECT_BY_DIGIT,
} from "../src/core/domain/constants";
import { fakeRegistry } from "./support/settingsFakes";

/** Makes a content tab with one settings group for each entry. Each group holds its controls. */
function createGroups(
  groups: Record<string, Record<string, string>>,
  ungrouped: Record<string, string> = {},
) {
  const tab = document.createElement("section");
  tab.className = "content-tab";
  const panelRoot = document.createElement("div");
  tab.appendChild(panelRoot);
  document.body.appendChild(tab);
  const registry = fakeRegistry({}, Object.assign({ ...ungrouped }, ...Object.values(groups)));
  for (const [label, controls] of Object.entries(groups)) {
    const section = document.createElement("section");
    section.className = "settings-group";
    const header = document.createElement("div");
    header.className = "settings-group-header";
    const title = document.createElement("h3");
    title.className = "settings-group-title";
    title.textContent = label;
    header.appendChild(title);
    const body = document.createElement("div");
    body.className = "settings-group-body";
    for (const key of Object.keys(controls)) {
      body.appendChild(registry[key].rootElement);
    }
    section.append(header, body);
    tab.appendChild(section);
  }
  return { tab, panelRoot, registry };
}

describe("options workspace panels", () => {
  test("essentials workspace absorbs legacy groups into card layout", () => {
    const { tab, panelRoot, registry } = createGroups({
      General: {
        enable: "Enable FluentTyper",
        [KEY_PREFER_NATIVE_AUTOCOMPLETE]: "Prefer native autocomplete",
      },
      Prediction: {
        [KEY_NUM_SUGGESTIONS]: "Number of suggestions",
        [KEY_MIN_WORD_LENGTH_TO_PREDICT]: "Minimum characters",
        [KEY_PERSONALIZATION_ENABLED]: "Learn from accepted suggestions",
      },
      Accept: {
        [KEY_AUTOCOMPLETE_ON_TAB]: "Accept on Tab",
        [KEY_AUTOCOMPLETE_ON_ENTER]: "Accept on Enter",
        [KEY_AUTOCOMPLETE]: "Accept on Space",
        [KEY_SELECT_BY_DIGIT]: "Choose with digits",
      },
      After: {
        [KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE]: "Insert space after accept",
        [KEY_INLINE_SUGGESTION]: "Inline suggestion",
      },
    });

    renderControlCards(panelRoot, registry, ESSENTIALS_CARDS);

    expect(panelRoot.textContent).toContain("Enable FluentTyper");
    expect(panelRoot.textContent).toContain("Prefer native autocomplete");
    expect(panelRoot.textContent).toContain("Number of suggestions");
    expect(panelRoot.textContent).toContain("Learn from accepted suggestions");
    expect(panelRoot.textContent).toContain("Inline suggestion");
    expect(tab.querySelectorAll(".settings-group.is-empty-workspace-group")).toHaveLength(4);
  });

  test("data workspace keeps diagnostics limited to productivity and import/export", () => {
    const { tab, panelRoot, registry } = createGroups({
      Productivity: {
        productivityStatsPanel: "Productivity graph",
        resetProductivityStatsButton: "Reset stats",
      },
      Config: {
        importSettingButton: "Import settings",
        exportSettingButton: "Export settings",
        clearPersonalizationButton: "Clear learned words",
      },
    });
    renderControlCards(panelRoot, registry, DATA_CARDS);

    expect(panelRoot.textContent).toContain("Productivity graph");
    expect(panelRoot.textContent).toContain("Import settings");
    expect(panelRoot.textContent).toContain("Clear learned words");
    expect(panelRoot.textContent).toContain(i18n.get("data_panel_transfer_copy"));
    expect(panelRoot.textContent).not.toContain("Debug dashboard");
    expect(
      panelRoot.querySelectorAll(".workspace-panel-stack > .settings-inline-card"),
    ).toHaveLength(2);
    expect(tab.querySelectorAll(".settings-group.is-empty-workspace-group")).toHaveLength(2);
  });

  test("observability workspace groups controls, predictor settings, and dashboard shell", () => {
    const { panelRoot, registry } = createGroups(
      {
        Controls: {
          [KEY_OBSERVABILITY_ENABLED]: "Observability enabled",
          [KEY_OBSERVABILITY_DEFAULT_LEVEL]: "Default log level",
        },
        Predictor: { [KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED]: "Trace Presage" },
        Dashboard: { observabilityPanel: "Observability dashboard" },
      },
      { [KEY_OBSERVABILITY_MODULE_OVERRIDES]: "Overrides" },
    );

    renderControlCards(panelRoot, registry, OBSERVABILITY_CARDS);

    expect(panelRoot.textContent).toContain("Observability enabled");
    expect(panelRoot.textContent).toContain("Trace Presage");
    expect(panelRoot.textContent).toContain("Observability dashboard");
    expect(
      panelRoot.querySelectorAll(".workspace-panel-stack > .settings-inline-card"),
    ).toHaveLength(3);
  });

  test("readability threshold uses validated native input and does not enable advice", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const registry = fakeRegistry(
      { [KEY_REVIEW_LONG_SENTENCE_WORDS]: "bad" },
      { [KEY_ENABLED_GRAMMAR_RULES]: "Rules", [KEY_REVIEW_LONG_SENTENCE_WORDS]: "Threshold" },
    );
    const threshold = registry[KEY_REVIEW_LONG_SENTENCE_WORDS];
    renderGrammarWorkspacePanel(root, registry);
    const input = root.querySelector<HTMLInputElement>("#review-long-sentence-words")!;
    expect(input.value).toBe("35");
    expect(input.closest("label")?.textContent).toContain("Long-sentence word threshold");
    expect(input.getAttribute("aria-describedby")).toBe("review-long-sentence-help");
    for (const value of ["", "9", "201", "10.5"]) {
      input.value = value;
      input.dispatchEvent(new Event("change"));
      expect(threshold.get()).toBe("bad");
    }
    input.value = "40";
    input.dispatchEvent(new Event("change"));
    expect(threshold.get()).toBe(40);
  });

  test("grammar rule matrix edits typing and Review rules independently", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const registry = fakeRegistry(
      { [KEY_ENABLED_GRAMMAR_RULES]: {}, [KEY_REVIEW_RULE_OVERRIDES]: {} },
      { [KEY_ENABLED_GRAMMAR_RULES]: "Typing", [KEY_REVIEW_RULE_OVERRIDES]: "Review" },
    );
    const typing = registry[KEY_ENABLED_GRAMMAR_RULES];
    const review = registry[KEY_REVIEW_RULE_OVERRIDES];
    renderGrammarWorkspacePanel(root, registry);

    const matrix = root.querySelector(".rule-matrix")!;
    const switchFor = (key: string, rule: string) =>
      matrix.querySelector<HTMLInputElement>(`input[data-setting="${key}"][value="${rule}"]`);

    // Typing-only, Review-only and shared rules each get the right switches.
    expect(switchFor(KEY_ENABLED_GRAMMAR_RULES, "doubleSpaceToPeriod")).not.toBeNull();
    expect(switchFor(KEY_REVIEW_RULE_OVERRIDES, "doubleSpaceToPeriod")).toBeNull();
    expect(switchFor(KEY_ENABLED_GRAMMAR_RULES, "englishRepeatedWords")).toBeNull();
    expect(switchFor(KEY_REVIEW_RULE_OVERRIDES, "englishRepeatedWords")).not.toBeNull();
    const shared = switchFor(KEY_ENABLED_GRAMMAR_RULES, "capitalizeSentenceStart")!;
    expect(shared.checked).toBe(true);
    expect(switchFor(KEY_REVIEW_RULE_OVERRIDES, "capitalizeSentenceStart")).not.toBeNull();

    shared.checked = false;
    shared.dispatchEvent(new Event("change"));
    expect(typing.get()).toEqual({ capitalizeSentenceStart: false });
    expect(review.get()).toEqual({});

    matrix.querySelector<HTMLButtonElement>('[data-action="restore-defaults"]')!.click();
    expect(typing.get()).toEqual({});
    expect(review.get()).toEqual({});
  });
});
