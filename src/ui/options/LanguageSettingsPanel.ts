import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import type { Store } from "@core/application/storage/Store.js";
import {
  SUPPORTED_PREDICTION_LANGUAGE_KEYS,
  resolveEnabledLanguages,
  resolveFallbackLanguage,
  resolvePrimaryLanguage,
} from "@core/domain/lang";
import {
  KEY_ENABLED_LANGUAGES,
  KEY_EXTENSION_LANGUAGE,
  KEY_FALLBACK_LANGUAGE,
  KEY_LANGUAGE,
  KEY_SITE_PROFILES,
} from "@core/domain/constants";
import { resolveSiteProfiles } from "@core/domain/siteProfiles";
import { fetchAutoLanguageStatus } from "@ui/shared/runtimeMessaging";
import { appendLanguageOptions, languageLabel } from "@ui/shared/siteProfileEditor";
import { formatTranslation, i18n } from "./fluenttyperI18n.js";
import {
  bindRerender,
  createButton,
  createElement,
  createInlineCard,
  createWorkspaceCard,
  createWorkspaceShell,
  moveControlToBody,
  pruneEmptySettingsGroups,
} from "./workspacePanelUtils.js";

export class LanguageSettingsPanel {
  private readonly root: HTMLElement;
  private readonly registry: SettingsRegistry;
  private readonly store: Store;

  constructor(root: HTMLElement, registry: SettingsRegistry, store: Store) {
    this.root = root;
    this.registry = registry;
    this.store = store;

    bindRerender(this.registry[KEY_LANGUAGE], () => this.render());
    bindRerender(this.registry[KEY_EXTENSION_LANGUAGE], () => this.render());
    bindRerender(this.registry[KEY_ENABLED_LANGUAGES], () => this.render());
    bindRerender(this.registry[KEY_FALLBACK_LANGUAGE], () => this.render());
    bindRerender(this.registry[KEY_SITE_PROFILES], () => this.render());

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
    const autoLanguageStatus = language === "auto_detect" ? await fetchAutoLanguageStatus() : null;

    const shell = createWorkspaceShell();

    const topGrid = createWorkspaceShell("workspace-top-grid");
    topGrid.append(
      this.createControlCard("extension_ui_language", KEY_EXTENSION_LANGUAGE),
      this.createSummary(enabledLanguages, language, fallbackLanguage, autoLanguageStatus),
    );

    const lowerGrid = createWorkspaceShell("workspace-main-grid");
    const languageGridSection = this.createLanguageGridSection(enabledLanguages, usageCounts);
    languageGridSection.classList.add("workspace-span-full");
    lowerGrid.append(
      languageGridSection,
      ...this.createBehaviorCards(enabledLanguages, language, fallbackLanguage),
    );

    shell.append(topGrid, lowerGrid);

    this.root.replaceChildren(shell);
    pruneEmptySettingsGroups(this.root);
  }

  private createControlCard(titleKey: string, controlKey: string): HTMLElement {
    const { card, body } = createWorkspaceCard(i18n.get(titleKey));
    moveControlToBody(this.registry, controlKey, body);
    return card;
  }

