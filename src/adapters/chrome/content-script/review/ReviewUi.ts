import { SUPPORTED_LANGUAGES } from "@core/domain/lang";
import { isReviewSupportedRule, reviewKind } from "@core/domain/grammar/review/reviewCatalog";
import { getDeepActiveElement } from "@core/application/dom-utils";
import type { ReviewViewState } from "@core/application/review/ReviewSession";
import {
  isPageMessageKey,
  reviewText,
  type ReviewTextKey,
} from "@core/domain/grammar/review/reviewMessages";
import { commonAffixes } from "@core/domain/grammar/review/textRanges";
import {
  REVIEW_CATEGORIES,
  REVIEW_LOCAL_AI_CHECK,
  type ReviewCategory,
  type ReviewDiagnostic,
} from "@core/domain/grammar/review/types";
import { REVIEW_SHADOW_CSS, createOverlayHost, enterTopLayer } from "./reviewStyles";
import type { ReviewMode, RewriteViewState } from "@core/application/review/reviewAi";
import {
  REWRITE_STYLES,
  type AiRejectionReason,
  type EditorContextHint,
  type RewriteStyle,
} from "@core/domain/grammar/review/ai/types";

export interface ReviewUiCallbacks {
  close(): void;
  setLanguage?(language: string): void;
  retry?(): void;
  select(id: string | null, options: { openCard: boolean; focusList: boolean }): void;
  /** `viaKeyboard`: activated without a pointer, so focus should stay in the panel. */
  apply(id: string, alternative: number, viaKeyboard: boolean): void;
  ignore(id: string): void;
  ignoreMatching(id: string): void;
  resetIgnores(): void;
  disableRule?(id: string): void;
  addToDictionary(id: string): void;
  fixAll(viaKeyboard: boolean): void;
  toggleCategory(category: ReviewCategory, shown: boolean): void;
  navigate(step: 1 | -1): void;
  // Local AI (see src/core/application/review/reviewAi.ts)
  setMode(mode: ReviewMode): void;
  toggleAiPause(): void;
  /** Opens the extension's Local AI setup page (explicit consent happens there). */
  aiSetup(): void;
  aiDismissSetup(): void;
  setRewriteStyle(style: RewriteStyle): void;
  setRewriteContext(hint: EditorContextHint): void;
  generateRewrite(): void;
  cancelRewrite(): void;
  applyRewrite(viaKeyboard: boolean): void;
  previewAiBatch(): void;
  applyAiBatch(viaKeyboard: boolean): void;
  cancelAiBatch(): void;
}

export interface ReviewMark {
  id: string;
  category: ReviewCategory;
  selected: boolean;
  rects: DOMRect[];
}

type Box = Pick<DOMRect, "left" | "top" | "right" | "bottom">;

function overlapArea(a: Box, b: Box): number {
  return (
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  );
}

const BADGES: Record<ReviewCategory, string> = {
  spelling: "abc",
  grammar: "G",
  punctuation: ",.",
  typography: "Aa",
  style: "S",
};
const CATEGORY_KEY: Record<ReviewCategory, ReviewTextKey> = {
  spelling: "review_cat_spelling",
  grammar: "review_cat_grammar",
  punctuation: "review_cat_punctuation",
  typography: "review_cat_typography",
  style: "review_cat_style",
};

const MODES: readonly ReviewMode[] = ["correct", "rewrite"];
const MODE_KEY: Record<ReviewMode, ReviewTextKey> = {
  correct: "review_mode_correct",
  rewrite: "review_mode_rewrite",
};
const STYLE_KEY: Record<RewriteStyle, ReviewTextKey> = {
  "keep-voice": "review_style_keep_voice",
  professional: "review_style_professional",
  friendly: "review_style_friendly",
  concise: "review_style_concise",
  clearer: "review_style_clearer",
  "context-aware": "review_style_context_aware",
};
const CONTEXTS: readonly EditorContextHint[] = ["general", "chat", "email"];
const CONTEXT_KEY: Record<EditorContextHint, ReviewTextKey> = {
  general: "review_context_general",
  chat: "review_context_chat",
  email: "review_context_email",
};
const REJECTION_KEY: Record<AiRejectionReason, ReviewTextKey> = {
  number: "review_reject_number",
  name: "review_reject_name",
  negation: "review_reject_negation",
  uncertainty: "review_reject_uncertainty",
  quoted: "review_reject_quoted",
  protected: "review_reject_protected",
  placeholder: "review_reject_protected",
  "technical-token": "review_reject_protected",
  drift: "review_reject_too_much",
  "drift.changed_word_share": "review_reject_too_much",
  "drift.lexical_substitution": "review_reject_too_much",
  "drift.optional_style": "review_reject_too_much",
  invented: "review_reject_invented",
  length: "review_reject_too_much",
  "unit.too_many_changed_words": "review_reject_too_much",
  shape: "review_reject_incomplete",
  "unsafe-boundary": "review_reject_incomplete",
  unchanged: "review_reject_unchanged",
};

function isLocalAi(diagnostic: ReviewDiagnostic): boolean {
  return diagnostic.ruleId === REVIEW_LOCAL_AI_CHECK;
}

/** A number in the UI language ("pr" is how the options page stores Portuguese). */
function formatNumber(value: number, lang: string, options: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(lang === "pr" ? "pt" : lang, options).format(value);
  } catch {
    return new Intl.NumberFormat("en", options).format(value);
  }
}

/** "0.97 GB" or "40 MB". */
function formatDownloadSize(bytes: number, lang: string): string {
  const giga = bytes >= 1e8;
  return formatNumber(giga ? bytes / 1e9 : Math.max(1, Math.round(bytes / 1e6)), lang, {
    style: "unit",
    unit: giga ? "gigabyte" : "megabyte",
    maximumFractionDigits: giga ? 2 : 0,
  });
}

/** The changed regions of a rewrite on each side (the session checked the hunks rebuild `after`). */
function rewriteRegions(hunks: RewriteViewState["hunks"]): {
  from: Array<[number, number]>;
  to: Array<[number, number]>;
} {
  const from: Array<[number, number]> = [];
  const to: Array<[number, number]> = [];
  let shift = 0;
  for (const { start, end, replacement } of [...hunks].sort((a, b) => a.start - b.start)) {
    from.push([start, end]);
    to.push([start + shift, start + shift + replacement.length]);
    shift += replacement.length - (end - start);
  }
  return { from, to };
}

/** Text with `regions` wrapped in `tag` (<del>/<ins>), built from text nodes only. */
function appendRegions(
  doc: Document,
  parent: HTMLElement,
  text: string,
  regions: Array<[number, number]>,
  tag: "del" | "ins",
): void {
  let cursor = 0;
  for (const [start, end] of regions) {
    if (end <= start) continue;
    parent.append(doc.createTextNode(text.slice(cursor, start)));
    const node = doc.createElement(tag);
    node.textContent = text.slice(start, end);
    parent.append(node);
    cursor = end;
  }
  parent.append(doc.createTextNode(text.slice(cursor)));
}

/** Makes spaces visible in a short change preview ("word ," -> "word\u2423,"). */
function visibleWhitespace(text: string): string {
  return text
    .replace(/ /g, "\u2423")
    .replace(/\u00A0/g, "\u237D")
    .replace(/\n/g, "\u21B5");
}

/** The common prefix and suffix, and whether whitespace itself is what changes. */
function changeShape(from: string, to: string) {
  const { prefix, suffix } = commonAffixes(from, to);
  const changed = from.slice(prefix, from.length - suffix) + to.slice(prefix, to.length - suffix);
  return { prefix, suffix, whitespace: /\s/.test(changed) };
}

/** Whitespace is shown as symbols only when whitespace itself is what changes. */
function changePreview(from: string, to: string): [string, string] {
  return changeShape(from, to).whitespace
    ? [visibleWhitespace(from), visibleWhitespace(to)]
    : [from, to];
}

/** How many suggestions a pick-one finding shows in the list; the card shows all. */
const LIST_CHOICES = 3;

