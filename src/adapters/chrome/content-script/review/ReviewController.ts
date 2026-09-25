import { getDeepActiveElement } from "@core/application/dom-utils";
import { createLogger } from "@core/application/logging/Logger";
import { ReviewSession, type ReviewViewState } from "@core/application/review/ReviewSession";
import { reviewText, type ReviewTextKey } from "@core/domain/grammar/review/reviewMessages";
import type {
  ReviewCategory,
  ReviewDiagnostic,
  ReviewOptions,
} from "@core/domain/grammar/review/types";
import { GoogleDocsReviewTarget, type GoogleDocsReviewSurface } from "./GoogleDocsReviewTarget";
import {
  ContentEditableReviewTarget,
  resolveReviewTarget,
  type ReviewTargetHandle,
} from "./ReviewTargets";
import { ReviewUi, type ReviewMark } from "./ReviewUi";
import { REVIEW_HIGHLIGHT_NAMES } from "./reviewStyles";

const logger = createLogger("ReviewController");

export interface ReviewControllerDependencies {
  /** Current review settings: enabled rules (already code-mode filtered), language, dictionary. */
  getOptions(): ReviewOptions;
  /** Pauses live grammar/suggestions for this editor only; resume restores them. */
  suspend(element: HTMLElement): void;
  resume(element: HTMLElement): void;
  addToDictionary(word: string): Promise<boolean>;
  /** The Google Docs adapter when this page is a Docs editor. */
  getDocsSurface(): GoogleDocsReviewSurface | null;
  uiLanguage?: string;
}

type HighlightRegistry = Map<string, unknown>;
type HighlightConstructor = new (...ranges: Range[]) => { priority: number };

/** Feature-detected CSS Custom Highlight API; missing in older browsers. */
function highlightApi(): { registry: HighlightRegistry; Highlight: HighlightConstructor } | null {
  const scope = globalThis as typeof globalThis & {
    CSS?: { highlights?: HighlightRegistry };
    Highlight?: HighlightConstructor;
  };
  const registry = scope.CSS?.highlights;
  return registry && typeof scope.Highlight === "function"
    ? { registry, Highlight: scope.Highlight }
    : null;
}

interface ActiveReview {
  target: ReviewTargetHandle;
  session: ReviewSession;
  ui: ReviewUi;
  state: ReviewViewState | null;
  /** CSS highlights are only styled in the document's own style scope. */
  cssHighlights: ReturnType<typeof highlightApi>;
  cleanup: Array<() => void>;
  frame: number | null;
}

/**
 * Explicitly invoked review of one editor. Nothing is scanned, observed or
 * created until invoke(); close() removes every listener, observer, timer,
 * highlight and element it added and restores the editor's normal behavior.
 */
export class ReviewController {
  private active: ActiveReview | null = null;
  private notice: ReviewUi | null = null;
  private noticeReturnFocus: HTMLElement | null = null;
  private startToken = 0;
  private docsStarting = false;

  constructor(private readonly deps: ReviewControllerDependencies) {}

  get isActive(): boolean {
    return this.active !== null;
  }

  get activeElement(): HTMLElement | null {
    return this.active?.target.element ?? null;
  }

  private get lang(): string {
    return this.deps.uiLanguage ?? navigator.language;
  }

  /** Starts (or focuses) a review of the focused editor or its selection. */
  invoke(): void {
    // Capture editor and selection before any FluentTyper UI takes focus.
    const docs = this.deps.getDocsSurface();
    // Pressed again from the panel itself: that is "take me to the review".
    if (this.active?.ui.hasFocus()) {
      this.active.ui.focusPanel();
      return;
    }
    // A Docs review is already starting (its first read is asynchronous).
    if (docs && this.docsStarting) return;
    const resolution = docs ? null : resolveReviewTarget(document);
    if (this.active) {
      const same = resolution?.ok && resolution.target.element === this.active.target.element;
      if (same || (docs && this.active.target instanceof GoogleDocsReviewTarget)) {
        this.active.ui.focusPanel();
        return;
      }
      this.close();
    }
    this.dismissNotice();
    if (docs) {
      void this.startDocs(docs);
      return;
    }
    if (!resolution?.ok) {
      const reason = resolution?.reason ?? "no-editor";
      this.showNotice(
        reason === "sensitive"
          ? "review_unsupported_sensitive"
          : reason === "cross-selection"
            ? "review_unsupported_cross"
            : "review_unsupported_no_editor",
      );
      return;
    }
    this.start(resolution.target, resolution.scope);
  }

