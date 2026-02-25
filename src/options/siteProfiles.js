import { Store } from "../third_party/fancier-settings/lib/store.js";
import { i18n } from "../third_party/fancier-settings/i18n.js";
import {
  SUPPORTED_LANGUAGES,
  resolveEnabledLanguages,
} from "../shared/lang.ts";
import {
  DEFAULT_NUM_SUGGESTIONS,
  KEY_ENABLED_LANGUAGES,
  KEY_INLINE_SUGGESTION,
  KEY_NUM_SUGGESTIONS,
  KEY_SITE_PROFILES,
  MAX_NUM_SUGGESTIONS,
} from "../shared/constants.ts";
import {
  normalizeDomainHost,
  removeSiteProfileForDomain,
  resolveSiteProfiles,
  setSiteProfileForDomain,
} from "../shared/siteProfiles.ts";

function resolveGlobalNumSuggestions(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_NUM_SUGGESTIONS;
  }
  return Math.min(MAX_NUM_SUGGESTIONS, Math.max(0, Math.round(value)));
}

function parseSuggestionsOverride(value) {
  if (value === "global") {
    return undefined;
  }
  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue)) {
    return undefined;
  }
  return Math.min(MAX_NUM_SUGGESTIONS, Math.max(0, parsedValue));
}

function parseInlineOverride(value) {
  if (value === "on") {
    return true;
  }
  if (value === "off") {
    return false;
  }
  return undefined;
}

function getOnOffLabel(value) {
  return value ? i18n.get("site_profile_on") : i18n.get("site_profile_off");
}

function getInheritLabel(globalValueLabel) {
  return `${i18n.get("site_profile_inherit_global")} (${globalValueLabel})`;
}

function getPrimaryLanguage(enabledLanguages) {
  return enabledLanguages[0] || "en_US";
}

export class SiteProfilesManager {
  constructor(settings, onConfigChange) {
    this.settings = settings;
    this.onConfigChange = onConfigChange;
    this.store = new Store("settings");
    this.editingDomain = null;
    this.statusText = "";
    this.statusIsError = false;
    this.root =
      this.settings.manifest.siteProfilesEditor.bundle.element.querySelector(
        "#siteProfilesEditorRoot",
      ) || this.settings.manifest.siteProfilesEditor.bundle.element;
    this.buildUI();
    this.cacheElements();
    this.bindEvents();
    this.setStatus(i18n.get("site_profiles_form_hint"));
    this.render();
  }

  buildUI() {
    this.root.innerHTML = `
      <p class="help mb-3">${i18n.get("site_profiles_desc")}</p>
      <div class="columns is-multiline">
        <div class="column is-4">
          <label class="label" for="siteProfileDomainInput">${i18n.get("site_profiles_domain_label")}</label>
          <input
            id="siteProfileDomainInput"
            class="input"
            type="text"
            placeholder="${i18n.get("site_profiles_domain_placeholder")}"
          />
        </div>
        <div class="column is-3">
          <label class="label" for="siteProfileLanguageSelect">${i18n.get("site_profiles_language_label")}</label>
          <div class="select is-fullwidth">
            <select id="siteProfileLanguageSelect"></select>
          </div>
        </div>
        <div class="column is-3">
          <label class="label" for="siteProfileNumSuggestionsSelect">${i18n.get("site_profiles_num_suggestions_label")}</label>
          <div class="select is-fullwidth">
            <select id="siteProfileNumSuggestionsSelect"></select>
          </div>
        </div>
        <div class="column is-2">
          <label class="label" for="siteProfileInlineSelect">${i18n.get("site_profiles_inline_mode_label")}</label>
          <div class="select is-fullwidth">
            <select id="siteProfileInlineSelect"></select>
          </div>
        </div>
      </div>
      <div class="field is-grouped mb-2">
        <p class="control">
          <button id="siteProfileSaveButton" class="button is-primary" type="button">
            ${i18n.get("site_profiles_add_btn")}
          </button>
        </p>
        <p class="control">
          <button id="siteProfileCancelButton" class="button" type="button">
            ${i18n.get("site_profiles_cancel_btn")}
          </button>
        </p>
      </div>
      <p id="siteProfilesFormStatus" class="help mb-4"></p>
      <p id="siteProfilesEmptyState" class="help is-hidden">${i18n.get("site_profiles_empty")}</p>
      <div id="siteProfilesTableContainer" class="table-container">
        <table class="table is-fullwidth is-striped is-hoverable">
          <thead>
            <tr>
              <th>${i18n.get("site_profiles_table_domain")}</th>
              <th>${i18n.get("site_profiles_table_language")}</th>
              <th>${i18n.get("site_profiles_table_num_suggestions")}</th>
              <th>${i18n.get("site_profiles_table_inline_mode")}</th>
              <th>${i18n.get("site_profiles_table_actions")}</th>
            </tr>
          </thead>
          <tbody id="siteProfilesTableBody"></tbody>
        </table>
      </div>
    `;
  }

