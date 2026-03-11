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
    var(--suggestion-highlight-bg-light, #2563eb)
  );
  --ft-panel-highlight-fg: var(
    --ft-theme-suggestion-highlight-text-light,
    var(--suggestion-highlight-text-light, #ffffff)
  );
  --ft-panel-header-fg: color-mix(
    in srgb,
    var(--ft-panel-fg) 58%,
    transparent
  );
  --ft-shortcut-bg: color-mix(
    in srgb,
    var(--ft-panel-bg) 82%,
    var(--ft-panel-fg)
  );
  --ft-shortcut-border: color-mix(
    in srgb,
    var(--ft-panel-border) 70%,
    var(--ft-panel-fg) 12%
  );
  --ft-shortcut-fg: color-mix(
    in srgb,
    var(--ft-panel-fg) 88%,
    transparent
  );
  --ft-panel-shadow:
    0 14px 36px rgba(15, 23, 42, 0.18),
    0 2px 8px rgba(15, 23, 42, 0.1);
  --ft-font-family: ${SUGGESTION_POPUP_FONT_FAMILY};
  --ft-font-size: 13px;
  --ft-line-height: 18px;
  --ft-font-weight: ${SUGGESTION_POPUP_FONT_WEIGHT};
  --ft-font-style: ${SUGGESTION_POPUP_FONT_STYLE};
  --ft-font-stretch: ${SUGGESTION_POPUP_FONT_STRETCH};
  --ft-letter-spacing: ${SUGGESTION_POPUP_LETTER_SPACING};
  --ft-word-spacing: ${SUGGESTION_POPUP_WORD_SPACING};
  --ft-text-transform: ${SUGGESTION_POPUP_TEXT_TRANSFORM};
  --ft-radius: 11px;
  --ft-pad-x: 9px;
  --ft-pad-y: 4px;
  --ft-row-height: 28px;
  --ft-panel-min-width: 164px;
  all: initial;
  box-sizing: border-box;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 2147483647;
  display: none;
  max-width: min(420px, calc(100vw - 16px));
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
      0 18px 42px rgba(2, 6, 23, 0.42),
      0 2px 10px rgba(2, 6, 23, 0.22);
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
  backdrop-filter: saturate(145%) blur(12px);
  -webkit-backdrop-filter: saturate(145%) blur(12px);
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
  padding: 7px 9px 2px;
  color: var(--ft-panel-header-fg);
  font-family: var(--ft-font-family);
  font-size: calc(var(--ft-font-size) * 0.78);
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.ft-suggestion-list {
  all: initial;
  display: block;
  margin: 0;
  padding: 4px;
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
    transform 120ms ease;
}

.ft-suggestion-list li.has-shortcut {
  grid-template-columns: 22px minmax(0, 1fr);
  column-gap: 7px;
}

.ft-suggestion-list li.highlight {
  background: var(--ft-panel-highlight-bg);
  color: var(--ft-panel-highlight-fg);
  -webkit-text-fill-color: currentColor;
}

.ft-suggestion-list li:active {
  transform: scale(0.995);
}

.ft-suggestion-shortcut {
  all: initial;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  border: 1px solid var(--ft-shortcut-border);
  background: var(--ft-shortcut-bg);
  color: var(--ft-shortcut-fg);
  -webkit-text-fill-color: currentColor;
  font-family: var(--ft-font-family);
  font-size: calc(var(--ft-font-size) * 0.78);
  line-height: 1;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.ft-suggestion-list li.highlight .ft-suggestion-shortcut {
  background: color-mix(
    in srgb,
    var(--ft-panel-highlight-bg) 72%,
    var(--ft-panel-bg)
  );
  border-color: color-mix(
    in srgb,
    var(--ft-panel-border) 65%,
    var(--ft-panel-highlight-fg)
  );
  color: var(--ft-panel-highlight-fg);
}

.ft-suggestion-label {
  all: initial;
  display: block;
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
  color: inherit;
  -webkit-text-fill-color: currentColor;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  font-weight: 800;
  letter-spacing: inherit;
  text-transform: inherit;
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
