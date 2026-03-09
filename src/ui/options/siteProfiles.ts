import type { Store } from "@core/application/storage/Store.js";
import { SUPPORTED_LANGUAGES, resolveEnabledLanguages } from "@core/domain/lang";
import {
  KEY_ENABLED_LANGUAGES,
  KEY_INLINE_SUGGESTION,
  KEY_NUM_SUGGESTIONS,
  KEY_PREFER_NATIVE_AUTOCOMPLETE,
  KEY_SITE_PROFILES,
  MAX_NUM_SUGGESTIONS,
} from "@core/domain/constants";
import {
  parseInlineOverride,
  parsePreferNativeAutocompleteOverride,
  parseSuggestionsOverride,
  resolveGlobalNumSuggestions,
} from "@core/domain/siteProfileService";
import {
  normalizeDomainHost,
  removeSiteProfileForDomain,
  resolveSiteProfiles,
  setSiteProfileForDomain,
  type SiteProfile,
  type SiteProfiles,
} from "@core/domain/siteProfiles";
import { formatTranslation, i18n } from "./fluenttyperI18n.js";

interface FancierSettingsLike {
  siteProfilesEditor: {
    rootElement: HTMLElement;
  };
}

interface SiteProfilesElements {
  editingBadge: HTMLElement;
  domainInput: HTMLInputElement;
  languageSelect: HTMLSelectElement;
  numSuggestionsSelect: HTMLSelectElement;
  inlineSelect: HTMLSelectElement;
  preferNativeAutocompleteSelect: HTMLSelectElement;
  searchInput: HTMLInputElement;
  normalizedPreview: HTMLElement;
  saveButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  status: HTMLElement;
  tableBody: HTMLElement;
  emptyState: HTMLElement;
}

function getOnOffLabel(value: boolean): string {
  return value ? i18n.get("site_profile_on") : i18n.get("site_profile_off");
}

function getInheritLabel(globalValueLabel: string): string {
  return `${i18n.get("site_profile_inherit_global")} (${globalValueLabel})`;
}

function getPrimaryLanguage(enabledLanguages: string[]): string {
  return enabledLanguages[0] || "en_US";
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  options: {
    className?: string;
    id?: string;
    textContent?: string;
    attributes?: Record<string, string>;
  } = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (options.className) {
    element.className = options.className;
  }
  if (options.id) {
    element.id = options.id;
  }
  if (options.textContent !== undefined) {
    element.textContent = options.textContent;
  }
  if (options.attributes) {
    Object.entries(options.attributes).forEach(([name, value]) => {
      element.setAttribute(name, value);
    });
  }
  return element;
}

export class SiteProfilesManager {
  private readonly settings: FancierSettingsLike;
  private readonly onConfigChange: (() => Promise<void> | void) | undefined;
  private readonly store: Store;
  private readonly root: HTMLElement;
  private editingDomain: string | null = null;
  private pendingRemovalDomain: string | null = null;
  private searchQuery = "";
  private statusText = i18n.get("site_profiles_editor_default_status");
  private statusIsError = false;
  private elements!: SiteProfilesElements;

  constructor(
    settings: FancierSettingsLike,
    store: Store,
    onConfigChange?: () => Promise<void> | void,
  ) {
    this.settings = settings;
    this.store = store;
    this.onConfigChange = onConfigChange;
    this.root = this.settings.siteProfilesEditor.rootElement;
    this.buildUI();
    this.cacheElements();
    this.bindEvents();
    void this.render();
  }

