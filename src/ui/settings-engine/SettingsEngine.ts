import type { FieldConfig, ManifestDefinition, TabConfig } from "./types.js";
import type { BaseControl } from "./controls/FieldControl.js";
import { Store } from "@core/application/storage/Store.js";

import { CheckboxControl } from "./controls/CheckboxControl.js";
import { SliderControl } from "./controls/SliderControl.js";
import { SelectControl } from "./controls/SelectControl.js";
import { ButtonControl } from "./controls/ButtonControl.js";
import { DescriptionControl } from "./controls/DescriptionControl.js";
import { ValueOnlyControl } from "./controls/ValueOnlyControl.js";
import { CustomPanelControl } from "./controls/CustomPanelControl.js";

export type SettingsRegistry = Record<string, BaseControl<unknown>>;

interface SettingsEngineOptions {
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
  private readonly tabContainer: HTMLElement;
  private readonly contentContainer: HTMLElement;
  private activeTabId: string | null = null;
  readonly store: Store;
  private readonly mobileTabs?: HTMLSelectElement | null;
  private readonly searchInput?: HTMLInputElement | null;

  private readonly tabs: Record<
    string,
    {
      tabLi: HTMLLIElement;
      content: HTMLElement;
      body: HTMLElement;
      groups: Record<string, HTMLElement>;
      meta?: TabConfig;
    }
  > = {};

  private tabMetaMap: Record<string, TabConfig> = {};

  constructor(options: SettingsEngineOptions) {
    this.tabContainer = options.container.tabs;
    this.contentContainer = options.container.content;
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
    // Navigation follows the manifest's tab order, not the order settings first mention a tab.
    for (const tab of manifest.tabs) {
      this.getOrCreateTab(tab.id);
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
    if (tabId in this.tabs) {
      this.setTabActive(tabId);
      if (this.mobileTabs) {
        this.mobileTabs.value = tabId;
      }
      this.resetScrollPosition();
    }
  }

  private setTabActive(tabId: string): void {
    for (const [id, tab] of Object.entries(this.tabs)) {
      const active = id === tabId;
      tab.tabLi.classList.toggle("is-active", active);
      tab.content.classList.toggle("is-active", active);
      tab.content.classList.toggle("is-hidden", !active);
    }
    this.activeTabId = tabId;
  }

  private getOrCreateTab(tabId: string): HTMLElement {
    if (!(tabId in this.tabs)) {
      const meta = this.tabMetaMap[tabId] ?? { id: tabId, label: tabId };
      const tabA = document.createElement("a");
      tabA.href = `#${meta.id}`;
      tabA.className = "settings-nav-link";
      tabA.textContent = meta.label;
      const tabLi = document.createElement("li");
      tabLi.appendChild(tabA);
      const content = document.createElement("div");
      content.className = "content-tab options-tab-content";
      this.tabContainer.appendChild(tabLi);
      this.contentContainer.appendChild(content);
      content.classList.add("is-hidden");

      tabA.addEventListener("click", (event) => {
        event.preventDefault();
        this.activateTabById(tabId);
        history.replaceState(null, "", `#${tabId}`);
      });

      content.id = tabId;
      content.setAttribute("data-tab-id", tabId);

      const header = document.createElement("header");
      header.className = "settings-section-header";

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

      content.appendChild(header);
      content.appendChild(body);

      this.tabs[tabId] = { tabLi, content, body, groups: {}, meta };
      if (this.activeTabId === null) {
        this.setTabActive(tabId);
      }
    }
    return this.tabs[tabId].body;
  }

  private getOrCreateGroup(tabId: string, groupLabel: string): HTMLElement {
    const tabContent = this.getOrCreateTab(tabId);
    const tab = this.tabs[tabId];

    if (!(groupLabel in tab.groups)) {
      tab.groups[groupLabel] = this.createGroup(tabContent, groupLabel || tab.meta?.label || tabId);
    }

    return tab.groups[groupLabel];
  }

  private createGroup(tabContent: HTMLElement, label: string): HTMLDivElement {
    const groupDiv = document.createElement("section");
    groupDiv.className = "settings-group";

    const header = document.createElement("div");
    header.className = "settings-group-header";
    const title = document.createElement("h3");
    title.className = "settings-group-title divider";
    title.textContent = label;
    header.appendChild(title);
    groupDiv.appendChild(header);

    const body = document.createElement("div");
    body.className = "settings-group-body";
    groupDiv.appendChild(body);

    tabContent.appendChild(groupDiv);

    return body;
  }

  private createControl(params: FieldConfig): BaseControl<unknown> {
    const control = this.instantiateControl(params);
    if (params.type === "valueOnly") {
      return control;
    }
    const groupContainer = this.getOrCreateGroup(params.tab, params.group);
    control.rootElement.setAttribute("data-search-text", this.buildFieldSearchText(params));
    groupContainer.appendChild(control.rootElement);
    if (params.type === "customPanel") {
      groupContainer.closest(".settings-group")?.classList.add("settings-group-panel-only");
    }
    return control;
  }

  private instantiateControl(params: FieldConfig): BaseControl<unknown> {
    switch (params.type) {
      case "checkbox":
        return new CheckboxControl(params, this.store);
      case "slider":
        return new SliderControl(params, this.store);
      case "popupButton":
        return new SelectControl(params, this.store);
      case "button":
        return new ButtonControl(params, this.store);
      case "description":
        return new DescriptionControl(params, this.store);
      case "customPanel":
        return new CustomPanelControl(params, this.store);
      case "valueOnly":
        return new ValueOnlyControl(params, this.store);
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
        const groupRoot = groupContent.closest<HTMLElement>(".settings-group");
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

      tab.tabLi.classList.toggle("is-search-hidden", !tabMatches);
      tab.content.classList.toggle("is-search-filtered-out", !tabMatches);
      if (tabMatches && !firstVisibleTabId) {
        firstVisibleTabId = tabId;
      }
    });

    const activeTabId = this.activeTabId;
    if (
      firstVisibleTabId &&
      (!activeTabId || this.tabs[activeTabId].content.classList.contains("is-search-filtered-out"))
    ) {
      this.activateTabById(firstVisibleTabId);
    }

    // Reveal matches tucked inside collapsed sections such as "Advanced".
    if (query) {
      Object.values(this.tabs).forEach((tab) => {
        tab.content.querySelectorAll("details").forEach((details) => {
          if ((details.textContent || "").toLowerCase().includes(query)) details.open = true;
        });
      });
    }

    const matchTarget = firstMatchTarget as HTMLElement | null;
    if (query && matchTarget) {
      matchTarget.scrollIntoView({
        block: "start",
        inline: "nearest",
        behavior: "smooth",
      });
    }
  }

  private buildFieldSearchText(params: Exclude<FieldConfig, { type: "valueOnly" }>): string {
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
    }
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
  }
}
