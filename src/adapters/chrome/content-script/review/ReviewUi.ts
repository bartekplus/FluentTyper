import type { ReviewViewState } from "@core/application/review/ReviewSession";
import { reviewText, type ReviewTextKey } from "@core/domain/grammar/review/reviewMessages";
import {
  REVIEW_CATEGORIES,
  type ReviewCategory,
  type ReviewDiagnostic,
} from "@core/domain/grammar/review/types";
import { REVIEW_SHADOW_CSS } from "./reviewStyles";

export interface ReviewUiCallbacks {
  close(): void;
  select(id: string | null, options: { openCard: boolean; focusList: boolean }): void;
  /** `viaKeyboard`: activated without a pointer, so focus should stay in the panel. */
  apply(id: string, alternative: number, viaKeyboard: boolean): void;
  ignore(id: string): void;
  addToDictionary(id: string): void;
  fixAll(viaKeyboard: boolean): void;
  toggleCategory(category: ReviewCategory, shown: boolean): void;
  navigate(step: 1 | -1): void;
}

export interface ReviewUiNotes {
  /** Extra, honest capability notes (no highlights, review only, undo behavior\u2026). */
  capabilityKeys: ReviewTextKey[];
}

export interface ReviewMark {
  id: string;
  category: ReviewCategory;
  selected: boolean;
  rects: DOMRect[];
}

const BADGES: Record<ReviewCategory, string> = {
  spelling: "abc",
  grammar: "G",
  punctuation: ",.",
  typography: "Aa",
};
const CATEGORY_KEY: Record<ReviewCategory, ReviewTextKey> = {
  spelling: "review_cat_spelling",
  grammar: "review_cat_grammar",
  punctuation: "review_cat_punctuation",
  typography: "review_cat_typography",
};

/** Makes spaces visible in a short change preview ("word ," -> "word\u2423,"). */
function visibleWhitespace(text: string): string {
  return text
    .replace(/ /g, "\u2423")
    .replace(/\u00A0/g, "\u237D")
    .replace(/\n/g, "\u21B5");
}