  private buildUI(): void {
    const shell = createElement("div", { className: "site-profiles-shell" });

    const editor = createElement("div", { className: "site-profiles-editor" });
    const title = createElement("h5", { textContent: i18n.get("site_profiles_editor_title") });
    editor.appendChild(title);
    const editingBadge = createElement("p", {
      id: "siteProfilesEditingBadge",
      className: "settings-inline-help",
      textContent: "",
    });
    editor.appendChild(editingBadge);

    const domainField = this.createField(
      i18n.get("site_profiles_domain_label"),
      "siteProfileDomainInput",
      i18n.get("site_profiles_domain_placeholder"),
    );
    domainField.classList.add("site-profiles-field-wide");
    const preview = createElement("p", {
      id: "siteProfileNormalizedPreview",
      className: "settings-inline-help site-profiles-field-wide",
      textContent: i18n.get("site_profiles_normalized_preview_default"),
    });

    const languageField = this.createSelectField(
      i18n.get("site_profiles_table_language"),
      "siteProfileLanguageSelect",
    );
    const suggestionsField = this.createSelectField(
      i18n.get("site_profiles_table_num_suggestions"),
      "siteProfileNumSuggestionsSelect",
    );
    const inlineField = this.createSelectField(
      i18n.get("site_profiles_inline_mode_label"),
      "siteProfileInlineSelect",
    );
    const preferNativeAutocompleteField = this.createSelectField(
      i18n.get("site_profiles_prefer_native_autocomplete_label"),
      "siteProfilePreferNativeAutocompleteSelect",
    );

    const actions = createElement("div", { className: "text-assets-actions" });
    const saveButton = createElement("button", {
      id: "siteProfileSaveButton",
      className: "button",
      textContent: i18n.get("site_profiles_add_btn"),
      attributes: { type: "button" },
    });
    const cancelButton = createElement("button", {
      id: "siteProfileCancelButton",
      className: "button is-light",
      textContent: i18n.get("site_profiles_cancel_btn"),
      attributes: { type: "button" },
    });
    actions.append(saveButton, cancelButton);

    const status = createElement("p", {
      id: "siteProfilesFormStatus",
      className: "settings-inline-help",
      textContent: this.statusText,
    });

    const formGrid = createElement("div", { className: "site-profiles-form-grid" });
    formGrid.append(
      domainField,
      preview,
      languageField,
      suggestionsField,
      inlineField,
      preferNativeAutocompleteField,
    );

    editor.append(formGrid, actions, status);

    const list = createElement("div", { className: "site-profiles-list" });
    const listTitle = createElement("h5", { textContent: i18n.get("site_profiles") });
    list.appendChild(listTitle);
    const searchRow = createElement("div", { className: "text-assets-toolbar" });
    const searchInput = createElement("input", {
      id: "siteProfilesSearchInput",
      className: "input",
      attributes: {
        type: "search",
        placeholder: i18n.get("site_profiles_search_placeholder"),
      },
    });
    searchRow.appendChild(searchInput);
    list.appendChild(searchRow);

    const emptyState = createElement("p", {
      id: "siteProfilesEmptyState",
      className: "settings-inline-help",
      textContent: i18n.get("site_profiles_empty_workspace"),
    });
    const body = createElement("div", {
      id: "siteProfilesTableBody",
      className: "site-profiles-card-list",
      attributes: { role: "list" },
    });
    list.append(emptyState, body);

    shell.append(editor, list);
    this.root.replaceChildren(shell);
  }

  private createField(labelText: string, inputId: string, placeholder: string): HTMLElement {
    const wrapper = createElement("label", { className: "settings-stack-field" });
    wrapper.appendChild(createElement("span", { textContent: labelText }));
    wrapper.appendChild(
      createElement("input", {
        id: inputId,
        className: "input",
        attributes: { type: "text", placeholder },
      }),
    );
    return wrapper;
  }

  private createSelectField(labelText: string, selectId: string): HTMLElement {
    const wrapper = createElement("label", { className: "settings-stack-field" });
    wrapper.appendChild(createElement("span", { textContent: labelText }));
    wrapper.appendChild(createElement("select", { id: selectId, className: "input" }));
    return wrapper;
  }

