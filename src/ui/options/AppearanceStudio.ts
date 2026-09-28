import {
  calculateThemeContrast,
  clampAlpha,
  clampColorChannel,
  normalizeCssColor,
  parseThemeColor,
  resolveOpaqueColor,
  toHex,
  toOpaqueHex,
  type RGBAColor,
} from "@core/domain/color";

export { calculateThemeContrast, parseThemeColor };
import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import {
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_SHOW_SUGGESTION_FOOTER,
  KEY_HORIZONTAL_SUGGESTIONS,
  KEY_LANGUAGE,
  KEY_SELECT_BY_DIGIT,
  KEY_SUGGESTION_BG_DARK,
  KEY_SUGGESTION_BG_LIGHT,
  KEY_SUGGESTION_BORDER_DARK,
  KEY_SUGGESTION_BORDER_LIGHT,
  KEY_SUGGESTION_FONT_SIZE,
  KEY_SUGGESTION_HIGHLIGHT_BG_DARK,
  KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT,
  KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK,
  KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT,
  KEY_SUGGESTION_PADDING_HORIZONTAL,
  KEY_SUGGESTION_PADDING_VERTICAL,
  KEY_SUGGESTION_TEXT_DARK,
  KEY_SUGGESTION_TEXT_LIGHT,
} from "@core/domain/constants";
import {
  DEFAULT_SUGGESTION_THEME_SETTINGS,
  type SuggestionThemeSettings,
} from "@core/domain/themeDefaults";
import { SUPPORTED_LANGUAGES } from "@core/domain/lang";
import { acceptKeyLabels, buildSuggestionKeyHints } from "@core/domain/suggestionPopup/keyHints";
import {
  buildSuggestionPanelHtml,
  suggestionLanguageLabel,
} from "@core/domain/suggestionPopup/markup";
import {
  computeSuggestionPopupStyleVars,
  themeScaleFromValues,
} from "@core/domain/suggestionPopup/metrics";
import { resolveSuggestionAccents } from "@core/domain/suggestionPopup/palette";
import { SUGGESTION_POPUP_SHADOW_CSS } from "@core/domain/suggestionPopup/styles";
import { i18n } from "./fluenttyperI18n.js";
import {
  bindRerender,
  createStackField,
  createWorkspaceShell,
  formatLooseText,
} from "./workspacePanelUtils.js";

type ThemePreset = Record<string, string>;

type ThemeKey = keyof SuggestionThemeSettings;
const THEME_KEYS = Object.keys(DEFAULT_SUGGESTION_THEME_SETTINGS) as ThemeKey[];
const LIGHT_THEME_CANVAS = "#ffffff";
const DARK_THEME_CANVAS = "#020617";
/** Settings besides the theme that change what the popup shows. */
const PREVIEW_OPTION_KEYS = [
  KEY_SELECT_BY_DIGIT,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE,
  KEY_HORIZONTAL_SUGGESTIONS,
  KEY_SHOW_SUGGESTION_FOOTER,
  KEY_LANGUAGE,
];
function previewCanvasContext(): CanvasRenderingContext2D | null {
  try {
    return document.createElement("canvas").getContext("2d");
  } catch {
    return null;
  }
}

/**
 * Any CSS length (vw, %, calc(), ...) in px, measured the way the popup on web
 * pages measures theme sizes: on a hidden probe in a 16px, unsized container.
 */
function measurePreviewLengthPx(value: string, property: string): number | null {
  const root = document.body ?? document.documentElement;
  if (!root) {
    return null;
  }
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.visibility = "hidden";
  container.style.pointerEvents = "none";
  container.style.fontSize = `${PREVIEW_TEXT_FONT_SIZE_PX}px`;
  const probe = document.createElement("div");
  probe.style.setProperty(property, value);
  container.appendChild(probe);
  root.appendChild(container);
  try {
    const px = Number.parseFloat(window.getComputedStyle(probe).getPropertyValue(property));
    return Number.isFinite(px) ? px : null;
  } finally {
    container.remove();
  }
}

