import { describe, expect, test } from "bun:test";
import { SUGGESTION_POPUP_SHADOW_CSS } from "../src/adapters/chrome/content-script/suggestions/SuggestionPopupShadowStyles";
import { SUGGESTION_POPUP_FONT_FAMILY } from "../src/adapters/chrome/content-script/suggestions/SuggestionPopupTypography";

describe("SuggestionPopupShadowStyles", () => {
  test("restores explicit foreground and typography after list reset", () => {
    expect(SUGGESTION_POPUP_SHADOW_CSS).toContain(`--ft-font-family: ${SUGGESTION_POPUP_FONT_FAMILY};`);
    expect(SUGGESTION_POPUP_SHADOW_CSS).toContain("--ft-row-height: 28px;");
    expect(SUGGESTION_POPUP_SHADOW_CSS).toContain("--ft-panel-min-width: 164px;");
    expect(SUGGESTION_POPUP_SHADOW_CSS).toMatch(
      /\.ft-suggestion-list\s*\{[\s\S]*color:\s*var\(--ft-panel-fg\);/,
    );
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
      /\.ft-suggestion-label\s*\{[\s\S]*-webkit-text-fill-color:\s*currentColor;/,
    );
  });
});