  private cacheElements(): void {
    this.elements = {
      domainInput: this.root.querySelector("#siteProfileDomainInput") as HTMLInputElement,
      editingBadge: this.root.querySelector("#siteProfilesEditingBadge") as HTMLElement,
      languageSelect: this.root.querySelector("#siteProfileLanguageSelect") as HTMLSelectElement,
      numSuggestionsSelect: this.root.querySelector(
        "#siteProfileNumSuggestionsSelect",
      ) as HTMLSelectElement,
      inlineSelect: this.root.querySelector("#siteProfileInlineSelect") as HTMLSelectElement,
      preferNativeAutocompleteSelect: this.root.querySelector(
        "#siteProfilePreferNativeAutocompleteSelect",
      ) as HTMLSelectElement,
      searchInput: this.root.querySelector("#siteProfilesSearchInput") as HTMLInputElement,
      normalizedPreview: this.root.querySelector("#siteProfileNormalizedPreview") as HTMLElement,
      saveButton: this.root.querySelector("#siteProfileSaveButton") as HTMLButtonElement,
      cancelButton: this.root.querySelector("#siteProfileCancelButton") as HTMLButtonElement,
      status: this.root.querySelector("#siteProfilesFormStatus") as HTMLElement,
      tableBody: this.root.querySelector("#siteProfilesTableBody") as HTMLElement,
      emptyState: this.root.querySelector("#siteProfilesEmptyState") as HTMLElement,
    };
  }