  private createSummary(
    enabledLanguages: string[],
    language: string,
    fallbackLanguage: string,
    autoLanguageStatus: { language: string; locked: boolean } | null,
  ): HTMLElement {
    const shell = createInlineCard(i18n.get("language_panel_summary_title"));
    shell.classList.add("language-panel-summary");

    const text = document.createElement("p");
    const primaryLabel =
      language === "auto_detect" ? i18n.get("language_panel_auto_detect") : languageLabel(language);
    const fallbackLabel = languageLabel(fallbackLanguage);
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
        language: languageLabel(enabledLanguages[0]),
      });
    }
    shell.appendChild(text);

    if (language === "auto_detect" && autoLanguageStatus?.language) {
      const activeStatus = createElement("p", { className: "settings-inline-help" });
      const activeLabel = languageLabel(autoLanguageStatus.language);
      activeStatus.textContent = formatTranslation("language_panel_auto_detect_current", {
        language: activeLabel,
      });
      if (autoLanguageStatus.locked) {
        activeStatus.textContent += ` ${i18n.get("language_panel_auto_detect_locked")}`;
      }
      shell.appendChild(activeStatus);
    } else if (language === "auto_detect") {
      const waitingStatus = createElement("p", {
        className: "settings-inline-help",
        textContent: formatTranslation("language_panel_auto_detect_waiting", {
          language: fallbackLabel,
        }),
      });
      shell.appendChild(waitingStatus);
    }

    if (language === "auto_detect") {
      const behaviorStatus = createElement("p", {
        className: "settings-inline-help",
        textContent: autoLanguageStatus?.locked
          ? i18n.get("language_panel_auto_detect_locked_reason")
          : autoLanguageStatus?.language
            ? i18n.get("language_panel_auto_detect_live_reason")
            : formatTranslation("language_panel_auto_detect_waiting_reason", {
                language: fallbackLabel,
              }),
      });
      shell.appendChild(behaviorStatus);

      const learningStatus = createElement("p", {
        className: "settings-inline-help",
        textContent: i18n.get("language_panel_auto_detect_learning"),
      });
      shell.appendChild(learningStatus);
    }

    const link = document.createElement("a");
    link.href = "#site_mgmt_tab";
    link.textContent = i18n.get("language_panel_site_overrides_link");
    shell.appendChild(link);

    return shell;
  }

  private createLanguageGridSection(
    enabledLanguages: string[],
    usageCounts: Record<string, number>,
  ): HTMLElement {
    const { card, body } = createWorkspaceCard(
      i18n.get("options_panel_language_label"),
      i18n.get("options_panel_language_desc"),
    );
    const section = createElement("div", { className: "language-card-grid" });

    SUPPORTED_PREDICTION_LANGUAGE_KEYS.forEach((languageKey) => {
      const button = createButton("", "language-card");
      if (enabledLanguages.includes(languageKey)) {
        button.classList.add("is-active");
      }

      const title = createElement("strong", { textContent: languageLabel(languageKey) });
      button.appendChild(title);

      const meta = createElement("span", { className: "language-card-meta" });
      const count = usageCounts[languageKey] || 0;
      meta.textContent =
        count > 0
          ? formatTranslation("language_panel_usage_count", { count })
          : i18n.get("language_panel_site_available");
      button.appendChild(meta);

      if (count > 0 && enabledLanguages.includes(languageKey)) {
        const warning = createElement("span", {
          className: "language-card-warning",
          textContent: i18n.get("language_panel_site_override_warning"),
        });
        button.appendChild(warning);
      }

      button.addEventListener("click", () => {
        const next = enabledLanguages.includes(languageKey)
          ? enabledLanguages.filter((entry) => entry !== languageKey)
          : SUPPORTED_PREDICTION_LANGUAGE_KEYS.filter(
              (entry) => entry === languageKey || enabledLanguages.includes(entry),
            );
        if (next.length === 0) {
          return;
        }
        this.registry[KEY_ENABLED_LANGUAGES].set(next);
      });

      section.appendChild(button);
    });

    body.appendChild(section);
    return card;
  }

  private createBehaviorCards(
    enabledLanguages: string[],
    language: string,
    fallbackLanguage: string,
  ): HTMLElement[] {
    const primaryCard = createElement("section", { className: "settings-inline-card" });
    const primaryLabel = createElement("label", { textContent: i18n.get("primary_lang_label") });
    primaryCard.appendChild(primaryLabel);
    const primarySelect = createElement("select", { className: "input" });
    if (enabledLanguages.length > 1) {
      primarySelect.appendChild(
        new window.Option(i18n.get("language_panel_auto_detect"), "auto_detect"),
      );
    }
    appendLanguageOptions(primarySelect, enabledLanguages);
    primarySelect.value = resolvePrimaryLanguage(language, enabledLanguages);
    primarySelect.addEventListener("change", () => {
      this.registry[KEY_LANGUAGE].set(primarySelect.value);
    });
    primaryCard.appendChild(primarySelect);
    const primaryHelp = createElement("p", {
      className: "settings-inline-help",
      textContent: i18n.get("language_panel_primary_help"),
    });
    primaryCard.appendChild(primaryHelp);

    const detectionCard = createElement("section", { className: "settings-inline-card" });
    const detectionTitle = createElement("label", {
      textContent: i18n.get("language_panel_detection_title"),
    });
    detectionCard.appendChild(detectionTitle);
    const detectionCopy = createElement("p", { className: "settings-inline-help" });
    detectionCopy.textContent =
      enabledLanguages.length > 1
        ? i18n.get("language_panel_detection_multi")
        : i18n.get("language_panel_detection_single");
    detectionCard.appendChild(detectionCopy);

    if (enabledLanguages.length > 1) {
      const stabilityCopy = createElement("p", {
        className: "settings-inline-help",
        textContent: i18n.get("language_panel_detection_stable"),
      });
      detectionCard.appendChild(stabilityCopy);

      const lockCopy = createElement("p", {
        className: "settings-inline-help",
        textContent: formatTranslation("language_panel_detection_lock_and_fallback", {
          language: languageLabel(fallbackLanguage),
        }),
      });
      detectionCard.appendChild(lockCopy);
    }

    if (enabledLanguages.length > 1 && primarySelect.value === "auto_detect") {
      const fallbackSelect = createElement("select", { className: "input" });
      appendLanguageOptions(fallbackSelect, enabledLanguages);
      fallbackSelect.value = resolveFallbackLanguage(fallbackLanguage, enabledLanguages);
      fallbackSelect.addEventListener("change", () => {
        this.registry[KEY_FALLBACK_LANGUAGE].set(fallbackSelect.value);
      });
      detectionCard.appendChild(fallbackSelect);
    }

    return [primaryCard, detectionCard];
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
