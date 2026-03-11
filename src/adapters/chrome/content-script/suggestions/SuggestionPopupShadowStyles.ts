import {
  SUGGESTION_POPUP_FONT_FAMILY,
  SUGGESTION_POPUP_FONT_STRETCH,
  SUGGESTION_POPUP_FONT_STYLE,
  SUGGESTION_POPUP_FONT_WEIGHT,
  SUGGESTION_POPUP_LETTER_SPACING,
  SUGGESTION_POPUP_TEXT_TRANSFORM,
  SUGGESTION_POPUP_WORD_SPACING,
} from "./SuggestionPopupTypography";

export const SUGGESTION_POPUP_SHADOW_CSS = `
:host {
  --ft-panel-bg: var(
    --ft-theme-suggestion-bg-light,
    var(--suggestion-bg-light, rgba(252, 253, 255, 0.96))
  );
  --ft-panel-fg: var(
    --ft-theme-suggestion-text-light,
    var(--suggestion-text-light, #0f172a)
  );
  --ft-panel-border: var(
    --ft-theme-suggestion-border-color-light,
    var(--suggestion-border-color-light, rgba(148, 163, 184, 0.28))
  );
  --ft-panel-highlight-bg: var(
    --ft-theme-suggestion-highlight-bg-light,
    var(--suggestion-highlight-bg-light, #0f172a)
  );
  --ft-panel-highlight-fg: var(
    --ft-theme-suggestion-highlight-text-light,
    var(--suggestion-highlight-text-light, #ffffff)
  );
  --ft-panel-header-fg: color-mix(
    in srgb,
    var(--ft-panel-fg) 52%,
    transparent
  );
  --ft-panel-match-fg: color-mix(
    in srgb,
    var(--ft-panel-fg) 82%,
    #9a5b13
  );
  --ft-shortcut-bg: color-mix(
    in srgb,
    var(--ft-panel-bg) 92%,
    var(--ft-panel-fg) 8%
  );
  --ft-shortcut-border: color-mix(
    in srgb,
    var(--ft-panel-border) 82%,
    transparent
  );
  --ft-shortcut-fg: color-mix(
    in srgb,
    var(--ft-panel-fg) 76%,
    transparent
  );
  --ft-panel-shadow:
    0 18px 42px rgba(15, 23, 42, 0.12),
    0 2px 10px rgba(15, 23, 42, 0.06);
  --ft-font-family: ${SUGGESTION_POPUP_FONT_FAMILY};
  --ft-font-size: 13px;
  --ft-line-height: 18px;
  --ft-font-weight: ${SUGGESTION_POPUP_FONT_WEIGHT};
  --ft-font-style: ${SUGGESTION_POPUP_FONT_STYLE};
  --ft-font-stretch: ${SUGGESTION_POPUP_FONT_STRETCH};
  --ft-letter-spacing: ${SUGGESTION_POPUP_LETTER_SPACING};
  --ft-word-spacing: ${SUGGESTION_POPUP_WORD_SPACING};
  --ft-text-transform: ${SUGGESTION_POPUP_TEXT_TRANSFORM};
  --ft-radius: 10px;
  --ft-pad-x: 8px;
  --ft-pad-y: 3px;
  --ft-row-height: 27px;
  --ft-panel-min-width: 152px;
  all: initial;
  box-sizing: border-box;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 2147483647;
  display: none;
  max-width: min(360px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  pointer-events: none;
  color-scheme: light dark;
  direction: inherit;
}

@media (prefers-color-scheme: dark) {
  :host {
    --ft-panel-bg: var(
      --ft-theme-suggestion-bg-dark,
      var(--suggestion-bg-dark, rgba(15, 23, 42, 0.96))
    );
    --ft-panel-fg: var(
      --ft-theme-suggestion-text-dark,
      var(--suggestion-text-dark, #e5edf7)
    );
    --ft-panel-border: var(
      --ft-theme-suggestion-border-color-dark,
      var(--suggestion-border-color-dark, rgba(148, 163, 184, 0.22))
    );
    --ft-panel-highlight-bg: var(
      --ft-theme-suggestion-highlight-bg-dark,
      var(--suggestion-highlight-bg-dark, rgba(96, 165, 250, 0.18))
    );
    --ft-panel-highlight-fg: var(
      --ft-theme-suggestion-highlight-text-dark,
      var(--suggestion-highlight-text-dark, #f8fafc)
    );
    --ft-panel-shadow:
      0 20px 46px rgba(2, 6, 23, 0.34),
      0 4px 12px rgba(2, 6, 23, 0.18);
  }
}

*, *::before, *::after {
  box-sizing: border-box;
}

.ft-suggestion-panel {
  all: initial;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  width: max-content;
  min-width: min(var(--ft-panel-min-width), 100%);
  max-width: inherit;
  max-height: inherit;
  overflow: hidden;
  border-radius: var(--ft-radius);
  border: 1px solid var(--ft-panel-border);
  background: var(--ft-panel-bg);
  color: var(--ft-panel-fg);
  box-shadow: var(--ft-panel-shadow);
  font-family: var(--ft-font-family);
  font-size: var(--ft-font-size);
  line-height: var(--ft-line-height);
  font-weight: var(--ft-font-weight);
  font-style: var(--ft-font-style);
  font-stretch: var(--ft-font-stretch);
  letter-spacing: var(--ft-letter-spacing);
  word-spacing: var(--ft-word-spacing);
  text-transform: var(--ft-text-transform);
  contain: layout style paint;
  isolation: isolate;
  transform-origin: top left;
  animation: ft-suggestion-pop-in 120ms cubic-bezier(0.2, 0.85, 0.28, 1);
}

.ft-suggestion-header {
  all: initial;
  display: none;
  padding: 8px 10px 4px;
  border-bottom: 1px solid color-mix(in srgb, var(--ft-panel-border) 72%, transparent);
  color: var(--ft-panel-header-fg);
  font-family: var(--ft-font-family);
  font-size: calc(var(--ft-font-size) * 0.74);
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: none;
}

.ft-suggestion-list {
  all: initial;
  display: block;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
  max-height: inherit;
  color: var(--ft-panel-fg);
  -webkit-text-fill-color: currentColor;
  font-family: var(--ft-font-family);
  font-size: var(--ft-font-size);
  line-height: var(--ft-line-height);
  font-weight: var(--ft-font-weight);
  font-style: var(--ft-font-style);
  font-stretch: var(--ft-font-stretch);
  letter-spacing: var(--ft-letter-spacing);
  word-spacing: var(--ft-word-spacing);
  text-transform: var(--ft-text-transform);
}

.ft-suggestion-list li {
  all: initial;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  min-height: var(--ft-row-height);
  padding: var(--ft-pad-y) var(--ft-pad-x);
  border-radius: calc(var(--ft-radius) - 6px);
  color: var(--ft-panel-fg);
  -webkit-text-fill-color: currentColor;
  cursor: pointer;
  font-family: var(--ft-font-family);
  font-size: var(--ft-font-size);
  line-height: var(--ft-line-height);
  font-weight: var(--ft-font-weight);
  letter-spacing: var(--ft-letter-spacing);
  word-spacing: var(--ft-word-spacing);
  text-transform: var(--ft-text-transform);
  transition:
    background-color 120ms ease,
    color 120ms ease,
    box-shadow 120ms ease,
    transform 120ms ease;
}

.ft-suggestion-list li:not(.highlight):hover {
  background: color-mix(in srgb, var(--ft-panel-bg) 92%, var(--ft-panel-fg) 8%);
}

.ft-suggestion-list li.has-shortcut {
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 8px;
}

.ft-suggestion-list li.highlight {
  background: var(--ft-panel-highlight-bg);
  color: var(--ft-panel-highlight-fg);
  -webkit-text-fill-color: currentColor;
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--ft-panel-highlight-fg) 10%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--ft-panel-highlight-fg) 12%, transparent);
}

.ft-suggestion-list li:active {
  transform: scale(0.995);
}

.ft-suggestion-shortcut {
  all: initial;
  display: grid;
  place-items: center;
  order: 2;
  justify-self: end;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--ft-shortcut-border);
  background: var(--ft-shortcut-bg);
  color: var(--ft-shortcut-fg);
  -webkit-text-fill-color: currentColor;
  font-family: var(--ft-font-family);
  font-size: calc(var(--ft-font-size) * 0.72);
  line-height: 1;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.ft-suggestion-list li.highlight .ft-suggestion-shortcut {
  background: color-mix(
    in srgb,
    var(--ft-panel-highlight-fg) 14%,
    var(--ft-panel-highlight-bg)
  );
  border-color: color-mix(
    in srgb,
    var(--ft-panel-highlight-fg) 24%,
    transparent
  );
  color: var(--ft-panel-highlight-fg);
}

.ft-suggestion-label {
  all: initial;
  display: block;
  order: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
  -webkit-text-fill-color: currentColor;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  font-weight: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
}

.ft-suggestion-match {
  all: initial;
  color: var(--ft-panel-match-fg);
  -webkit-text-fill-color: currentColor;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  font-weight: 700;
  letter-spacing: inherit;
  text-transform: inherit;
}

.ft-suggestion-list li.highlight .ft-suggestion-match {
  color: inherit;
}

@media (prefers-reduced-motion: reduce) {
  .ft-suggestion-panel,
  .ft-suggestion-list li {
    animation: none;
    transition: none;
  }
}

@keyframes ft-suggestion-pop-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.985);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
`;