/** Page text the preview sizes the popup for: 16px on a 1.4 line. */
const PREVIEW_TEXT_FONT_SIZE_PX = 16;
const PREVIEW_TEXT_LINE_HEIGHT_PX = 22.4;

function normalizeAlphaString(alpha: number): string {
  const normalized = clampAlpha(alpha);
  return Number.isInteger(normalized)
    ? String(normalized)
    : normalized.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function toAlphaHex(color: RGBAColor): string {
  return toHex([color.r, color.g, color.b, Math.round(clampAlpha(color.a) * 255)]);
}

function toRgbString(color: RGBAColor): string {
  return `rgb(${clampColorChannel(color.r)}, ${clampColorChannel(color.g)}, ${clampColorChannel(color.b)})`;
}

function toRgbaString(color: RGBAColor): string {
  return `rgba(${clampColorChannel(color.r)}, ${clampColorChannel(color.g)}, ${clampColorChannel(color.b)}, ${normalizeAlphaString(color.a)})`;
}

export function getColorPickerValue(rawValue: string): string {
  const parsed = parseThemeColor(rawValue);
  return parsed ? toOpaqueHex(parsed) : "#000000";
}

export function mergeColorPickerValue(pickerHex: string, previousRawValue: string): string {
  const pickerColor = parseThemeColor(pickerHex);
  if (!pickerColor) {
    return previousRawValue;
  }

  const previous = parseThemeColor(previousRawValue);
  if (!previous) {
    return toOpaqueHex(pickerColor);
  }

  const nextColor: RGBAColor = { ...pickerColor, a: previous.a };
  const previousValue = previousRawValue.trim().toLowerCase();
  if (previousValue.startsWith("rgba(")) {
    return toRgbaString(nextColor);
  }
  if (previousValue.startsWith("rgb(")) {
    return toRgbString(nextColor);
  }
  if (previousValue.startsWith("#") && (previousValue.length === 5 || previousValue.length === 9)) {
    return toAlphaHex(nextColor);
  }
  if (previous.a < 1) {
    return toRgbaString(nextColor);
  }
  return toOpaqueHex(nextColor);
}

export class AppearanceStudio {
  private readonly root: HTMLElement;
  private readonly registry: SettingsRegistry;
  private readonly presets: Record<string, ThemePreset>;
  private previewMode: "light" | "dark" = "light";
  private livePreview?: HTMLElement;
  private liveContrastSection?: HTMLElement;

  constructor(root: HTMLElement, registry: SettingsRegistry, presets: Record<string, ThemePreset>) {
    this.root = root;
    this.registry = registry;
    this.presets = presets;
    THEME_KEYS.forEach((key) => {
      bindRerender(this.registry[key], () => this.render());
    });
    PREVIEW_OPTION_KEYS.forEach((key) => {
      bindRerender(this.registry[key], () => this.render());
    });
    this.render();
  }

  render(): void {
    const theme = this.readThemeValues();
    const shell = createWorkspaceShell();
    const topGrid = createWorkspaceShell("workspace-main-grid");
    topGrid.append(this.createPresetCards(), this.createPreviewCard(theme));

    const lowerGrid = createWorkspaceShell("workspace-main-grid");
    lowerGrid.append(this.createTypographyCard(theme), this.createContrastWarnings(theme));

    shell.append(topGrid, lowerGrid, this.createAdvancedColors(theme));
    this.root.replaceChildren(shell);
  }

  private createPresetCards(): HTMLElement {
    const shell = document.createElement("section");
    shell.className = "settings-inline-card";
    const title = document.createElement("h4");
    title.textContent = i18n.get("appearance_presets_title");
    shell.appendChild(title);
    shell.appendChild(this.createHelperText(i18n.get("appearance_presets_copy")));

    const grid = document.createElement("div");
    grid.className = "preset-grid";
    Object.entries(this.presets).forEach(([presetName, preset]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "preset-card";
      const label = document.createElement("strong");
      label.textContent =
        presetName === "compact"
          ? i18n.get("use_compact_theme_btn")
          : i18n.get("use_default_theme_btn");
      button.appendChild(label);
      const desc = document.createElement("span");
      desc.textContent =
        presetName === "compact"
          ? i18n.get("use_compact_theme_desc")
          : i18n.get("use_default_theme_desc");
      button.appendChild(desc);
      button.addEventListener("click", () => {
        Object.entries(preset).forEach(([key, value]) => {
          this.registry[key]?.set(value);
        });
      });
      grid.appendChild(button);
    });
    shell.appendChild(grid);
    return shell;
  }

  private createPreviewCard(theme: Record<ThemeKey, string>): HTMLElement {
    const shell = document.createElement("section");
    shell.className = "settings-inline-card";
    const title = document.createElement("h4");
    title.textContent = i18n.get("appearance_preview_title");
    shell.appendChild(title);
    shell.appendChild(this.createHelperText(i18n.get("appearance_preview_copy")));

    const toggle = document.createElement("div");
    toggle.className = "segmented-control";
    ["light", "dark"].forEach((mode) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "segmented-control-button";
      if (mode === this.previewMode) {
        button.classList.add("is-active");
      }
      button.textContent =
        mode === "light"
          ? i18n.get("appearance_light_preview")
          : i18n.get("appearance_dark_preview");
      button.addEventListener("click", () => {
        this.previewMode = mode as "light" | "dark";
        this.render();
      });
      toggle.appendChild(button);
    });
    shell.appendChild(toggle);

    // The real popup's stylesheet, markup and sizing, in a shadow root like on
    // web pages, so the preview cannot drift from what users see.
    const preview = document.createElement("div");
    preview.className = "appearance-preview";
    const shadowRoot = preview.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<style>${SUGGESTION_POPUP_SHADOW_CSS}</style>${this.buildPreviewPanelHtml()}`;
    this.livePreview = preview;
    this.updatePreviewCard(theme);

    shell.appendChild(preview);
    return shell;
  }

  private createTypographyCard(theme: Record<ThemeKey, string>): HTMLElement {
    const shell = document.createElement("section");
    shell.className = "settings-inline-card";
    const title = document.createElement("h4");
    title.textContent = i18n.get("appearance_density_title");
    shell.appendChild(title);
    shell.appendChild(this.createHelperText(i18n.get("appearance_density_copy")));

    const fields: Array<[string, ThemeKey, Array<[string, string]>]> = [
      [
        "appearance_font_size_title",
        KEY_SUGGESTION_FONT_SIZE,
        [
          ["0.75rem", i18n.get("appearance_font_size_xs")],
          ["0.8rem", i18n.get("appearance_font_size_sm")],
          ["0.85rem", i18n.get("appearance_font_size_md")],
          ["0.9rem", i18n.get("appearance_font_size_lg")],
          ["1rem", i18n.get("appearance_font_size_xl")],
        ],
      ],
      [
        "appearance_row_height_title",
        KEY_SUGGESTION_PADDING_VERTICAL,
        [
          ["0.3rem", i18n.get("appearance_density_ultra_compact")],
          ["0.4rem", i18n.get("appearance_density_compact")],
          ["0.5rem", i18n.get("appearance_density_comfortable")],
          ["0.6rem", i18n.get("appearance_density_balanced")],
          ["0.8rem", i18n.get("appearance_density_roomy")],
        ],
      ],
      [
        "appearance_side_padding_title",
        KEY_SUGGESTION_PADDING_HORIZONTAL,
        [
          ["0.5rem", i18n.get("appearance_density_ultra_tight")],
          ["0.6rem", i18n.get("appearance_density_tight")],
          ["0.8rem", i18n.get("appearance_density_balanced")],
          ["1rem", i18n.get("appearance_density_wide")],
          ["1.2rem", i18n.get("appearance_density_extra_wide")],
        ],
      ],
    ];
    fields.forEach(([titleKey, key, options]) => {
      shell.appendChild(
        this.createSelectField(
          i18n.get(titleKey),
          theme[key],
          options,
          (value) => this.registry[key].set(value),
          (value) => this.syncLiveTheme({ ...theme, [key]: value }),
        ),
      );
    });
    return shell;
  }

  private createAdvancedColors(theme: Record<ThemeKey, string>): HTMLElement {
    const shell = document.createElement("details");
    shell.className = "settings-disclosure";
    const summary = document.createElement("summary");
    summary.textContent = i18n.get("appearance_advanced_colors");
    shell.appendChild(summary);
    const draftTheme = { ...theme };
    shell.appendChild(this.createHelperText(i18n.get("appearance_advanced_colors_copy")));

    shell.appendChild(
      this.createColorFieldGroup(
        i18n.get("appearance_light_surface_title"),
        i18n.get("appearance_light_surface_copy"),
        [
          [KEY_SUGGESTION_BG_LIGHT, i18n.get("appearance_background_title")],
          [KEY_SUGGESTION_TEXT_LIGHT, i18n.get("appearance_text_title")],
          [KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT, i18n.get("appearance_selected_row_bg_title")],
          [KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT, i18n.get("appearance_selected_row_text_title")],
          [KEY_SUGGESTION_BORDER_LIGHT, i18n.get("appearance_border_title")],
        ],
        theme,
        draftTheme,
      ),
    );
    shell.appendChild(
      this.createColorFieldGroup(
        i18n.get("appearance_dark_surface_title"),
        i18n.get("appearance_dark_surface_copy"),
        [
          [KEY_SUGGESTION_BG_DARK, i18n.get("appearance_background_title")],
          [KEY_SUGGESTION_TEXT_DARK, i18n.get("appearance_text_title")],
          [KEY_SUGGESTION_HIGHLIGHT_BG_DARK, i18n.get("appearance_selected_row_bg_title")],
          [KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK, i18n.get("appearance_selected_row_text_title")],
          [KEY_SUGGESTION_BORDER_DARK, i18n.get("appearance_border_title")],
        ],
        theme,
        draftTheme,
      ),
    );

    return shell;
  }

  private createContrastWarnings(theme: Record<ThemeKey, string>): HTMLElement {
    const shell = document.createElement("section");
    shell.className = "settings-inline-card";
    const title = document.createElement("h4");
    title.textContent = i18n.get("appearance_contrast_checks");
    shell.appendChild(title);
    shell.appendChild(this.createHelperText(i18n.get("appearance_contrast_copy")));
    this.liveContrastSection = shell;
    this.updateContrastWarnings(theme);
    return shell;
  }

  private createSelectField(
    labelText: string,
    value: string,
    options: Array<[string, string]>,
    onChange: (value: string) => void,
    onInput?: (value: string) => void,
  ): HTMLElement {
    const select = document.createElement("select");
    select.className = "input";
    options.forEach(([optionValue, optionLabel]) => {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionLabel;
      select.appendChild(option);
    });
    select.value = value;
    select.addEventListener("input", () => onInput?.(select.value));
    select.addEventListener("change", () => onChange(select.value));
    return createStackField(labelText, select);
  }

  private createHelperText(copy: string): HTMLElement {
    const text = document.createElement("p");
    text.className = "settings-inline-help";
    text.textContent = copy;
    return text;
  }

  private createColorFieldGroup(
    titleText: string,
    copy: string,
    fields: Array<[ThemeKey, string]>,
    theme: Record<ThemeKey, string>,
    draftTheme: Record<ThemeKey, string>,
  ): HTMLElement {
    const group = document.createElement("section");
    group.className = "settings-inline-card";

    const title = document.createElement("h4");
    title.textContent = titleText;
    group.appendChild(title);
    group.appendChild(this.createHelperText(copy));

    fields.forEach(([key, label]) => {
      const inputs = document.createElement("div");
      inputs.className = "is-flex is-align-items-center";
      inputs.style.gap = "0.75rem";

      const rawInput = document.createElement("input");
      rawInput.type = "text";
      rawInput.className = "input";
      rawInput.value = theme[key];
      rawInput.addEventListener("input", () => {
        draftTheme[key] = rawInput.value.trim();
        pickerInput.value = getColorPickerValue(draftTheme[key]);
        pickerInput.disabled = !parseThemeColor(draftTheme[key]);
        this.syncLiveTheme(draftTheme);
      });
      rawInput.addEventListener("change", () => {
        this.registry[key].set(rawInput.value.trim());
      });

      const pickerInput = document.createElement("input");
      pickerInput.type = "color";
      pickerInput.className = "input";
      pickerInput.value = getColorPickerValue(theme[key]);
      pickerInput.disabled = !parseThemeColor(theme[key]);
      pickerInput.addEventListener("input", () => {
        const mergedValue = mergeColorPickerValue(pickerInput.value, rawInput.value);
        rawInput.value = mergedValue;
        draftTheme[key] = mergedValue;
        this.syncLiveTheme(draftTheme);
      });
      pickerInput.addEventListener("change", () => {
        this.registry[key].set(mergeColorPickerValue(pickerInput.value, rawInput.value));
      });

      inputs.append(rawInput, pickerInput);
      group.appendChild(createStackField(label, inputs));
    });

    return group;
  }

  private readThemeValues(): Record<ThemeKey, string> {
    return Object.fromEntries(
      THEME_KEYS.map((key) => [key, formatLooseText(this.registry[key].get())]),
    ) as Record<ThemeKey, string>;
  }

  private syncLiveTheme(theme: Record<ThemeKey, string>): void {
    this.updatePreviewCard(theme);
    this.updateContrastWarnings(theme);
  }

  /** The popup as the current options would show it for a few sample words. */
  private buildPreviewPanelHtml(): string {
    const setting = (key: string) => this.registry[key]?.get();
    const suggestions = [
      i18n.get("appearance_sample_one"),
      i18n.get("appearance_sample_two"),
      i18n.get("appearance_sample_three"),
    ];
    const showShortcutDigits = setting(KEY_SELECT_BY_DIGIT) === true;
    const languageName = SUPPORTED_LANGUAGES[String(setting(KEY_LANGUAGE))];
    // The footer (key hints and language) is off unless turned on.
    const showFooter = setting(KEY_SHOW_SUGGESTION_FOOTER) === true;
    return buildSuggestionPanelHtml({
      suggestions,
      selectedIndex: 0,
      showShortcutDigits,
      // As if the first letters of the samples were typed, to show the highlight.
      mentionText: suggestions[0].slice(0, 3),
      hints: !showFooter
        ? []
        : buildSuggestionKeyHints({
            // The same defaults the settings fall back to.
            acceptKeys: acceptKeyLabels({
              autocompleteOnTab: setting(KEY_AUTOCOMPLETE_ON_TAB) !== false,
              autocompleteOnEnter: setting(KEY_AUTOCOMPLETE_ON_ENTER) !== false,
              autocomplete: setting(KEY_AUTOCOMPLETE) === true,
            }),
            digitCount: showShortcutDigits ? suggestions.length : 0,
            // The options page's own language, which follows "Extension UI Language".
            language: i18n.lang,
          }),
      language: showFooter && languageName ? suggestionLanguageLabel(languageName) : null,
    });
  }

  private updatePreviewCard(theme: Record<ThemeKey, string>): void {
    if (!this.livePreview) {
      return;
    }
    const preview = this.livePreview;
    preview.setAttribute("data-mode", this.previewMode);
    preview.setAttribute("data-ft-color-scheme", this.previewMode);
    if (this.registry[KEY_HORIZONTAL_SUGGESTIONS]?.get() === true) {
      preview.setAttribute("data-ft-layout", "horizontal");
    } else {
      preview.removeAttribute("data-ft-layout");
    }
    const sizeVars = computeSuggestionPopupStyleVars({
      fontSizePx: PREVIEW_TEXT_FONT_SIZE_PX,
      lineHeightPx: PREVIEW_TEXT_LINE_HEIGHT_PX,
      themeScale: themeScaleFromValues(
        {
          fontSize: theme[KEY_SUGGESTION_FONT_SIZE],
          paddingVertical: theme[KEY_SUGGESTION_PADDING_VERTICAL],
          paddingHorizontal: theme[KEY_SUGGESTION_PADDING_HORIZONTAL],
        },
        measurePreviewLengthPx,
      ),
      viewportWidthPx: window.innerWidth,
    });
    for (const [name, value] of Object.entries(sizeVars)) {
      preview.style.setProperty(name, value);
    }
    const isLight = this.previewMode === "light";
    const bg = isLight ? theme[KEY_SUGGESTION_BG_LIGHT] : theme[KEY_SUGGESTION_BG_DARK];
    const text = isLight ? theme[KEY_SUGGESTION_TEXT_LIGHT] : theme[KEY_SUGGESTION_TEXT_DARK];
    const highlightBg = isLight
      ? theme[KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT]
      : theme[KEY_SUGGESTION_HIGHLIGHT_BG_DARK];
    const highlightText = isLight
      ? theme[KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT]
      : theme[KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK];
    const border = isLight ? theme[KEY_SUGGESTION_BORDER_LIGHT] : theme[KEY_SUGGESTION_BORDER_DARK];

    const context = previewCanvasContext();
    const accents = resolveSuggestionAccents(theme, (color) => normalizeCssColor(color, context))[
      this.previewMode
    ];
    // The preview mirrors the selected mode into both light and dark variables.
    for (const suffix of ["light", "dark"]) {
      preview.style.setProperty(`--suggestion-accent-${suffix}`, accents.accent);
      preview.style.setProperty(`--suggestion-highlight-accent-${suffix}`, accents.highlightAccent);
      preview.style.setProperty(`--suggestion-bg-${suffix}`, bg);
      preview.style.setProperty(`--suggestion-text-${suffix}`, text);
      preview.style.setProperty(`--suggestion-highlight-bg-${suffix}`, highlightBg);
      preview.style.setProperty(`--suggestion-highlight-text-${suffix}`, highlightText);
      preview.style.setProperty(`--suggestion-border-color-${suffix}`, border);
    }
    preview.style.color = text;
  }

  private updateContrastWarnings(theme: Record<ThemeKey, string>): void {
    if (!this.liveContrastSection) {
      return;
    }
    this.liveContrastSection
      .querySelectorAll(".appearance-contrast-warning")
      .forEach((item) => item.remove());

    const warnings = [
      {
        label: i18n.get("appearance_contrast_light_text_label"),
        ratio: calculateThemeContrast(
          theme[KEY_SUGGESTION_BG_LIGHT],
          theme[KEY_SUGGESTION_TEXT_LIGHT],
          LIGHT_THEME_CANVAS,
        ),
      },
      {
        label: i18n.get("appearance_contrast_light_selected_label"),
        ratio: calculateThemeContrast(
          theme[KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT],
          theme[KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT],
          toOpaqueHex(resolveOpaqueColor(theme[KEY_SUGGESTION_BG_LIGHT], LIGHT_THEME_CANVAS)),
        ),
      },
      {
        label: i18n.get("appearance_contrast_dark_text_label"),
        ratio: calculateThemeContrast(
          theme[KEY_SUGGESTION_BG_DARK],
          theme[KEY_SUGGESTION_TEXT_DARK],
          DARK_THEME_CANVAS,
        ),
      },
      {
        label: i18n.get("appearance_contrast_dark_selected_label"),
        ratio: calculateThemeContrast(
          theme[KEY_SUGGESTION_HIGHLIGHT_BG_DARK],
          theme[KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK],
          toOpaqueHex(resolveOpaqueColor(theme[KEY_SUGGESTION_BG_DARK], DARK_THEME_CANVAS)),
        ),
      },
    ];

    warnings.forEach((warning) => {
      const item = document.createElement("p");
      item.className = "settings-inline-help appearance-contrast-warning";
      item.textContent = `${warning.label}: ${this.describeContrast(warning.ratio)}`;
      this.liveContrastSection?.appendChild(item);
    });
  }

  private describeContrast(ratio: number): string {
    if (ratio >= 7) {
      return i18n.get("appearance_contrast_excellent");
    }
    if (ratio >= 4.5) {
      return i18n.get("appearance_contrast_good");
    }
    if (ratio >= 3) {
      return i18n.get("appearance_contrast_okay");
    }
    return i18n.get("appearance_contrast_warn");
  }
}