  private async startDocs(surface: GoogleDocsReviewSurface): Promise<void> {
    const element = document.querySelector<HTMLElement>(".kix-appview-editor") ?? document.body;
    const target = new GoogleDocsReviewTarget(surface, element);
    const token = ++this.startToken;
    this.docsStarting = true;
    surface.setReviewActive(true);
    let scope: { start: number; end: number } | null = null;
    let failed = false;
    try {
      scope = await target.start();
    } catch {
      failed = true;
    } finally {
      this.docsStarting = false;
    }
    // Closed, disposed or failed while Docs was answering: open nothing.
    if (failed || token !== this.startToken) {
      surface.setReviewActive(false);
      target.dispose();
      return;
    }
    this.start(target, scope, () => surface.setReviewActive(false));
  }

  private start(
    target: ReviewTargetHandle,
    scope: { start: number; end: number } | null,
    onClose?: () => void,
  ): void {
    const doc = target.element.ownerDocument;
    const capabilityKeys: ReviewTextKey[] = [];
    if (target instanceof GoogleDocsReviewTarget) capabilityKeys.push("review_cap_docs");
    else if (!target.capabilities.inline) capabilityKeys.push("review_cap_no_inline");
    if (!target.capabilities.apply) capabilityKeys.push("review_cap_review_only");
    else if (target.capabilities.undo === "per-edit" && target.capabilities.bulk) {
      capabilityKeys.push("review_cap_undo_per_edit");
    }
    const ui = new ReviewUi(
      doc,
      this.lang,
      {
        close: () => this.close(),
        select: (id, options) => this.select(id, options),
        apply: (id, alternative, viaKeyboard) => void this.apply(id, alternative, viaKeyboard),
        ignore: (id) => this.ignore(id),
        addToDictionary: (id) => void this.active?.session.addToDictionary(id),
        fixAll: (viaKeyboard) => void this.fixAll(viaKeyboard),
        toggleCategory: (category: ReviewCategory, shown) =>
          this.active?.session.setCategory(category, shown),
        navigate: (step) => this.navigate(step),
      },
      { capabilityKeys },
      modalDialogOf(target.element),
    );
    target.setMeasurementRoot(ui.root);
    ui.placeAwayFrom(target.element.getBoundingClientRect());

    // ::highlight() rules live in the page stylesheet, which does not reach
    // into shadow trees; those editors, and form controls, use the overlay.
    const cssHighlights =
      target instanceof ContentEditableReviewTarget && target.element.getRootNode() === doc
        ? highlightApi()
        : null;

    const session = new ReviewSession({
      target,
      options: this.deps.getOptions(),
      initialScope: scope,
      onChange: (state) => this.onState(state),
      addToDictionary: (word) => this.deps.addToDictionary(word),
    });
    const active: ActiveReview = {
      target,
      session,
      ui,
      state: null,
      cssHighlights,
      cleanup: [],
      frame: null,
    };
    this.active = active;
    this.deps.suspend(target.element);
    active.cleanup.push(() => this.deps.resume(target.element));
    if (onClose) active.cleanup.push(onClose);
    this.listen(active);
    void session.start().catch((error: unknown) => {
      logger.warn("Review scan failed", { error: String(error) });
    });
    // Docs only answers while its own input frame is focused; the panel is one
    // Tab/shortcut away. Elsewhere keyboard users land in the panel.
    if (!(target instanceof GoogleDocsReviewTarget)) ui.focusPanel();
  }

