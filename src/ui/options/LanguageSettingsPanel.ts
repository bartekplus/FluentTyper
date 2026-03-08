import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import type { Store } from "@core/application/storage/Store.js";
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_PREDICTION_LANGUAGE_KEYS,
  resolveEnabledLanguages,
} from "@core/domain/lang";
import {
  KEY_ENABLED_LANGUAGES,
  KEY_FALLBACK_LANGUAGE,
  KEY_LANGUAGE,
  KEY_SITE_PROFILES,
} from "@core/domain/constants";
import { resolveSiteProfiles } from "@core/domain/siteProfiles";
import { formatTranslation, i18n } from "./fluenttyperI18n.js";

export class LanguageSettingsPanel {
  private readonly root: HTMLElement;
  private readonly registry: SettingsRegistry;
  private readonly store: Store;

  constructor(root: HTMLElement, registry: SettingsRegistry, store: Store) {
    this.root = root;
    this.registry = registry;
    this.store = store;

    this.registry[KEY_LANGUAGE]?.addEvent("action", () => {
      void this.render();
    });
    this.registry[KEY_ENABLED_LANGUAGES]?.addEvent("action", () => {
      void this.render();
    });
    this.registry[KEY_FALLBACK_LANGUAGE]?.addEvent("action", () => {
      void this.render();
    });
    this.registry[KEY_SITE_PROFILES]?.addEvent("action", () => {
      void this.render();
    });

    void this.render();
  }

  async render(): Promise<void> {
    const [enabledLanguagesRaw, languageRaw, fallbackLanguageRaw, siteProfilesRaw] =
      await Promise.all([
        this.store.get(KEY_ENABLED_LANGUAGES),
        this.store.get(KEY_LANGUAGE),
        this.store.get(KEY_FALLBACK_LANGUAGE),
        this.store.get(KEY_SITE_PROFILES),
      ]);

    const enabledLanguages = resolveEnabledLanguages(enabledLanguagesRaw);
    const language =
      typeof languageRaw === "string" && languageRaw.length > 0 ? languageRaw : enabledLanguages[0];
    const fallbackLanguage =
      typeof fallbackLanguageRaw === "string" && fallbackLanguageRaw.length > 0
        ? fallbackLanguageRaw
        : enabledLanguages[0];
    const siteProfiles = resolveSiteProfiles(siteProfilesRaw, enabledLanguages);
    const usageCounts = this.countSiteProfileUsage(siteProfiles);

    this.root.replaceChildren(
      this.createSummary(enabledLanguages, language, fallbackLanguage),
      this.createLanguageGrid(enabledLanguages, usageCounts),
      this.createBehaviorCards(enabledLanguages, language, fallbackLanguage),
    );
  }

  private createSummary(
    enabledLanguages: string[],
    language: string,
    fallbackLanguage: string,
  ): HTMLElement {
    const shell = document.createElement("section");
    shell.className = "language-panel-summary";

    const title = document.createElement("h4");
    title.textContent = i18n.get("language_panel_summary_title");
    shell.appendChild(title);

    const text = document.createElement("p");
    const primaryLabel =
      language === "auto_detect"
        ? i18n.get("language_panel_auto_detect")
        : SUPPORTED_LANGUAGES[language] || language;
    const fallbackLabel = SUPPORTED_LANGUAGES[fallbackLanguage] || fallbackLanguage;
    if (enabledLanguages.length > 1) {
      text.textContent =
        language === "auto_detect"
          ? formatTranslation("language_panel_summary_multi", {
              count: enabledLanguages.length,
              primary: primaryLabel,
              fallback: fallbackLabel,
            })
          : formatTranslation("language_panel_summary_multi_fixed", {
              count: enabledLanguages.length,
              primary: primaryLabel,
            });
    } else {
      text.textContent = formatTranslation("language_panel_summary_single", {
        language: SUPPORTED_LANGUAGES[enabledLanguages[0]] || enabledLanguages[0],
      });
    }
    shell.appendChild(text);

    const link = document.createElement("a");
    link.href = "#site_mgmt_tab";
    link.textContent = i18n.get("language_panel_site_overrides_link");
    shell.appendChild(link);

    return shell;
  }

