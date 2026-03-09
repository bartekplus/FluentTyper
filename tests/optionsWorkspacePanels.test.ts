import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import type { SettingsRegistry } from "../src/ui/settings-engine/SettingsEngine.js";
import { EssentialsWorkspacePanel } from "../src/ui/options/EssentialsWorkspacePanel.js";
import { DataDiagnosticsPanel } from "../src/ui/options/DataDiagnosticsPanel.js";
import { GrammarWorkspacePanel } from "../src/ui/options/GrammarWorkspacePanel.js";
import { ObservabilityWorkspacePanel } from "../src/ui/options/ObservabilityWorkspacePanel.js";
import { i18n } from "../src/ui/options/fluenttyperI18n.js";
import {
  KEY_AI_MODEL_ID,
  KEY_AI_PREDICTION_TIMEOUT_MS,
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_DEBUG_AI_PREDICTOR_ENABLED,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_INLINE_SUGGESTION,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_NUM_SUGGESTIONS,
  KEY_OBSERVABILITY_DEFAULT_LEVEL,
  KEY_OBSERVABILITY_ENABLED,
  KEY_OBSERVABILITY_MODULE_OVERRIDES,
  KEY_PREFER_NATIVE_AUTOCOMPLETE,
  KEY_SELECT_BY_DIGIT,
} from "../src/core/domain/constants";

class MockPanelControl {
  readonly rootElement: HTMLElement;
  readonly element: HTMLElement;
  private value: unknown;

  constructor(label: string, value?: unknown) {
    this.rootElement = document.createElement("div");
    this.rootElement.className = "field";
    this.rootElement.textContent = label;
    this.element = this.rootElement;
    this.value = value;
  }

  get(): unknown {
    return this.value;
  }

  set(value: unknown): this {
    this.value = value;
    return this;
  }

  addEvent(): void {}

  destroy(): void {}
}

