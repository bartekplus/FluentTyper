import { describe, expect, test } from "bun:test";
import { SUGGESTION_POPUP_SHADOW_CSS } from "../src/adapters/chrome/content-script/suggestions/SuggestionPopupShadowStyles";
import { SUGGESTION_POPUP_FONT_FAMILY } from "../src/adapters/chrome/content-script/suggestions/SuggestionPopupTypography";

describe("SuggestionPopupShadowStyles", () => {
  test("restores explicit foreground and typography after list reset", () => {
    expect(SUGGESTION_POPUP_SHADOW_CSS).toContain(
      `--ft-font-family: ${SUGGESTION_POPUP_FONT_FAMILY};`,
    );
    expect(SUGGESTION_POPUP_SHADOW_CSS).toContain("var(--suggestion-highlight-bg-light, #0f172a)");
    expect(SUGGESTION_POPUP_SHADOW_CSS).toContain(
      "var(--suggestion-highlight-text-light, #ffffff)",
    );
    expect(SUGGESTION_POPUP_SHADOW_CSS).toContain("--ft-row-height: 27px;");
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
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(
      /\.ft-suggestion-list li\.has-shortcut\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/,
    );
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(
      /\.ft-suggestion-list li\.highlight\s*\{[\s\S]*box-shadow:/,
    );
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(/\.ft-suggestion-shortcut\s*\{[\s\S]*order:\s*2;/);
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(
      /\.ft-suggestion-label\s*\{[\s\S]*-webkit-text-fill-color:\s*currentColor;/,
    );
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(
      /\.ft-suggestion-match\s*\{[\s\S]*color:\s*var\(--ft-panel-match-fg\);/,
    );
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(
      /\.ft-suggestion-list li\.highlight \.ft-suggestion-match\s*\{[\s\S]*color:\s*inherit;/,
    );
  });
});