  private createLanguageGrid(
    enabledLanguages: string[],
    usageCounts: Record<string, number>,
  ): HTMLElement {
    const section = document.createElement("section");
    section.className = "language-card-grid";

    SUPPORTED_PREDICTION_LANGUAGE_KEYS.forEach((languageKey) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "language-card";
      if (enabledLanguages.includes(languageKey)) {
        button.classList.add("is-active");
      }

      const title = document.createElement("strong");
      title.textContent = SUPPORTED_LANGUAGES[languageKey] || languageKey;
      button.appendChild(title);

      const meta = document.createElement("span");
      meta.className = "language-card-meta";
      const count = usageCounts[languageKey] || 0;
      meta.textContent =
        count > 0
          ? formatTranslation("language_panel_usage_count", { count })
          : i18n.get("language_panel_site_available");
      button.appendChild(meta);

      if (count > 0 && enabledLanguages.includes(languageKey)) {
        const warning = document.createElement("span");
        warning.className = "language-card-warning";
        warning.textContent = i18n.get("language_panel_site_override_warning");
        button.appendChild(warning);
      }

      button.addEventListener("click", () => {
        const next = enabledLanguages.includes(languageKey)
          ? enabledLanguages.filter((entry) => entry !== languageKey)
          : SUPPORTED_PREDICTION_LANGUAGE_KEYS.filter((entry) =>
              new Set([...enabledLanguages, languageKey]).has(entry),
            );
        if (next.length === 0) {
          return;
        }
        this.registry[KEY_ENABLED_LANGUAGES].set(next);
      });

      section.appendChild(button);
    });

    return section;
  }

  private createBehaviorCards(
    enabledLanguages: string[],
    language: string,
    fallbackLanguage: string,
  ): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "language-behavior-grid";

    const primaryCard = document.createElement("section");
    primaryCard.className = "settings-inline-card";
    const primaryLabel = document.createElement("label");
    primaryLabel.textContent = i18n.get("primary_lang_label");
    primaryCard.appendChild(primaryLabel);
    const primarySelect = document.createElement("select");
    primarySelect.className = "input";
    if (enabledLanguages.length > 1) {
      const autoDetect = document.createElement("option");
      autoDetect.value = "auto_detect";
      autoDetect.textContent = i18n.get("language_panel_auto_detect");
      primarySelect.appendChild(autoDetect);
    }
    enabledLanguages.forEach((languageKey) => {
      const option = document.createElement("option");
      option.value = languageKey;
      option.textContent = SUPPORTED_LANGUAGES[languageKey] || languageKey;
      primarySelect.appendChild(option);
    });
    primarySelect.value =
      language === "auto_detect" && enabledLanguages.length > 1
        ? "auto_detect"
        : enabledLanguages.includes(language)
          ? language
          : enabledLanguages[0];
    primarySelect.addEventListener("change", () => {
      this.registry[KEY_LANGUAGE].set(primarySelect.value);
    });
    primaryCard.appendChild(primarySelect);
    const primaryHelp = document.createElement("p");
    primaryHelp.className = "settings-inline-help";
    primaryHelp.textContent = i18n.get("language_panel_primary_help");
    primaryCard.appendChild(primaryHelp);
    grid.appendChild(primaryCard);

    const detectionCard = document.createElement("section");
    detectionCard.className = "settings-inline-card";
    const detectionTitle = document.createElement("label");
    detectionTitle.textContent = i18n.get("language_panel_detection_title");
    detectionCard.appendChild(detectionTitle);
    const detectionCopy = document.createElement("p");
    detectionCopy.className = "settings-inline-help";
    detectionCopy.textContent =
      enabledLanguages.length > 1
        ? i18n.get("language_panel_detection_multi")
        : i18n.get("language_panel_detection_single");
    detectionCard.appendChild(detectionCopy);

    if (enabledLanguages.length > 1 && primarySelect.value === "auto_detect") {
      const fallbackSelect = document.createElement("select");
      fallbackSelect.className = "input";
      enabledLanguages.forEach((languageKey) => {
        const option = document.createElement("option");
        option.value = languageKey;
        option.textContent = SUPPORTED_LANGUAGES[languageKey] || languageKey;
        fallbackSelect.appendChild(option);
      });
      fallbackSelect.value = enabledLanguages.includes(fallbackLanguage)
        ? fallbackLanguage
        : enabledLanguages[0];
      fallbackSelect.addEventListener("change", () => {
        this.registry[KEY_FALLBACK_LANGUAGE].set(fallbackSelect.value);
      });
      detectionCard.appendChild(fallbackSelect);
    }

    grid.appendChild(detectionCard);
    return grid;
  }

  private countSiteProfileUsage(
    siteProfiles: Record<string, { language: string }>,
  ): Record<string, number> {
    return Object.values(siteProfiles).reduce<Record<string, number>>((acc, profile) => {
      if (!profile.language) {
        return acc;
      }
      acc[profile.language] = (acc[profile.language] || 0) + 1;
      return acc;
    }, {});
  }
}
