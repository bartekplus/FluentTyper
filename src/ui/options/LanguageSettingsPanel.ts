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
import { createElement } from "@ui/settings-engine/dom/createElement.js";
import { getUniqueID } from "@ui/settings-engine/controls/FieldControl.js";
import {
  bindRerender,
  createButton,
  createInlineCard,
  createWorkspaceCard,
  moveControlToBody,
  pruneEmptySettingsGroups,
  replaceChildrenKeepingDisclosures,
} from "./workspacePanelUtils.js";

export class LanguageSettingsPanel {
  private readonly root: HTMLElement;
  private readonly registry: SettingsRegistry;
  private readonly store: Store;
  private renderSeq = 0;

  constructor(root: HTMLElement, registry: SettingsRegistry, store: Store) {
    this.root = root;
    this.registry = registry;
    this.store = store;

    for (const key of [
      KEY_LANGUAGE,
      KEY_EXTENSION_LANGUAGE,
      KEY_ENABLED_LANGUAGES,
      KEY_FALLBACK_LANGUAGE,
      KEY_SITE_PROFILES,
    ]) {
      bindRerender(this.registry[key], () => this.render());
    }

    void this.render();
  }

  async render(): Promise<void> {
    const seq = ++this.renderSeq;
    const [enabledLanguagesRaw, languageRaw, fallbackLanguageRaw, siteProfilesRaw] =
      await Promise.all([
        this.store.get(KEY_ENABLED_LANGUAGES),
        this.store.get(KEY_LANGUAGE),
        this.store.get(KEY_FALLBACK_LANGUAGE),
        this.store.get(KEY_SITE_PROFILES),
      ]);
    if (seq !== this.renderSeq) {
      return;
    }

    const enabledLanguages = resolveEnabledLanguages(enabledLanguagesRaw);
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    const language = resolvePrimaryLanguage(text(languageRaw), enabledLanguages);
    const fallbackLanguage = resolveFallbackLanguage(text(fallbackLanguageRaw), enabledLanguages);
    const usageCounts: Record<string, number> = {};
    for (const profile of Object.values(resolveSiteProfiles(siteProfilesRaw, enabledLanguages))) {
      usageCounts[profile.language] = (usageCounts[profile.language] || 0) + 1;
    }
    const autoLanguageStatus = language === "auto_detect" ? await fetchAutoLanguageStatus() : null;
    if (seq !== this.renderSeq) {
      return;
    }

    replaceChildrenKeepingDisclosures(this.root, () => {
      const shell = createElement("div", { className: "workspace-panel-stack" });

      const extensionLanguage = createWorkspaceCard(i18n.get("extension_ui_language"));
      moveControlToBody(this.registry, KEY_EXTENSION_LANGUAGE, extensionLanguage.body);
      const topGrid = createElement("div", { className: "workspace-top-grid" });
      topGrid.append(
        extensionLanguage.card,
        this.createSummary(enabledLanguages, language, fallbackLanguage, autoLanguageStatus),
      );

      const lowerGrid = createElement("div", { className: "workspace-main-grid" });
      const languageGridSection = this.createLanguageGridSection(enabledLanguages, usageCounts);
      languageGridSection.classList.add("workspace-span-full");
      lowerGrid.append(
        languageGridSection,
        ...this.createBehaviorCards(enabledLanguages, language, fallbackLanguage),
      );

      shell.append(topGrid, lowerGrid);
      return shell;
    });
    pruneEmptySettingsGroups(this.root);
  }

