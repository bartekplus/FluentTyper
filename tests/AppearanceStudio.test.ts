import "./setup";
import { describe, expect, test } from "bun:test";
import {
  AppearanceStudio,
  calculateThemeContrast,
  getColorPickerValue,
  mergeColorPickerValue,
  parseThemeColor,
} from "../src/ui/options/AppearanceStudio.js";
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
} from "../src/core/domain/constants.js";

const DEFAULT_THEME = {
  [KEY_SUGGESTION_BG_LIGHT]: "#ffffff",
  [KEY_SUGGESTION_TEXT_LIGHT]: "#2d3748",
  [KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT]: "#edf2f7",
  [KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT]: "#2d3748",
  [KEY_SUGGESTION_BORDER_LIGHT]: "#e2e8f0",
  [KEY_SUGGESTION_BG_DARK]: "#0f172a",
  [KEY_SUGGESTION_TEXT_DARK]: "#e2e8f0",
  [KEY_SUGGESTION_HIGHLIGHT_BG_DARK]: "#1e293b",
  [KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK]: "#f8fafc",
  [KEY_SUGGESTION_BORDER_DARK]: "#334155",
  [KEY_SUGGESTION_FONT_SIZE]: "0.9rem",
  [KEY_SUGGESTION_PADDING_VERTICAL]: "0.6rem",
  [KEY_SUGGESTION_PADDING_HORIZONTAL]: "0.8rem",
};

const COMPACT_THEME = {
  [KEY_SUGGESTION_BG_LIGHT]: "rgba(255, 255, 255, 0.85)",
  [KEY_SUGGESTION_TEXT_LIGHT]: "#1a202c",
  [KEY_SUGGESTION_HIGHLIGHT_BG_LIGHT]: "rgba(226, 232, 240, 0.9)",
  [KEY_SUGGESTION_HIGHLIGHT_TEXT_LIGHT]: "#1a202c",
  [KEY_SUGGESTION_BORDER_LIGHT]: "rgba(226, 232, 240, 0.7)",
  [KEY_SUGGESTION_BG_DARK]: "rgba(15, 23, 42, 0.9)",
  [KEY_SUGGESTION_TEXT_DARK]: "#f8fafc",
  [KEY_SUGGESTION_HIGHLIGHT_BG_DARK]: "rgba(30, 41, 59, 0.92)",
  [KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK]: "#f8fafc",
  [KEY_SUGGESTION_BORDER_DARK]: "rgba(71, 85, 105, 0.72)",
  [KEY_SUGGESTION_FONT_SIZE]: "0.85rem",
  [KEY_SUGGESTION_PADDING_VERTICAL]: "0.4rem",
  [KEY_SUGGESTION_PADDING_HORIZONTAL]: "0.6rem",
};

function createRegistry(initialValues: Record<string, string>) {
  const values = { ...initialValues };
  const handlers = new Map<string, Array<() => void>>();
  const registry = Object.fromEntries(
    Object.keys(initialValues).map((key) => [
      key,
      {
        get: () => values[key],
        set: (value: unknown) => {
          values[key] = String(value);
          (handlers.get(key) || []).forEach((handler) => handler());
        },
        addEvent: (_type: string, handler: () => void) => {
          handlers.set(key, [...(handlers.get(key) || []), handler]);
        },
      },
    ]),
  );

  return {
    registry,
    values,
  };
}

describe("AppearanceStudio theme value compatibility", () => {
  test("parses rgba and alpha hex theme values", () => {
    expect(parseThemeColor("rgba(255, 255, 255, 0.85)")).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 0.85,
    });
    expect(parseThemeColor("#112233cc")).toEqual({
      r: 17,
      g: 34,
      b: 51,
      a: 0.8,
    });
  });

  test("color picker merges into rgba values without stripping alpha", () => {
    expect(getColorPickerValue("rgba(255, 255, 255, 0.85)")).toBe("#ffffff");
    expect(mergeColorPickerValue("#112233", "rgba(255, 255, 255, 0.85)")).toBe(
      "rgba(17, 34, 51, 0.85)",
    );
  });

  test("contrast stays numeric for compact rgba themes", () => {
    const baseContrast = calculateThemeContrast(
      COMPACT_THEME[KEY_SUGGESTION_BG_LIGHT],
      COMPACT_THEME[KEY_SUGGESTION_TEXT_LIGHT],
      "#ffffff",
    );
    const highlightContrast = calculateThemeContrast(
      COMPACT_THEME[KEY_SUGGESTION_HIGHLIGHT_BG_DARK],
      COMPACT_THEME[KEY_SUGGESTION_HIGHLIGHT_TEXT_DARK],
      COMPACT_THEME[KEY_SUGGESTION_BG_DARK],
    );

    expect(Number.isFinite(baseContrast)).toBe(true);
    expect(Number.isFinite(highlightContrast)).toBe(true);
    expect(baseContrast).toBeGreaterThan(1);
    expect(highlightContrast).toBeGreaterThan(1);
  });

  test("preset application preserves exact stored values", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { registry, values } = createRegistry(DEFAULT_THEME);

    new AppearanceStudio(root, registry as never, {
      default: DEFAULT_THEME,
      compact: COMPACT_THEME,
    });

    const presetButtons = root.querySelectorAll<HTMLButtonElement>(".preset-card");
    presetButtons[1]?.click();

    expect(values[KEY_SUGGESTION_BG_LIGHT]).toBe(COMPACT_THEME[KEY_SUGGESTION_BG_LIGHT]);
    expect(values[KEY_SUGGESTION_BORDER_DARK]).toBe(COMPACT_THEME[KEY_SUGGESTION_BORDER_DARK]);
  });

  test("advanced color editor keeps rgba alpha when picker changes", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { registry, values } = createRegistry(COMPACT_THEME);

    new AppearanceStudio(root, registry as never, {
      default: DEFAULT_THEME,
      compact: COMPACT_THEME,
    });

    const colorInputs = root.querySelectorAll<HTMLInputElement>('input[type="color"]');
    expect(colorInputs[0]?.value).toBe("#ffffff");

    colorInputs[0]!.value = "#112233";
    colorInputs[0]!.dispatchEvent(new Event("change"));

    expect(values[KEY_SUGGESTION_BG_LIGHT]).toBe("rgba(17, 34, 51, 0.85)");
  });

  test("preview updates when theme values change and when preview mode switches", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { registry } = createRegistry(DEFAULT_THEME);

    new AppearanceStudio(root, registry as never, {
      default: DEFAULT_THEME,
      compact: COMPACT_THEME,
    });

    const previewBefore = root.querySelector(".appearance-preview") as HTMLElement;
    expect(previewBefore.dataset.mode).toBe("light");
    expect(previewBefore.style.background).toBe("rgb(255, 255, 255)");

    registry[KEY_SUGGESTION_BG_LIGHT].set("#112233");
    const previewAfterLightUpdate = root.querySelector(".appearance-preview") as HTMLElement;
    expect(previewAfterLightUpdate.style.background).toBe("rgb(17, 34, 51)");

    const darkToggle = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".segmented-control-button"),
    ).find((button) => button.textContent === "Dark preview");
    darkToggle?.click();

    const previewAfterToggle = root.querySelector(".appearance-preview") as HTMLElement;
    expect(previewAfterToggle.dataset.mode).toBe("dark");
    expect(previewAfterToggle.style.background).toBe("rgb(15, 23, 42)");
  });
});
