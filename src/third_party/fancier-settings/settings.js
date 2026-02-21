import { FancierSettingsWithManifest } from "./js/classes/fancier-settings.js";
import { Store } from "./lib/store.js";
import { ElementWrapper } from "./js/classes/utils.js";
import { SUPPORTED_LANGUAGES, resolveEnabledLanguages } from "../../shared/lang.ts";
import { TextExpander } from "../../options/textExpander.js";
import {
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_LANGUAGE,
  KEY_FALLBACK_LANGUAGE,
  KEY_ENABLED_LANGUAGES,
  KEY_NUM_SUGGESTIONS,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_AUTO_CAPITALIZE,
  KEY_APPLY_SPACING_RULES,
  KEY_SELECT_BY_DIGIT,
  KEY_VARIABLE_EXPANSION,
  KEY_TIME_FORMAT,
  KEY_DATE_FORMAT,
  KEY_REVERT_ON_BACKSPACE,
  KEY_TEXT_EXPANSIONS,
  KEY_USER_DICTIONARY_LIST,
  KEY_DOMAIN_LIST_MODE,
  KEY_DISPLAY_LANG_HEADER,
  KEY_INLINE_SUGGESTION,
  // theme settings
  KEY_USE_DEFAULT_THEME_BTN,
  KEY_USE_COMPACT_THEME_BTN,
  KEY_TRIBUTE_BG_LIGHT,
  KEY_TRIBUTE_TEXT_LIGHT,
  KEY_TRIBUTE_HIGHLIGHT_BG_LIGHT,
  KEY_TRIBUTE_HIGHLIGHT_TEXT_LIGHT,
  KEY_TRIBUTE_BORDER_LIGHT,
  KEY_TRIBUTE_BG_DARK,
  KEY_TRIBUTE_TEXT_DARK,
  KEY_TRIBUTE_HIGHLIGHT_BG_DARK,
  KEY_TRIBUTE_HIGHLIGHT_TEXT_DARK,
  KEY_TRIBUTE_BORDER_DARK,
  KEY_TRIBUTE_FONT_SIZE,
  KEY_TRIBUTE_PADDING_VERTICAL,
  KEY_TRIBUTE_PADDING_HORIZONTAL,
} from "../../shared/constants.ts";

function optionsPageConfigChange() {
  const message = {
    command: "CMD_OPTIONS_PAGE_CONFIG_CHANGE",
    context: {},
  };
  chrome.runtime.sendMessage(message);
}

function fallbackLanguageVisibility(settings, value) {
  if (value === "auto_detect")
    settings.manifest.fallbackLanguage.bundle.element.classList.remove(
      "is-hidden"
    );
  else
    settings.manifest.fallbackLanguage.bundle.element.classList.add(
      "is-hidden"
    );
}

