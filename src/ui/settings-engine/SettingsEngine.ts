import type { FieldConfig, ManifestDefinition } from "./types.js";
import type { FieldControl } from "./controls/FieldControl.js";
import { Store } from "@core/application/storage/Store.js";
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
import { CustomPanelControl } from "./controls/CustomPanelControl.js";
import type { TabConfig } from "./types.js";

export type SettingsRegistry = Record<string, FieldControl>;

export interface SettingsEngineOptions {
  container: {
    tabs: HTMLElement;
    content: HTMLElement;
    mobileTabs?: HTMLSelectElement | null;
    searchInput?: HTMLInputElement | null;
  };
  store?: Store;
  name?: string;
  icon?: string;
}

export class SettingsEngine {
  private readonly tabManager: TabManager;
  readonly store: Store;
  private readonly mobileTabs?: HTMLSelectElement | null;
  private readonly searchInput?: HTMLInputElement | null;

  private readonly tabs: Record<
    string,
    {
      bundle: ReturnType<TabManager["create"]>;
      content: HTMLElement;
      body: HTMLElement;
      groups: Record<string, HTMLElement>;
      meta?: TabConfig;
    }
  > = {};

  private tabMetaMap: Record<string, TabConfig> = {};

  constructor(options: SettingsEngineOptions) {
    this.tabManager = new TabManager(options.container.tabs, options.container.content);
    this.store = options.store ?? new Store("settings");
    this.mobileTabs = options.container.mobileTabs;
    this.searchInput = options.container.searchInput;

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
    this.mobileTabs?.addEventListener("change", () => {
      const tabId = this.mobileTabs?.value || "";
      this.activateTabById(tabId);
      history.replaceState(null, "", `#${tabId}`);
    });
    this.searchInput?.addEventListener("input", () => {
      this.applySearch(this.searchInput?.value || "");
    });
  }

  buildFromManifest(manifest: ManifestDefinition): SettingsRegistry {
    const registry: SettingsRegistry = {};

    this.tabMetaMap = {};
    for (const tab of manifest.tabs) {
      this.tabMetaMap[tab.id] = tab;
    }
    this.populateMobileTabs(manifest.tabs);

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
    this.applySearch(this.searchInput?.value || "");

    return registry;
  }

  private activateTabById(tabId: string): void {
    const tab = this.tabs[tabId];
    if (tab) {
      tab.bundle.activate();
      if (this.mobileTabs) {
        this.mobileTabs.value = tabId;
      }
      this.resetScrollPosition();
    }
  }

