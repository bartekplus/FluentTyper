/**
 * Review UI styles (inside FluentTyper's shadow root). Colors follow the
 * suggestion popup's theme variables; categories also differ by line style,
 * label and badge, never by color alone.
 */
export const REVIEW_SHADOW_CSS = `
:host {
  all: initial;
  --ft-bg: var(--ft-theme-suggestion-bg-light, var(--suggestion-bg-light, #ffffff));
  --ft-fg: var(--ft-theme-suggestion-text-light, var(--suggestion-text-light, #0f172a));
  --ft-border: var(--ft-theme-suggestion-border-color-light, var(--suggestion-border-color-light, #cbd5e1));
  --ft-muted: color-mix(in srgb, var(--ft-fg) 64%, transparent);
  --ft-accent: var(--ft-theme-suggestion-highlight-bg-light, var(--suggestion-highlight-bg-light, #0f172a));
  --ft-accent-fg: var(--ft-theme-suggestion-highlight-text-light, var(--suggestion-highlight-text-light, #ffffff));
  /* At least 3:1 on light and dark pages: overlay marks sit on the page. */
  --ft-spelling: #e5383b;
  --ft-grammar: #b87400;
  --ft-punctuation: #3b82f6;
  --ft-typography: #9061f9;
  --ft-focus: #2563eb;
  color-scheme: light dark;
}
.panel, .card {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  font-weight: 400;
  letter-spacing: normal;
  text-transform: none;
  text-align: start;
}
@media (prefers-color-scheme: dark) {
  :host {
    --ft-bg: var(--ft-theme-suggestion-bg-dark, var(--suggestion-bg-dark, #0f172a));
    --ft-fg: var(--ft-theme-suggestion-text-dark, var(--suggestion-text-dark, #e2e8f0));
    --ft-border: var(--ft-theme-suggestion-border-color-dark, var(--suggestion-border-color-dark, #334155));
    --ft-accent: #3b82f6;
    --ft-accent-fg: #ffffff;
    --ft-focus: #93c5fd;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.clip { position: fixed; overflow: hidden; pointer-events: none; }
.mark {
  position: fixed;
  pointer-events: none;
  border-bottom: 2px solid var(--ft-cat);
  background: color-mix(in srgb, var(--ft-cat) 12%, transparent);
  border-radius: 2px;
}
.mark[data-category="grammar"] { border-bottom-style: double; border-bottom-width: 3px; }
.mark[data-category="punctuation"] { border-bottom-style: dotted; }
.mark[data-category="typography"] { border-bottom-style: dashed; }
.mark[data-selected="true"] {
  background: color-mix(in srgb, var(--ft-cat) 28%, transparent);
  box-shadow: 0 0 0 1px var(--ft-cat);
}
[data-category="spelling"] { --ft-cat: var(--ft-spelling); }
[data-category="grammar"] { --ft-cat: var(--ft-grammar); }
[data-category="punctuation"] { --ft-cat: var(--ft-punctuation); }
[data-category="typography"] { --ft-cat: var(--ft-typography); }
.panel, .card {
  position: fixed;
  pointer-events: auto;
  background: var(--ft-bg);
  color: var(--ft-fg);
  border: 1px solid var(--ft-border);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.08);
}
.panel {
  width: min(340px, calc(100vw - 24px));
  max-height: min(70vh, 560px);
  /* When even a short list does not fit (zoom, small screens), the panel
     itself scrolls so every control stays reachable. */
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  bottom: 12px;
  right: 12px;
}
@media (max-height: 480px) {
  .panel { max-height: calc(100vh - 24px); }
}
.panel > * { flex-shrink: 0; }
.panel > .list { flex-shrink: 1; }
.panel[data-corner="bottom-left"] { right: auto; left: 12px; }
.panel[data-corner="top-right"] { bottom: auto; top: 12px; }
.panel[data-corner="top-left"] { bottom: auto; top: 12px; right: auto; left: 12px; }
.panel header { display: flex; align-items: center; gap: 8px; padding: 10px 10px 6px 12px; }
.panel h2 { margin: 0; font-size: 14px; font-weight: 650; outline: none; }
.scope {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--ft-border);
  color: var(--ft-muted);
}
.spacer { flex: 1; }
button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--ft-border);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  min-height: 28px;
}
button:hover:not(:disabled) { background: color-mix(in srgb, var(--ft-fg) 7%, transparent); }
button:focus-visible, h2:focus-visible, .item:focus-visible {
  outline: 2px solid var(--ft-focus);
  outline-offset: 2px;
}
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--ft-accent); color: var(--ft-accent-fg); border-color: var(--ft-accent); }
button.icon { border: none; min-width: 28px; font-size: 16px; line-height: 1; padding: 4px; }
.status, .notes, .fix-note { margin: 0; padding: 0 12px 6px; font-size: 12px; color: var(--ft-muted); }
.notes p { margin: 2px 0; }
.status { color: var(--ft-fg); }
.filters { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 12px 8px; }
.filter { font-size: 11px; padding: 2px 6px; min-height: 24px; display: inline-flex; gap: 4px; align-items: center; }
.filter[aria-pressed="false"] { opacity: 0.55; text-decoration: line-through; }
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 18px;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  color: var(--ft-cat);
  border: 1px solid var(--ft-cat);
  background: color-mix(in srgb, var(--ft-cat) 10%, transparent);
}
.nav { display: flex; gap: 4px; padding: 0 12px 6px; }
.list { list-style: none; margin: 0; padding: 0 6px; overflow: auto; flex: 1; min-height: 40px; }
.list li { margin: 2px 0; }
.item {
  width: 100%;
  text-align: start;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 8px;
  border-color: transparent;
  border-inline-start: 3px solid var(--ft-cat);
  padding: 6px 8px;
}
.item[aria-current="true"] { background: color-mix(in srgb, var(--ft-cat) 12%, transparent); border-color: var(--ft-cat); }
.item .change { font-weight: 600; overflow-wrap: anywhere; }
.item .why { grid-column: 2; font-size: 12px; color: var(--ft-muted); }
footer { border-top: 1px solid var(--ft-border); padding: 8px 12px 10px; display: grid; gap: 4px; }
footer .fix-note { padding: 0; }
.card {
  width: min(320px, calc(100vw - 16px));
  padding: 10px 12px 12px;
  display: grid;
  gap: 8px;
}
.card header { display: flex; align-items: center; gap: 8px; }
.card .category { font-weight: 650; font-size: 12px; }
.card p { margin: 0; }
.diff { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; align-items: baseline; font-size: 13px; }
.diff .label { font-size: 11px; color: var(--ft-muted); }
.from { text-decoration: line-through; text-decoration-color: var(--ft-cat); }
.from, .to, .change { overflow-wrap: anywhere; min-width: 0; }
.to mark, .from mark { background: color-mix(in srgb, var(--ft-cat) 22%, transparent); color: inherit; border-radius: 2px; }
.alternatives { display: flex; flex-wrap: wrap; gap: 4px; }
.alternatives button[aria-pressed="true"] { border-color: var(--ft-cat); background: color-mix(in srgb, var(--ft-cat) 14%, transparent); }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
.card .word { font-size: 15px; font-weight: 600; }
.card p.label { font-size: 11px; color: var(--ft-muted); }
.suggestions button { font-weight: 600; min-width: 44px; }
.suggestions button:hover:not(:disabled), .suggestions button:focus-visible {
  border-color: var(--ft-cat);
  background: color-mix(in srgb, var(--ft-cat) 14%, transparent);
}
.hint { font-size: 11px; color: var(--ft-muted); }
.ws { color: var(--ft-muted); }
@media (forced-colors: active) {
  .mark { border-bottom-color: Highlight; background: transparent; forced-color-adjust: none; }
  .mark[data-selected="true"] { box-shadow: 0 0 0 2px Highlight; }
  .badge, .item { border-color: CanvasText; color: CanvasText; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
`;

/**
 * Painted highlights (CSS Custom Highlight API). These rules must live in the
 * page's own style scope, so they ship in suggestions.css; the names are
 * namespaced and listed here so tests keep both in sync.
 */
export const REVIEW_HIGHLIGHT_NAMES = {
  spelling: "fluenttyper-review-spelling",
  grammar: "fluenttyper-review-grammar",
  punctuation: "fluenttyper-review-punctuation",
  typography: "fluenttyper-review-typography",
  selected: "fluenttyper-review-selected",
} as const;