  private bindEvents(): void {
    this.elements.saveButton.addEventListener("click", () => void this.saveProfile());
    this.elements.cancelButton.addEventListener("click", () => this.cancelEdit());
    this.elements.domainInput.addEventListener("input", () => this.updateNormalizedPreview());
    this.elements.domainInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.saveProfile();
      }
    });
    this.elements.searchInput.addEventListener("input", () => {
      this.searchQuery = this.elements.searchInput.value.trim().toLowerCase();
      void this.render();
    });
    this.elements.tableBody.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const button = target.closest<HTMLButtonElement>("button[data-action][data-domain]");
      if (!button?.dataset.domain) {
        return;
      }
      if (button.dataset.action === "edit") {
        this.startEdit(button.dataset.domain);
        return;
      }
      if (button.dataset.action === "remove") {
        void this.removeProfile(button.dataset.domain);
      }
    });
  }

  private setStatus(text: string, isError = false): void {
    this.statusText = text;
    this.statusIsError = isError;
    this.elements.status.textContent = text;
    this.elements.status.classList.toggle("has-text-danger", isError);
  }

  private updateNormalizedPreview(): void {
    const normalized = normalizeDomainHost(this.elements.domainInput.value.trim());
    this.elements.normalizedPreview.textContent = normalized
      ? formatTranslation("site_profiles_normalized_preview_value", { domain: normalized })
      : i18n.get("site_profiles_normalized_preview_default");
  }

  private getEditorProfile(enabledLanguages: string[]): SiteProfile {
    const selectedLanguage = enabledLanguages.includes(this.elements.languageSelect.value)
      ? this.elements.languageSelect.value
      : getPrimaryLanguage(enabledLanguages);
    const profile: SiteProfile = { language: selectedLanguage };

    const numSuggestions = parseSuggestionsOverride(this.elements.numSuggestionsSelect.value);
    if (typeof numSuggestions === "number") {
      profile.numSuggestions = numSuggestions;
    }

    const inlineSuggestion = parseInlineOverride(this.elements.inlineSelect.value);
    if (typeof inlineSuggestion === "boolean") {
      profile.inline_suggestion = inlineSuggestion;
    }

    const preferNativeAutocomplete = parsePreferNativeAutocompleteOverride(
      this.elements.preferNativeAutocompleteSelect.value,
    );
    if (typeof preferNativeAutocomplete === "boolean") {
      profile.preferNativeAutocomplete = preferNativeAutocomplete;
    }

    return profile;
  }

  private async notifyConfigChange(): Promise<void> {
    await this.onConfigChange?.();
  }

  private populateLanguageOptions(enabledLanguages: string[]): void {
    this.elements.languageSelect.replaceChildren();
    enabledLanguages.forEach((languageKey) => {
      const option = document.createElement("option");
      option.value = languageKey;
      option.textContent = SUPPORTED_LANGUAGES[languageKey] || languageKey;
      this.elements.languageSelect.appendChild(option);
    });
  }

  private populateSuggestionsOptions(globalNumSuggestions: number): void {
    this.elements.numSuggestionsSelect.replaceChildren();
    const inherit = document.createElement("option");
    inherit.value = "global";
    inherit.textContent = getInheritLabel(String(globalNumSuggestions));
    this.elements.numSuggestionsSelect.appendChild(inherit);
    for (let idx = 0; idx <= MAX_NUM_SUGGESTIONS; idx++) {
      const option = document.createElement("option");
      option.value = String(idx);
      option.textContent = String(idx);
      this.elements.numSuggestionsSelect.appendChild(option);
    }
  }

  private populateInlineOptions(globalInlineSuggestion: boolean): void {
    this.populateBooleanOverrideOptions(
      this.elements.inlineSelect,
      globalInlineSuggestion,
      getOnOffLabel,
    );
  }

  private populatePreferNativeAutocompleteOptions(globalPreferNativeAutocomplete: boolean): void {
    this.populateBooleanOverrideOptions(
      this.elements.preferNativeAutocompleteSelect,
      globalPreferNativeAutocomplete,
      (value) =>
        value
          ? i18n.get("prefer_native_autocomplete_on")
          : i18n.get("prefer_native_autocomplete_off"),
    );
  }

  private populateBooleanOverrideOptions(
    select: HTMLSelectElement,
    globalValue: boolean,
    describeValue: (value: boolean) => string,
  ): void {
    select.replaceChildren();
    [
      { value: "global", label: getInheritLabel(describeValue(globalValue)) },
      { value: "on", label: describeValue(true) },
      { value: "off", label: describeValue(false) },
    ].forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.value;
      option.textContent = entry.label;
      select.appendChild(option);
    });
  }

  private applyEditorState(enabledLanguages: string[], siteProfiles: SiteProfiles): void {
    const primaryLanguage = getPrimaryLanguage(enabledLanguages);
    const profile = this.editingDomain ? siteProfiles[this.editingDomain] : undefined;
    this.elements.domainInput.value = this.editingDomain || "";
    this.elements.languageSelect.value = profile?.language || primaryLanguage;
    this.elements.numSuggestionsSelect.value =
      typeof profile?.numSuggestions === "number" ? String(profile.numSuggestions) : "global";
    this.elements.inlineSelect.value =
      typeof profile?.inline_suggestion === "boolean"
        ? profile.inline_suggestion
          ? "on"
          : "off"
        : "global";
    this.elements.preferNativeAutocompleteSelect.value =
      typeof profile?.preferNativeAutocomplete === "boolean"
        ? profile.preferNativeAutocomplete
          ? "on"
          : "off"
        : "global";
    this.elements.saveButton.textContent = this.editingDomain
      ? i18n.get("site_profiles_update_btn")
      : i18n.get("site_profiles_add_btn");
    this.elements.cancelButton.classList.toggle("is-hidden", !this.editingDomain);
    this.elements.editingBadge.textContent = this.editingDomain
      ? formatTranslation("site_profiles_update_status", { domain: this.editingDomain })
      : i18n.get("site_profiles_form_hint");
    this.updateNormalizedPreview();
  }

  private renderTable(
    siteProfiles: SiteProfiles,
    globalNumSuggestions: number,
    globalInlineSuggestion: boolean,
    globalPreferNativeAutocomplete: boolean,
  ): void {
    const profileEntries = Object.entries(siteProfiles)
      .filter(([domain]) => domain.toLowerCase().includes(this.searchQuery))
      .sort(([a], [b]) => a.localeCompare(b));

    this.elements.tableBody.replaceChildren();
    this.elements.emptyState.classList.toggle("is-hidden", profileEntries.length > 0);
    this.elements.emptyState.textContent = this.searchQuery
      ? i18n.get("site_profiles_no_matches")
      : i18n.get("site_profiles_empty_workspace");

    profileEntries.forEach(([domain, profile]) => {
      const row = createElement("article", {
        className: "site-profile-row",
        attributes: { role: "listitem" },
      });
      if (this.editingDomain === domain) {
        row.classList.add("is-selected-row");
      }

      const header = createElement("div", { className: "site-profile-row-header" });
      const domainLabel = createElement("div", {
        className: "site-profile-row-domain",
        textContent: domain,
      });
      header.appendChild(domainLabel);

      const actions = createElement("div", { className: "site-profile-row-actions" });
      const edit = createElement("button", {
        className: "button is-light",
        textContent: i18n.get("site_profiles_edit_btn"),
        attributes: { type: "button", "data-action": "edit" },
      });
      edit.dataset.domain = domain;
      const remove = createElement("button", {
        className: "button is-light",
        textContent:
          this.pendingRemovalDomain === domain
            ? i18n.get("text_assets_delete_snippet_confirm")
            : i18n.get("remove"),
        attributes: { type: "button", "data-action": "remove" },
      });
      remove.dataset.domain = domain;
      actions.append(edit, remove);
      header.appendChild(actions);
      row.appendChild(header);

      const metaGrid = createElement("div", { className: "site-profile-row-meta" });
      [
        {
          label: i18n.get("site_profiles_table_language"),
          value: SUPPORTED_LANGUAGES[profile.language] || profile.language,
        },
        {
          label: i18n.get("site_profiles_table_num_suggestions"),
          value:
            typeof profile.numSuggestions === "number"
              ? String(profile.numSuggestions)
              : getInheritLabel(String(globalNumSuggestions)),
        },
        {
          label: i18n.get("site_profiles_table_inline_mode"),
          value:
            typeof profile.inline_suggestion === "boolean"
              ? getOnOffLabel(profile.inline_suggestion)
              : getInheritLabel(getOnOffLabel(globalInlineSuggestion)),
        },
        {
          label: i18n.get("site_profiles_table_prefer_native_autocomplete"),
          value:
            typeof profile.preferNativeAutocomplete === "boolean"
              ? profile.preferNativeAutocomplete
                ? i18n.get("prefer_native_autocomplete_on")
                : i18n.get("prefer_native_autocomplete_off")
              : getInheritLabel(
                  globalPreferNativeAutocomplete
                    ? i18n.get("prefer_native_autocomplete_on")
                    : i18n.get("prefer_native_autocomplete_off"),
                ),
        },
      ].forEach((entry) => {
        const item = createElement("div", { className: "site-profile-meta-item" });
        item.appendChild(
          createElement("span", {
            className: "site-profile-meta-label",
            textContent: entry.label,
          }),
        );
        item.appendChild(
          createElement("span", {
            className: "site-profile-meta-value",
            textContent: entry.value,
          }),
        );
        metaGrid.appendChild(item);
      });
      row.appendChild(metaGrid);

      this.elements.tableBody.appendChild(row);
    });
  }

  async render(): Promise<void> {
    const [
      enabledLanguagesRaw,
      rawProfiles,
      rawNumSuggestions,
      rawInline,
      rawPreferNativeAutocomplete,
    ] = await Promise.all([
      this.store.get(KEY_ENABLED_LANGUAGES),
      this.store.get(KEY_SITE_PROFILES),
      this.store.get(KEY_NUM_SUGGESTIONS),
      this.store.get(KEY_INLINE_SUGGESTION),
      this.store.get(KEY_PREFER_NATIVE_AUTOCOMPLETE),
    ]);

    const enabledLanguages = resolveEnabledLanguages(enabledLanguagesRaw);
    const siteProfiles = resolveSiteProfiles(rawProfiles, enabledLanguages);
    const globalNumSuggestions = resolveGlobalNumSuggestions(rawNumSuggestions);
    const globalInlineSuggestion = rawInline === true;
    const globalPreferNativeAutocomplete = rawPreferNativeAutocomplete !== false;

    this.populateLanguageOptions(enabledLanguages);
    this.populateSuggestionsOptions(globalNumSuggestions);
    this.populateInlineOptions(globalInlineSuggestion);
    this.populatePreferNativeAutocompleteOptions(globalPreferNativeAutocomplete);
    this.applyEditorState(enabledLanguages, siteProfiles);
    this.renderTable(
      siteProfiles,
      globalNumSuggestions,
      globalInlineSuggestion,
      globalPreferNativeAutocomplete,
    );
    this.setStatus(this.statusText, this.statusIsError);
  }

  startEdit(domain: string): void {
    this.editingDomain = domain;
    this.pendingRemovalDomain = null;
    this.setStatus(formatTranslation("site_profiles_update_status", { domain }));
    void this.render();
  }

  cancelEdit(): void {
    this.editingDomain = null;
    this.pendingRemovalDomain = null;
    this.setStatus(i18n.get("site_profiles_editor_default_status"));
    void this.render();
  }

  async saveProfile(): Promise<void> {
    const normalizedDomain = normalizeDomainHost(this.elements.domainInput.value.trim());
    if (!normalizedDomain) {
      this.setStatus(i18n.get("site_profiles_invalid_domain"), true);
      return;
    }

    const enabledLanguages = resolveEnabledLanguages(await this.store.get(KEY_ENABLED_LANGUAGES));
    const profile = this.getEditorProfile(enabledLanguages);
    const siteProfilesRaw = await this.store.get(KEY_SITE_PROFILES);
    if (this.editingDomain !== normalizedDomain) {
      const existingProfiles = resolveSiteProfiles(siteProfilesRaw, enabledLanguages);
      if (existingProfiles[normalizedDomain]) {
        this.setStatus(
          formatTranslation("site_profiles_duplicate_domain_status", {
            domain: normalizedDomain,
          }),
          true,
        );
        return;
      }
    }
    let nextProfiles = setSiteProfileForDomain(
      siteProfilesRaw,
      normalizedDomain,
      profile,
      enabledLanguages,
    );
    if (this.editingDomain && this.editingDomain !== normalizedDomain) {
      nextProfiles = removeSiteProfileForDomain(nextProfiles, this.editingDomain, enabledLanguages);
    }

    await this.store.set(KEY_SITE_PROFILES, nextProfiles);
    this.editingDomain = normalizedDomain;
    this.pendingRemovalDomain = null;
    this.setStatus(i18n.get("site_profiles_saved_status"));
    await this.notifyConfigChange();
    await this.render();
  }

  async removeProfile(domain: string): Promise<void> {
    if (this.pendingRemovalDomain !== domain) {
      this.pendingRemovalDomain = domain;
      this.setStatus(
        formatTranslation("site_profiles_remove_confirm_status", {
          domain,
        }),
        true,
      );
      await this.render();
      return;
    }

    const enabledLanguages = resolveEnabledLanguages(await this.store.get(KEY_ENABLED_LANGUAGES));
    const currentProfiles = await this.store.get(KEY_SITE_PROFILES);
    const nextProfiles = removeSiteProfileForDomain(currentProfiles, domain, enabledLanguages);
    await this.store.set(KEY_SITE_PROFILES, nextProfiles);
    this.pendingRemovalDomain = null;
    if (this.editingDomain === domain) {
      this.editingDomain = null;
    }
    this.setStatus(i18n.get("site_profiles_removed_status"));
    await this.notifyConfigChange();
    await this.render();
  }
}
