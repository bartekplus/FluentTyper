import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import {
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
import { i18n } from "./fluenttyperI18n.js";

type ThemePreset = Record<string, string>;
type RGBAColor = { r: number; g: number; b: number; a: number };

const THEME_KEYS = [
  KEY_SUGGESTION_BG_LIGHT,
  KEY_SUGGESTION_TEXT_LIGHT,
  KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT,
  KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT,
  KEY_SUGGESTION_BORDER_LIGHT,
  KEY_SUGGESTION_BG_DARK,
  KEY_SUGGESTION_TEXT_DARK,
  KEY_SUGGESTION_HIGHLIGHT_BG_DARK,
  KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK,
  KEY_SUGGESTION_BORDER_DARK,
  KEY_SUGGESTION_FONT_SIZE,
  KEY_SUGGESTION_PADDING_VERTICAL,
  KEY_SUGGESTION_PADDING_HORIZONTAL,
] as const;

type ThemeKey = (typeof THEME_KEYS)[number];
const LIGHT_THEME_CANVAS = "#ffffff";
const DARK_THEME_CANVAS = "#020617";

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampAlpha(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeAlphaString(alpha: number): string {
  const normalized = clampAlpha(alpha);
  return Number.isInteger(normalized)
    ? String(normalized)
    : normalized.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function parseRgbPart(value: string): number | null {
  const numericValue = Number.parseFloat(value);
  return Number.isFinite(numericValue) ? clampChannel(numericValue) : null;
}

function parseAlphaPart(value: string): number | null {
  const numericValue = Number.parseFloat(value);
  return Number.isFinite(numericValue) ? clampAlpha(numericValue) : null;
}

function readThemeValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

export function parseThemeColor(rawValue: string): RGBAColor | null {
  const value = rawValue.trim();
  if (!value) {
    return null;
  }

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const channels = [...hex].map((part) => Number.parseInt(part + part, 16));
      if (channels.some((part) => Number.isNaN(part))) {
        return null;
      }
      return {
        r: channels[0],
        g: channels[1],
        b: channels[2],
        a: hex.length === 4 ? channels[3] / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      const pairs = hex.match(/.{1,2}/g);
      if (!pairs) {
        return null;
      }
      const channels = pairs.map((part) => Number.parseInt(part, 16));
      if (channels.some((part) => Number.isNaN(part))) {
        return null;
      }
      return {
        r: channels[0],
        g: channels[1],
        b: channels[2],
        a: hex.length === 8 ? channels[3] / 255 : 1,
      };
    }
    return null;
  }

  const rgbMatch = value.match(
    /^rgba?\(\s*([^\s,]+)\s*,\s*([^\s,]+)\s*,\s*([^\s,]+)(?:\s*,\s*([^)]+))?\s*\)$/i,
  );
  if (!rgbMatch) {
    return null;
  }

  const r = parseRgbPart(rgbMatch[1]);
  const g = parseRgbPart(rgbMatch[2]);
  const b = parseRgbPart(rgbMatch[3]);
  const a = rgbMatch[4] === undefined ? 1 : parseAlphaPart(rgbMatch[4]);
  if (r === null || g === null || b === null || a === null) {
    return null;
  }
  return { r, g, b, a };
}

export function toOpaqueHex(color: RGBAColor): string {
  return `#${[color.r, color.g, color.b]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function toAlphaHex(color: RGBAColor): string {
  return `#${[color.r, color.g, color.b, Math.round(clampAlpha(color.a) * 255)]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function toRgbString(color: RGBAColor): string {
  return `rgb(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)})`;
}

function toRgbaString(color: RGBAColor): string {
  return `rgba(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)}, ${normalizeAlphaString(color.a)})`;
}

export function getColorPickerValue(rawValue: string): string {
  const parsed = parseThemeColor(rawValue);
  return parsed ? toOpaqueHex(parsed) : "#000000";
}

export function isThemeColorEditableWithPicker(rawValue: string): boolean {
  return parseThemeColor(rawValue) !== null;
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
  if (previousValue.startsWith("#") && previousValue.length === 5) {
    return toAlphaHex(nextColor);
  }
  if (previousValue.startsWith("#") && previousValue.length === 9) {
    return toAlphaHex(nextColor);
  }
  if (previous.a < 1) {
    return toRgbaString(nextColor);
  }
  return toOpaqueHex(nextColor);
}

function compositeForegroundOverBackground(
  foreground: RGBAColor,
  background: RGBAColor,
): RGBAColor {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  };
}

function resolveOpaqueColor(rawValue: string, backdropRawValue: string): RGBAColor {
  const backdrop = parseThemeColor(backdropRawValue) ?? { r: 0, g: 0, b: 0, a: 1 };
  const parsed = parseThemeColor(rawValue);
  if (!parsed) {
    return backdrop;
  }
  return parsed.a >= 1 ? parsed : compositeForegroundOverBackground(parsed, backdrop);
}

