/**
 * Review UI styles (inside FluentTyper's shadow root). Colors follow the
 * suggestion popup's theme variables; categories also differ by line style,
 * label and badge, never by color alone.
 */
export const REVIEW_SHADOW_CSS = `
:host {
  all: initial;
  /* The surface follows the user's suggestion theme; actions and focus use
     the product accent, as on the popup and the options page. */
  --ft-bg: var(--ft-theme-suggestion-bg-light, var(--suggestion-bg-light, #ffffff));
  --ft-fg: var(--ft-theme-suggestion-text-light, var(--suggestion-text-light, #0f172a));
  --ft-border: var(--ft-theme-suggestion-border-color-light, var(--suggestion-border-color-light, #cbd5e1));
  --ft-muted: color-mix(in srgb, var(--ft-fg) 64%, transparent);
  --ft-hover: color-mix(in srgb, var(--ft-fg) 6%, transparent);
  --ft-accent: #4f46e5;
  --ft-accent-hover: #4338ca;
  --ft-accent-fg: #ffffff;
  --ft-success: #047857;
  --ft-shadow: 0 12px 32px -8px rgba(15, 23, 42, 0.22), 0 2px 6px rgba(15, 23, 42, 0.06);
  /* At least 3:1 on light and dark pages: overlay marks sit on the page. */
  --ft-spelling: #e5383b;
  --ft-grammar: #b87400;
  --ft-punctuation: #3b82f6;
  --ft-typography: #9061f9;
  --ft-style: #168578;
  --ft-focus: var(--ft-accent);
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
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  :host {
    --ft-bg: var(--ft-theme-suggestion-bg-dark, var(--suggestion-bg-dark, #0f172a));
    --ft-fg: var(--ft-theme-suggestion-text-dark, var(--suggestion-text-dark, #e2e8f0));
    --ft-border: var(--ft-theme-suggestion-border-color-dark, var(--suggestion-border-color-dark, #334155));
    --ft-accent: #38bdf8;
    --ft-accent-hover: #0ea5e9;
    --ft-accent-fg: #0f172a;
    --ft-success: #34d399;
    --ft-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.3);
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
::selection { background: color-mix(in srgb, var(--ft-accent) 30%, transparent); }
.layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.clip { position: fixed; overflow: hidden; pointer-events: none; }
/* Inside the clip, which is their containing block: a fixed mark would escape its overflow. */
.mark {
  position: absolute;
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
[data-category="style"] { --ft-cat: var(--ft-style); }
.mark[data-category="style"] { border-bottom-style: dotted; }
.panel, .card {
  position: fixed;
  pointer-events: auto;
  background: var(--ft-bg);
  color: var(--ft-fg);
  border: 1px solid var(--ft-border);
  border-radius: 12px;
  box-shadow: var(--ft-shadow);
}
.panel {
  width: min(340px, calc(100vw - 24px));
  max-height: min(70vh, 560px);
  /* When even a short list does not fit (zoom, small screens), the panel
     itself scrolls so every control stays reachable. */
  overflow-y: auto;
  /* Controls scrolled into view clear the sticky footer. */
  scroll-padding-bottom: 72px;
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
.panel > header { display: flex; align-items: center; gap: 8px; padding: 12px 10px 4px 16px; }
.panel h2 { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.3; }
/* A programmatic focus target (the panel's start), not a control. */
.panel h2:focus { outline: none; }
.scope {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--ft-hover);
  color: var(--ft-muted);
  white-space: nowrap;
}
.spacer { flex: 1; }
button, summary {
  font: inherit;
  font-weight: 500;
  color: inherit;
  background: transparent;
  border: 1px solid var(--ft-border);
  border-radius: 8px;
  padding: 4px 12px;
  cursor: pointer;
  min-height: 30px;
  transition: background-color 150ms ease-out, border-color 150ms ease-out, opacity 150ms ease-out;
}
button:hover:not(:disabled), summary:hover { background: var(--ft-hover); }
button:focus-visible, summary:focus-visible, .item:focus-visible {
  outline: 2px solid var(--ft-focus);
  outline-offset: 2px;
}
button:disabled { opacity: 0.45; cursor: default; }
button.primary {
  background: var(--ft-accent);
  color: var(--ft-accent-fg);
  border-color: var(--ft-accent);
  font-weight: 600;
}
button.primary:hover:not(:disabled) { background: var(--ft-accent-hover); border-color: var(--ft-accent-hover); }
/* Disabled reads as disabled: no accent fill. */
button.primary:disabled { background: var(--ft-hover); border-color: transparent; color: var(--ft-muted); opacity: 1; }
button.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  width: 28px;
  min-width: 28px;
  min-height: 28px;
  padding: 0;
  color: var(--ft-muted);
}
button.icon:hover:not(:disabled) { color: var(--ft-fg); }
button.icon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
button.link {
  border: none;
  min-height: 24px;
  padding: 2px 0;
  justify-self: start;
  color: var(--ft-accent);
  font-size: 12px;
}
button.link:hover:not(:disabled) { background: transparent; text-decoration: underline; text-underline-offset: 2px; }
.status { margin: 0; padding: 0 16px 8px; font-size: 12px; color: var(--ft-muted); }
.notes { margin: 0; padding: 10px 16px 8px; font-size: 12px; color: var(--ft-muted); }
.notes p { margin: 2px 0; }
.fix-note { margin: 0; font-size: 12px; color: var(--ft-muted); }
.filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 16px 8px; }
/* Badge and count; the category's name is the chip's title and accessible name. */
.filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 2px 10px 2px 3px;
  border-radius: 999px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.filter .badge { border-radius: 999px; }
.filter[aria-pressed="false"] { color: var(--ft-muted); border-style: dashed; padding-inline-end: 3px; }
.nav { display: inline-flex; }
.filter[aria-pressed="false"] .badge { background: transparent; border-color: var(--ft-border); color: var(--ft-muted); }
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  min-width: 24px;
  height: 18px;
  padding: 0 5px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  color: var(--ft-cat);
  border: 1px solid color-mix(in srgb, var(--ft-cat) 55%, transparent);
  background: color-mix(in srgb, var(--ft-cat) 10%, transparent);
}
.list { list-style: none; margin: 0; padding: 2px 8px 6px; overflow: auto; flex: 1; min-height: min(132px, 28vh); }
.list li { margin: 1px 0; }
.item {
  width: 100%;
  text-align: start;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  gap: 2px 10px;
  border-color: transparent;
  padding: 8px;
}
.item[aria-current="true"] { background: color-mix(in srgb, var(--ft-cat) 10%, transparent); }
.item .badge { align-self: start; margin-top: 1px; }
.item .change { font-weight: 600; overflow-wrap: anywhere; }
.item .why { grid-column: 2; font-size: 12px; font-weight: 400; color: var(--ft-muted); }
/* Fix all stays in reach while the panel scrolls. */
footer {
  position: sticky;
  bottom: 0;
  margin-top: auto;
  border-top: 1px solid var(--ft-border);
  padding: 10px 16px 12px;
  display: grid;
  gap: 6px;
  background: var(--ft-bg);
}
footer .primary { min-height: 32px; }
/* Done: the review is finished, so only the outcome and what can follow stay. */
.panel[data-done] :is(.filters, .list, .nav),
.panel[data-done] footer :is([data-action="fix-all"], .fix-note) { display: none; }
.panel[data-done] footer:not(:has(> button:not([hidden]):not([data-action="fix-all"]))) { display: none; }
.panel[data-done] .status {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 14px;
  font-size: 13px;
  color: var(--ft-fg);
}
/* A check in a circle, drawn in CSS: the page loads nothing, not even a data: image. */
.panel[data-done] .status::before {
  content: "";
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--ft-success);
}
.panel[data-done] .status::after {
  content: "";
  position: absolute;
  left: 23px;
  top: calc(50% - 7px);
  width: 4px;
  height: 8px;
  border: solid var(--ft-bg);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.card {
  width: min(320px, calc(100vw - 16px));
  padding: 12px 12px 14px 16px;
  display: grid;
  gap: 10px;
}
.card > header { display: flex; align-items: center; gap: 8px; margin-inline-end: -4px; }
.card .category { font-weight: 600; font-size: 12px; color: var(--ft-muted); }
.card p { margin: 0; }
.diff { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; font-size: 15px; }
.diff .arrow { color: var(--ft-muted); font-size: 13px; }
.from { color: var(--ft-muted); text-decoration: line-through; text-decoration-color: var(--ft-cat); }
.to { font-weight: 600; }
.from, .to, .change { overflow-wrap: anywhere; min-width: 0; }
.to mark, .from mark { background: color-mix(in srgb, var(--ft-cat) 22%, transparent); color: inherit; border-radius: 2px; }
.alternatives { display: flex; flex-wrap: wrap; gap: 6px; }
.alternatives button[aria-pressed="true"] { border-color: var(--ft-cat); background: color-mix(in srgb, var(--ft-cat) 14%, transparent); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
/* Rarer actions stay one click away. */
.card-actions { display: grid; gap: 6px; }
.more { display: grid; gap: 6px; }
.more > summary {
  list-style: none;
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  min-height: 26px;
  padding: 2px 6px;
  margin-inline-start: -6px;
  color: var(--ft-muted);
  font-size: 12px;
}
.more > summary::-webkit-details-marker { display: none; }
.more > summary::after {
  content: "";
  width: 6px;
  height: 6px;
  margin-top: -3px;
  border: solid currentColor;
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
  transition: transform 150ms ease-out;
}
.more[open] > summary::after { margin-top: 2px; transform: rotate(-135deg); }
.more > button { justify-self: start; }
.card .word { font-size: 15px; font-weight: 600; }
.card .word .from { color: inherit; }
.card p.label { font-size: 12px; color: var(--ft-muted); }
.suggestions button { font-weight: 600; min-width: 44px; }
.suggestions button:hover:not(:disabled), .suggestions button:focus-visible {
  border-color: var(--ft-cat);
  background: color-mix(in srgb, var(--ft-cat) 14%, transparent);
}
.hint { font-size: 12px; color: var(--ft-muted); }
/* Local AI: a segmented mode switch, one status line, provenance in words. */
.modes {
  display: inline-flex;
  align-self: flex-start;
  gap: 2px;
  margin: 4px 16px 10px;
  padding: 2px;
  border-radius: 9px;
  background: var(--ft-hover);
}
.modes button { border: none; border-radius: 7px; min-height: 26px; padding: 2px 14px; font-size: 12px; color: var(--ft-muted); }
.modes button:hover:not(:disabled) { background: transparent; color: var(--ft-fg); }
.modes button[aria-pressed="true"] {
  background: var(--ft-bg);
  color: var(--ft-fg);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12), 0 0 0 0.5px rgba(15, 23, 42, 0.08);
}
.ai { display: grid; gap: 8px; padding: 4px 16px 8px; font-size: 12px; }
.ai-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.ai-line { margin: 0; flex: 1 1 12em; color: var(--ft-muted); }
.ai button, .batch button, .rewrite .actions button { font-size: 12px; }
.setup, .batch, .rewrite-diff {
  display: grid;
  gap: 6px;
  border: 1px solid var(--ft-border);
  border-radius: 10px;
  padding: 10px 12px;
}
.setup { background: color-mix(in srgb, var(--ft-accent) 5%, transparent); border-color: color-mix(in srgb, var(--ft-accent) 25%, var(--ft-border)); }
.setup p, .batch p, .rewrite p { margin: 0; }
.setup-title, .batch-title { font-size: 13px; font-weight: 600; }
.setup-size { color: var(--ft-muted); }
.setup .actions { margin-top: 2px; }
.tag {
  display: inline-block;
  padding: 0 4px;
  border: 1px solid var(--ft-border);
  border-radius: 5px;
  font-size: 10px;
  font-weight: 600;
  color: var(--ft-fg);
  white-space: nowrap;
}
.batch { margin: 0 16px 8px; font-size: 12px; }
.batch ol { margin: 0; padding-inline-start: 18px; max-height: 30vh; overflow: auto; overflow-wrap: anywhere; }
.rewrite { display: grid; gap: 10px; padding: 0 16px 12px; }
.rewrite label { display: grid; gap: 4px; font-size: 12px; color: var(--ft-muted); }
.rewrite .using, .rewrite-msg { font-size: 12px; }
.rewrite-msg { color: var(--ft-fg); }
select {
  font: inherit;
  font-size: 13px;
  color: var(--ft-fg);
  background: var(--ft-bg);
  border: 1px solid var(--ft-border);
  border-radius: 8px;
  padding: 4px 8px;
  min-height: 30px;
}
select:focus-visible { outline: 2px solid var(--ft-focus); outline-offset: 2px; }
.rewrite-diff { max-height: 40vh; overflow: auto; }
.rewrite-diff p.before, .rewrite-diff p.after { white-space: pre-wrap; overflow-wrap: anywhere; }
.rewrite-diff p.label { font-size: 12px; color: var(--ft-muted); }
/* Changes read without color: struck through and underlined. */
del { text-decoration: line-through; background: color-mix(in srgb, var(--ft-spelling) 14%, transparent); color: inherit; }
ins { text-decoration: underline; background: color-mix(in srgb, #16a34a 18%, transparent); color: inherit; }
.copied { align-self: center; font-size: 12px; color: var(--ft-muted); }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (forced-colors: active) {
  .mark { border-bottom-color: Highlight; background: transparent; forced-color-adjust: none; }
  .mark[data-selected="true"] { box-shadow: 0 0 0 2px Highlight; }
  .badge, .item { border-color: CanvasText; color: CanvasText; }
  .item[aria-current="true"] { outline: 2px solid Highlight; outline-offset: -2px; }
  button.primary:not(:disabled) { forced-color-adjust: none; background: Highlight; color: HighlightText; border-color: Highlight; }
  .panel[data-done] .status::before, .panel[data-done] .status::after { display: none; }
  .modes, .modes button + button, .tag, .setup, .batch, .rewrite-diff, select { border-color: CanvasText; }
  .modes button[aria-pressed="true"] { forced-color-adjust: none; background: Highlight; color: HighlightText; }
  del, ins { background: transparent; }
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
  style: "fluenttyper-review-style",
  selected: "fluenttyper-review-selected",
} as const;

/**
 * A viewport-sized, click-through host for FluentTyper's own layer, with the
 * shadow root its UI goes in. The page's CSS cannot reach or move it, and it is
 * never part of an editing host, even on designMode pages.
 */
export function createOverlayHost(
  doc: Document,
  attribute: string,
  zIndex: number,
): { host: HTMLElement; root: ShadowRoot } {
  const host = doc.createElement("div");
  host.setAttribute(attribute, "");
  host.setAttribute("contenteditable", "false");
  for (const [name, value] of Object.entries({
    all: "initial",
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    margin: "0",
    padding: "0",
    border: "0",
    background: "transparent",
    overflow: "visible",
    "pointer-events": "none",
    "z-index": String(zIndex),
    display: "block",
  })) {
    host.style.setProperty(name, value, "important");
  }
  return { host, root: host.attachShadow({ mode: "open" }) };
}

/** Moves a connected host to the top layer, which escapes page transforms, stacking contexts and clipping. */
export function enterTopLayer(host: HTMLElement): void {
  const popover = host as HTMLElement & { showPopover?: () => void };
  if (typeof popover.showPopover !== "function") return;
  try {
    host.setAttribute("popover", "manual");
    popover.showPopover();
  } catch {
    host.removeAttribute("popover");
  }
}
