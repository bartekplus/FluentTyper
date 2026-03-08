import type { FieldConfig, ManifestDefinition } from "./types.js";
import type { FieldControl } from "./controls/FieldControl.js";
import { Store } from "./store/Store.js";
import { TabManager } from "./layout/TabManager.js";
import { createGroup } from "./layout/GroupManager.js";

import { CheckboxControl } from "./controls/CheckboxControl.js";
import { SliderControl } from "./controls/SliderControl.js";
import { TextControl } from "./controls/TextControl.js";
import { TextareaControl } from "./controls/TextareaControl.js";
import { SelectControl } from "./controls/SelectControl.js";
import { ListBoxControl } from "./controls/ListBoxControl.js";
import { ListBoxMultiSelectControl } from "./controls/ListBoxMultiSelectControl.js";
import { RadioControl } from "./controls/RadioControl.js";
import { ButtonControl } from "./controls/ButtonControl.js";
import { ModalButtonControl } from "./controls/ModalButtonControl.js";
import { DescriptionControl } from "./controls/DescriptionControl.js";
import { ValueOnlyControl } from "./controls/ValueOnlyControl.js";
import { RuleToggleCardsControl } from "./controls/RuleToggleCardsControl.js";

export type SettingsRegistry = Record<string, FieldControl>;

export interface SettingsEngineOptions {
  container: {
    tabs: HTMLElement;
    content: HTMLElement;
  };
  store?: Store;
  name?: string;
  icon?: string;
}

export class SettingsEngine {
  private readonly tabManager: TabManager;
  readonly store: Store;

  private readonly tabs: Record<
    string,
    {
      bundle: ReturnType<TabManager["create"]>;
      content: HTMLElement;
      groups: Record<string, HTMLElement>;
    }
  > = {};

  private tabLabelMap: Record<string, string> = {};

  constructor(options: SettingsEngineOptions) {
    this.tabManager = new TabManager(options.container.tabs, options.container.content);
    this.store = options.store ?? new Store("settings");

    if (options.name) {
      const titleEl = document.getElementById("title");
      if (titleEl) {
        (titleEl as HTMLTitleElement).text = options.name;
      }
    }
    if (options.icon) {
      const faviconEl = document.getElementById("favicon") as HTMLLinkElement | null;
      if (faviconEl) {
        faviconEl.href = options.icon;
      }
      const iconEl = document.getElementById("icon") as HTMLImageElement | null;
      if (iconEl) {
        iconEl.src = options.icon;
      }
    }

    window.addEventListener("hashchange", () => {
      this.activateTabById(location.hash.substring(1));
    });
  }

  buildFromManifest(manifest: ManifestDefinition): SettingsRegistry {
    const registry: SettingsRegistry = {};

    // Register tab id → label mapping before iterating settings
    this.tabLabelMap = {};
    for (const tab of manifest.tabs) {
      this.tabLabelMap[tab.id] = tab.label;
    }

    for (const params of manifest.settings) {
      const control = this.createControl(params);
      if (params.name !== undefined) {
        registry[params.name] = control;
      }
    }

    // Apply initial hash routing after all tabs are created
    const initialAnchor = location.hash.substring(1);
    if (initialAnchor) {
      this.activateTabById(initialAnchor);
    }

    return registry;
  }

  private activateTabById(tabId: string): void {
    const tab = this.tabs[tabId];
    if (tab) {
      tab.bundle.activate();
    }
  }

  private getOrCreateTab(tabId: string): HTMLElement {
    if (!(tabId in this.tabs)) {
      const bundle = this.tabManager.create();
      bundle.tabA.innerText = this.tabLabelMap[tabId] ?? tabId;
      bundle.tabA.href = `#${tabId}`;

      bundle.tabA.addEventListener("click", () => {
        history.replaceState(null, "", `#${tabId}`);
      });

      this.tabs[tabId] = { bundle, content: bundle.content, groups: {} };
    }
    return this.tabs[tabId].content;
  }

  private getOrCreateGroup(tabId: string, groupLabel: string): HTMLElement {
    const tabContent = this.getOrCreateTab(tabId);
    const tab = this.tabs[tabId];

    if (!(groupLabel in tab.groups)) {
      const groupBundle = createGroup(tabContent, groupLabel || tabLabel);
      tab.groups[groupLabel] = groupBundle.content;
    }

    return tab.groups[groupLabel];
  }

  private createControl(params: FieldConfig): FieldControl {
    const container = this.getOrCreateGroup(params.tab, params.group);
    const control = this.instantiateControl(params);
    container.appendChild(control.rootElement);
    return control;
  }

  private instantiateControl(params: FieldConfig): FieldControl {
    switch (params.type) {
      case "checkbox":
        return new CheckboxControl(params, this.store);
      case "slider":
        return new SliderControl(params, this.store);
      case "text":
        return new TextControl(params, this.store);
      case "textarea":
        return new TextareaControl(params, this.store);
      case "popupButton":
        return new SelectControl(params, this.store);
      case "listBox":
        return new ListBoxControl(params, this.store);
      case "listBoxMultiselect":
        return new ListBoxMultiSelectControl(params, this.store);
      case "radioButtons":
        return new RadioControl(params, this.store);
      case "button":
        return new ButtonControl(params, this.store);
      case "modalButton":
        return new ModalButtonControl(params, this.store, (p) => this.instantiateControl(p));
      case "description":
        return new DescriptionControl(params, this.store);
      case "valueOnly":
        return new ValueOnlyControl(params, this.store);
      case "ruleToggleCards":
        return new RuleToggleCardsControl(params, this.store);
      default: {
        const _exhaustive: never = params;
        throw new Error(`Unknown field type: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}
