import { SUGGESTION_POPUP_ACCENT } from "./palette";
import {
  SUGGESTION_POPUP_FONT_FAMILY,
  SUGGESTION_POPUP_FONT_STRETCH,
  SUGGESTION_POPUP_FONT_STYLE,
  SUGGESTION_POPUP_FONT_WEIGHT,
  SUGGESTION_POPUP_LETTER_SPACING,
  SUGGESTION_POPUP_TEXT_TRANSFORM,
  SUGGESTION_POPUP_WORD_SPACING,
} from "./typography";

/** Colors on light pages; the user's theme (--ft-theme-*) wins over the defaults. */
const LIGHT_PALETTE = `
  --ft-panel-bg: var(
    --ft-theme-suggestion-bg-light,
    var(--suggestion-bg-light, #ffffff)
  );
  --ft-panel-fg: var(
    --ft-theme-suggestion-text-light,
    var(--suggestion-text-light, #1f2329)
  );
  --ft-panel-border: var(
    --ft-theme-suggestion-border-color-light,
    var(--suggestion-border-color-light, #d5dae3)
  );
  --ft-panel-highlight-bg: var(
    --ft-theme-suggestion-highlight-bg-light,
    var(--suggestion-highlight-bg-light, #e3edf9)
  );
  --ft-panel-highlight-fg: var(
    --ft-theme-suggestion-highlight-text-light,
    var(--suggestion-highlight-text-light, #1f2329)
  );
  /* Typed text; the theme code passes versions that read on the user's colors. */
  --ft-panel-accent: var(
    --ft-theme-suggestion-accent-light,
    var(--suggestion-accent-light, ${SUGGESTION_POPUP_ACCENT.light})
  );
  --ft-panel-highlight-accent: var(
    --ft-theme-suggestion-highlight-accent-light,
    var(--suggestion-highlight-accent-light, ${SUGGESTION_POPUP_ACCENT.light})
  );
  --ft-panel-shadow:
    0 12px 32px rgba(15, 23, 42, 0.14),
    0 2px 6px rgba(15, 23, 42, 0.08);
`;

/** Colors on dark pages. */
const DARK_PALETTE = `
  --ft-panel-bg: var(
    --ft-theme-suggestion-bg-dark,
    var(--suggestion-bg-dark, #22252c)
  );
  --ft-panel-fg: var(
    --ft-theme-suggestion-text-dark,
    var(--suggestion-text-dark, #e6e7eb)
  );
  --ft-panel-border: var(
    --ft-theme-suggestion-border-color-dark,
    var(--suggestion-border-color-dark, #373b46)
  );
  --ft-panel-highlight-bg: var(
    --ft-theme-suggestion-highlight-bg-dark,
    var(--suggestion-highlight-bg-dark, #2c3b52)
  );
  --ft-panel-highlight-fg: var(
    --ft-theme-suggestion-highlight-text-dark,
    var(--suggestion-highlight-text-dark, #f3f4f6)
  );
  --ft-panel-accent: var(
    --ft-theme-suggestion-accent-dark,
    var(--suggestion-accent-dark, ${SUGGESTION_POPUP_ACCENT.dark})
  );
  --ft-panel-highlight-accent: var(
    --ft-theme-suggestion-highlight-accent-dark,
    var(--suggestion-highlight-accent-dark, ${SUGGESTION_POPUP_ACCENT.dark})
  );
  --ft-panel-shadow:
    0 16px 40px rgba(0, 0, 0, 0.5),
    0 2px 6px rgba(0, 0, 0, 0.35);
`;