export function calculateThemeContrast(
  backgroundRawValue: string,
  foregroundRawValue: string,
  backdropRawValue: string,
): number {
  const background = resolveOpaqueColor(backgroundRawValue, backdropRawValue);
  const foreground = resolveOpaqueColor(foregroundRawValue, toOpaqueHex(background));
  const backgroundLuminance = relativeLuminance(background);
  const foregroundLuminance = relativeLuminance(foreground);
  const lighter = Math.max(backgroundLuminance, foregroundLuminance);
  const darker = Math.min(backgroundLuminance, foregroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: RGBAColor): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = clampChannel(channel) / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
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
      this.registry[key]?.addEvent("action", () => this.render());
      this.registry[key]?.addEvent("change", () => this.render());
    });
    this.render();
  }

  render(): void {
    const theme = this.readThemeValues();
    const shell = document.createElement("div");
    shell.className = "workspace-panel-stack";
    const topGrid = document.createElement("div");
    topGrid.className = "workspace-main-grid";
    topGrid.append(this.createPresetCards(), this.createPreviewCard(theme));

    const lowerGrid = document.createElement("div");
    lowerGrid.className = "workspace-main-grid";
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

    const preview = document.createElement("div");
    preview.className = "appearance-preview";
    [
      i18n.get("appearance_sample_one"),
      i18n.get("appearance_sample_two"),
      i18n.get("appearance_sample_three"),
    ].forEach((entry) => {
      const item = document.createElement("div");
      item.className = "appearance-preview-item";
      item.textContent = entry;
      preview.appendChild(item);
    });
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

    shell.appendChild(
      this.createSelectField(
        i18n.get("appearance_font_size_title"),
        theme[KEY_SUGGESTION_FONT_SIZE],
        [
          ["0.75rem", i18n.get("appearance_font_size_xs")],
          ["0.8rem", i18n.get("appearance_font_size_sm")],
          ["0.85rem", i18n.get("appearance_font_size_md")],
          ["0.9rem", i18n.get("appearance_font_size_lg")],
          ["1rem", i18n.get("appearance_font_size_xl")],
        ],
        (value) => this.registry[KEY_SUGGESTION_FONT_SIZE].set(value),
        (value) => this.syncLiveTheme({ ...theme, [KEY_SUGGESTION_FONT_SIZE]: value }),
      ),
    );
    shell.appendChild(
      this.createSelectField(
        i18n.get("appearance_row_height_title"),
        theme[KEY_SUGGESTION_PADDING_VERTICAL],
        [
          ["0.3rem", i18n.get("appearance_density_ultra_compact")],
          ["0.4rem", i18n.get("appearance_density_compact")],
          ["0.5rem", i18n.get("appearance_density_comfortable")],
          ["0.6rem", i18n.get("appearance_density_balanced")],
          ["0.8rem", i18n.get("appearance_density_roomy")],
        ],
        (value) => this.registry[KEY_SUGGESTION_PADDING_VERTICAL].set(value),
        (value) => this.syncLiveTheme({ ...theme, [KEY_SUGGESTION_PADDING_VERTICAL]: value }),
      ),
    );
    shell.appendChild(
      this.createSelectField(
        i18n.get("appearance_side_padding_title"),
        theme[KEY_SUGGESTION_PADDING_HORIZONTAL],
        [
          ["0.5rem", i18n.get("appearance_density_ultra_tight")],
          ["0.6rem", i18n.get("appearance_density_tight")],
          ["0.8rem", i18n.get("appearance_density_balanced")],
          ["1rem", i18n.get("appearance_density_wide")],
          ["1.2rem", i18n.get("appearance_density_extra_wide")],
        ],
        (value) => this.registry[KEY_SUGGESTION_PADDING_HORIZONTAL].set(value),
        (value) => this.syncLiveTheme({ ...theme, [KEY_SUGGESTION_PADDING_HORIZONTAL]: value }),
      ),
    );
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
    const field = document.createElement("label");
    field.className = "settings-stack-field";
    const title = document.createElement("span");
    title.textContent = labelText;
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
    field.append(title, select);
    return field;
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
      const field = document.createElement("label");
      field.className = "settings-stack-field";
      const fieldTitle = document.createElement("span");
      fieldTitle.textContent = label;
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
        pickerInput.disabled = !isThemeColorEditableWithPicker(draftTheme[key]);
        this.syncLiveTheme(draftTheme);
      });
      rawInput.addEventListener("change", () => {
        this.registry[key].set(rawInput.value.trim());
      });

      const pickerInput = document.createElement("input");
      pickerInput.type = "color";
      pickerInput.className = "input";
      pickerInput.value = getColorPickerValue(theme[key]);
      pickerInput.disabled = !isThemeColorEditableWithPicker(theme[key]);
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
      field.append(fieldTitle, inputs);
      group.appendChild(field);
    });

    return group;
  }

  private readThemeValues(): Record<ThemeKey, string> {
    return THEME_KEYS.reduce(
      (acc, key) => {
        acc[key] = readThemeValue(this.registry[key].get());
        return acc;
      },
      {} as Record<ThemeKey, string>,
    );
  }

  private syncLiveTheme(theme: Record<ThemeKey, string>): void {
    this.updatePreviewCard(theme);
    this.updateContrastWarnings(theme);
  }

  private updatePreviewCard(theme: Record<ThemeKey, string>): void {
    if (!this.livePreview) {
      return;
    }
    const preview = this.livePreview;
    preview.setAttribute("data-mode", this.previewMode);
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

    preview.style.background = bg;
    preview.style.borderColor = border;
    preview.style.color = text;
    preview.style.fontSize = theme[KEY_SUGGESTION_FONT_SIZE];
    preview.style.padding = `${theme[KEY_SUGGESTION_PADDING_VERTICAL]} ${theme[KEY_SUGGESTION_PADDING_HORIZONTAL]}`;

    const items = Array.from(preview.querySelectorAll<HTMLElement>(".appearance-preview-item"));
    items.forEach((item, index) => {
      if (index === 1) {
        item.style.background = highlightBg;
        item.style.color = highlightText;
        return;
      }
      item.style.background = "";
      item.style.color = "";
    });
  }

  private updateContrastWarnings(theme: Record<ThemeKey, string>): void {
    if (!this.liveContrastSection) {
      return;
    }
    this.liveContrastSection
      .querySelectorAll(".settings-inline-help")
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
      item.className = "settings-inline-help";
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