/** "teh → the"; a pick-one finding lists its first suggestions: "wa → was / way / war". */
function listPreview(diagnostic: ReviewDiagnostic, warningLabel: string): string {
  if (diagnostic.warningOnly) return `${warningLabel}: ${diagnostic.original}`;
  if (diagnostic.requiresChoice) {
    const choices = diagnostic.alternatives.map((alternative) => alternative.preview);
    const shown = choices.slice(0, LIST_CHOICES).join(" / ");
    return `${diagnostic.original} \u2192 ${shown}${choices.length > LIST_CHOICES ? " / \u2026" : ""}`;
  }
  const [from, to] = changePreview(diagnostic.original, diagnostic.alternatives[0].preview);
  return `${from} \u2192 ${to}`;
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attributes: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Line icons for icon buttons, drawn as SVG paths (stroke follows the button's color). */
const ICONS = {
  close: ["M6 6l12 12", "M18 6 6 18"],
  up: ["m6 15 6-6 6 6"],
  down: ["m6 9 6 6 6-6"],
} as const;

function iconButton(
  doc: Document,
  icon: keyof typeof ICONS,
  label: string,
  attributes: Record<string, string> = {},
): HTMLButtonElement {
  const button = element(doc, "button", {
    type: "button",
    class: "icon",
    "aria-label": label,
    title: label,
    ...attributes,
  });
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICONS[icon]) {
    const path = doc.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  button.append(svg);
  return button;
}

/** Text with its changed middle wrapped in <mark>, built from text nodes only. */
function appendDiff(
  doc: Document,
  parent: HTMLElement,
  from: string,
  to: string,
  side: "from" | "to",
) {
  const { prefix, suffix, whitespace } = changeShape(from, to);
  const text = side === "from" ? from : to;
  const changed = text.slice(prefix, text.length - suffix);
  const show = whitespace ? visibleWhitespace : (value: string) => value;
  parent.append(doc.createTextNode(show(text.slice(0, prefix))));
  if (changed) parent.append(element(doc, "mark", {}, show(changed)));
  parent.append(doc.createTextNode(show(text.slice(text.length - suffix))));
}

/**
 * Review panel, correction card and overlay marks in ONE FluentTyper shadow
 * root. Uses the top layer (popover) when available so page clipping and
 * stacking contexts cannot hide it. Renders state; owns no review logic.
 */
export class ReviewUi {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  private readonly doc: Document;
  private readonly panel: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly scopeLabel: HTMLElement;
  private readonly status: HTMLElement;
  private readonly notes: HTMLElement;
  private readonly filters: HTMLElement;
  private readonly list: HTMLOListElement;
  /** The panel's scrolling middle: findings, AI offer and notes. */
  private readonly body: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly fixAll: HTMLButtonElement;
  private readonly resetIgnores: HTMLButtonElement;
  private readonly fixNote: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly footer: HTMLElement;
  // Local AI: mode switch, status line and setup offer, batch preview, rewrite view.
  private readonly modes: HTMLElement;
  private readonly modeButtons = new Map<ReviewMode, HTMLButtonElement>();
  private readonly ai: HTMLElement;
  private readonly aiLine: HTMLElement;
  private readonly aiPause: HTMLButtonElement;
  private readonly aiSettings: HTMLButtonElement;
  private readonly setup: HTMLElement;
  private readonly setupSize: HTMLElement;
  private readonly aiBatchButton: HTMLButtonElement;
  private readonly batch: HTMLElement;
  /** What the batch preview and rewrite diff were last built for (content, not identity). */
  private batchKey: string | null = null;
  private readonly rewrite: {
    root: HTMLElement;
    style: HTMLSelectElement;
    contextRow: HTMLElement;
    context: HTMLSelectElement;
    using: HTMLElement;
    generate: HTMLButtonElement;
    cancel: HTMLButtonElement;
    message: HTMLElement;
    diff: HTMLElement;
    apply: HTMLButtonElement;
    copy: HTMLButtonElement;
    copied: HTMLElement;
    previewOnly: HTMLElement;
  };
  private diffKey: string | null = null;
  /** Restrained announcements: an AI pass ending, a rewrite becoming ready/rejected/failed. */
  private readonly announcer: HTMLElement;
  private announcedCoverage: string | null = null;
  private announcedRewrite: string | null = null;
  private readonly card: HTMLElement;
  private readonly marks: HTMLElement;
  private readonly clip: HTMLElement;
  private state: ReviewViewState | null = null;
  private cardId: string | null = null;
  private cardAlternative = 0;
  /** Whether the open card's More actions are shown. */
  private cardMoreOpen = false;
  private cardAnchor: DOMRect | null = null;
  /** The open card's finding, kept while a recheck runs on unchanged text. */
  private cardMemory: { ruleId: string; start: number; end: number; text: string } | null = null;

  // List items by finding id, for the findings last listed.
  private readonly items = new Map<string, HTMLElement>();
  private listedDiagnostics: readonly ReviewDiagnostic[] | null = null;
  // The state the notes were last rendered for.
  private notesState: ReviewViewState | null = null;

  constructor(
    doc: Document,
    private readonly lang: string,
    private readonly callbacks: ReviewUiCallbacks,
    /** Honest capability notes (no highlights, review only, undo behavior). */
    private capabilityKeys: readonly ReviewTextKey[],
    /** Where the host goes: inside a modal dialog, anything outside it is inert. */
    mount: Element | null = null,
  ) {
    this.doc = doc;
    const overlay = createOverlayHost(doc, "data-fluenttyper-review", 2147483647);
    this.host = overlay.host;
    this.root = overlay.root;
    const style = element(doc, "style", {}, REVIEW_SHADOW_CSS);
    this.marks = element(doc, "div", { class: "layer", "aria-hidden": "true" });
    this.clip = element(doc, "div", { class: "clip" });
    this.marks.append(this.clip);

    this.panel = element(doc, "section", {
      class: "panel",
      role: "dialog",
      "aria-modal": "false",
      "aria-labelledby": "ft-review-title",
      // The UI languages are all left-to-right; snippets of the user's text
      // carry dir="auto" themselves.
      dir: "ltr",
    });
    const header = element(doc, "header");
    this.heading = element(
      doc,
      "h2",
      { id: "ft-review-title", tabindex: "-1" },
      this.t("review_title"),
    );
    this.scopeLabel = element(doc, "span", { class: "scope" });
    const close = iconButton(doc, "close", this.t("review_close"), { "data-action": "close" });
    // Previous and next finding sit with the title, like a document's find bar.
    const nav = (this.nav = element(doc, "div", { class: "nav" }));
    this.prev = iconButton(doc, "up", this.t("review_prev"), { "data-action": "prev" });
    this.next = iconButton(doc, "down", this.t("review_next"), { "data-action": "next" });
    nav.append(this.prev, this.next);
    header.append(
      this.heading,
      this.scopeLabel,
      element(doc, "span", { class: "spacer" }),
      nav,
      close,
    );
    const language = element(doc, "select", {
      "aria-label": this.t("review_language_label"),
      "data-action": "language",
    });
    for (const [value, label] of Object.entries({
      ...SUPPORTED_LANGUAGES,
      en_GB: "English (UK)",
      en_AU: "English (Australia)",
      en_CA: "English (Canada)",
    })) {
      if (value === "textExpander") continue;
      language.append(element(doc, "option", { value }, label));
    }
    language.addEventListener("change", (event) => {
      if (event.isTrusted) this.callbacks.setLanguage?.(language.value);
    });
    const retry = element(
      doc,
      "button",
      { type: "button", "data-action": "retry" },
      this.t("review_retry"),
    );
    retry.addEventListener("click", (event) => {
      if (event.isTrusted) this.callbacks.retry?.();
    });
    const languageControls = element(doc, "div", { class: "language-controls" });
    languageControls.append(language, retry);
    this.modes = element(doc, "div", {
      class: "modes",
      role: "group",
      "aria-label": this.t("review_mode_label"),
      hidden: "",
    });
    for (const mode of MODES) {
      const button = element(
        doc,
        "button",
        { type: "button", "data-action": `mode-${mode}`, "aria-pressed": "false" },
        this.t(MODE_KEY[mode]),
      );
      button.addEventListener("click", () => {
        if (this.state?.mode !== mode) this.callbacks.setMode(mode);
      });
      this.modeButtons.set(mode, button);
      this.modes.append(button);
    }
    this.status = element(doc, "p", { class: "status", role: "status", "aria-live": "polite" });
    this.announcer = element(doc, "p", { class: "sr-only", role: "status", "aria-live": "polite" });
    this.ai = element(doc, "div", { class: "ai", hidden: "" });
    const aiRow = element(doc, "div", { class: "ai-row" });
    this.aiLine = element(doc, "p", { class: "ai-line" });
    this.aiPause = element(doc, "button", { type: "button", "data-action": "ai-pause" });
    this.aiPause.addEventListener("click", () => this.callbacks.toggleAiPause());
    this.aiSettings = element(
      doc,
      "button",
      { type: "button", "data-action": "ai-settings" },
      this.t("review_ai_open_settings"),
    );
    // Opening setup is the start of a consent flow: only the user's own click counts.
    this.aiSettings.addEventListener("click", (event) => {
      if (event.isTrusted) this.callbacks.aiSetup();
    });
    aiRow.append(this.aiLine, this.aiPause, this.aiSettings);
    this.setup = element(doc, "div", {
      class: "setup",
      role: "group",
      "aria-labelledby": "ft-review-ai-setup",
    });
    this.setupSize = element(doc, "p", { class: "setup-size" });
    const setupStart = element(
      doc,
      "button",
      { type: "button", class: "primary", "data-action": "ai-setup" },
      this.t("review_ai_setup_start"),
    );
    setupStart.addEventListener("click", (event) => {
      if (event.isTrusted) this.callbacks.aiSetup();
    });
    const setupLater = element(
      doc,
      "button",
      { type: "button", "data-action": "ai-setup-later" },
      this.t("review_ai_setup_later"),
    );
    setupLater.addEventListener("click", (event) => {
      if (event.isTrusted) this.callbacks.aiDismissSetup();
    });
    const setupActions = element(doc, "div", { class: "actions" });
    setupActions.append(setupStart, setupLater);
    this.setup.append(
      element(
        doc,
        "p",
        { class: "setup-title", id: "ft-review-ai-setup" },
        this.t("review_ai_setup_title"),
      ),
      element(doc, "p", {}, this.t("review_ai_setup_body")),
      this.setupSize,
      setupActions,
    );
    this.ai.append(aiRow, this.setup);
    this.rewrite = this.buildRewrite();
    this.notes = element(doc, "div", { class: "notes" });
    this.filters = element(doc, "div", {
      class: "filters",
      role: "group",
      "aria-label": this.t("review_filters"),
    });
    this.list = element(doc, "ol", { class: "list", "aria-label": this.t("review_list_label") });
    this.batch = element(doc, "section", {
      class: "batch",
      "aria-labelledby": "ft-review-batch-title",
      hidden: "",
    });
    const footer = (this.footer = element(doc, "footer"));
    this.fixAll = element(doc, "button", {
      type: "button",
      class: "primary",
      "data-action": "fix-all",
    });
    this.fixNote = element(doc, "p", { class: "fix-note", id: "ft-review-fix-note" });
    this.fixAll.setAttribute("aria-describedby", "ft-review-fix-note");
    // Never part of Fix all safe: AI findings get their own preview first.
    this.aiBatchButton = element(doc, "button", {
      type: "button",
      "data-action": "ai-batch",
      hidden: "",
    });
    this.aiBatchButton.addEventListener("click", () => this.callbacks.previewAiBatch());
    this.resetIgnores = element(
      doc,
      "button",
      { type: "button", class: "link", "data-action": "reset-ignores", hidden: "" },
      this.t("review_reset_ignores"),
    );
    this.resetIgnores.addEventListener("click", () => this.callbacks.resetIgnores());
    footer.append(this.fixAll, this.fixNote, this.aiBatchButton, this.resetIgnores);
    // The findings come first; the Local AI offer and coverage notes follow
    // them. They scroll together between the fixed top and the footer, so
    // nothing scrolled into view can end up under Fix all.
    this.body = element(doc, "div", { class: "body" });
    this.body.append(this.list, this.batch, this.ai, this.notes);
    this.panel.append(
      header,
      languageControls,
      this.modes,
      this.status,
      this.announcer,
      this.rewrite.root,
      this.filters,
      this.body,
      footer,
    );

    this.card = element(doc, "div", {
      class: "card",
      role: "dialog",
      hidden: "",
      tabindex: "-1",
      dir: "ltr",
    });
    this.root.append(style, this.marks, this.panel, this.card);

    close.addEventListener("click", () => this.callbacks.close());
    this.prev.addEventListener("click", () => this.callbacks.navigate(-1));
    this.next.addEventListener("click", () => this.callbacks.navigate(1));
    this.fixAll.addEventListener("click", (event) => this.callbacks.fixAll(event.detail === 0));
    this.root.addEventListener("keydown", (event) => this.onKeyDown(event as KeyboardEvent));

    (mount ?? doc.documentElement ?? doc.body).appendChild(this.host);
    enterTopLayer(this.host);
  }

  private t(key: ReviewTextKey, params?: Record<string, string | number>): string {
    return reviewText(key, this.lang, params);
  }

  /** The Rewrite view's controls; they persist so an open select or focus survives renders. */
  private buildRewrite(): ReviewUi["rewrite"] {
    const doc = this.doc;
    const root = element(doc, "div", { class: "rewrite", hidden: "" });
    const styleLabel = element(doc, "label", {}, this.t("review_rewrite_style"));
    const style = element(doc, "select", { "data-action": "rewrite-style" });
    for (const value of REWRITE_STYLES) {
      style.append(element(doc, "option", { value }, this.t(STYLE_KEY[value])));
    }
    // Choosing a style never generates: Generate is always a separate step.
    style.addEventListener("change", () =>
      this.callbacks.setRewriteStyle(style.value as RewriteStyle),
    );
    styleLabel.append(style);
    const contextRow = element(doc, "label", {}, this.t("review_rewrite_context"));
    const context = element(doc, "select", { "data-action": "rewrite-context" });
    for (const value of CONTEXTS) {
      context.append(element(doc, "option", { value }, this.t(CONTEXT_KEY[value])));
    }
    context.addEventListener("change", () =>
      this.callbacks.setRewriteContext(context.value as EditorContextHint),
    );
    contextRow.append(context);
    const using = element(doc, "p", { class: "using" });
    const generate = element(doc, "button", {
      type: "button",
      class: "primary",
      "data-action": "rewrite-generate",
    });
    generate.addEventListener("click", () => this.callbacks.generateRewrite());
    const cancel = element(
      doc,
      "button",
      { type: "button", "data-action": "rewrite-cancel" },
      this.t("review_cancel"),
    );
    cancel.addEventListener("click", () => this.callbacks.cancelRewrite());
    const run = element(doc, "div", { class: "actions" });
    run.append(generate, cancel);
    const message = element(doc, "p", { class: "rewrite-msg" });
    const diff = element(doc, "div", {
      class: "rewrite-diff",
      role: "group",
      "aria-label": this.t("review_rewrite_changes"),
    });
    const apply = element(
      doc,
      "button",
      { type: "button", class: "primary", "data-action": "rewrite-apply" },
      this.t("review_rewrite_apply"),
    );
    apply.addEventListener("click", (event) => this.callbacks.applyRewrite(event.detail === 0));
    const copy = element(
      doc,
      "button",
      { type: "button", "data-action": "rewrite-copy" },
      this.t("review_rewrite_copy"),
    );
    const copied = element(doc, "span", { class: "copied", role: "status" });
    // Only ever on the user's own click; never automatically.
    copy.addEventListener("click", (event) => {
      const text = this.state?.rewrite?.after;
      if (!event.isTrusted || !this.state?.rewrite?.previewOnly || !text) return;
      const clipboard = this.doc.defaultView?.navigator.clipboard;
      const done = (ok: boolean) => {
        copied.textContent = this.t(ok ? "review_rewrite_copied" : "review_rewrite_copy_failed");
      };
      if (!clipboard) done(false);
      else
        clipboard.writeText(text).then(
          () => done(true),
          () => done(false),
        );
    });
    const accept = element(doc, "div", { class: "actions" });
    accept.append(apply, copy, copied);
    const previewOnly = element(doc, "p", { class: "hint" }, this.t("review_rewrite_preview_only"));
    root.append(styleLabel, contextRow, using, run, message, diff, accept, previewOnly);
    return {
      root,
      style,
      contextRow,
      context,
      using,
      generate,
      cancel,
      message,
      diff,
      apply,
      copy,
      copied,
      previewOnly,
    };
  }

  /**
   * Puts the panel in the viewport corner that covers the least of the editor
   * and, above all, never covers `focus` (the current finding) when a corner
   * avoids it.
   */
  placeAwayFrom(rect: DOMRect | null, focus: DOMRect | null = null): void {
    const view = this.doc.defaultView;
    if (!rect || !view) return;
    const width = this.panel.offsetWidth || Math.min(340, view.innerWidth - 24);
    const height = this.panel.offsetHeight || Math.min(view.innerHeight * 0.7, 560);
    const corners = [
      ["bottom-right", view.innerWidth - 12 - width, view.innerHeight - 12 - height],
      ["bottom-left", 12, view.innerHeight - 12 - height],
      ["top-right", view.innerWidth - 12 - width, 12],
      ["top-left", 12, 12],
    ] as const;
    const score = ([, left, top]: (typeof corners)[number]) =>
      overlapArea({ left, top, right: left + width, bottom: top + height }, rect) +
      (focus
        ? 1000 * overlapArea({ left, top, right: left + width, bottom: top + height }, focus)
        : 0);
    const best = corners.reduce((a, b) => (score(b) < score(a) ? b : a));
    this.panel.dataset.corner = best[0];
  }

  /** True when the panel sits over `rect`. */
  panelCovers(rect: DOMRect): boolean {
    return !this.panel.hidden && overlapArea(this.panel.getBoundingClientRect(), rect) > 0;
  }

  /** A message-only panel: why nothing could be reviewed. */
  showMessage(text: string): void {
    for (const part of [
      this.scopeLabel,
      this.modes,
      this.ai,
      this.rewrite.root,
      this.batch,
      this.notes,
      this.filters,
      this.list,
      this.prev,
      this.next,
      this.aiBatchButton,
    ]) {
      part.hidden = true;
    }
    this.fixAll.hidden = true;
    this.fixNote.hidden = true;
    this.status.textContent = text;
  }

  focusPanel(): void {
    this.heading.focus({ preventScroll: true });
  }

  focusItem(id: string): void {
    const item = this.itemFor(id);
    item?.focus({ preventScroll: false });
  }

  isCardOpen(): boolean {
    return this.cardId !== null;
  }

  /** True when the event came from FluentTyper's own review UI. */
  owns(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }

  render(state: ReviewViewState): void {
    const previousFocus = this.root.activeElement as HTMLElement | null;
    const focusedId = previousFocus?.dataset?.id ?? null;
    // A panel control other than a finding (those are refocused by id below).
    const panelFocus =
      previousFocus && !focusedId && this.panel.contains(previousFocus) ? previousFocus : null;
    this.state = state;
    const rewriting = state.mode === "rewrite";
    // Rewrite replaces the findings view; a finding's card has nothing to act on there.
    if (rewriting && this.cardId) this.closeCard();
    for (const part of [this.notes, this.filters, this.nav, this.list, this.footer]) {
      part.hidden = rewriting;
    }
    // Rewrite has its own message line; the review status still says why nothing works.
    this.status.hidden = rewriting && state.status === "ready";
    this.renderModes(state);
    this.renderAi(state);
    this.renderRewrite(state);
    this.renderBatch(state);
    this.scopeLabel.textContent = this.t(
      state.scopeKind === "selection"
        ? "review_scope_selection"
        : state.unread > 0
          ? "review_scope_window"
          : "review_scope_field",
    );
    // The whole field is the default: only a narrower scope earns a label.
    this.scopeLabel.hidden = state.scopeKind !== "selection" && state.unread === 0;
    this.status.textContent = this.statusText(state);
    // Whether suggestions for unknown words may still join the results.
    this.panel.dataset.checking = state.checking;
    const languageSelect = this.panel.querySelector<HTMLSelectElement>('[data-action="language"]');
    if (languageSelect) {
      languageSelect.value =
        state.language.source === "explicit" ? state.language.language : "auto_detect";
      languageSelect.disabled = state.status === "applying";
    }
    const retry = this.panel.querySelector<HTMLButtonElement>('[data-action="retry"]');
    if (retry) retry.disabled = state.status === "applying";
    this.panel.dataset.spelling = state.status === "ready" ? state.spelling : "idle";
    this.notesState = state;
    this.renderNotes(state);
    this.renderFilters(state);
    this.renderList(state);
    const nav = state.diagnostics.length > 1;
    this.prev.disabled = !nav;
    this.next.disabled = !nav;
    const bulkAvailable = state.capabilities.bulk && state.status === "ready";
    this.fixAll.hidden = !state.capabilities.bulk;
    // While the plan is still being proven the count is not known yet.
    this.fixAll.textContent = this.t("review_fix_all", {
      count: state.bulk.pending ? "\u2026" : state.bulk.count,
    });
    this.fixAll.disabled = !bulkAvailable || state.bulk.pending || state.bulk.count === 0;
    this.resetIgnores.hidden = state.ignoredCount + (state.ignoredAdviceCount ?? 0) === 0;
    this.resetIgnores.disabled = state.status !== "ready";
    const filtered = state.categories.size < REVIEW_CATEGORIES.length;
    // Nothing left to act on with every category shown: the review is done.
    const done =
      !rewriting &&
      state.status === "ready" &&
      state.checking === "checked" &&
      !state.noRules &&
      !filtered &&
      state.diagnostics.length === 0;
    // Finishing starts the body at its top: the outcome and what follows it.
    if (done && !this.panel.hasAttribute("data-done")) this.body.scrollTop = 0;
    this.panel.toggleAttribute("data-done", done);
    const noteParts = [this.t(filtered ? "review_fix_all_filtered" : "review_fix_all_whole")];
    if (state.bulk.deferred > 0) {
      noteParts.push(this.t("review_fix_all_deferred", { count: state.bulk.deferred }));
    }
    this.fixNote.textContent = state.capabilities.bulk ? noteParts.join(" ") : "";
    // The default (every category) stays the button's description, unseen.
    this.fixNote.classList.toggle("sr-only", !filtered && state.bulk.deferred === 0);
    const aiFindings = state.diagnostics.filter(isLocalAi).length;
    this.aiBatchButton.hidden = !(
      state.capabilities.apply &&
      state.capabilities.bulk &&
      aiFindings >= 2
    );
    this.aiBatchButton.textContent = this.t("review_ai_batch", { count: aiFindings });
    this.aiBatchButton.disabled = state.status !== "ready" || state.aiBatch !== null;
    if (focusedId) this.itemFor(focusedId)?.focus({ preventScroll: true });
    // A control that just went away (Generate while generating, a closed preview)
    // must not drop the keyboard focus out of the panel.
    const active = this.root.activeElement as HTMLElement | null;
    if (panelFocus && (!active || !active.isConnected || active.closest("[hidden]"))) {
      const fallback = rewriting
        ? [this.rewrite.cancel, this.rewrite.generate, this.rewrite.style]
        : [this.aiBatchButton, this.fixAll];
      (fallback.find((control) => this.canFocus(control)) ?? this.heading).focus({
        preventScroll: true,
      });
    }

    if (this.cardId) {
      const diagnostic = state.diagnostics.find((d) => d.id === this.cardId);
      if (diagnostic && state.status === "ready") {
        this.renderCard(diagnostic);
      } else if (state.status === "updating" || state.status === "loading") {
        // Stale while rechecking: never actionable, but may come back unchanged.
        this.card.hidden = true;
      } else {
        const memory = this.cardMemory;
        const again =
          memory && state.status === "ready" && state.text === memory.text
            ? state.diagnostics.find(
                (d) =>
                  d.ruleId === memory.ruleId &&
                  d.range.start === memory.start &&
                  d.range.end === memory.end,
              )
            : undefined;
        this.closeCard();
        // Same finding on the same text after a recheck: reopen it.
        if (again) {
          queueMicrotask(() =>
            this.callbacks.select(again.id, { openCard: true, focusList: false }),
          );
        }
      }
    }
  }

  private canFocus(control: HTMLElement): boolean {
    return (
      control.isConnected &&
      !control.closest("[hidden]") &&
      !(control as HTMLButtonElement | HTMLSelectElement).disabled
    );
  }

  private announce(text: string): void {
    this.announcer.textContent = "";
    this.announcer.textContent = text;
  }

  private renderModes(state: ReviewViewState): void {
    const { availability } = state.ai;
    this.modes.hidden =
      state.mode !== "rewrite" &&
      (availability === "off" ||
        availability === "unsupported" ||
        availability === "failed" ||
        availability === "language");
    for (const [mode, button] of this.modeButtons) {
      button.setAttribute("aria-pressed", String(state.mode === mode));
    }
  }

  /** The one Local AI line for this review (null: nothing worth saying). */
  private aiLineText(state: ReviewViewState): string | null {
    const { ai } = state;
    const rewriting = state.mode === "rewrite";
    switch (ai.availability) {
      case "off":
        return rewriting ? this.t("review_ai_off") : null;
      case "unsupported":
        return this.t("review_ai_unsupported");
      case "failed":
        return this.t("review_ai_failed");
      case "language":
        return this.t("review_ai_language");
      case "setup-needed":
        return rewriting && !ai.offerSetup ? this.t("review_ai_rewrite_setup") : null;
      case "install-needed":
        return this.t("review_ai_install_needed");
      case "installing":
        return ai.status?.progress !== undefined
          ? this.t("review_ai_installing_progress", {
              percent: formatNumber(ai.status.progress, this.lang, {
                style: "percent",
                maximumFractionDigits: 0,
              }),
            })
          : this.t("review_ai_installing");
      case "paused":
        return rewriting ? null : this.t("review_ai_paused");
      case "ready":
        break;
    }
    if (rewriting) return null;
    switch (ai.coverage) {
      case "idle":
        return null;
      case "waiting":
        return this.t("review_ai_waiting");
      case "loading":
        return this.t("review_ai_loading");
      case "checking":
        return ai.progress === undefined
          ? this.t("review_ai_checking")
          : `${this.t("review_ai_checking")} ${formatNumber(ai.progress, this.lang, {
              style: "percent",
              maximumFractionDigits: 0,
            })}`;
      case "complete":
        return this.t("review_ai_complete");
      case "partial":
        return ai.skippedChars > 0
          ? this.t("review_ai_partial_skipped", { count: ai.skippedChars })
          : this.t("review_ai_partial");
      case "failed":
        return this.t("review_ai_failed");
      case "cancelled":
        return this.t("review_ai_stopped");
    }
  }

  private renderAi(state: ReviewViewState): void {
    const { ai } = state;
    const rewriting = state.mode === "rewrite";
    const line = this.aiLineText(state);
    const offer = ai.offerSetup && ai.availability === "setup-needed";
    const pause = !rewriting && (ai.availability === "ready" || ai.availability === "paused");
    const settings =
      ai.availability === "install-needed" ||
      (rewriting &&
        (ai.availability === "off" || (ai.availability === "setup-needed" && !ai.offerSetup)));
    this.aiLine.textContent = line ?? "";
    this.aiLine.hidden = line === null;
    this.aiPause.hidden = !pause;
    this.aiPause.textContent = this.t(
      ai.availability === "paused" ? "review_ai_resume" : "review_ai_pause",
    );
    this.aiSettings.hidden = !settings;
    this.setup.hidden = !offer;
    const bytes = ai.status?.downloadBytes ?? 0;
    this.setupSize.hidden = bytes <= 0;
    this.setupSize.textContent =
      bytes > 0
        ? this.t("review_ai_setup_size", { size: formatDownloadSize(bytes, this.lang) })
        : "";
    this.ai.hidden = line === null && !offer && !pause && !settings;
    // Announce only an AI pass ending, once per change.
    const ended =
      !rewriting && ["complete", "partial", "failed"].includes(ai.coverage) ? ai.coverage : null;
    if (ended && ended !== this.announcedCoverage && line) this.announce(line);
    this.announcedCoverage = ended;
  }

  private rewriteMessage(rewrite: RewriteViewState): string {
    switch (rewrite.status) {
      case "idle":
        return this.t("review_rewrite_idle");
      case "generating":
        return this.t("review_rewrite_generating");
      case "ready": {
        const kept = Object.values(rewrite.kept).reduce((sum, count) => sum + (count ?? 0), 0);
        return kept > 0
          ? `${this.t("review_rewrite_ready")} ${this.t("review_rewrite_kept", { count: kept })}`
          : this.t("review_rewrite_ready");
      }
      case "rejected":
        return this.t(REJECTION_KEY[rewrite.rejection ?? "shape"]);
      case "failed":
        return this.t("review_rewrite_failed");
      case "stale":
        return this.t("review_rewrite_stale");
      case "too-long":
        return this.t("review_rewrite_too_long");
      case "applying":
        return this.t("review_status_applying");
    }
  }

  private renderRewrite(state: ReviewViewState): void {
    const view = this.rewrite;
    const rewrite = state.rewrite;
    view.root.hidden = !rewrite;
    if (!rewrite) {
      this.announcedRewrite = null;
      return;
    }
    if (view.style.value !== rewrite.style) view.style.value = rewrite.style;
    if (view.context.value !== rewrite.contextHint) view.context.value = rewrite.contextHint;
    const contextAware = rewrite.style === "context-aware";
    view.contextRow.hidden = !contextAware;
    view.using.hidden = !contextAware;
    view.using.textContent = this.t("review_rewrite_using", {
      style: this.t(STYLE_KEY[rewrite.resolvedStyle]),
    });
    const busy = rewrite.status === "generating" || rewrite.status === "applying";
    const usable = state.ai.availability === "ready" || state.ai.availability === "paused";
    view.generate.hidden = busy;
    view.generate.textContent = this.t(
      rewrite.status === "ready" ? "review_rewrite_regenerate" : "review_rewrite_generate",
    );
    view.generate.disabled = !usable || state.status !== "ready" || rewrite.status === "too-long";
    view.cancel.hidden = rewrite.status !== "generating";
    view.message.textContent = this.rewriteMessage(rewrite);

    const after = rewrite.after;
    view.diff.hidden = after === null;
    const diffKey = after === null ? null : `${rewrite.before}\u0000${after}`;
    if (after !== null && diffKey !== this.diffKey) this.renderRewriteDiff(rewrite, after);
    this.diffKey = diffKey;
    view.apply.hidden = after === null || rewrite.previewOnly;
    view.apply.disabled = !rewrite.canApply || state.status !== "ready";
    view.copy.hidden = !(rewrite.previewOnly && after !== null && rewrite.status === "ready");
    view.copied.hidden = view.copy.hidden;
    view.previewOnly.hidden = !rewrite.previewOnly;

    const ended = ["ready", "rejected", "failed"].includes(rewrite.status) ? rewrite.status : null;
    if (ended && ended !== this.announcedRewrite) this.announce(view.message.textContent);
    this.announcedRewrite = ended;
  }

  /** Before and after, changed regions marked; model text only ever as text nodes. */
  private renderRewriteDiff(rewrite: RewriteViewState, after: string): void {
    const doc = this.doc;
    const regions = rewriteRegions(rewrite.hunks);
    const from = element(doc, "p", { class: "before", dir: "auto" });
    const to = element(doc, "p", { class: "after", dir: "auto" });
    appendRegions(doc, from, rewrite.before, regions.from, "del");
    appendRegions(doc, to, after, regions.to, "ins");
    this.rewrite.diff.replaceChildren(
      element(doc, "p", { class: "label" }, this.t("review_rewrite_before")),
      from,
      element(doc, "p", { class: "label" }, this.t("review_rewrite_after")),
      to,
    );
    this.rewrite.copied.textContent = "";
  }

  private renderBatch(state: ReviewViewState): void {
    const preview = state.mode === "correct" ? state.aiBatch : null;
    this.batch.hidden = preview === null;
    const key = preview
      ? `${preview.diagnosticIds.join(" ")}|${preview.excluded}|${preview.canApply}`
      : null;
    const opened = this.batchKey === null;
    if (key === this.batchKey) {
      const button = this.batch.querySelector<HTMLButtonElement>("[data-action=ai-batch-apply]");
      if (button && preview) button.disabled = !preview.canApply || state.status !== "ready";
      return;
    }
    this.batchKey = key;
    if (!preview) {
      this.batch.replaceChildren();
      return;
    }
    const doc = this.doc;
    const changes = element(doc, "ol", {});
    for (const id of preview.diagnosticIds) {
      const diagnostic = state.diagnostics.find((d) => d.id === id);
      if (diagnostic)
        changes.append(
          element(doc, "li", { dir: "auto" }, listPreview(diagnostic, this.t("review_warning"))),
        );
    }
    const parts: HTMLElement[] = [
      element(
        doc,
        "p",
        { class: "batch-title", id: "ft-review-batch-title" },
        this.t("review_ai_batch_title"),
      ),
      changes,
    ];
    if (preview.excluded > 0) {
      parts.push(
        element(
          doc,
          "p",
          { class: "hint" },
          this.t("review_ai_batch_excluded", { count: preview.excluded }),
        ),
      );
    }
    if (!preview.canApply) {
      parts.push(element(doc, "p", { class: "hint" }, this.t("review_ai_batch_unsupported")));
    }
    const applyButton = element(
      doc,
      "button",
      { type: "button", class: "primary", "data-action": "ai-batch-apply" },
      this.t("review_ai_batch_apply"),
    );
    applyButton.disabled = !preview.canApply || state.status !== "ready";
    applyButton.addEventListener("click", (event) =>
      this.callbacks.applyAiBatch(event.detail === 0),
    );
    const cancel = element(
      doc,
      "button",
      { type: "button", "data-action": "ai-batch-cancel" },
      this.t("review_cancel"),
    );
    cancel.addEventListener("click", () => this.callbacks.cancelAiBatch());
    const actions = element(doc, "div", { class: "actions" });
    actions.append(applyButton, cancel);
    parts.push(actions);
    this.replaceKeepingFocus(this.batch, parts);
    if (opened) (applyButton.disabled ? cancel : applyButton).focus({ preventScroll: false });
  }

  private statusText(state: ReviewViewState): string {
    switch (state.status) {
      case "loading":
        return this.t("review_status_loading");
      case "updating":
        return this.t("review_status_updating");
      case "applying":
        return this.t("review_status_applying");
      case "stale-scope":
        return this.t("review_status_stale_scope");
      case "error":
        return this.t("review_status_error");
      case "unavailable":
        return this.t(
          state.unavailable === "composing"
            ? "review_status_composing"
            : state.unavailable === "detached"
              ? "review_status_detached"
              : "review_status_ineligible",
        );
      case "closed":
        return "";
      default:
        break;
    }
    if (state.noRules && state.checking === "inactive" && state.diagnostics.length === 0)
      return this.t("review_status_no_rules");
    const notice = this.noticeText(state);
    const advice = state.diagnostics.filter((d) => d.category === "style").length;
    const count = state.diagnostics.length - advice;
    let summary: string;
    if (count > 0) summary = this.t("review_status_count", { count });
    else if (state.ignoredCount > 0) summary = this.t("review_status_all_ignored");
    else if (state.resolvedCount > 0)
      summary = this.t("review_status_all_resolved", { count: state.resolvedCount });
    else summary = this.t("review_status_none");
    if (count === 0 && state.checking !== "checked") {
      summary = this.t(
        state.checking === "checking" ? "review_status_loading" : "review_status_incomplete",
      );
    }
    // "All resolved" already reports the fixes; don't say it twice.
    const redundant =
      state.checking === "checked" &&
      count === 0 &&
      state.ignoredCount === 0 &&
      state.notice?.kind === "applied";
    if (advice > 0) summary += ` ${this.t("review_status_advice", { count: advice })}`;
    return notice && !redundant ? `${notice} ${summary}` : summary;
  }

  private noticeText(state: ReviewViewState): string {
    const notice = state.notice;
    if (!notice) return "";
    switch (notice.kind) {
      case "advice-applied":
        return this.t("review_notice_advice_applied");
      case "applied":
        return this.t("review_notice_applied", { count: notice.count });
      case "stale":
        return this.t("review_notice_stale");
      case "partial":
        return this.t("review_notice_partial", { count: notice.applied });
      case "unverified":
        return this.t("review_notice_unverified");
      case "refused":
        return this.t("review_notice_refused");
      case "dictionary-added":
        return this.t("review_notice_dictionary_added", { word: notice.word });
      case "rule-disabled":
        return this.t("review_notice_rule_disabled");
      case "rule-setting-failed":
        return this.t("review_notice_rule_setting_failed");
      case "dictionary-failed":
        return this.t("review_notice_dictionary_failed");
    }
  }

  /** Replaces the capability notes (what the editor allows can change while reviewing). */
  setCapabilityKeys(keys: readonly ReviewTextKey[]): void {
    if (
      keys.length === this.capabilityKeys.length &&
      keys.every((k, i) => k === this.capabilityKeys[i])
    ) {
      return;
    }
    this.capabilityKeys = keys;
    if (this.notesState) this.renderNotes(this.notesState);
  }

  private renderNotes(state: ReviewViewState): void {
    const lines: string[] = this.capabilityKeys.map((key) => this.t(key));
    if (state.status === "ready") {
      lines.push(
        this.t("review_language_status", {
          language: state.language.language,
          source: this.t(`review_language_${state.language.source}`),
          resource: state.language.resource ?? this.t("review_language_unavailable"),
        }),
      );
      if (state.language.resource && state.language.resource !== state.language.language)
        lines.push(this.t("review_language_dictionary_fallback"));
      if (state.nativeGrammarDisabled) lines.push(this.t("review_status_grammar_off"));
      const skipped = state.coverage?.skipped ?? {};
      const protectedChars = (skipped.code ?? 0) + (skipped.structure ?? 0);
      if (protectedChars > 0)
        lines.push(this.t("review_status_skipped", { count: protectedChars }));
      if (state.truncated > 0)
        lines.push(this.t("review_status_size_limit", { count: state.truncated }));
      if (state.unread > 0) lines.push(this.t("review_status_window", { count: state.unread }));
      if (state.spelling === "checking") lines.push(this.t("review_status_spelling_checking"));
      if (state.spelling === "failed" || state.language.failure)
        lines.push(this.t("review_status_resource_failed"));
      if (state.spelling === "unavailable") {
        lines.push(this.t("review_status_spelling_unavailable"));
      }
      if (state.spelling === "partial") lines.push(this.t("review_status_spelling_partial"));
      if (skipped["language-uncertain"])
        lines.push(
          this.t("review_status_language_uncertain", { count: skipped["language-uncertain"] }),
        );
      if (skipped["other-language"])
        lines.push(this.t("review_status_other_language", { count: skipped["other-language"] }));
      if ((state.coverage?.failedRules.length ?? 0) > 0)
        lines.push(this.t("review_status_rule_error"));
      if (state.languageSkipped > 0) lines.push(this.t("review_status_language"));
      if (state.ignoredCount > 0)
        lines.push(this.t("review_status_ignored", { count: state.ignoredCount }));
    }
    if (state.ignoredAdviceCount)
      lines.push(this.t("review_status_advice_ignored", { count: state.ignoredAdviceCount }));
    this.notes.replaceChildren(...lines.map((line) => element(this.doc, "p", {}, line)));
  }

  private renderFilters(state: ReviewViewState): void {
    const counts = new Map<ReviewCategory, number>();
    for (const diagnostic of state.diagnostics) {
      counts.set(diagnostic.category, (counts.get(diagnostic.category) ?? 0) + 1);
    }
    const focused = (this.root.activeElement as HTMLElement | null)?.dataset?.category;
    this.filters.replaceChildren(
      ...REVIEW_CATEGORIES.filter(
        (category) =>
          category !== "style" ||
          [...(state.coverage?.checkedRules ?? []), ...(state.coverage?.failedRules ?? [])].some(
            (id) => id === "styleRedundancy" || id === "styleLongSentence",
          ) ||
          state.diagnostics.some((d) => d.category === "style"),
      ).map((category) => {
        const shown = state.categories.has(category);
        const name = this.t(CATEGORY_KEY[category]);
        const count = counts.get(category) ?? 0;
        // Badge and count keep the filters on one line; the name is the chip's title and label.
        const button = element(this.doc, "button", {
          type: "button",
          class: "filter",
          "data-category": category,
          "aria-pressed": String(shown),
          "aria-label": shown ? `${name} (${count})` : name,
          title: name,
        });
        button.append(
          element(this.doc, "span", { class: "badge", "aria-hidden": "true" }, BADGES[category]),
        );
        // A hidden category's findings are not counted.
        if (shown)
          button.append(element(this.doc, "span", { "aria-hidden": "true" }, String(count)));
        button.addEventListener("click", () => this.callbacks.toggleCategory(category, !shown));
        return button;
      }),
    );
    if (focused) this.filters.querySelector<HTMLElement>(`[data-category="${focused}"]`)?.focus();
  }

  private renderList(state: ReviewViewState): void {
    // Same findings (a selection or a notice changed): only the current item moves.
    if (state.diagnostics !== this.listedDiagnostics) {
      this.listedDiagnostics = state.diagnostics;
      this.rebuildList(state);
    } else {
      for (const [id, item] of this.items) {
        item.setAttribute("aria-current", String(id === state.selectedId));
      }
    }
    // Keep the current finding visible, scrolling only the panel's body.
    const current = state.selectedId ? this.itemFor(state.selectedId) : null;
    if (current) {
      const box = this.body.getBoundingClientRect();
      const rect = current.getBoundingClientRect();
      if (rect.top < box.top) this.body.scrollTop -= box.top - rect.top;
      else if (rect.bottom > box.bottom) this.body.scrollTop += rect.bottom - box.bottom;
    }
  }

  private rebuildList(state: ReviewViewState): void {
    this.items.clear();
    const items = state.diagnostics.map((diagnostic) => {
      const li = element(this.doc, "li");
      const button = element(this.doc, "button", {
        type: "button",
        class: "item",
        "data-id": diagnostic.id,
        "data-category": diagnostic.category,
        "aria-current": String(diagnostic.id === state.selectedId),
      });
      const change = element(this.doc, "span", { class: "change", dir: "auto" });
      change.textContent = listPreview(diagnostic, this.t("review_warning"));
      const why = element(
        this.doc,
        "span",
        { class: "why" },
        `${this.t(CATEGORY_KEY[diagnostic.category])}: ${this.explanation(diagnostic)}`,
      );
      // Provenance in words (part of the item's name), beside the unchanged category signals.
      if (isLocalAi(diagnostic)) {
        why.prepend(element(this.doc, "span", { class: "tag" }, this.t("review_ai_tag")), " ");
      }
      button.append(
        element(
          this.doc,
          "span",
          { class: "badge", "aria-hidden": "true" },
          BADGES[diagnostic.category],
        ),
        change,
        why,
      );
      button.addEventListener("click", () => {
        this.callbacks.select(diagnostic.id, { openCard: true, focusList: false });
        // From the list, the card's actions are the next thing to reach.
        this.focusCard();
      });
      li.append(button);
      this.items.set(diagnostic.id, button);
      return li;
    });
    this.list.replaceChildren(...items);
  }

  private itemFor(id: string): HTMLElement | null {
    return this.items.get(id) ?? null;
  }

  /** `alternative` restores a choice made in an earlier card for this finding. */
  openCard(diagnostic: ReviewDiagnostic, anchor: DOMRect | null, alternative?: number): void {
    if (this.cardId !== diagnostic.id) {
      this.cardAlternative = 0;
      this.cardMoreOpen = false;
    }
    if (alternative !== undefined) this.cardAlternative = alternative;
    this.cardId = diagnostic.id;
    this.cardAnchor = anchor;
    this.cardMemory = {
      ruleId: diagnostic.ruleId,
      start: diagnostic.range.start,
      end: diagnostic.range.end,
      text: this.state?.text ?? "",
    };
    this.renderCard(diagnostic);
    this.card.hidden = false;
    this.positionCard();
  }

  closeCard(): void {
    this.cardId = null;
    this.cardMemory = null;
    this.card.hidden = true;
    this.card.replaceChildren();
  }

  /** The page explains its own findings (dictionary, Local AI); the rest came with the scan. */
  private explanation(diagnostic: ReviewDiagnostic): string {
    const key = diagnostic.messageKey;
    const label = isPageMessageKey(key) ? this.t(key) : (this.state?.explanations[key] ?? "");
    return diagnostic.terminology ? `${label} ${diagnostic.terminology.explanation}` : label;
  }

  focusCard(): void {
    // A pick-one card has no default: focus lands on its first suggestion.
    (
      this.card.querySelector<HTMLElement>("button.primary, button.suggestion") ??
      this.card.querySelector<HTMLElement>("button")
    )?.focus({ preventScroll: true });
  }

  cardDiagnosticId(): string | null {
    return this.cardId;
  }

  /** The alternative chosen in the open card. */
  cardAlternativeIndex(): number {
    return this.cardAlternative;
  }

  /** True when the keyboard focus is in the open card. */
  cardHasFocus(): boolean {
    const active = getDeepActiveElement(this.doc);
    return !this.card.hidden && !!active && this.card.contains(active);
  }

  private renderCard(diagnostic: ReviewDiagnostic): void {
    const state = this.state;
    const doc = this.doc;
    const canApply = !!state && state.capabilities.apply && state.status === "ready";
    const ai = isLocalAi(diagnostic);
    const kind = reviewKind(diagnostic.ruleId);
    const category = kind
      ? `${this.t(CATEGORY_KEY[diagnostic.category])} · ${this.t(`review_kind_${kind}`)}`
      : this.t(CATEGORY_KEY[diagnostic.category]);
    this.card.dataset.category = diagnostic.category;
    this.card.setAttribute(
      "aria-label",
      `${ai ? `${category}, ${this.t("review_ai_tag")}` : category}: ${this.explanation(diagnostic)}`,
    );
    const header = element(doc, "header");
    header.append(
      element(doc, "span", { class: "badge", "aria-hidden": "true" }, BADGES[diagnostic.category]),
      element(doc, "span", { class: "category" }, category),
    );
    if (ai) header.append(element(doc, "span", { class: "tag" }, this.t("review_ai_tag")));
    header.append(element(doc, "span", { class: "spacer" }));
    const close = iconButton(doc, "close", this.t("review_card_close"));
    close.addEventListener("click", () => {
      this.closeCard();
      this.callbacks.select(null, { openCard: false, focusList: true });
    });
    header.append(close);

    if (diagnostic.warningOnly) {
      this.card.setAttribute(
        "aria-label",
        `${category}, ${this.t("review_warning")}: ${this.explanation(diagnostic)}`,
      );
      this.replaceKeepingFocus(this.card, [
        header,
        element(doc, "p", {}, this.explanation(diagnostic)),
        element(doc, "p", { class: "hint" }, this.t("review_warning_hint")),
        this.cardActions(diagnostic),
      ]);
      return;
    }
    // Review-only choices use the non-mutating selector and Copy below.
    if (diagnostic.requiresChoice && state?.capabilities.apply) {
      this.renderChoiceCard(diagnostic, header, canApply);
      return;
    }
    const alternative = diagnostic.alternatives[this.cardAlternative] ?? diagnostic.alternatives[0];
    const diff = element(doc, "div", { class: "diff", "aria-label": this.t("review_card_change") });
    const from = element(doc, "span", { class: "from", dir: "auto" });
    const to = element(doc, "span", { class: "to", dir: "auto" });
    appendDiff(doc, from, diagnostic.original, alternative.preview, "from");
    appendDiff(doc, to, diagnostic.original, alternative.preview, "to");
    // One line, as it reads: the text as written, struck through, then the fix.
    diff.append(
      from,
      element(doc, "span", { class: "arrow", "aria-hidden": "true" }, "\u2192"),
      to,
    );

    const parts: HTMLElement[] = [
      header,
      element(doc, "p", {}, this.explanation(diagnostic)),
      diff,
    ];
    if (diagnostic.alternatives.length > 1) {
      const group = element(doc, "div", {
        class: "alternatives",
        role: "group",
        "aria-label": this.t("review_card_choose"),
      });
      diagnostic.alternatives.forEach((option, index) => {
        const button = element(
          doc,
          "button",
          { type: "button", "aria-pressed": String(index === this.cardAlternative), dir: "auto" },
          visibleWhitespace(option.preview),
        );
        if (option.localAi) {
          button.append(" ", element(doc, "span", { class: "tag" }, this.t("review_ai_tag")));
        }
        button.addEventListener("click", () => {
          this.cardAlternative = index;
          this.renderCard(diagnostic);
        });
        group.append(button);
      });
      parts.push(group);
    }
    const apply = element(
      doc,
      "button",
      { type: "button", class: "primary", "data-action": "apply" },
      this.t("review_card_apply"),
    );
    apply.disabled = !canApply;
    apply.addEventListener("click", (event) =>
      this.callbacks.apply(diagnostic.id, this.cardAlternative, event.detail === 0),
    );
    parts.push(this.cardActions(diagnostic, apply));
    if (!diagnostic.bulk.eligible && state?.capabilities.bulk) {
      parts.push(element(doc, "p", { class: "hint" }, this.t("review_card_individual")));
    }
    if (!state?.capabilities.apply)
      parts.push(element(doc, "p", { class: "hint" }, this.t("review_cap_review_only")));
    this.replaceKeepingFocus(this.card, parts);
  }

  /**
   * An unknown word: the word as written, then its suggestions as buttons.
   * None is preselected and nothing changes until one is chosen; one click
   * (or Enter) on a suggestion replaces the word with it.
   */
  private renderChoiceCard(
    diagnostic: ReviewDiagnostic,
    header: HTMLElement,
    canApply: boolean,
  ): void {
    const doc = this.doc;
    const word = element(doc, "p", { class: "word" });
    word.append(element(doc, "span", { class: "from", dir: "auto" }, diagnostic.original));
    const group = element(doc, "div", {
      class: "alternatives suggestions",
      role: "group",
      "aria-label": this.t("review_card_replace_with"),
    });
    diagnostic.alternatives.forEach((option, index) => {
      const button = element(
        doc,
        "button",
        {
          type: "button",
          class: "suggestion",
          "data-action": "pick",
          "data-index": String(index),
          "aria-label": option.localAi
            ? `${this.t("review_card_replace_label", { word: option.preview })}, ${this.t("review_ai_tag")}`
            : this.t("review_card_replace_label", { word: option.preview }),
          dir: "auto",
        },
        option.preview,
      );
      if (option.localAi) {
        button.append(" ", element(doc, "span", { class: "tag" }, this.t("review_ai_tag")));
      }
      button.disabled = !canApply;
      button.addEventListener("click", (event) =>
        this.callbacks.apply(diagnostic.id, index, event.detail === 0),
      );
      group.append(button);
    });
    const actions = this.cardActions(diagnostic);
    const parts: HTMLElement[] = [
      header,
      element(doc, "p", {}, this.explanation(diagnostic)),
      word,
      element(doc, "p", { class: "label" }, this.t("review_card_replace_with")),
      group,
      actions,
      element(
        doc,
        "p",
        { class: "hint" },
        this.t(this.state?.capabilities.apply ? "review_card_pick_hint" : "review_cap_review_only"),
      ),
    ];
    this.replaceKeepingFocus(this.card, parts);
  }

  /**
   * A card's buttons: `lead` (Apply) and Ignore, then the rarer, lasting ones
   * (ignore matching, turn the check off, add to dictionary) under More.
   */
  private cardActions(diagnostic: ReviewDiagnostic, ...lead: HTMLElement[]): HTMLElement {
    const doc = this.doc;
    const actions = element(doc, "div", { class: "actions" });
    const more = element(doc, "details", { class: "more" });
    const summary = element(doc, "summary", { "data-action": "more" }, this.t("review_card_more"));
    more.append(summary);
    // The card is rebuilt on every render: keep More open while it shows this finding.
    more.open = this.cardMoreOpen;
    more.addEventListener("toggle", () => {
      this.cardMoreOpen = more.open;
      if (!this.card.hidden) this.positionCard();
    });
    const ignore = element(
      doc,
      "button",
      { type: "button", "data-action": "ignore", title: this.t("review_card_ignore_hint") },
      this.t("review_card_ignore"),
    );
    ignore.addEventListener("click", () => this.callbacks.ignore(diagnostic.id));
    actions.append(...lead, ignore);
    const alternative = diagnostic.alternatives[this.cardAlternative];
    if (this.state && !this.state.capabilities.apply && alternative) {
      const copy = element(
        doc,
        "button",
        { type: "button", "data-action": "copy" },
        this.t("review_rewrite_copy"),
      );
      const status = element(doc, "span", { role: "status" });
      copy.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        const done = (ok: boolean) => {
          status.textContent = this.t(ok ? "review_rewrite_copied" : "review_rewrite_copy_failed");
        };
        const clipboard = doc.defaultView?.navigator.clipboard;
        if (!clipboard) done(false);
        else
          clipboard.writeText(alternative.preview).then(
            () => done(true),
            () => done(false),
          );
      });
      actions.append(copy, status);
    }

    if (diagnostic.ruleId !== REVIEW_LOCAL_AI_CHECK) {
      const matching = element(
        doc,
        "button",
        {
          type: "button",
          "data-action": "ignore-matching",
          "aria-describedby": "ft-review-ignore-matching-hint",
        },
        this.t("review_ignore_matching"),
      );
      matching.disabled = this.state?.status !== "ready";
      matching.addEventListener("click", () => this.callbacks.ignoreMatching(diagnostic.id));
      more.append(
        matching,
        // The fine print stays the button's description.
        element(
          doc,
          "p",
          { class: "sr-only", id: "ft-review-ignore-matching-hint" },
          this.t("review_ignore_matching_hint"),
        ),
      );
    }
    if (this.callbacks.disableRule && isReviewSupportedRule(diagnostic.ruleId)) {
      const disable = element(
        doc,
        "button",
        { type: "button", "data-action": "disable-rule" },
        this.t("review_disable_rule"),
      );
      disable.disabled = this.state?.status !== "ready";
      disable.addEventListener("click", (event) => {
        if (event.isTrusted) this.callbacks.disableRule?.(diagnostic.id);
      });
      more.append(disable);
    }
    if (diagnostic.dictionaryWord) {
      const add = element(
        doc,
        "button",
        { type: "button", "data-action": "dictionary" },
        this.t("review_card_add_dictionary", { word: diagnostic.dictionaryWord }),
      );
      // A lasting settings change: only the user's own click counts, never a
      // page script clicking through the shadow root.
      add.addEventListener("click", (event) => {
        if (event.isTrusted) this.callbacks.addToDictionary(diagnostic.id);
      });
      more.append(add);
    }
    if (more.childElementCount === 1) return actions;
    const group = element(doc, "div", { class: "card-actions" });
    group.append(actions, more);
    return group;
  }

  /** Swaps a container's content (the card, the batch preview), keeping focus on the same control. */
  private replaceKeepingFocus(container: HTMLElement, parts: HTMLElement[]): void {
    const focused = this.root.activeElement as HTMLElement | null;
    const inside = !!focused && container.contains(focused);
    const focusedAction = inside ? focused.dataset.action : undefined;
    const focusedIndex = inside ? focused.dataset.index : undefined;
    container.replaceChildren(...parts);
    if (focusedAction) {
      const selector =
        focusedIndex === undefined
          ? `[data-action="${focusedAction}"]`
          : `[data-action="${focusedAction}"][data-index="${focusedIndex}"]`;
      container.querySelector<HTMLElement>(selector)?.focus();
    }
  }

  /**
   * Places the card next to its finding (below, above, right or left) where it
   * covers neither the finding nor the panel; failing that, where it covers
   * the least, the finding counting most.
   */
  private positionCard(): void {
    const view = this.doc.defaultView;
    if (!view || this.card.hidden) return;
    const width = this.card.offsetWidth || 320;
    const height = this.card.offsetHeight || 160;
    const fit = (left: number, top: number) => ({
      left: Math.max(8, Math.min(left, view.innerWidth - width - 8)),
      top: Math.max(8, Math.min(top, view.innerHeight - height - 8)),
    });
    const panel = this.panel.hidden ? null : this.panel.getBoundingClientRect();
    const anchor = this.cardAnchor;
    const candidates = anchor
      ? [
          fit(anchor.left, anchor.bottom + 6),
          fit(anchor.left, anchor.top - height - 6),
          fit(anchor.right + 8, anchor.top),
          fit(anchor.left - width - 8, anchor.top),
        ]
      : [];
    if (panel) {
      candidates.push(
        fit(panel.left - width - 8, panel.top),
        fit(panel.left, panel.top - height - 8),
      );
    }
    if (candidates.length === 0) candidates.push(fit(8, 8));
    const score = ({ left, top }: { left: number; top: number }) => {
      const box = { left, top, right: left + width, bottom: top + height };
      return (anchor ? 4 * overlapArea(box, anchor) : 0) + (panel ? overlapArea(box, panel) : 0);
    };
    const best = candidates.reduce((a, b) => (score(b) < score(a) ? b : a));
    this.card.style.left = `${best.left}px`;
    this.card.style.top = `${best.top}px`;
  }

  /** Re-anchors an open card after scrolling or a resize. */
  updateCardAnchor(anchor: DOMRect | null): void {
    this.cardAnchor = anchor;
    this.positionCard();
  }

  /** Overlay underlines (for form controls, shadow editors, or without CSS highlights). */
  paintMarks(marks: ReviewMark[], clip: DOMRect | null): void {
    if (!clip) {
      this.clip.replaceChildren();
      return;
    }
    Object.assign(this.clip.style, {
      left: `${clip.left}px`,
      top: `${clip.top}px`,
      width: `${clip.width}px`,
      height: `${clip.height}px`,
    });
    const fragment = this.doc.createDocumentFragment();
    for (const mark of marks) {
      for (const rect of mark.rects) {
        const node = element(this.doc, "div", {
          class: "mark",
          "data-category": mark.category,
          "data-selected": String(mark.selected),
          "data-review-id": mark.id,
        });
        // Relative to the clip, so marks outside the editor's box are cut off
        // (Docs draws whole pages above and below its scrolled view).
        Object.assign(node.style, {
          left: `${rect.left - clip.left}px`,
          top: `${rect.top - clip.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        fragment.append(node);
      }
    }
    this.clip.replaceChildren(fragment);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      // The AI batch preview first, then the card, then the review.
      if (this.state?.aiBatch && !this.batch.hidden) {
        this.callbacks.cancelAiBatch();
      } else if (this.cardId) {
        const id = this.cardId;
        this.closeCard();
        this.callbacks.select(id, { openCard: false, focusList: true });
      } else {
        this.callbacks.close();
      }
      return;
    }
    const target = event.composedPath()[0] as HTMLElement | undefined;
    if (
      target?.classList.contains("suggestion") &&
      ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)
    ) {
      event.preventDefault();
      const options = Array.from(this.card.querySelectorAll<HTMLElement>("button.suggestion"));
      const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
      const index = options.indexOf(target) + (forward ? 1 : -1);
      options[(index + options.length) % options.length]?.focus();
      return;
    }
    if (
      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
      target?.classList.contains("item")
    ) {
      event.preventDefault();
      const items = Array.from(this.list.querySelectorAll<HTMLElement>(".item"));
      const index = items.indexOf(target);
      items[
        Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))
      ]?.focus();
    }
  }

  /** True when the keyboard focus is in the panel or the card. */
  hasFocus(): boolean {
    const active = getDeepActiveElement(this.doc);
    return active === this.host || (!!active && this.root.contains(active));
  }

  destroy(): void {
    this.host.remove();
  }
}