export const SUGGESTION_POPUP_SHADOW_CSS = `
:host {
${LIGHT_PALETTE}  --ft-font-family: ${SUGGESTION_POPUP_FONT_FAMILY};
  --ft-font-size: 13px;
  --ft-line-height: 18px;
  --ft-font-weight: ${SUGGESTION_POPUP_FONT_WEIGHT};
  --ft-font-style: ${SUGGESTION_POPUP_FONT_STYLE};
  --ft-font-stretch: ${SUGGESTION_POPUP_FONT_STRETCH};
  --ft-letter-spacing: ${SUGGESTION_POPUP_LETTER_SPACING};
  --ft-word-spacing: ${SUGGESTION_POPUP_WORD_SPACING};
  --ft-text-transform: ${SUGGESTION_POPUP_TEXT_TRANSFORM};
  --ft-radius: 8px;
  --ft-pad-x: 10px;
  --ft-pad-y: 3px;
  --ft-row-height: 32px;
  --ft-panel-min-width: 152px;
  all: initial;
  box-sizing: border-box;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 2147483647;
  display: none;
  max-width: min(460px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  pointer-events: none;
  color-scheme: light dark;
  direction: inherit;
}

@media (prefers-color-scheme: dark) {
  :host {
  ${DARK_PALETTE}
  }
}

/* An explicit scheme (the options preview's light/dark toggle) beats the OS one. */
:host([data-ft-color-scheme="light"]) {
${LIGHT_PALETTE}
}

:host([data-ft-color-scheme="dark"]) {
${DARK_PALETTE}
}

/* Derived from the (user-themable) panel colors, so custom themes stay coherent. */
:host {
  --ft-panel-muted: color-mix(in srgb, var(--ft-panel-fg) 68%, var(--ft-panel-bg));
  --ft-panel-highlight-border: color-mix(
    in srgb,
    var(--ft-panel-highlight-bg) 60%,
    var(--ft-panel-highlight-accent)
  );
  --ft-badge-bg: color-mix(in srgb, var(--ft-panel-fg) 9%, var(--ft-panel-bg));
  --ft-badge-fg: color-mix(in srgb, var(--ft-panel-fg) 72%, var(--ft-panel-bg));
  --ft-kbd-border: color-mix(in srgb, var(--ft-panel-fg) 24%, var(--ft-panel-bg));
  --ft-kbd-fg: color-mix(in srgb, var(--ft-panel-fg) 84%, var(--ft-panel-bg));
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
  padding: 4px;
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

.ft-suggestion-list {
  all: initial;
  display: flex;
  flex-direction: column;
  row-gap: 2px;
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

/* Above the caret the list grows upward, so the first suggestion stays next to it. */
:host([data-ft-placement="above"]:not([data-ft-layout="horizontal"])) .ft-suggestion-list {
  flex-direction: column-reverse;
}

/* ...and the key hints go on top, away from the caret. */
:host([data-ft-placement="above"]) .ft-suggestion-footer {
  order: -1;
  margin: 0 0 4px;
  border-top: 0;
  border-bottom: 1px solid var(--ft-panel-border);
}

.ft-suggestion-list li {
  all: initial;
  /* \`all: initial\` resets box-sizing; rows are --ft-row-height including borders. */
  box-sizing: border-box;
  display: flex;
  align-items: center;
  column-gap: 10px;
  min-height: var(--ft-row-height);
  padding: 0 var(--ft-pad-x) 0 calc(var(--ft-pad-x) - 2px);
  border: 1px solid transparent;
  border-radius: 5px;
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
    border-color 120ms ease,
    color 120ms ease;
}

.ft-suggestion-list li:not(.highlight):hover {
  background: color-mix(in srgb, var(--ft-panel-bg) 92%, var(--ft-panel-fg) 8%);
}

.ft-suggestion-list li.highlight {
  background: var(--ft-panel-highlight-bg);
  border-color: var(--ft-panel-highlight-border);
  color: var(--ft-panel-highlight-fg);
  -webkit-text-fill-color: currentColor;
}

/* Number badge (1-9). */
.ft-suggestion-shortcut {
  all: initial;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: var(--ft-badge-bg);
  color: var(--ft-badge-fg);
  -webkit-text-fill-color: currentColor;
  font-family: var(--ft-font-family);
  font-size: 11px;
  line-height: 1;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.ft-suggestion-label {
  all: initial;
  display: block;
  flex: 1 1 auto;
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
  color: var(--ft-panel-accent);
  -webkit-text-fill-color: currentColor;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  font-weight: 700;
  letter-spacing: inherit;
  text-transform: inherit;
}

/*
 * The selected row has its own accent (checked against that row's background)
 * and mixes its other colors from its own text color, so a dark selected row on
 * a light popup stays readable.
 */
.ft-suggestion-list li.highlight .ft-suggestion-match {
  color: var(--ft-panel-highlight-accent);
}

.ft-suggestion-list li.highlight .ft-suggestion-detail {
  color: color-mix(in srgb, var(--ft-panel-highlight-fg) 72%, var(--ft-panel-highlight-bg));
}

.ft-suggestion-list li.highlight .ft-suggestion-shortcut {
  background: color-mix(in srgb, var(--ft-panel-highlight-fg) 14%, var(--ft-panel-highlight-bg));
  color: color-mix(in srgb, var(--ft-panel-highlight-fg) 80%, var(--ft-panel-highlight-bg));
}

/* A snippet's shortcut, on the right. */
.ft-suggestion-detail {
  all: initial;
  display: block;
  flex: 0 1 auto;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ft-panel-muted);
  -webkit-text-fill-color: currentColor;
  font-family: inherit;
  font-size: 0.86em;
  line-height: inherit;
  letter-spacing: inherit;
}

.ft-suggestion-footer {
  all: initial;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 4px;
  padding: 8px 8px 4px;
  border-top: 1px solid var(--ft-panel-border);
  color: var(--ft-panel-muted);
  -webkit-text-fill-color: currentColor;
  font-family: var(--ft-font-family);
  font-size: 11.5px;
  line-height: 18px;
  white-space: nowrap;
}

.ft-suggestion-footer[hidden] {
  display: none;
}

/* The prediction language, at the far end of the hint line. */
.ft-suggestion-lang {
  all: initial;
  margin-inline-start: auto;
  color: inherit;
  -webkit-text-fill-color: currentColor;
  font: inherit;
  font-weight: 600;
}

.ft-suggestion-footer kbd {
  all: initial;
  margin-inline-end: 4px;
  padding: 1px 5px;
  border: 1px solid var(--ft-kbd-border);
  border-radius: 3px;
  color: var(--ft-kbd-fg);
  -webkit-text-fill-color: currentColor;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}

:host([data-ft-layout="horizontal"]) {
  max-width: min(640px, calc(100vw - 16px));
}

:host([data-ft-layout="horizontal"]) .ft-suggestion-panel {
  min-width: 0;
  padding: 6px;
  border-radius: calc(var(--ft-radius) + 2px);
}

/* One row, first suggestion at the anchor; what does not fit is cut off, never wrapped. */
:host([data-ft-layout="horizontal"]) .ft-suggestion-list {
  flex-direction: row;
  column-gap: 4px;
  overflow: hidden;
}

:host([data-ft-layout="horizontal"]) .ft-suggestion-list li {
  flex: none;
  max-width: 240px;
  column-gap: 8px;
  min-height: calc(var(--ft-row-height) + 4px);
  padding: 0 calc(var(--ft-pad-x) + 2px) 0 var(--ft-pad-x);
  border-radius: 6px;
}

:host([data-ft-layout="horizontal"]) .ft-suggestion-footer {
  margin-top: 6px;
  padding: 6px 8px 2px;
}

:host([data-ft-layout="horizontal"][data-ft-placement="above"]) .ft-suggestion-footer {
  margin: 0 0 6px;
  padding: 2px 8px 6px;
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