function createGroup(tab: HTMLElement, label: string, controls: MockPanelControl[]) {
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
  controls.forEach((control) => body.appendChild(control.rootElement));
  section.append(header, body);
  tab.appendChild(section);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("options workspace panels", () => {
  test("essentials workspace absorbs legacy groups into card layout", () => {
    const tab = document.createElement("section");
    tab.className = "content-tab";
    const panelRoot = document.createElement("div");
    tab.appendChild(panelRoot);
    document.body.appendChild(tab);

    const registry = {
      enable: new MockPanelControl("Enable FluentTyper"),
      [KEY_PREFER_NATIVE_AUTOCOMPLETE]: new MockPanelControl("Prefer native autocomplete"),
      [KEY_NUM_SUGGESTIONS]: new MockPanelControl("Number of suggestions"),
      [KEY_MIN_WORD_LENGTH_TO_PREDICT]: new MockPanelControl("Minimum characters"),
      [KEY_AUTOCOMPLETE_ON_TAB]: new MockPanelControl("Accept on Tab"),
      [KEY_AUTOCOMPLETE_ON_ENTER]: new MockPanelControl("Accept on Enter"),
      [KEY_AUTOCOMPLETE]: new MockPanelControl("Accept on Space"),
      [KEY_SELECT_BY_DIGIT]: new MockPanelControl("Choose with digits"),
      [KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE]: new MockPanelControl("Insert space after accept"),
      [KEY_INLINE_SUGGESTION]: new MockPanelControl("Inline suggestion"),
    } as unknown as SettingsRegistry;

    createGroup(tab, "General", [
      registry.enable as unknown as MockPanelControl,
      registry[KEY_PREFER_NATIVE_AUTOCOMPLETE] as unknown as MockPanelControl,
    ]);
    createGroup(tab, "Prediction", [
      registry[KEY_NUM_SUGGESTIONS] as unknown as MockPanelControl,
      registry[KEY_MIN_WORD_LENGTH_TO_PREDICT] as unknown as MockPanelControl,
    ]);
    createGroup(tab, "Accept", [
      registry[KEY_AUTOCOMPLETE_ON_TAB] as unknown as MockPanelControl,
      registry[KEY_AUTOCOMPLETE_ON_ENTER] as unknown as MockPanelControl,
      registry[KEY_AUTOCOMPLETE] as unknown as MockPanelControl,
      registry[KEY_SELECT_BY_DIGIT] as unknown as MockPanelControl,
    ]);
    createGroup(tab, "After", [
      registry[KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE] as unknown as MockPanelControl,
      registry[KEY_INLINE_SUGGESTION] as unknown as MockPanelControl,
    ]);

    new EssentialsWorkspacePanel(panelRoot, registry, false);

    expect(panelRoot.textContent).toContain("Enable FluentTyper");
    expect(panelRoot.textContent).toContain("Prefer native autocomplete");
    expect(panelRoot.textContent).toContain("Number of suggestions");
    expect(panelRoot.textContent).toContain("Inline suggestion");
    expect(tab.querySelectorAll(".settings-group.is-empty-workspace-group")).toHaveLength(4);
  });

  test("data workspace keeps diagnostics limited to productivity and import/export", () => {
    const tab = document.createElement("section");
    tab.className = "content-tab";
    const panelRoot = document.createElement("div");
    tab.appendChild(panelRoot);
    document.body.appendChild(tab);

    const registry = {
      productivityStatsPanel: new MockPanelControl("Productivity graph"),
      resetProductivityStatsButton: new MockPanelControl("Reset stats"),
      importSettingButton: new MockPanelControl("Import settings"),
      exportSettingButton: new MockPanelControl("Export settings"),
    } as unknown as SettingsRegistry;

    createGroup(tab, "Productivity", [
      registry.productivityStatsPanel as unknown as MockPanelControl,
      registry.resetProductivityStatsButton as unknown as MockPanelControl,
    ]);
    createGroup(tab, "Config", [
      registry.importSettingButton as unknown as MockPanelControl,
      registry.exportSettingButton as unknown as MockPanelControl,
    ]);
    new DataDiagnosticsPanel(panelRoot, registry);

    expect(panelRoot.textContent).toContain("Productivity graph");
    expect(panelRoot.textContent).toContain("Import settings");
    expect(panelRoot.textContent).toContain(i18n.get("data_panel_transfer_copy"));
    expect(panelRoot.textContent).not.toContain("Debug dashboard");
    expect(
      panelRoot.querySelectorAll(".workspace-panel-stack > .settings-inline-card"),
    ).toHaveLength(2);
    expect(tab.querySelectorAll(".settings-group.is-empty-workspace-group")).toHaveLength(2);
  });

  test("observability workspace groups controls, predictor settings, and dashboard shell", () => {
    const tab = document.createElement("section");
    tab.className = "content-tab";
    const panelRoot = document.createElement("div");
    tab.appendChild(panelRoot);
    document.body.appendChild(tab);

    const registry = {
      observabilityHint: new MockPanelControl("Observability hint"),
      observabilityPanel: new MockPanelControl("Observability dashboard"),
      [KEY_OBSERVABILITY_ENABLED]: new MockPanelControl("Observability enabled"),
      [KEY_OBSERVABILITY_DEFAULT_LEVEL]: new MockPanelControl("Default log level"),
      [KEY_OBSERVABILITY_MODULE_OVERRIDES]: new MockPanelControl("Overrides"),
      [KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED]: new MockPanelControl("Trace Presage"),
      [KEY_DEBUG_AI_PREDICTOR_ENABLED]: new MockPanelControl("Trace AI"),
      [KEY_AI_MODEL_ID]: new MockPanelControl("Model"),
      [KEY_AI_PREDICTION_TIMEOUT_MS]: new MockPanelControl("Timeout"),
    } as unknown as SettingsRegistry;

    createGroup(tab, "Controls", [
      registry.observabilityHint as unknown as MockPanelControl,
      registry[KEY_OBSERVABILITY_ENABLED] as unknown as MockPanelControl,
      registry[KEY_OBSERVABILITY_DEFAULT_LEVEL] as unknown as MockPanelControl,
    ]);
    createGroup(tab, "Predictor", [
      registry[KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED] as unknown as MockPanelControl,
      registry[KEY_DEBUG_AI_PREDICTOR_ENABLED] as unknown as MockPanelControl,
      registry[KEY_AI_MODEL_ID] as unknown as MockPanelControl,
      registry[KEY_AI_PREDICTION_TIMEOUT_MS] as unknown as MockPanelControl,
    ]);
    createGroup(tab, "Dashboard", [registry.observabilityPanel as unknown as MockPanelControl]);

    new ObservabilityWorkspacePanel(panelRoot, registry);

    expect(panelRoot.textContent).toContain("Observability enabled");
    expect(panelRoot.textContent).toContain("Trace Presage");
    expect(panelRoot.textContent).toContain("Observability dashboard");
    expect(
      panelRoot.querySelectorAll(".workspace-panel-stack > .settings-inline-card"),
    ).toHaveLength(3);
  });

  test("grammar workspace wraps the rule selector in the shared card layout", () => {
    const tab = document.createElement("section");
    tab.className = "content-tab";
    const panelRoot = document.createElement("div");
    tab.appendChild(panelRoot);
    document.body.appendChild(tab);

    const registry = {
      [KEY_ENABLED_GRAMMAR_RULES]: new MockPanelControl("Enabled Grammar Rules"),
    } as unknown as SettingsRegistry;

    createGroup(tab, "Grammar", [
      registry[KEY_ENABLED_GRAMMAR_RULES] as unknown as MockPanelControl,
    ]);

    new GrammarWorkspacePanel(panelRoot, registry);

    expect(panelRoot.querySelector(".workspace-panel-stack")).not.toBeNull();
    expect(panelRoot.querySelector(".settings-inline-card")).not.toBeNull();
    expect(panelRoot.textContent).toContain("Enabled Grammar Rules");
    expect(tab.querySelectorAll(".settings-group.is-empty-workspace-group")).toHaveLength(1);
  });
});
