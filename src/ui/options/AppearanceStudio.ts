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

export class AppearanceStudio {
  private readonly root: HTMLElement;
  private readonly registry: SettingsRegistry;
  private readonly presets: Record<string, ThemePreset>;
  private previewMode: "light" | "dark" = "light";

  constructor(root: HTMLElement, registry: SettingsRegistry, presets: Record<string, ThemePreset>) {
    this.root = root;
    this.registry = registry;
    this.presets = presets;
    THEME_KEYS.forEach((key) => {
      this.registry[key]?.addEvent("action", () => this.render());
    });
    this.render();
  }

  render(): void {
    const theme = this.readThemeValues();
    this.root.replaceChildren(
      this.createPresetCards(),
      this.createPreviewCard(theme),
      this.createTypographyCard(theme),
      this.createAdvancedColors(theme),
      this.createContrastWarnings(theme),
    );
  }

  private createPresetCards(): HTMLElement {
    const shell = document.createElement("section");
    shell.className = "settings-inline-card";
    const title = document.createElement("h4");
    title.textContent = i18n.get("theme_presets");
    shell.appendChild(title);

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

    [
      i18n.get("appearance_sample_one"),
      i18n.get("appearance_sample_two"),
      i18n.get("appearance_sample_three"),
    ].forEach((entry, index) => {
      const item = document.createElement("div");
      item.className = "appearance-preview-item";
      item.textContent = entry;
      if (index === 1) {
        item.style.background = highlightBg;
        item.style.color = highlightText;
      }
      preview.appendChild(item);
    });

    shell.appendChild(preview);
    return shell;
  }