  private listen(active: ActiveReview): void {
    const { target, session } = active;
    const element = target.element;
    const doc = element.ownerDocument;
    const view = doc.defaultView!;
    const on = <E extends Event>(
      node: EventTarget,
      type: string,
      handler: (event: E) => void,
      options: AddEventListenerOptions | boolean = false,
    ) => {
      node.addEventListener(type, handler as EventListener, options);
      active.cleanup.push(() => node.removeEventListener(type, handler as EventListener, options));
    };

    if (!(target instanceof GoogleDocsReviewTarget)) {
      on(element, "input", () => session.notifySourceChanged());
      on(element, "compositionstart", () => {
        target.composing = true;
        session.notifySourceChanged();
      });
      on(element, "compositionend", () => {
        target.composing = false;
        session.notifySourceChanged();
      });
      on<MouseEvent>(element, "click", (event) => this.onEditorClick(event));
      on<KeyboardEvent>(element, "keydown", (event) => this.onEditorKeyDown(event), true);
      // Programmatic edits and formatting-only changes (text turned into code).
      if (element.isContentEditable) {
        const observer = new MutationObserver(() => session.notifySourceChanged());
        observer.observe(element, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["class", "contenteditable", "style", "hidden"],
        });
        active.cleanup.push(() => observer.disconnect());
      }
      if (typeof ResizeObserver === "function") {
        const resize = new ResizeObserver(() => this.scheduleLayout());
        resize.observe(element);
        active.cleanup.push(() => resize.disconnect());
      }
      on(element, "scroll", () => this.scheduleLayout(), { passive: true });
    } else {
      // Docs has no DOM text to observe; its own key events drive a recheck.
      on(doc, "keyup", () => session.notifySourceChanged(), true);
    }
    on(view, "scroll", () => this.scheduleLayout(), { capture: true, passive: true });
    on(view, "resize", () => {
      // A rotated or resized window may put the panel over the editor.
      const cardId = active.ui.cardDiagnosticId();
      active.ui.placeAwayFrom(
        element.getBoundingClientRect(),
        cardId ? this.anchorFor(active, cardId) : null,
      );
      this.scheduleLayout();
    });
    on<PointerEvent>(doc, "pointerdown", (event) => this.onDocumentPointerDown(event), true);
    on(view, "pagehide", () => this.close());
    if (!(target instanceof GoogleDocsReviewTarget)) {
      // Removal from the page and scripted value changes fire no event here.
      const poll = view.setInterval(() => {
        if (this.active !== active || active.state?.status !== "ready") return;
        const current = active.target.element;
        const changed =
          !current.isConnected ||
          ((current.tagName === "TEXTAREA" || current.tagName === "INPUT") &&
            (current as HTMLTextAreaElement).value !== session.sourceText);
        if (changed) session.notifySourceChanged();
      }, SOURCE_POLL_MS);
      active.cleanup.push(() => view.clearInterval(poll));
    }
    active.cleanup.push(() => {
      if (active.frame !== null) view.cancelAnimationFrame(active.frame);
    });
  }

  handleOptionsChanged(): void {
    this.active?.session.updateOptions(this.deps.getOptions());
  }

  close(): void {
    // Also cancels a Docs review that is still starting.
    this.startToken += 1;
    const active = this.active;
    if (!active) return;
    this.active = null;
    // Closed from the panel (Escape, ×): the keyboard goes back to the editor.
    const returnFocus = active.ui.hasFocus();
    active.session.close();
    this.clearHighlights(active);
    for (const cleanup of active.cleanup.splice(0).reverse()) {
      try {
        cleanup();
      } catch {
        // Cleanup continues past a detached node.
      }
    }
    active.target.dispose();
    active.ui.destroy();
    if (returnFocus && active.target.element.isConnected) active.target.focusEditor();
  }

  // ------------------------------------------------------------------- state

  private onState(state: ReviewViewState): void {
    const active = this.active;
    if (!active) return;
    active.state = state;
    active.ui.render(state);
    this.paint(active);
    const cardId = active.ui.cardDiagnosticId();
    if (cardId) active.ui.updateCardAnchor(this.anchorFor(active, cardId));
  }

  private diagnostic(id: string): ReviewDiagnostic | undefined {
    return this.active?.state?.diagnostics.find((d) => d.id === id);
  }

  private select(id: string | null, options: { openCard: boolean; focusList: boolean }): void {
    const active = this.active;
    if (!active) return;
    active.session.select(id);
    if (!id) {
      active.ui.closeCard();
      return;
    }
    const diagnostic = this.diagnostic(id);
    if (!diagnostic) return;
    active.target.reveal(diagnostic.range);
    const anchor = this.anchorFor(active, id);
    // Never leave the current finding under the panel.
    if (anchor && active.ui.panelCovers(anchor)) {
      active.ui.placeAwayFrom(active.target.element.getBoundingClientRect(), anchor);
    }
    if (options.openCard) active.ui.openCard(diagnostic, anchor);
    if (options.focusList) active.ui.focusItem(id);
  }

  private navigate(step: 1 | -1): void {
    const state = this.active?.state;
    if (!state || state.diagnostics.length === 0) return;
    const index = state.diagnostics.findIndex((d) => d.id === state.selectedId);
    const next =
      index < 0
        ? step > 0
          ? 0
          : state.diagnostics.length - 1
        : (index + step + state.diagnostics.length) % state.diagnostics.length;
    this.select(state.diagnostics[next].id, { openCard: true, focusList: true });
  }

  private async apply(id: string, alternative: number, viaKeyboard: boolean): Promise<void> {
    const active = this.active;
    if (!active) return;
    active.ui.closeCard();
    await active.session.apply(id, alternative);
    if (this.active === active && viaKeyboard) this.focusAfterWrite(active);
  }

  private ignore(id: string): void {
    const active = this.active;
    if (!active) return;
    const index = active.state?.diagnostics.findIndex((d) => d.id === id) ?? -1;
    active.ui.closeCard();
    active.session.ignore(id);
    // Keep keyboard users in the list, on the issue that took this one's place.
    const next =
      active.state?.diagnostics[
        Math.min(Math.max(index, 0), (active.state?.diagnostics.length ?? 1) - 1)
      ];
    if (next) active.ui.focusItem(next.id);
    else active.ui.focusPanel();
  }

  private async fixAll(viaKeyboard: boolean): Promise<void> {
    const active = this.active;
    if (!active) return;
    await active.session.fixAll();
    if (this.active === active && viaKeyboard) this.focusAfterWrite(active);
  }

  /** Writes focus the editor; a keyboard user continues in the review panel. */
  private focusAfterWrite(active: ActiveReview): void {
    const next = active.state?.diagnostics[0];
    if (next) active.ui.focusItem(next.id);
    else active.ui.focusPanel();
  }

  // ------------------------------------------------------------- highlights

  private scheduleLayout(): void {
    const active = this.active;
    if (!active || active.frame !== null) return;
    const view = active.target.element.ownerDocument.defaultView!;
    active.frame = view.requestAnimationFrame(() => {
      active.frame = null;
      if (this.active !== active) return;
      // CSS highlights move with the text by themselves; overlays are re-measured.
      if (!active.cssHighlights) this.paint(active);
      const cardId = active.ui.cardDiagnosticId();
      if (cardId) active.ui.updateCardAnchor(this.anchorFor(active, cardId));
    });
  }

  private paint(active: ActiveReview): void {
    const state = active.state;
    const diagnostics = state?.status === "ready" ? state.diagnostics : [];
    if (!active.target.capabilities.inline) return;
    if (active.cssHighlights) {
      this.paintCss(active, diagnostics, state?.selectedId ?? null);
      return;
    }
    const marks: ReviewMark[] = diagnostics.map((diagnostic) => ({
      id: diagnostic.id,
      category: diagnostic.category,
      selected: diagnostic.id === state?.selectedId,
      rects: active.target.rangeRects(diagnostic.range),
    }));
    const box = active.target.element.getBoundingClientRect();
    active.ui.paintMarks(marks, diagnostics.length ? box : null);
  }

  private paintCss(
    active: ActiveReview,
    diagnostics: ReviewDiagnostic[],
    selectedId: string | null,
  ): void {
    const api = active.cssHighlights!;
    const byCategory = new Map<ReviewCategory, Range[]>();
    const selected: Range[] = [];
    for (const diagnostic of diagnostics) {
      const range = active.target.domRange(diagnostic.range);
      if (!range) continue;
      const ranges = byCategory.get(diagnostic.category);
      if (ranges) ranges.push(range);
      else byCategory.set(diagnostic.category, [range]);
      if (diagnostic.id === selectedId) selected.push(range.cloneRange());
    }
    for (const category of ["spelling", "grammar", "punctuation", "typography"] as const) {
      const ranges = byCategory.get(category) ?? [];
      const name = REVIEW_HIGHLIGHT_NAMES[category];
      if (ranges.length) api.registry.set(name, new api.Highlight(...ranges));
      else api.registry.delete(name);
    }
    if (selected.length) {
      const highlight = new api.Highlight(...selected);
      highlight.priority = 1;
      api.registry.set(REVIEW_HIGHLIGHT_NAMES.selected, highlight);
    } else {
      api.registry.delete(REVIEW_HIGHLIGHT_NAMES.selected);
    }
  }

  private clearHighlights(active: ActiveReview): void {
    // Only FluentTyper's own names: the page's and other extensions' highlights stay.
    for (const name of Object.values(REVIEW_HIGHLIGHT_NAMES))
      active.cssHighlights?.registry.delete(name);
    active.ui.paintMarks([], null);
  }

  /** The first on-screen rectangle of a finding, or null (the card then sits by the panel). */
  private anchorFor(active: ActiveReview, id: string): DOMRect | null {
    const diagnostic = active.state?.diagnostics.find((d) => d.id === id);
    if (!diagnostic || !active.target.capabilities.inline) return null;
    const view = active.target.element.ownerDocument.defaultView!;
    const box = active.target.element.getBoundingClientRect();
    return (
      active.target
        .rangeRects(diagnostic.range)
        .find(
          (rect) =>
            rect.bottom > Math.max(0, box.top) &&
            rect.top < Math.min(view.innerHeight, box.bottom) &&
            rect.right > box.left &&
            rect.left < box.right,
        ) ?? null
    );
  }

  /** Narrow hit-testing: only a click on a finding's own rectangles opens its card. */
  private hitTest(x: number, y: number): string | null {
    const active = this.active;
    if (!active || active.state?.status !== "ready") return null;
    for (const diagnostic of active.state.diagnostics) {
      for (const rect of active.target.rangeRects(diagnostic.range)) {
        if (x >= rect.left && x <= rect.right && y >= rect.top - 2 && y <= rect.bottom + 2) {
          return diagnostic.id;
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ events

  private onEditorClick(event: MouseEvent): void {
    const active = this.active;
    // The panel may sit inside the editor's tree (designMode): its own clicks are not the editor's.
    if (!active || event.button !== 0 || active.ui.owns(event)) return;
    // A drag that selected text is a selection, not a click on a finding.
    const element = active.target.element;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.selectionStart !== element.selectionEnd) return;
    } else if (element.ownerDocument.getSelection()?.isCollapsed === false) {
      return;
    }
    const id = this.hitTest(event.clientX, event.clientY);
    if (id) this.select(id, { openCard: true, focusList: false });
    else if (active.ui.isCardOpen()) active.ui.closeCard();
  }

  private onEditorKeyDown(event: KeyboardEvent): void {
    const active = this.active;
    if (!active || event.key !== "Escape" || event.isComposing || active.ui.owns(event)) return;
    // Escape closes the card first, then the review.
    event.preventDefault();
    event.stopPropagation();
    if (active.ui.isCardOpen()) {
      active.ui.closeCard();
      active.session.select(null);
    } else {
      this.close();
    }
  }

  private onDocumentPointerDown(event: PointerEvent): void {
    const active = this.active;
    if (!active || !active.ui.isCardOpen() || active.ui.owns(event)) return;
    // A press on the editor is handled by its click (which may open another card).
    if (event.composedPath().includes(active.target.element)) return;
    active.ui.closeCard();
  }

  // ----------------------------------------------------------------- notices

  /** Explains why nothing could be reviewed; closes itself on Escape or its button. */
  private showNotice(key: ReviewTextKey): void {
    const ui = new ReviewUi(
      document,
      this.lang,
      {
        close: () => this.dismissNotice(),
        select: () => {},
        apply: () => {},
        ignore: () => {},
        addToDictionary: () => {},
        fixAll: () => {},
        toggleCategory: () => {},
        navigate: () => {},
      },
      { capabilityKeys: [] },
    );
    ui.showMessage(reviewText(key, this.lang));
    this.notice = ui;
    this.noticeReturnFocus = getDeepActiveElement(document) as HTMLElement | null;
    ui.focusPanel();
  }

  private dismissNotice(): void {
    const notice = this.notice;
    if (!notice) return;
    const returnFocus = notice.hasFocus() ? this.noticeReturnFocus : null;
    notice.destroy();
    this.notice = null;
    this.noticeReturnFocus = null;
    if (returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true });
  }

  dispose(): void {
    this.close();
    this.dismissNotice();
  }
}

/** How often an open review checks for changes that fire no event. */
const SOURCE_POLL_MS = 1000;

/** The open modal dialog holding `element` (across shadow roots), if any. */
function modalDialogOf(element: Element): HTMLDialogElement | null {
  for (let node: Node | null = element; node;) {
    if (node.nodeType === 1 && (node as Element).tagName === "DIALOG") {
      const dialog = node as HTMLDialogElement;
      try {
        if (dialog.matches(":modal")) return dialog;
      } catch {
        // No :modal support: an open dialog is the best signal left.
        if (dialog.open) return dialog;
      }
    }
    const parent: Node | null = node.parentNode;
    node = parent && parent.nodeType === 11 ? ((parent as ShadowRoot).host ?? null) : parent;
  }
  return null;
}
