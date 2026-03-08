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
    { content: HTMLElement; groups: Record<string, HTMLElement> }
  > = {};

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
  }

  buildFromManifest(manifest: ManifestDefinition): SettingsRegistry {
    const registry: SettingsRegistry = {};

    for (const params of manifest.settings) {
      const control = this.createControl(params);
      if (params.name !== undefined) {
        registry[params.name] = control;
      }
    }

    return registry;
  }

  private getOrCreateTab(tabLabel: string): HTMLElement {
    if (!(tabLabel in this.tabs)) {
      const bundle = this.tabManager.create();
      bundle.tabA.innerText = tabLabel;

      // Hash-based tab routing
      const anchor = location.hash.substring(1);
      if (tabLabel === anchor || tabLabel === decodeURIComponent(anchor)) {
        bundle.activate();
      }

      this.tabs[tabLabel] = { content: bundle.content, groups: {} };
    }
    return this.tabs[tabLabel].content;
  }

  private getOrCreateGroup(tabLabel: string, groupLabel: string): HTMLElement {
    const tabContent = this.getOrCreateTab(tabLabel);
    const tab = this.tabs[tabLabel];

    if (!(groupLabel in tab.groups)) {
      const groupBundle = createGroup(tabContent, groupLabel || tabLabel);
      tab.groups[groupLabel] = groupBundle.content;
    }

    return tab.groups[groupLabel];
  }

  private createControl(params: FieldConfig): FieldControl {
    const container = this.getOrCreateGroup(params.tab, params.group);
    const store = this.store;

    let control: FieldControl;

    switch (params.type) {
      case "checkbox":
        control = new CheckboxControl(params, store);
        break;
      case "slider":
        control = new SliderControl(params, store);
        break;
      case "text":
        control = new TextControl(params, store);
        break;
      case "textarea":
        control = new TextareaControl(params, store);
        break;
      case "popupButton":
        control = new SelectControl(params, store);
        break;
      case "listBox":
        control = new ListBoxControl(params, store);
        break;
      case "listBoxMultiselect":
        control = new ListBoxMultiSelectControl(params, store);
        break;
      case "radioButtons":
        control = new RadioControl(params, store);
        break;
      case "button":
        control = new ButtonControl(params, store);
        break;
      case "modalButton":
        control = new ModalButtonControl(params, store, (p) => this.createNestedControl(p));
        break;
      case "description":
        control = new DescriptionControl(params, store);
        break;
      case "valueOnly":
        control = new ValueOnlyControl(params, store);
        break;
      case "ruleToggleCards":
        control = new RuleToggleCardsControl(params, store);
        break;
      default: {
        const _exhaustive: never = params;
        throw new Error(`Unknown field type: ${JSON.stringify(_exhaustive)}`);
      }
    }

    container.appendChild(control.rootElement);
    return control;
  }

  private createNestedControl(params: FieldConfig): FieldControl {
    const store = this.store;
    switch (params.type) {
      case "checkbox":
        return new CheckboxControl(params, store);
      case "slider":
        return new SliderControl(params, store);
      case "text":
        return new TextControl(params, store);
      case "textarea":
        return new TextareaControl(params, store);
      case "popupButton":
        return new SelectControl(params, store);
      case "listBox":
        return new ListBoxControl(params, store);
      case "listBoxMultiselect":
        return new ListBoxMultiSelectControl(params, store);
      case "radioButtons":
        return new RadioControl(params, store);
      case "button":
        return new ButtonControl(params, store);
      case "modalButton":
        return new ModalButtonControl(params, store, (p) => this.createNestedControl(p));
      case "description":
        return new DescriptionControl(params, store);
      case "valueOnly":
        return new ValueOnlyControl(params, store);
      case "ruleToggleCards":
        return new RuleToggleCardsControl(params, store);
      default: {
        const _exhaustive: never = params;
        throw new Error(`Unknown nested field type: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}
