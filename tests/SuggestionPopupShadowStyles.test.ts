import { describe, expect, test } from "bun:test";
import { SUGGESTION_POPUP_SHADOW_CSS } from "../src/adapters/chrome/content-script/suggestions/SuggestionPopupShadowStyles";
import { SUGGESTION_POPUP_FONT_FAMILY } from "../src/adapters/chrome/content-script/suggestions/SuggestionPopupTypography";

describe("SuggestionPopupShadowStyles", () => {
  test("restores explicit foreground and typography after list reset", () => {
    expect(SUGGESTION_POPUP_SHADOW_CSS).toContain(
      `--ft-font-family: ${SUGGESTION_POPUP_FONT_FAMILY};`,
    );
    expect(SUGGESTION_POPUP_SHADOW_CSS).toContain("var(--suggestion-highlight-bg-light, #e3edf9)");
    expect(SUGGESTION_POPUP_SHADOW_CSS).toContain(
      "var(--suggestion-highlight-text-light, #1f2329)",
    );
    expect(SUGGESTION_POPUP_SHADOW_CSS).toContain("--ft-row-height: 32px;");
    expect(SUGGESTION_POPUP_SHADOW_CSS).toContain("--ft-panel-min-width: 152px;");
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(
      /\.ft-suggestion-list\s*\{[\s\S]*color:\s*var\(--ft-panel-fg\);/,
    );
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(/\.ft-suggestion-list\s*\{[\s\S]*padding:\s*0;/);
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(
      /\.ft-suggestion-list\s*\{[\s\S]*font-family:\s*var\(--ft-font-family\);/,
    );
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(
      /\.ft-suggestion-list li\s*\{[\s\S]*color:\s*var\(--ft-panel-fg\);/,
    );
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(
      /\.ft-suggestion-panel\s*\{[\s\S]*width:\s*max-content;[\s\S]*min-width:\s*min\(var\(--ft-panel-min-width\), 100%\);/,
    );
    // Selected row: filled, with an accent-tinted outline (popup design).
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(
      /\.ft-suggestion-list li\.highlight\s*\{[\s\S]*border-color:\s*var\(--ft-panel-highlight-border\);/,
    );
    // The key-hint footer hides with its hidden attribute despite \`all: initial\`.
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(
      /\.ft-suggestion-footer\[hidden\]\s*\{\s*display:\s*none;/,
    );
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(
      /\.ft-suggestion-label\s*\{[\s\S]*-webkit-text-fill-color:\s*currentColor;/,
    );
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(
      /\.ft-suggestion-match\s*\{[\s\S]*color:\s*var\(--ft-panel-accent\);/,
    );
  });
});