/** Whitespace is shown as symbols only when whitespace itself is what changes. */
function changePreview(from: string, to: string): [string, string] {
  let prefix = 0;
  while (prefix < from.length && prefix < to.length && from[prefix] === to[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < from.length - prefix &&
    suffix < to.length - prefix &&
    from[from.length - 1 - suffix] === to[to.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const changed = from.slice(prefix, from.length - suffix) + to.slice(prefix, to.length - suffix);
  return /\s/.test(changed) ? [visibleWhitespace(from), visibleWhitespace(to)] : [from, to];
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

/** Text with its changed middle wrapped in <mark>, built from text nodes only. */
function appendDiff(
  doc: Document,
  parent: HTMLElement,
  from: string,
  to: string,
  side: "from" | "to",
) {
  let prefix = 0;
  while (prefix < from.length && prefix < to.length && from[prefix] === to[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < from.length - prefix &&
    suffix < to.length - prefix &&
    from[from.length - 1 - suffix] === to[to.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const text = side === "from" ? from : to;
  const changed = text.slice(prefix, text.length - suffix);
  const both = from.slice(prefix, from.length - suffix) + to.slice(prefix, to.length - suffix);
  const show = /\s/.test(both) ? visibleWhitespace : (value: string) => value;
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
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly fixAll: HTMLButtonElement;
  private readonly fixNote: HTMLElement;
  private readonly card: HTMLElement;
  private readonly marks: HTMLElement;
  private readonly clip: HTMLElement;
  private state: ReviewViewState | null = null;
  private cardId: string | null = null;
  private cardAlternative = 0;
  private cardAnchor: DOMRect | null = null;
  /** The open card's finding, kept while a recheck runs on unchanged text. */
  private cardMemory: { ruleId: string; start: number; end: number; text: string } | null = null;

  constructor(
    doc: Document,
    private readonly lang: string,
    private readonly callbacks: ReviewUiCallbacks,
    private notesConfig: ReviewUiNotes,
  ) {
    this.doc = doc;
    this.host = doc.createElement("div");
    this.host.setAttribute("data-fluenttyper-review", "");
    const hostStyle = this.host.style;
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
      "z-index": "2147483647",
      display: "block",
    })) {
      hostStyle.setProperty(name, value, "important");
    }
    this.root = this.host.attachShadow({ mode: "open" });
    const style = element(doc, "style", {}, REVIEW_SHADOW_CSS);
    this.marks = element(doc, "div", { class: "layer", "aria-hidden": "true" });
    this.clip = element(doc, "div", { class: "clip" });
    this.marks.append(this.clip);

    this.panel = element(doc, "section", {
      class: "panel",
      role: "dialog",
      "aria-modal": "false",
      "aria-labelledby": "ft-review-title",
      dir: "auto",
    });
    const header = element(doc, "header");
    this.heading = element(
      doc,
      "h2",
      { id: "ft-review-title", tabindex: "-1" },
      this.t("review_title"),
    );
    this.scopeLabel = element(doc, "span", { class: "scope" });
    const close = element(
      doc,
      "button",
      {
        class: "icon",
        type: "button",
        "aria-label": this.t("review_close"),
        title: this.t("review_close"),
        "data-action": "close",
      },
      "\u00D7",
    );
    header.append(this.heading, this.scopeLabel, element(doc, "span", { class: "spacer" }), close);
    this.status = element(doc, "p", { class: "status", role: "status", "aria-live": "polite" });
    this.notes = element(doc, "div", { class: "notes" });
    this.filters = element(doc, "div", {
      class: "filters",
      role: "group",
      "aria-label": this.t("review_filters"),
    });
    const nav = element(doc, "div", { class: "nav" });
    this.prev = element(
      doc,
      "button",
      { type: "button", "data-action": "prev", "aria-label": this.t("review_prev") },
      "\u2191",
    );
    this.next = element(
      doc,
      "button",
      { type: "button", "data-action": "next", "aria-label": this.t("review_next") },
      "\u2193",
    );
    this.prev.title = this.t("review_prev");
    this.next.title = this.t("review_next");
    nav.append(this.prev, this.next);
    this.list = element(doc, "ol", { class: "list", "aria-label": this.t("review_list_label") });
    const footer = element(doc, "footer");
    this.fixAll = element(doc, "button", {
      type: "button",
      class: "primary",
      "data-action": "fix-all",
    });
    this.fixNote = element(doc, "p", { class: "fix-note", id: "ft-review-fix-note" });
    this.fixAll.setAttribute("aria-describedby", "ft-review-fix-note");
    footer.append(this.fixAll, this.fixNote);
    this.panel.append(header, this.status, this.notes, this.filters, nav, this.list, footer);

    this.card = element(doc, "div", { class: "card", role: "dialog", hidden: "", tabindex: "-1" });
    this.root.append(style, this.marks, this.panel, this.card);

    close.addEventListener("click", () => this.callbacks.close());
    this.prev.addEventListener("click", () => this.callbacks.navigate(-1));
    this.next.addEventListener("click", () => this.callbacks.navigate(1));
    this.fixAll.addEventListener("click", (event) => this.callbacks.fixAll(event.detail === 0));
    this.root.addEventListener("keydown", (event) => this.onKeyDown(event as KeyboardEvent));

    (doc.documentElement ?? doc.body).appendChild(this.host);
    this.enterTopLayer();
  }

  private t(key: ReviewTextKey, params?: Record<string, string | number>): string {
    return reviewText(key, this.lang, params);
  }

  /** The top layer escapes page stacking contexts and overflow clipping. */
  private enterTopLayer(): void {
    const host = this.host as HTMLElement & { showPopover?: () => void };
    if (typeof host.showPopover !== "function") return;
    try {
      host.setAttribute("popover", "manual");
      host.showPopover();
    } catch {
      host.removeAttribute("popover");
    }
  }

  setNotes(notes: ReviewUiNotes): void {
    this.notesConfig = notes;
    if (this.state) this.render(this.state);
  }

  /** Puts the panel in the viewport corner that covers the least of the editor. */
  placeAwayFrom(rect: DOMRect | null): void {
    const view = this.doc.defaultView;
    if (!rect || !view) return;
    const width = Math.min(340, view.innerWidth - 24);
    const height = Math.min(view.innerHeight * 0.7, 560);
    const corners = [
      ["bottom-right", view.innerWidth - 12 - width, view.innerHeight - 12 - height],
      ["bottom-left", 12, view.innerHeight - 12 - height],
      ["top-right", view.innerWidth - 12 - width, 12],
      ["top-left", 12, 12],
    ] as const;
    const overlap = ([, left, top]: (typeof corners)[number]) =>
      Math.max(0, Math.min(left + width, rect.right) - Math.max(left, rect.left)) *
      Math.max(0, Math.min(top + height, rect.bottom) - Math.max(top, rect.top));
    const best = corners.reduce((a, b) => (overlap(b) < overlap(a) ? b : a));
    this.panel.dataset.corner = best[0];
  }

  /** A message-only panel: why nothing could be reviewed. */
  showMessage(text: string): void {
    for (const part of [
      this.scopeLabel,
      this.notes,
      this.filters,
      this.list,
      this.prev,
      this.next,
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
    this.state = state;
    this.scopeLabel.textContent = this.t(
      state.scopeKind === "selection" ? "review_scope_selection" : "review_scope_field",
    );
    this.status.textContent = this.statusText(state);
    this.renderNotes(state);
    this.renderFilters(state);
    this.renderList(state);
    const nav = state.diagnostics.length > 1;
    this.prev.disabled = !nav;
    this.next.disabled = !nav;
    const bulkAvailable = state.capabilities.bulk && state.status === "ready";
    this.fixAll.hidden = !state.capabilities.bulk;
    this.fixAll.textContent = this.t("review_fix_all", { count: state.bulk.count });
    this.fixAll.disabled = !bulkAvailable || state.bulk.count === 0;
    const filtered = state.categories.size < REVIEW_CATEGORIES.length;
    const noteParts = [this.t(filtered ? "review_fix_all_filtered" : "review_fix_all_whole")];
    if (state.bulk.deferred > 0) {
      noteParts.push(this.t("review_fix_all_deferred", { count: state.bulk.deferred }));
    }
    this.fixNote.textContent = state.capabilities.bulk ? noteParts.join(" ") : "";
    if (focusedId) this.itemFor(focusedId)?.focus({ preventScroll: true });

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
    if (state.noRules) return this.t("review_status_no_rules");
    const notice = this.noticeText(state);
    const count = state.diagnostics.length;
    let summary: string;
    if (count > 0) summary = this.t("review_status_count", { count });
    else if (state.resolvedCount > 0)
      summary = this.t("review_status_all_resolved", { count: state.resolvedCount });
    else summary = this.t("review_status_none");
    // "All resolved" already reports the fixes; don't say it twice.
    const redundant = count === 0 && state.notice?.kind === "applied";
    return notice && !redundant ? `${notice} ${summary}` : summary;
  }

  private noticeText(state: ReviewViewState): string {
    const notice = state.notice;
    if (!notice) return "";
    switch (notice.kind) {
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
      case "dictionary-failed":
        return this.t("review_notice_dictionary_failed");
    }
  }

  private renderNotes(state: ReviewViewState): void {
    const lines: string[] = this.notesConfig.capabilityKeys.map((key) => this.t(key));
    if (state.status === "ready") {
      const skipped = state.coverage?.skipped ?? {};
      const protectedChars = (skipped.code ?? 0) + (skipped.structure ?? 0);
      if (protectedChars > 0)
        lines.push(this.t("review_status_skipped", { count: protectedChars }));
      if (state.truncated > 0)
        lines.push(this.t("review_status_size_limit", { count: state.truncated }));
      if ((state.coverage?.failedRules.length ?? 0) > 0)
        lines.push(this.t("review_status_rule_error"));
      if (state.languageSkipped > 0) lines.push(this.t("review_status_language"));
      if (state.ignoredCount > 0)
        lines.push(this.t("review_status_ignored", { count: state.ignoredCount }));
    }
    this.notes.replaceChildren(...lines.map((line) => element(this.doc, "p", {}, line)));
  }

  private renderFilters(state: ReviewViewState): void {
    const counts = new Map<ReviewCategory, number>();
    for (const diagnostic of state.diagnostics) {
      counts.set(diagnostic.category, (counts.get(diagnostic.category) ?? 0) + 1);
    }
    const focused = (this.root.activeElement as HTMLElement | null)?.dataset?.category;
    this.filters.replaceChildren(
      ...REVIEW_CATEGORIES.map((category) => {
        const shown = state.categories.has(category);
        const button = element(this.doc, "button", {
          type: "button",
          class: "filter",
          "data-category": category,
          "aria-pressed": String(shown),
        });
        button.append(
          element(this.doc, "span", { class: "badge", "aria-hidden": "true" }, BADGES[category]),
          this.doc.createTextNode(
            shown
              ? `${this.t(CATEGORY_KEY[category])} (${counts.get(category) ?? 0})`
              : this.t(CATEGORY_KEY[category]),
          ),
        );
        button.addEventListener("click", () => this.callbacks.toggleCategory(category, !shown));
        return button;
      }),
    );
    if (focused) this.filters.querySelector<HTMLElement>(`[data-category="${focused}"]`)?.focus();
  }

  private renderList(state: ReviewViewState): void {
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
      const [from, to] = changePreview(diagnostic.original, diagnostic.alternatives[0].preview);
      change.textContent = `${from} \u2192 ${to}`;
      button.append(
        element(
          this.doc,
          "span",
          { class: "badge", "aria-hidden": "true" },
          BADGES[diagnostic.category],
        ),
        change,
        element(
          this.doc,
          "span",
          { class: "why" },
          `${this.t(CATEGORY_KEY[diagnostic.category])}: ${this.t(diagnostic.messageKey)}`,
        ),
      );
      button.addEventListener("click", () => {
        this.callbacks.select(diagnostic.id, { openCard: true, focusList: false });
        // From the list, the card's actions are the next thing to reach.
        this.focusCard();
      });
      li.append(button);
      return li;
    });
    this.list.replaceChildren(...items);
    // Keep the current finding visible in the list, scrolling only the list.
    const current = state.selectedId ? this.itemFor(state.selectedId) : null;
    if (current) {
      const box = this.list.getBoundingClientRect();
      const rect = current.getBoundingClientRect();
      if (rect.top < box.top) this.list.scrollTop -= box.top - rect.top;
      else if (rect.bottom > box.bottom) this.list.scrollTop += rect.bottom - box.bottom;
    }
  }

  private itemFor(id: string): HTMLElement | null {
    return (
      Array.from(this.list.querySelectorAll<HTMLElement>(".item")).find(
        (item) => item.dataset.id === id,
      ) ?? null
    );
  }

  openCard(diagnostic: ReviewDiagnostic, anchor: DOMRect | null): void {
    if (this.cardId !== diagnostic.id) this.cardAlternative = 0;
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

  focusCard(): void {
    this.card.querySelector<HTMLElement>("button.primary")?.focus({ preventScroll: true });
  }

  cardDiagnosticId(): string | null {
    return this.cardId;
  }

  private renderCard(diagnostic: ReviewDiagnostic): void {
    const state = this.state;
    const doc = this.doc;
    const canApply = !!state && state.capabilities.apply && state.status === "ready";
    this.card.dataset.category = diagnostic.category;
    this.card.setAttribute(
      "aria-label",
      `${this.t(CATEGORY_KEY[diagnostic.category])}: ${this.t(diagnostic.messageKey)}`,
    );
    const header = element(doc, "header");
    header.append(
      element(doc, "span", { class: "badge", "aria-hidden": "true" }, BADGES[diagnostic.category]),
      element(doc, "span", { class: "category" }, this.t(CATEGORY_KEY[diagnostic.category])),
      element(doc, "span", { class: "spacer" }),
    );
    const close = element(
      doc,
      "button",
      {
        type: "button",
        class: "icon",
        "aria-label": this.t("review_card_close"),
        title: this.t("review_card_close"),
      },
      "\u00D7",
    );
    close.addEventListener("click", () => {
      this.closeCard();
      this.callbacks.select(null, { openCard: false, focusList: true });
    });
    header.append(close);

    const alternative = diagnostic.alternatives[this.cardAlternative] ?? diagnostic.alternatives[0];
    const diff = element(doc, "div", { class: "diff", "aria-label": this.t("review_card_change") });
    const from = element(doc, "span", { class: "from", dir: "auto" });
    const to = element(doc, "span", { class: "to", dir: "auto" });
    appendDiff(doc, from, diagnostic.original, alternative.preview, "from");
    appendDiff(doc, to, diagnostic.original, alternative.preview, "to");
    diff.append(
      element(doc, "span", { class: "label" }, "\u2212"),
      from,
      element(doc, "span", { class: "label" }, "+"),
      to,
    );

    const parts: HTMLElement[] = [
      header,
      element(doc, "p", {}, this.t(diagnostic.messageKey)),
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
        button.addEventListener("click", () => {
          this.cardAlternative = index;
          this.renderCard(diagnostic);
        });
        group.append(button);
      });
      parts.push(group);
    }
    const actions = element(doc, "div", { class: "actions" });
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
    const ignore = element(
      doc,
      "button",
      { type: "button", "data-action": "ignore", title: this.t("review_card_ignore_hint") },
      this.t("review_card_ignore"),
    );
    ignore.addEventListener("click", () => this.callbacks.ignore(diagnostic.id));
    actions.append(apply, ignore);
    if (diagnostic.dictionaryWord) {
      const add = element(
        doc,
        "button",
        { type: "button", "data-action": "dictionary" },
        this.t("review_card_add_dictionary", { word: diagnostic.dictionaryWord }),
      );
      add.addEventListener("click", () => this.callbacks.addToDictionary(diagnostic.id));
      actions.append(add);
    }
    parts.push(actions);
    if (!diagnostic.bulk.eligible && state?.capabilities.bulk) {
      parts.push(element(doc, "p", { class: "hint" }, this.t("review_card_individual")));
    }
    if (!state?.capabilities.apply)
      parts.push(element(doc, "p", { class: "hint" }, this.t("review_cap_review_only")));
    const focused = this.root.activeElement as HTMLElement | null;
    const focusedAction =
      focused && this.card.contains(focused) ? focused.dataset.action : undefined;
    this.card.replaceChildren(...parts);
    if (focusedAction) {
      this.card.querySelector<HTMLElement>(`[data-action="${focusedAction}"]`)?.focus();
    }
  }

  /** Below the finding (above when there is no room), else beside the panel. */
  private positionCard(): void {
    const view = this.doc.defaultView;
    if (!view || this.card.hidden) return;
    const width = this.card.offsetWidth || 320;
    const height = this.card.offsetHeight || 160;
    let left: number;
    let top: number;
    const anchor = this.cardAnchor;
    if (anchor) {
      left = anchor.left;
      top = anchor.bottom + 6;
      if (top + height > view.innerHeight - 8) top = anchor.top - height - 6;
    } else {
      const panel = this.panel.getBoundingClientRect();
      left = panel.left - width - 8;
      top = panel.top;
      if (left < 8) {
        left = panel.left;
        top = panel.top - height - 8;
      }
    }
    left = Math.max(8, Math.min(left, view.innerWidth - width - 8));
    top = Math.max(8, Math.min(top, view.innerHeight - height - 8));
    this.card.style.left = `${left}px`;
    this.card.style.top = `${top}px`;
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
        Object.assign(node.style, {
          left: `${rect.left}px`,
          top: `${rect.top}px`,
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
      if (this.cardId) {
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

  destroy(): void {
    this.host.remove();
  }
}
