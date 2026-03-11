import { afterEach, describe, expect, test } from "bun:test";
import { ThemeApplicator } from "../src/adapters/chrome/content-script/ThemeApplicator";
import { DEFAULT_SUGGESTION_THEME_SETTINGS } from "../src/core/domain/themeDefaults";

describe("ThemeApplicator", () => {
  afterEach(() => {
    document.getElementById("fluent-typer-theme-overrides")?.remove();
  });

  test("falls back to safe defaults when persisted theme values are invalid or host-dependent", () => {
    const applicator = new ThemeApplicator();

    applicator.apply({
      ...DEFAULT_SUGGESTION_THEME_SETTINGS,
      suggestionBgLight: "var(--page-bg)",
      suggestionTextLight: "not-a-color",
      suggestionHighlightBgLight: "rgba(10, 20, 30, 0.9)",
      suggestionHighlightTextLight: "",
      suggestionBorderLight: "url(https://example.com/fake)",
      suggestionBgDark: "#111827",
      suggestionTextDark: "var(--page-fg)",
      suggestionHighlightBgDark: "calc(1px + 1px)",
      suggestionHighlightTextDark: "#f8fafc",
      suggestionBorderDark: "rgba(148, 163, 184, 0.5)",
      suggestionFontSize: "var(--host-size)",
      suggestionPaddingVertical: "calc(0.6rem + var(--host-gap))",
      suggestionPaddingHorizontal: "bogus",
    });

    const style = document.getElementById("fluent-typer-theme-overrides");
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain(
      `--ft-theme-suggestion-bg-light: ${DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBgLight}`,
    );
    expect(style?.textContent).toContain(
      `--ft-theme-suggestion-text-light: ${DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionTextLight}`,
    );
    expect(style?.textContent).toContain(
      "--ft-theme-suggestion-highlight-bg-light: rgba(10, 20, 30, 0.9)",
    );
    expect(style?.textContent).toContain(
      `--ft-theme-suggestion-highlight-text-light: ${DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionHighlightTextLight}`,
    );
    expect(style?.textContent).toContain(
      `--ft-theme-suggestion-border-color-light: ${DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionBorderLight}`,
    );
    expect(style?.textContent).toContain(
      `--ft-theme-suggestion-text-dark: ${DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionTextDark}`,
    );
    expect(style?.textContent).toContain(
      `--ft-theme-suggestion-font-size: ${DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionFontSize}`,
    );
    expect(style?.textContent).toContain(
      `--ft-theme-suggestion-padding-vertical: ${DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionPaddingVertical}`,
    );
    expect(style?.textContent).toContain(
      `--ft-theme-suggestion-padding-horizontal: ${DEFAULT_SUGGESTION_THEME_SETTINGS.suggestionPaddingHorizontal}`,
    );
  });
});
