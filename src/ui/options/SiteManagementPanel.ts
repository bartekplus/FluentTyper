import { renderFieldPreferencesPanel } from "./FieldPreferencesPanel";
import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import type { Store } from "@core/application/storage/Store.js";
import {
  KEY_DOMAIN_LIST_MODE,
  KEY_ENABLED_LANGUAGES,
  KEY_INLINE_SUGGESTION,
  KEY_NUM_SUGGESTIONS,
  KEY_SITE_PROFILES,
  KEY_FIELD_PREFERENCES,
} from "@core/domain/constants";
import { normalizeDomainHost } from "@core/domain/siteProfiles";
import { SiteProfilesManager } from "./siteProfiles.js";
import { i18n } from "./fluenttyperI18n.js";
import {
  bindRerender,
  createButton,
  createElement,
  createInlineCard,
  createRemovableList,
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
      this.siteProfilesRoot,
      this.store,
      this.onConfigChange,
    );

    bindRerender(this.registry[KEY_DOMAIN_LIST_MODE], () => this.render());
    bindRerender(this.registry.domainBlackList, () => this.render());
    bindRerender(this.registry[KEY_ENABLED_LANGUAGES], () => this.render());
    bindRerender(this.registry[KEY_SITE_PROFILES], () => this.render());
    bindRerender(this.registry[KEY_FIELD_PREFERENCES], () => this.render());
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
    const fields = createInlineCard();
    shell.append(fields);
    await renderFieldPreferencesPanel(fields);
  }

  private createAccessCard(mode: DomainListMode, domainList: string[]): HTMLElement {
    const card = createInlineCard(i18n.get("site_management_access_title"));
    const segmented = createElement("div", { className: "segmented-control" });
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
      const button = createButton(entry.label, "segmented-control-button", () => {
        this.registry[KEY_DOMAIN_LIST_MODE].set(entry.value);
      });
      button.classList.toggle("is-active", entry.value === mode);
      segmented.appendChild(button);
    });
    card.appendChild(segmented);

    card.appendChild(
      createElement("p", {
        className: "settings-inline-help",
        textContent: modes.find((entry) => entry.value === mode)?.hint || "",
      }),
    );

    const blocking = mode === "blackList";
    const { toolbar, list } = createRemovableList({
      searchPlaceholder: i18n.get("site_management_search_domains"),
      query: this.searchQuery,
      onQuery: (query) => {
        this.searchQuery = query;
      },
      addPlaceholder: i18n.get("site_management_domain_placeholder"),
      addLabel: i18n.get(blocking ? "site_management_block_site" : "site_management_allow_site"),
      onAdd: (addInput) => {
        const normalized = normalizeDomainHost(addInput.value);
        if (!normalized) {
          return;
        }
        const next = Array.from(new Set([...domainList, normalized])).sort((a, b) =>
          a.localeCompare(b),
        );
        this.registry.domainBlackList.set(next);
        addInput.value = "";
      },
      items: domainList,
      hint: i18n.get(blocking ? "site_management_blocked" : "site_management_allowed"),
      onRemove: (domain) => {
        this.registry.domainBlackList.set(domainList.filter((entry) => entry !== domain));
      },
      emptyText: i18n.get(
        blocking ? "site_management_empty_blocked" : "site_management_empty_allowed",
      ),
    });
    card.append(toolbar, list);
    return card;
  }
}