  private createSummary(
    enabledLanguages: string[],
    language: string,
    fallbackLanguage: string,
    autoLanguageStatus: { language: string; locked: boolean } | null,
  ): HTMLElement {
    const shell = createInlineCard(i18n.get("language_panel_summary_title"));
    shell.classList.add("language-panel-summary");

    const fallbackLabel = languageLabel(fallbackLanguage);
    const count = enabledLanguages.length;
    shell.appendChild(
      createElement("p", {
        textContent:
          count <= 1
            ? formatTranslation("language_panel_summary_single", {
                language: languageLabel(enabledLanguages[0]),
              })
            : language === "auto_detect"
              ? formatTranslation("language_panel_summary_multi", {
                  count,
                  primary: i18n.get("language_panel_auto_detect"),
                  fallback: fallbackLabel,
                })
              : formatTranslation("language_panel_summary_multi_fixed", {
                  count,
                  primary: languageLabel(language),
                }),
      }),
    );

    if (language === "auto_detect") {
      const activeLanguage = autoLanguageStatus?.language;
      const locked = autoLanguageStatus?.locked;
      shell.append(
        helpText(
          activeLanguage
            ? formatTranslation("language_panel_auto_detect_current", {
                language: languageLabel(activeLanguage),
              }) + (locked ? ` ${i18n.get("language_panel_auto_detect_locked")}` : "")
            : formatTranslation("language_panel_auto_detect_waiting", { language: fallbackLabel }),
        ),
        helpText(
          locked
            ? i18n.get("language_panel_auto_detect_locked_reason")
            : activeLanguage
              ? i18n.get("language_panel_auto_detect_live_reason")
              : formatTranslation("language_panel_auto_detect_waiting_reason", {
                  language: fallbackLabel,
                }),
        ),
        helpText(i18n.get("language_panel_auto_detect_learning")),
      );
    }

    shell.appendChild(
      createElement("a", {
        textContent: i18n.get("language_panel_site_overrides_link"),
        attributes: { href: "#site_mgmt_tab" },
      }),
    );
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
      const enabled = enabledLanguages.includes(languageKey);
      const button = createButton("", "language-card", () => {
        const next = enabled
          ? enabledLanguages.filter((entry) => entry !== languageKey)
          : SUPPORTED_PREDICTION_LANGUAGE_KEYS.filter(
              (entry) => entry === languageKey || enabledLanguages.includes(entry),
            );
        if (next.length === 0) {
          return;
        }
        this.registry[KEY_ENABLED_LANGUAGES].set(next);
      });
      button.classList.toggle("is-active", enabled);

      const count = usageCounts[languageKey] || 0;
      button.append(
        createElement("strong", { textContent: languageLabel(languageKey) }),
        createElement("span", {
          className: "language-card-meta",
          textContent:
            count > 0
              ? formatTranslation("language_panel_usage_count", { count })
              : i18n.get("language_panel_site_available"),
        }),
      );
      if (count > 0) {
        button.appendChild(
          createElement("span", {
            className: "language-card-warning",
            textContent: i18n.get("language_panel_site_override_warning"),
          }),
        );
      }

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
    const multiple = enabledLanguages.length > 1;
    const primarySelect = createElement("select", { className: "input", id: getUniqueID() });
    const primaryLabel = createElement("label", { textContent: i18n.get("primary_lang_label") });
    primaryLabel.htmlFor = primarySelect.id;
    if (multiple) {
      primarySelect.appendChild(
        new window.Option(i18n.get("language_panel_auto_detect"), "auto_detect"),
      );
    }
    appendLanguageOptions(primarySelect, enabledLanguages);
    primarySelect.value = language;
    primarySelect.addEventListener("change", () => {
      this.registry[KEY_LANGUAGE].set(primarySelect.value);
    });
    const primaryCard = createElement("section", { className: "settings-inline-card" });
    primaryCard.append(
      primaryLabel,
      primarySelect,
      helpText(i18n.get("language_panel_primary_help")),
    );

    const detectionCard = createElement("section", { className: "settings-inline-card" });
    detectionCard.append(
      createElement("label", { textContent: i18n.get("language_panel_detection_title") }),
      helpText(
        i18n.get(multiple ? "language_panel_detection_multi" : "language_panel_detection_single"),
      ),
    );
    if (multiple) {
      detectionCard.append(
        helpText(i18n.get("language_panel_detection_stable")),
        helpText(
          formatTranslation("language_panel_detection_lock_and_fallback", {
            language: languageLabel(fallbackLanguage),
          }),
        ),
      );
      if (language === "auto_detect") {
        const fallbackSelect = createElement("select", {
          className: "input",
          attributes: { "aria-label": i18n.get("fallback_lang_label") },
        });
        appendLanguageOptions(fallbackSelect, enabledLanguages);
        fallbackSelect.value = fallbackLanguage;
        fallbackSelect.addEventListener("change", () => {
          this.registry[KEY_FALLBACK_LANGUAGE].set(fallbackSelect.value);
        });
        detectionCard.appendChild(fallbackSelect);
      }
    }

    return [primaryCard, detectionCard];
  }
}

function helpText(textContent: string): HTMLParagraphElement {
  return createElement("p", { className: "settings-inline-help", textContent });
}