function buildLanguageOptions(enabledLanguages, allowAutoDetect) {
  const options = enabledLanguages.map((lang) => [
    lang,
    SUPPORTED_LANGUAGES[lang],
  ]);
  if (allowAutoDetect) {
    options.unshift(["auto_detect", SUPPORTED_LANGUAGES.auto_detect]);
  }
  return options;
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function validateLanguageSettings(settings, store) {
  const enabledLanguagesRaw = await store.get(KEY_ENABLED_LANGUAGES);
  const enabledLanguages = resolveEnabledLanguages(enabledLanguagesRaw);
  const allowAutoDetect = enabledLanguages.length > 1;
  const language = (await store.get(KEY_LANGUAGE)) || enabledLanguages[0];
  const fallbackLanguage =
    (await store.get(KEY_FALLBACK_LANGUAGE)) || enabledLanguages[0];

  const resolvedLanguage =
    language === "auto_detect" && allowAutoDetect
      ? "auto_detect"
      : enabledLanguages.includes(language)
        ? language
        : enabledLanguages[0];
  const resolvedFallbackLanguage = enabledLanguages.includes(fallbackLanguage)
    ? fallbackLanguage
    : enabledLanguages[0];

  const primaryOptions = buildLanguageOptions(
    enabledLanguages,
    allowAutoDetect,
  );
  const fallbackOptions = buildLanguageOptions(enabledLanguages, false);
  settings.manifest.language.setOptions(primaryOptions, resolvedLanguage);
  settings.manifest.fallbackLanguage.setOptions(
    fallbackOptions,
    resolvedFallbackLanguage,
  );

  if (!arraysEqual(enabledLanguagesRaw, enabledLanguages)) {
    settings.manifest[KEY_ENABLED_LANGUAGES].set(enabledLanguages);
  }

  if (resolvedLanguage !== language) {
    settings.manifest.language.set(resolvedLanguage);
  }
  if (resolvedFallbackLanguage !== fallbackLanguage) {
    settings.manifest.fallbackLanguage.set(resolvedFallbackLanguage);
  }
}

function importSettingButtonFileSelected(settings) {
  const importInputElem = settings.manifest.importSettingButton.element.element;
  const fr = new FileReader();
  fr.addEventListener("load", () => {
    try {
      const jsonSettings = JSON.parse(fr.result);
      console.log(jsonSettings);
      chrome.storage.local.set(jsonSettings);
      optionsPageConfigChange();
      location.reload();
    } catch (error) {
      const block = new ElementWrapper("div", { class: "block" });
      const notification = new ElementWrapper("div", {
        class: "notification is-danger",
        text: "Failed to import JSON file:  " + error,
      });

      notification.inject(block);
      block.inject(settings.manifest.importSettingButton.bundle);
    }
  });

  fr.readAsText(importInputElem.files[0]);
  importInputElem.value = null;
}

function importUserDictFileSelected(settings) {
  const importInputElem = settings.manifest.importUserDictButton.element.element;
  const fr = new FileReader();
  fr.addEventListener("load", () => {
    try {
      const fileContent = fr.result;
      const lines = fileContent.split('\n');
      // Regex to match a single word (letters, numbers, underscore) without spaces or other special chars
      const wordRegex = /^\w+$/;
      let count = 0;

      lines.forEach(line => {
        const word = line.trim();
        if (word && wordRegex.test(word)) {
          settings.manifest.userDictionaryList.add(word, false);
          count += 1;
        }
      });
      settings.manifest.userDictionaryList.store();

      const block = new ElementWrapper("div", { class: "block" });
      const notification = new ElementWrapper("div", {
        class: "notification is-success",
        text: "Imported:  " + count + " words",
      });

      notification.inject(block);
      block.inject(settings.manifest.importUserDictButton.bundle);
    } catch (error) {
      const block = new ElementWrapper("div", { class: "block" });
      const notification = new ElementWrapper("div", {
        class: "notification is-danger",
        text: "Failed to import user dictionary file:  " + error,
      });

      notification.inject(block);
      block.inject(settings.manifest.importUserDictButton.bundle);
    }
  });
  fr.readAsText(importInputElem.files[0]);
  importInputElem.value = null;
}

// Theme application is now handled through the messaging system
// This function is no longer needed as themes are applied via background script

const themePresets = {
  default: {
    tributeBgLight: "#ffffff",
    tributeTextLight: "#2d3748",
    tributeHighlightBgLight: "#edf2f7",
    tributeHighlightTextLight: "#2d3748",
    tributeBorderLight: "#e2e8f0",
    tributeBgDark: "#2d3748",
    tributeTextDark: "#e2e8f0",
    tributeHighlightBgDark: "#4a5568",
    tributeHighlightTextDark: "#ffffff",
    tributeBorderDark: "#4a5568",
    tributeFontSize: "0.9rem",
    tributePaddingVertical: "0.6rem",
    tributePaddingHorizontal: "0.8rem"
  },
  compact: {
    tributeBgLight: "rgba(255, 255, 255, 0.85)",
    tributeTextLight: "#1a202c",
    tributeHighlightBgLight: "rgba(226, 232, 240, 0.9)",
    tributeHighlightTextLight: "#1a202c",
    tributeBorderLight: "rgba(226, 232, 240, 0.7)",
    tributeBgDark: "rgba(45, 55, 72, 0.85)",
    tributeTextDark: "#f7fafc",
    tributeHighlightBgDark: "rgba(113, 128, 150, 0.9)",
    tributeHighlightTextDark: "#f7fafc",
    tributeBorderDark: "rgba(74, 85, 104, 0.7)",
    tributeFontSize: "0.85rem",
    tributePaddingVertical: "0.4rem",
    tributePaddingHorizontal: "0.6rem"
  }
};

function applyThemePreset(settings, presetName) {
  const presetToApply = presetName === 'compact' ? themePresets.compact : themePresets.default;

  console.log(`FluentTyper: Applying ${presetName} theme preset`);

  Object.keys(presetToApply).forEach(key => {
    if (settings.manifest[key]) {
      settings.manifest[key].set(presetToApply[key]);
    }
  });

  // Theme will be applied through the messaging system when settings change
}

window.addEventListener("DOMContentLoaded", function () {
  //chrome.storage.local.clear();

  // Option 1: Use the manifest:
  (() =>
    new FancierSettingsWithManifest(async function (settings) {
      new TextExpander(settings, optionsPageConfigChange);
      settings.manifest.removeDomainBtn.addEvent("action", function () {
        settings.manifest.domainBlackList.remove();
      });

      const store = new Store("settings");
      fallbackLanguageVisibility(settings, await store.get(KEY_LANGUAGE));

      settings.manifest.language.addEvent("action", function (value) {
        fallbackLanguageVisibility(settings, value);
        validateLanguageSettings(settings, store);
      });

      settings.manifest[KEY_ENABLED_LANGUAGES].addEvent("action", function () {
        validateLanguageSettings(settings, store);
      });
      validateLanguageSettings(settings, store);

      settings.manifest.addDomainBtn.addEvent("action", function () {
        if (settings.manifest.domain.element.element.checkValidity()) {
          const domainURL = settings.manifest.domain.get();
          const hostName = new URL(domainURL).hostname;
          if (hostName) {
            settings.manifest.domainBlackList.add(hostName);
            settings.manifest.domain.element.element.value = "";
          }
        }
      });

      // User dictionary add action
      settings.manifest.addUserWordBtn.addEvent("action", function () {
        if (settings.manifest.userDictionary.element.element.checkValidity()) {
          const word = settings.manifest.userDictionary.get();
          settings.manifest.userDictionaryList.add(word);
          settings.manifest.userDictionary.element.element.value = "";
        }
      });
      // User dictionary remove action
      settings.manifest.removeUserWordBtn.addEvent("action", function () {
        settings.manifest.userDictionaryList.remove();
      });
      settings.manifest.removeAllUserWordsBtn.addEvent("action", function () {
        settings.manifest.userDictionaryList.removeAll();
      });

      settings.manifest.exportSettingButton.addEvent("action", function () {
        chrome.storage.local.get(null, function (items) {
          // null implies all items
          // Convert object to a JSON.
          const result = JSON.stringify(items);
          const blob = new Blob([result], { type: "application/json" });
          const dlink = document.createElement("a");
          dlink.download = name;
          dlink.href = window.URL.createObjectURL(blob);
          (dlink.download = "FluentTyperSettings.json"),
            (dlink.onclick = function () {
              // revokeObjectURL needs a delay to work properly
              const that = this;
              setTimeout(function () {
                window.URL.revokeObjectURL(that.href);
              }, 1500);
            });

          dlink.click();
          dlink.remove();
        });
      });

      const importInputElem =
        settings.manifest.importSettingButton.element.element;
      importInputElem.type = "file";
      importInputElem.accept = ".json";
      importInputElem.addEventListener(
        "input",
        importSettingButtonFileSelected.bind(null, settings)
      );

      const importUserDictElem =
        settings.manifest.importUserDictButton.element.element;
      importUserDictElem.type = "file";
      importUserDictElem.accept = ".txt";
      importUserDictElem.addEventListener(
        "input",
        importUserDictFileSelected.bind(null, settings)
      );

      // Theme preset buttons
      settings.manifest[KEY_USE_DEFAULT_THEME_BTN].addEvent("action", function () {
        applyThemePreset(settings, 'default');
      });
      settings.manifest[KEY_USE_COMPACT_THEME_BTN].addEvent("action", function () {
        applyThemePreset(settings, 'compact');
      });

      settings.manifest[KEY_INLINE_SUGGESTION].addEvent("action", function () {
        if (settings.manifest[KEY_INLINE_SUGGESTION].get()) {
          settings.manifest[KEY_AUTOCOMPLETE_ON_TAB].set(true);
          settings.manifest[KEY_NUM_SUGGESTIONS].set(10);
        }
      });

      // Theme settings event listeners
      const themeSettings = [
        KEY_TRIBUTE_BG_LIGHT, KEY_TRIBUTE_TEXT_LIGHT, KEY_TRIBUTE_HIGHLIGHT_BG_LIGHT,
        KEY_TRIBUTE_HIGHLIGHT_TEXT_LIGHT, KEY_TRIBUTE_BORDER_LIGHT,
        KEY_TRIBUTE_BG_DARK, KEY_TRIBUTE_TEXT_DARK, KEY_TRIBUTE_HIGHLIGHT_BG_DARK,
        KEY_TRIBUTE_HIGHLIGHT_TEXT_DARK, KEY_TRIBUTE_BORDER_DARK,
        KEY_TRIBUTE_FONT_SIZE, KEY_TRIBUTE_PADDING_VERTICAL, KEY_TRIBUTE_PADDING_HORIZONTAL
      ];

      // Theme settings are now handled through the messaging system
      // No direct theme application needed here

      // Update pressage config on change
      [
        KEY_AUTOCOMPLETE,
        KEY_AUTOCOMPLETE_ON_ENTER,
        KEY_AUTOCOMPLETE_ON_TAB,
        KEY_LANGUAGE,
        KEY_ENABLED_LANGUAGES,
        KEY_DOMAIN_LIST_MODE,
        KEY_FALLBACK_LANGUAGE,
        KEY_NUM_SUGGESTIONS,
        KEY_MIN_WORD_LENGTH_TO_PREDICT,
        KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
        KEY_AUTO_CAPITALIZE,
        KEY_APPLY_SPACING_RULES,
        KEY_SELECT_BY_DIGIT,
        KEY_VARIABLE_EXPANSION,
        KEY_TIME_FORMAT,
        KEY_DATE_FORMAT,
        KEY_REVERT_ON_BACKSPACE,
        KEY_TEXT_EXPANSIONS,
        KEY_USER_DICTIONARY_LIST,
        KEY_DISPLAY_LANG_HEADER,
        KEY_INLINE_SUGGESTION,
        // Theme settings
        KEY_TRIBUTE_BG_LIGHT,
        KEY_TRIBUTE_TEXT_LIGHT,
        KEY_TRIBUTE_HIGHLIGHT_BG_LIGHT,
        KEY_TRIBUTE_HIGHLIGHT_TEXT_LIGHT,
        KEY_TRIBUTE_BORDER_LIGHT,
        KEY_TRIBUTE_BG_DARK,
        KEY_TRIBUTE_TEXT_DARK,
        KEY_TRIBUTE_HIGHLIGHT_BG_DARK,
        KEY_TRIBUTE_HIGHLIGHT_TEXT_DARK,
        KEY_TRIBUTE_BORDER_DARK,
        KEY_TRIBUTE_FONT_SIZE,
        KEY_TRIBUTE_PADDING_VERTICAL,
        KEY_TRIBUTE_PADDING_HORIZONTAL
      ].forEach((element) => {
        settings.manifest[element].addEvent("action", function () {
          optionsPageConfigChange();
        });
      });
    }))();
});
