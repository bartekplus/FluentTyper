import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import type { Store } from "@core/application/storage/Store.js";
import {
  KEY_DOMAIN_LIST_MODE,
  KEY_ENABLED_LANGUAGES,
  KEY_INLINE_SUGGESTION,
  KEY_NUM_SUGGESTIONS,
  KEY_SITE_PROFILES,
} from "@core/domain/constants";
import { normalizeDomainHost } from "@core/domain/siteProfiles";
import { SiteProfilesManager } from "./siteProfiles.js";
import { i18n } from "./fluenttyperI18n.js";
import {
  bindRerender,
  createWorkspaceCard,
  createWorkspaceShell,
} from "./workspacePanelUtils.js";

type DomainListMode = "blackList" | "whiteList";

export class SiteManagementPanel {
  private readonly root: HTMLElement;
  private readonly registry: SettingsRegistry;
  private readonly store: Store;
  private readonly onConfigChange: () => void;
  private readonly siteProfilesRoot: HTMLElement;
  private readonly siteProfilesManager: SiteProfilesManager;
  private searchQuery = "";

  constructor(
    root: HTMLElement,
    registry: SettingsRegistry,
    store: Store,
    onConfigChange: () => void,
  ) {
    this.root = root;
    this.registry = registry;
    this.store = store;
    this.onConfigChange = onConfigChange;
    this.siteProfilesRoot = document.createElement("div");
    this.siteProfilesManager = new SiteProfilesManager(
      {
        siteProfilesEditor: {
          rootElement: this.siteProfilesRoot,
        },
      },
      this.store,
      this.onConfigChange,
    );

    bindRerender(this.registry[KEY_DOMAIN_LIST_MODE], () => this.render());
    bindRerender(this.registry.domainBlackList, () => this.render());
    bindRerender(this.registry[KEY_ENABLED_LANGUAGES], () => this.render());
    bindRerender(this.registry[KEY_SITE_PROFILES], () => this.render());
    bindRerender(this.registry[KEY_NUM_SUGGESTIONS], () => this.siteProfilesManager.render());
    bindRerender(this.registry[KEY_INLINE_SUGGESTION], () => this.siteProfilesManager.render());

    void this.render();
  }

  async render(): Promise<void> {
    const [modeRaw, domainListRaw] = await Promise.all([
      this.store.get(KEY_DOMAIN_LIST_MODE),
      this.store.get("domainBlackList"),
    ]);
    const mode: DomainListMode = modeRaw === "whiteList" ? "whiteList" : "blackList";
    const domainList = Array.isArray(domainListRaw)
      ? domainListRaw
          .map((entry) => String(entry))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))
      : [];

    const accessCard = this.createAccessCard(mode, domainList);
    const profileCard = createWorkspaceCard(
      i18n.get("site_profiles"),
      i18n.get("site_profiles_desc"),
    );
    profileCard.body.appendChild(this.siteProfilesRoot);

    const shell = createWorkspaceShell();
    shell.append(accessCard, profileCard.card);

    this.root.replaceChildren(shell);
    await this.siteProfilesManager.render();
  }

  private createAccessCard(mode: DomainListMode, domainList: string[]): HTMLElement {
    const card = document.createElement("section");
    card.className = "settings-inline-card";

    const title = document.createElement("h4");
    title.textContent = i18n.get("site_management_access_title");
    card.appendChild(title);

    const segmented = document.createElement("div");
    segmented.className = "segmented-control";
    const modes: Array<{ value: DomainListMode; label: string; hint: string }> = [
      {
        value: "blackList",
        label: i18n.get("site_management_blacklist_label"),
        hint: i18n.get("site_management_blacklist_hint"),
      },
      {
        value: "whiteList",
        label: i18n.get("site_management_whitelist_label"),
        hint: i18n.get("site_management_whitelist_hint"),
      },
    ];
    modes.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "segmented-control-button";
      if (entry.value === mode) {
        button.classList.add("is-active");
      }
      button.textContent = entry.label;
      button.addEventListener("click", () => {
        this.registry[KEY_DOMAIN_LIST_MODE].set(entry.value);
      });
      segmented.appendChild(button);
    });
    card.appendChild(segmented);

    const explanation = document.createElement("p");
    explanation.className = "settings-inline-help";
    explanation.textContent = modes.find((entry) => entry.value === mode)?.hint || "";
    card.appendChild(explanation);

    const toolbar = document.createElement("div");
    toolbar.className = "text-assets-toolbar";
    const search = document.createElement("input");
    search.type = "search";
    search.className = "input";
    search.placeholder = i18n.get("site_management_search_domains");
    search.value = this.searchQuery;
    search.addEventListener("input", () => {
      this.searchQuery = search.value.trim().toLowerCase();
      void this.render();
    });
    toolbar.appendChild(search);

    const addInput = document.createElement("input");
    addInput.className = "input";
    addInput.placeholder = i18n.get("site_management_domain_placeholder");
    toolbar.appendChild(addInput);

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "button";
    addButton.textContent =
      mode === "blackList"
        ? i18n.get("site_management_block_site")
        : i18n.get("site_management_allow_site");
    addButton.addEventListener("click", () => {
      const normalized = normalizeDomainHost(addInput.value);
      if (!normalized) {
        return;
      }
      const next = Array.from(new Set([...domainList, normalized])).sort((a, b) =>
        a.localeCompare(b),
      );
      this.registry.domainBlackList.set(next);
      addInput.value = "";
      this.onConfigChange();
    });
    toolbar.appendChild(addButton);
    card.appendChild(toolbar);

    const table = document.createElement("div");
    table.className = "domain-table";
    domainList
      .filter((domain) => domain.toLowerCase().includes(this.searchQuery))
      .forEach((domain) => {
        const row = document.createElement("div");
        row.className = "domain-table-row";
        const label = document.createElement("div");
        label.className = "domain-table-name";
        label.textContent = domain;
        row.appendChild(label);

        const hint = document.createElement("div");
        hint.className = "domain-table-hint";
        hint.textContent =
          mode === "blackList"
            ? i18n.get("site_management_blocked")
            : i18n.get("site_management_allowed");
        row.appendChild(hint);

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "button is-light";
        removeButton.textContent = i18n.get("remove");
        removeButton.addEventListener("click", () => {
          this.registry.domainBlackList.set(domainList.filter((entry) => entry !== domain));
          this.onConfigChange();
        });
        row.appendChild(removeButton);
        table.appendChild(row);
      });

    if (!table.childElementCount) {
      const empty = document.createElement("p");
      empty.className = "settings-inline-help";
      empty.textContent =
        mode === "blackList"
          ? i18n.get("site_management_empty_blocked")
          : i18n.get("site_management_empty_allowed");
      table.appendChild(empty);
    }

    card.appendChild(table);
    return card;
  }
}