  private createTypographyCard(theme: Record<ThemeKey, string>): HTMLElement {
    const shell = document.createElement("section");
    shell.className = "settings-inline-card";
    const title = document.createElement("h4");
    title.textContent = i18n.get("typography_spacing");
    shell.appendChild(title);

    shell.appendChild(
      this.createSelectField(
        i18n.get("font_size_label"),
        theme[KEY_SUGGESTION_FONT_SIZE],
        [
          ["0.8rem", "0.8rem"],
          ["0.85rem", "0.85rem"],
          ["0.9rem", "0.9rem"],
          ["1rem", "1rem"],
        ],
        (value) => this.registry[KEY_SUGGESTION_FONT_SIZE].set(value),
      ),
    );
    shell.appendChild(
      this.createSelectField(
        i18n.get("vertical_padding_label"),
        theme[KEY_SUGGESTION_PADDING_VERTICAL],
        [
          ["0.4rem", "0.4rem"],
          ["0.6rem", "0.6rem"],
          ["0.8rem", "0.8rem"],
        ],
        (value) => this.registry[KEY_SUGGESTION_PADDING_VERTICAL].set(value),
      ),
    );
    shell.appendChild(
      this.createSelectField(
        i18n.get("horizontal_padding_label"),
        theme[KEY_SUGGESTION_PADDING_HORIZONTAL],
        [
          ["0.6rem", "0.6rem"],
          ["0.8rem", "0.8rem"],
          ["1rem", "1rem"],
        ],
        (value) => this.registry[KEY_SUGGESTION_PADDING_HORIZONTAL].set(value),
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

    const fields = [
      [KEY_SUGGESTION_BG_LIGHT, this.composeThemeLabel("light_theme_colors", "bg_color_label")],
      [KEY_SUGGESTION_TEXT_LIGHT, this.composeThemeLabel("light_theme_colors", "text_color_label")],
      [
        KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT,
        this.composeThemeLabel("light_theme_colors", "highlight_bg_label"),
      ],
      [
        KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT,
        this.composeThemeLabel("light_theme_colors", "highlight_text_label"),
      ],
      [
        KEY_SUGGESTION_BORDER_LIGHT,
        this.composeThemeLabel("light_theme_colors", "border_color_label"),
      ],
      [KEY_SUGGESTION_BG_DARK, this.composeThemeLabel("dark_theme_colors", "bg_color_label")],
      [KEY_SUGGESTION_TEXT_DARK, this.composeThemeLabel("dark_theme_colors", "text_color_label")],
      [
        KEY_SUGGESTION_HIGHLIGHT_BG_DARK,
        this.composeThemeLabel("dark_theme_colors", "highlight_bg_label"),
      ],
      [
        KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK,
        this.composeThemeLabel("dark_theme_colors", "highlight_text_label"),
      ],
      [
        KEY_SUGGESTION_BORDER_DARK,
        this.composeThemeLabel("dark_theme_colors", "border_color_label"),
      ],
    ] as const;

    fields.forEach(([key, label]) => {
      const field = document.createElement("label");
      field.className = "settings-stack-field";
      const title = document.createElement("span");
      title.textContent = label;
      const input = document.createElement("input");
      input.type = "color";
      input.className = "input";
      input.value = theme[key];
      input.addEventListener("change", () => {
        this.registry[key].set(input.value);
      });
      field.append(title, input);
      shell.appendChild(field);
    });

    return shell;
  }

  private createContrastWarnings(theme: Record<ThemeKey, string>): HTMLElement {
    const shell = document.createElement("section");
    shell.className = "settings-inline-card";
    const title = document.createElement("h4");
    title.textContent = i18n.get("appearance_contrast_checks");
    shell.appendChild(title);

    const warnings = [
      {
        label: this.composeThemeLabel("light_theme_colors", "text_color_label"),
        ratio: this.calculateContrast(
          theme[KEY_SUGGESTION_BG_LIGHT],
          theme[KEY_SUGGESTION_TEXT_LIGHT],
        ),
      },
      {
        label: this.composeThemeLabel("light_theme_colors", "highlight_text_label"),
        ratio: this.calculateContrast(
          theme[KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT],
          theme[KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT],
        ),
      },
      {
        label: this.composeThemeLabel("dark_theme_colors", "text_color_label"),
        ratio: this.calculateContrast(
          theme[KEY_SUGGESTION_BG_DARK],
          theme[KEY_SUGGESTION_TEXT_DARK],
        ),
      },
      {
        label: this.composeThemeLabel("dark_theme_colors", "highlight_text_label"),
        ratio: this.calculateContrast(
          theme[KEY_SUGGESTION_HIGHLIGHT_BG_DARK],
          theme[KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK],
        ),
      },
    ];

    warnings.forEach((warning) => {
      const item = document.createElement("p");
      item.className = "settings-inline-help";
      item.textContent =
        warning.ratio < 4.5
          ? `${warning.label}: ${warning.ratio.toFixed(2)}:1. ${i18n.get("appearance_contrast_warn")}`
          : `${warning.label}: ${warning.ratio.toFixed(2)}:1. ${i18n.get("appearance_contrast_good")}`;
      shell.appendChild(item);
    });
    return shell;
  }

  private composeThemeLabel(themeKey: string, fieldKey: string): string {
    return `${i18n.get(themeKey)} · ${i18n.get(fieldKey)}`;
  }

  private createSelectField(
    labelText: string,
    value: string,
    options: Array<[string, string]>,
    onChange: (value: string) => void,
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
    select.addEventListener("change", () => onChange(select.value));
    field.append(title, select);
    return field;
  }

  private readThemeValues(): Record<ThemeKey, string> {
    return THEME_KEYS.reduce(
      (acc, key) => {
        acc[key] = String(this.registry[key].get() || "");
        return acc;
      },
      {} as Record<ThemeKey, string>,
    );
  }

  private calculateContrast(backgroundHex: string, foregroundHex: string): number {
    const bg = this.relativeLuminance(backgroundHex);
    const fg = this.relativeLuminance(foregroundHex);
    const lighter = Math.max(bg, fg);
    const darker = Math.min(bg, fg);
    return (lighter + 0.05) / (darker + 0.05);
  }

  private relativeLuminance(hex: string): number {
    const normalized = hex.replace("#", "");
    const values = [0, 2, 4].map(
      (start) => Number.parseInt(normalized.slice(start, start + 2), 16) / 255,
    );
    const channels = values.map((value) =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }
}