  private getOrCreateTab(tabId: string): HTMLElement {
    if (!(tabId in this.tabs)) {
      const meta = this.tabMetaMap[tabId] ?? { id: tabId, label: tabId };
      const bundle = this.tabManager.create(meta);

      bundle.tabA.addEventListener("click", () => {
        this.activateTabById(tabId);
        history.replaceState(null, "", `#${tabId}`);
      });

      bundle.content.id = tabId;
      bundle.content.setAttribute("data-tab-id", tabId);
      bundle.content.setAttribute(
        "data-tab-search",
        [meta.label, meta.title, meta.shortDescription, ...(meta.keywords || [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      );

      const header = document.createElement("header");
      header.className = "settings-section-header";

      const eyebrow = document.createElement("p");
      eyebrow.className = "settings-section-eyebrow";
      eyebrow.textContent = meta.label;
      header.appendChild(eyebrow);

      const title = document.createElement("h2");
      title.className = "settings-section-title";
      title.textContent = meta.title ?? meta.label;
      header.appendChild(title);

      if (meta.shortDescription) {
        const description = document.createElement("p");
        description.className = "settings-section-description";
        description.textContent = meta.shortDescription;
        header.appendChild(description);
      }

      const body = document.createElement("div");
      body.className = "settings-section-body";

      bundle.content.appendChild(header);
      bundle.content.appendChild(body);

      this.tabs[tabId] = { bundle, content: bundle.content, body, groups: {}, meta };
    }
    return this.tabs[tabId].body;
  }

  private getOrCreateGroup(tabId: string, groupLabel: string): HTMLElement {
    const tabContent = this.getOrCreateTab(tabId);
    const tab = this.tabs[tabId];

    if (!(groupLabel in tab.groups)) {
      const groupBundle = createGroup(tabContent, groupLabel || tab.meta?.label || tabId);
      tab.groups[groupLabel] = groupBundle.content;
    }

    return tab.groups[groupLabel];
  }

  private createControl(params: FieldConfig): FieldControl {
    const control = this.instantiateControl(params);
    if (params.type === "valueOnly") {
      return control;
    }
    const container = this.getOrCreateGroup(params.tab, params.group);
    const groupRoot = container.closest(".settings-group");
    control.rootElement.setAttribute("data-search-text", this.buildFieldSearchText(params));
    container.appendChild(control.rootElement);
    if (params.type === "customPanel") {
      groupRoot?.classList.add("settings-group-panel-only");
    }
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
      case "customPanel":
        return new CustomPanelControl(params, this.store);
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

  private populateMobileTabs(tabs: TabConfig[]): void {
    if (!this.mobileTabs) {
      return;
    }
    this.mobileTabs.replaceChildren();
    tabs.forEach((tab) => {
      const option = document.createElement("option");
      option.value = tab.id;
      option.textContent = tab.label;
      this.mobileTabs?.appendChild(option);
    });
  }

  private applySearch(rawQuery: string): void {
    const query = rawQuery.trim().toLowerCase();
    let firstVisibleTabId: string | null = null;
    let firstMatchTarget: HTMLElement | null = null;

    Object.entries(this.tabs).forEach(([tabId, tab]) => {
      let tabMatches = !query;

      Object.entries(tab.groups).forEach(([groupLabel, groupContent]) => {
        const groupRoot = groupContent.closest(".settings-group") as HTMLElement | null;
        const controls = Array.from(groupContent.children) as HTMLElement[];
        let groupMatches = !query;

        controls.forEach((control) => {
          const controlText = (
            control.getAttribute("data-search-text") ||
            control.textContent ||
            ""
          ).toLowerCase();
          const matches = !query || controlText.includes(query);
          control.classList.toggle("is-search-hidden", !matches);
          if (matches) {
            groupMatches = true;
            if (query && firstMatchTarget === null) {
              firstMatchTarget = control;
            }
          }
        });

        const groupText = [groupLabel, groupRoot?.textContent || ""].join(" ").toLowerCase();
        if (query && groupText.includes(query)) {
          groupMatches = true;
          controls.forEach((control) => {
            control.classList.remove("is-search-hidden");
          });
          if (firstMatchTarget === null) {
            firstMatchTarget = groupRoot;
          }
        }

        groupRoot?.classList.toggle("is-search-hidden", !groupMatches);
        if (groupMatches) {
          tabMatches = true;
        }
      });

      const tabText = [
        tab.meta?.label,
        tab.meta?.title,
        tab.meta?.shortDescription,
        ...(tab.meta?.keywords || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (query && tabText.includes(query)) {
        tabMatches = true;
        Object.values(tab.groups).forEach((groupContent) => {
          groupContent.closest(".settings-group")?.classList.remove("is-search-hidden");
          Array.from(groupContent.children).forEach((control) => {
            (control as HTMLElement).classList.remove("is-search-hidden");
          });
        });
        if (firstMatchTarget === null) {
          firstMatchTarget = tab.content;
        }
      }

      tab.bundle.tabLi.classList.toggle("is-search-hidden", !tabMatches);
      tab.content.classList.toggle("is-search-filtered-out", !tabMatches);
      if (tabMatches && !firstVisibleTabId) {
        firstVisibleTabId = tabId;
      }
    });

    const activeTabId = Object.entries(this.tabs).find(([, tab]) =>
      tab.bundle.tabLi.classList.contains("is-active"),
    )?.[0];
    if (
      firstVisibleTabId &&
      (!activeTabId || this.tabs[activeTabId].content.classList.contains("is-search-filtered-out"))
    ) {
      this.activateTabById(firstVisibleTabId);
    }

    if (query && firstMatchTarget) {
      firstMatchTarget.scrollIntoView({
        block: "start",
        inline: "nearest",
        behavior: "smooth",
      });
    }
  }

  private buildFieldSearchText(params: FieldConfig): string {
    const fragments: string[] = [params.tab, params.group];
    if ("label" in params && typeof params.label === "string") {
      fragments.push(params.label);
    }
    if ("description" in params && typeof params.description === "string") {
      fragments.push(params.description);
    }
    if ("text" in params && typeof params.text === "string") {
      fragments.push(params.text);
    }
    if ("keywords" in params && Array.isArray(params.keywords)) {
      fragments.push(...params.keywords);
    }
    return fragments.join(" ").toLowerCase();
  }

  private resetScrollPosition(): void {
    const contentRoot =
      this.mobileTabs?.closest(".options-main") ?? this.searchInput?.closest(".options-main");
    if (contentRoot instanceof HTMLElement) {
      contentRoot.scrollTop = 0;
      contentRoot.scrollLeft = 0;
      contentRoot.scrollTo?.(0, 0);
    }

    const scrollingElement = document.scrollingElement;
    if (scrollingElement) {
      scrollingElement.scrollTop = 0;
      scrollingElement.scrollLeft = 0;
    }
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
    if (document.body) {
      document.body.scrollTop = 0;
      document.body.scrollLeft = 0;
    }
    const userAgent = navigator.userAgent.toLowerCase();
    if (!userAgent.includes("jsdom")) {
      window.scrollTo?.(0, 0);
    }
  }
}