  cacheElements() {
    this.elements = {
      domainInput: this.root.querySelector("#siteProfileDomainInput"),
      languageSelect: this.root.querySelector("#siteProfileLanguageSelect"),
      numSuggestionsSelect: this.root.querySelector(
        "#siteProfileNumSuggestionsSelect",
      ),
      inlineSelect: this.root.querySelector("#siteProfileInlineSelect"),
      saveButton: this.root.querySelector("#siteProfileSaveButton"),
      cancelButton: this.root.querySelector("#siteProfileCancelButton"),
      status: this.root.querySelector("#siteProfilesFormStatus"),
      tableBody: this.root.querySelector("#siteProfilesTableBody"),
      emptyState: this.root.querySelector("#siteProfilesEmptyState"),
      tableContainer: this.root.querySelector("#siteProfilesTableContainer"),
    };
  }

  bindEvents() {
    this.elements.saveButton.addEventListener(
      "click",
      this.saveProfile.bind(this),
    );
    this.elements.cancelButton.addEventListener(
      "click",
      this.cancelEdit.bind(this),
    );
    this.elements.domainInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.saveProfile();
      }
    });
    this.elements.tableBody.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const actionButton = target.closest("button[data-action][data-domain]");
      if (!(actionButton instanceof HTMLButtonElement)) {
        return;
      }
      const domain = actionButton.dataset.domain;
      if (!domain) {
        return;
      }
      if (actionButton.dataset.action === "edit") {
        this.startEdit(domain);
        return;
      }
      if (actionButton.dataset.action === "remove") {
        this.removeProfile(domain);
      }
    });
  }

  setStatus(text, isError = false) {
    this.statusText = text;
    this.statusIsError = isError;
    this.elements.status.textContent = text;
    this.elements.status.classList.toggle("has-text-danger", isError);
  }

  getEditorProfile(enabledLanguages) {
    const primaryLanguage = getPrimaryLanguage(enabledLanguages);
    const selectedLanguage = enabledLanguages.includes(
      this.elements.languageSelect.value,
    )
      ? this.elements.languageSelect.value
      : primaryLanguage;
    const profile = {
      language: selectedLanguage,
    };
    const numSuggestions = parseSuggestionsOverride(
      this.elements.numSuggestionsSelect.value,
    );
    if (typeof numSuggestions === "number") {
      profile.numSuggestions = numSuggestions;
    }
    const inlineSuggestion = parseInlineOverride(
      this.elements.inlineSelect.value,
    );
    if (typeof inlineSuggestion === "boolean") {
      profile.inline_suggestion = inlineSuggestion;
    }
    return profile;
  }

  async notifyConfigChange() {
    if (typeof this.onConfigChange === "function") {
      await this.onConfigChange();
    }
  }

  populateLanguageOptions(enabledLanguages) {
    this.elements.languageSelect.innerHTML = "";
    enabledLanguages.forEach((langCode) => {
      const option = document.createElement("option");
      option.value = langCode;
      option.textContent = SUPPORTED_LANGUAGES[langCode] || langCode;
      this.elements.languageSelect.appendChild(option);
    });
  }

  populateSuggestionsOptions(globalNumSuggestions) {
    this.elements.numSuggestionsSelect.innerHTML = "";
    const inheritOption = document.createElement("option");
    inheritOption.value = "global";
    inheritOption.textContent = getInheritLabel(String(globalNumSuggestions));
    this.elements.numSuggestionsSelect.appendChild(inheritOption);
    for (let idx = 0; idx <= MAX_NUM_SUGGESTIONS; idx++) {
      const option = document.createElement("option");
      option.value = String(idx);
      option.textContent = String(idx);
      this.elements.numSuggestionsSelect.appendChild(option);
    }
  }

  populateInlineOptions(globalInlineSuggestion) {
    this.elements.inlineSelect.innerHTML = "";
    [
      {
        value: "global",
        label: getInheritLabel(getOnOffLabel(globalInlineSuggestion)),
      },
      { value: "on", label: getOnOffLabel(true) },
      { value: "off", label: getOnOffLabel(false) },
    ].forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.value;
      option.textContent = entry.label;
      this.elements.inlineSelect.appendChild(option);
    });
  }

  applyEditorState(enabledLanguages, siteProfiles) {
    const primaryLanguage = getPrimaryLanguage(enabledLanguages);
    const editingProfile = this.editingDomain
      ? siteProfiles[this.editingDomain]
      : undefined;
    if (this.editingDomain && !editingProfile) {
      this.editingDomain = null;
    }

    const profile = this.editingDomain
      ? siteProfiles[this.editingDomain]
      : null;
    this.elements.domainInput.value = this.editingDomain || "";
    this.elements.languageSelect.value = profile?.language || primaryLanguage;
    this.elements.numSuggestionsSelect.value =
      typeof profile?.numSuggestions === "number"
        ? String(profile.numSuggestions)
        : "global";
    this.elements.inlineSelect.value =
      typeof profile?.inline_suggestion === "boolean"
        ? profile.inline_suggestion
          ? "on"
          : "off"
        : "global";
    this.elements.saveButton.textContent = this.editingDomain
      ? i18n.get("site_profiles_update_btn")
      : i18n.get("site_profiles_add_btn");
    this.elements.cancelButton.classList.toggle(
      "is-hidden",
      !this.editingDomain,
    );

    if (!this.editingDomain && !this.statusText) {
      this.setStatus(i18n.get("site_profiles_form_hint"));
    }
  }

  renderTable(siteProfiles, globalNumSuggestions, globalInlineSuggestion) {
    const profileEntries = Object.entries(siteProfiles).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    this.elements.tableBody.innerHTML = "";
    const hasProfiles = profileEntries.length > 0;
    this.elements.emptyState.classList.toggle("is-hidden", hasProfiles);
    this.elements.tableContainer.classList.toggle("is-hidden", !hasProfiles);
    if (!hasProfiles) {
      return;
    }

    profileEntries.forEach(([domain, profile]) => {
      const row = document.createElement("tr");
      const numSuggestionsLabel =
        typeof profile.numSuggestions === "number"
          ? String(profile.numSuggestions)
          : getInheritLabel(String(globalNumSuggestions));
      const inlineLabel =
        typeof profile.inline_suggestion === "boolean"
          ? getOnOffLabel(profile.inline_suggestion)
          : getInheritLabel(getOnOffLabel(globalInlineSuggestion));
      const isSuggestionsInherited = typeof profile.numSuggestions !== "number";
      const isInlineInherited = typeof profile.inline_suggestion !== "boolean";
      row.innerHTML = `
        <td>${domain}</td>
        <td>${SUPPORTED_LANGUAGES[profile.language] || profile.language}</td>
        <td class="${isSuggestionsInherited ? "has-text-grey" : ""}">${numSuggestionsLabel}</td>
        <td class="${isInlineInherited ? "has-text-grey" : ""}">${inlineLabel}</td>
        <td>
          <div class="buttons are-small">
            <button class="button is-link is-light" type="button" data-action="edit" data-domain="${domain}">
              ${i18n.get("site_profiles_edit_btn")}
            </button>
            <button class="button is-danger is-light" type="button" data-action="remove" data-domain="${domain}">
              ${i18n.get("remove")}
            </button>
          </div>
        </td>
      `;
      this.elements.tableBody.appendChild(row);
    });
  }

  async render() {
    const [enabledLanguagesRaw, rawProfiles, rawNumSuggestions, rawInline] =
      await Promise.all([
        this.store.get(KEY_ENABLED_LANGUAGES),
        this.store.get(KEY_SITE_PROFILES),
        this.store.get(KEY_NUM_SUGGESTIONS),
        this.store.get(KEY_INLINE_SUGGESTION),
      ]);
    const enabledLanguages = resolveEnabledLanguages(enabledLanguagesRaw);
    const siteProfiles = resolveSiteProfiles(rawProfiles, enabledLanguages);
    const globalNumSuggestions = resolveGlobalNumSuggestions(rawNumSuggestions);
    const globalInlineSuggestion = rawInline === true;

    this.populateLanguageOptions(enabledLanguages);
    this.populateSuggestionsOptions(globalNumSuggestions);
    this.populateInlineOptions(globalInlineSuggestion);
    this.applyEditorState(enabledLanguages, siteProfiles);
    this.renderTable(
      siteProfiles,
      globalNumSuggestions,
      globalInlineSuggestion,
    );
    this.setStatus(
      this.statusText || i18n.get("site_profiles_form_hint"),
      this.statusIsError,
    );
  }

  startEdit(domain) {
    this.editingDomain = domain;
    this.statusText = `${i18n.get("site_profiles_editing_hint")} ${domain}`;
    this.statusIsError = false;
    this.render();
  }

  cancelEdit() {
    this.editingDomain = null;
    this.statusText = i18n.get("site_profiles_form_hint");
    this.statusIsError = false;
    this.render();
  }

  async saveProfile() {
    const domainInput = this.elements.domainInput.value.trim();
    const normalizedDomain = normalizeDomainHost(domainInput);
    if (!normalizedDomain) {
      this.setStatus(i18n.get("site_profiles_invalid_domain"), true);
      return;
    }

    const enabledLanguages = resolveEnabledLanguages(
      await this.store.get(KEY_ENABLED_LANGUAGES),
    );
    const profile = this.getEditorProfile(enabledLanguages);
    const siteProfilesRaw = await this.store.get(KEY_SITE_PROFILES);
    let updatedProfiles = setSiteProfileForDomain(
      siteProfilesRaw,
      normalizedDomain,
      profile,
      enabledLanguages,
    );
    if (this.editingDomain && this.editingDomain !== normalizedDomain) {
      updatedProfiles = removeSiteProfileForDomain(
        updatedProfiles,
        this.editingDomain,
        enabledLanguages,
      );
    }
    await this.store.set(KEY_SITE_PROFILES, updatedProfiles);
    this.editingDomain = normalizedDomain;
    this.setStatus(i18n.get("site_profiles_saved_status"));
    await this.notifyConfigChange();
    await this.render();
  }

  async removeProfile(domain) {
    const enabledLanguages = resolveEnabledLanguages(
      await this.store.get(KEY_ENABLED_LANGUAGES),
    );
    const currentProfiles = await this.store.get(KEY_SITE_PROFILES);
    const updatedProfiles = removeSiteProfileForDomain(
      currentProfiles,
      domain,
      enabledLanguages,
    );
    await this.store.set(KEY_SITE_PROFILES, updatedProfiles);
    if (this.editingDomain === domain) {
      this.editingDomain = null;
    }
    this.setStatus(i18n.get("site_profiles_removed_status"));
    await this.notifyConfigChange();
    await this.render();
  }
}
