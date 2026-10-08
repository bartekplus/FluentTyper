import {
  FIELD_ACTION_CHANGE_EVENT,
  fieldActionSlot,
  fieldActionTone,
  styleFieldActionButton,
} from "../FieldActionUi";
import { getDeepActiveElement } from "@core/application/dom-utils";
import { reviewText } from "@core/domain/grammar/review/reviewMessages";
import { reviewMountFor } from "./ReviewController";
import { editorCapabilities } from "../suggestions/EditorCapabilities";
import { editingHost } from "./ReviewTargets";
import { createOverlayHost, enterTopLayer, svgIcon } from "./reviewStyles";
import { gutenbergSelectedField, isGutenbergContainer } from "../suggestions/GutenbergEnvironment";

/** Marks FluentTyper's own launcher host; never a review target itself. */
export const REVIEW_LAUNCHER_ATTRIBUTE = "data-fluenttyper-review-launcher";

const MIN_TEXT_CHARS = 3;

export interface ReviewLauncherDependencies {
  /** The setting is on and FluentTyper runs here with review rules (not code mode). */
  isEnabled(): boolean;
  /** False while another FluentTyper control owns the field (the "enable here" icon). */
  canShowFor(field: HTMLElement): boolean;
  /** The field an open review is showing, if any. */
  reviewedElement(): HTMLElement | null;
  /** Reviews `field`; it already holds focus and its selection. */
  review(field: HTMLElement): void;
  /** UI locale, read on each use so a settings change applies at once. */
  uiLanguage(): string;
}

/**
 * The field a launcher may sit on: a multi-line editor the review can read.
 * Single-line inputs (search boxes, names) get no button.
 */
export function launcherFieldFor(element: Element | null): HTMLElement | null {
  if (!(element instanceof HTMLElement) || element.closest(`[${REVIEW_LAUNCHER_ATTRIBUTE}]`)) {
    return null;
  }
  let field: HTMLElement | null = null;
  if (element.tagName === "TEXTAREA") field = element;
  else if (element.isContentEditable) {
    field = editingHost(element);
    // A Gutenberg canvas is no field itself; the selected RichText field is.
    field = gutenbergSelectedField(field);
    if (field && isGutenbergContainer(field)) return null;
    if (field?.getAttribute("aria-multiline") === "false") return null;
  }
  return field && editorCapabilities(field).renderReview ? field : null;
}

/**
 * Where the launcher can show on `field`, or null when the field never gets one.
 * Other corner controls use it to sit beside the launcher, not under it.
 */
export function reviewLauncherSlot(
  field: HTMLElement,
): { left: number; top: number; size: number } | null {
  return launcherFieldFor(field) === field ? fieldActionSlot(field) : null;
}

function fieldText(field: HTMLElement): string {
  return field.tagName === "TEXTAREA"
    ? (field as HTMLTextAreaElement).value
    : (field.textContent ?? "");
}

/**
 * "Review text" as a button on the field being written in: one small button in
 * the field's bottom inline-end corner, in FluentTyper's own shadow root, so
 * the page's layout, padding and markup are untouched. It appears only on the
 * focused multi-line field once it holds some text and remains visible during
 * typing. It hides while that field's review is open. Clicking it keeps the field's
 * focus and selection and reviews exactly that field.
 */
export class ReviewLauncher {
  private host: HTMLElement | null = null;
  private button: HTMLButtonElement | null = null;
  private field: HTMLElement | null = null;
  private frame: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly view: Window;

  private readonly onFocusIn = (event: Event) => {
    this.setField(launcherFieldFor(event.composedPath()[0] as Element | null));
  };
  private readonly onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as Element | null;
    if (next && this.host?.contains(next)) return;
    // Focus moving within the same editor (a contenteditable's children) keeps it.
    if (next && this.field?.contains(next)) return;
    this.setField(null);
  };
  private readonly onInput = (event: Event) => {
    const path = event.composedPath();
    if (
      !this.field ||
      (!path.includes(this.field) &&
        gutenbergSelectedField(path[0] as Element | null) !== this.field)
    )
      return;
    this.refresh();
  };
  private readonly onLayout = () => this.schedule();
  private readonly onActionChange = () => this.refresh();
  // Inside a Gutenberg editing host, moving to another field fires no focus events.
  private readonly onSelectionChange = () => {
    const active = this.doc.activeElement;
    if (!(active instanceof HTMLElement) || gutenbergSelectedField(active) === active) return;
    const field = launcherFieldFor(active);
    if (field !== this.field) this.setField(field);
  };

  constructor(
    private readonly doc: Document,
    private readonly deps: ReviewLauncherDependencies,
  ) {
    this.view = doc.defaultView ?? window;
    doc.addEventListener("focusin", this.onFocusIn, true);
    doc.addEventListener("focusout", this.onFocusOut, true);
    doc.addEventListener("input", this.onInput, true);
    doc.addEventListener("selectionchange", this.onSelectionChange);
    doc.addEventListener(FIELD_ACTION_CHANGE_EVENT, this.onActionChange);
    this.view.addEventListener("scroll", this.onLayout, { capture: true, passive: true });
    this.view.addEventListener("resize", this.onLayout);
    // Focus that was already inside a field when the launcher started.
    const active = getDeepActiveElement(doc);
    if (active && active !== doc.body) this.setField(launcherFieldFor(active));
  }

  /** Re-evaluates visibility and position (a review opened or closed, settings changed). */
  refresh(): void {
    const field = this.field;
    if (!field || !this.shouldShow(field)) {
      this.hide();
      return;
    }
    const button = this.ensureButton(field);
    if (!this.place(field, button)) {
      this.hide();
      return;
    }
    styleFieldActionButton(
      button,
      fieldActionTone(field),
      button.matches(":hover") ? "hover" : "idle",
    );
    button.hidden = false;
  }

  dispose(): void {
    this.doc.removeEventListener("focusin", this.onFocusIn, true);
    this.doc.removeEventListener("focusout", this.onFocusOut, true);
    this.doc.removeEventListener("input", this.onInput, true);
    this.doc.removeEventListener("selectionchange", this.onSelectionChange);
    this.doc.removeEventListener(FIELD_ACTION_CHANGE_EVENT, this.onActionChange);
    this.view.removeEventListener("scroll", this.onLayout, { capture: true });
    this.view.removeEventListener("resize", this.onLayout);
    this.setField(null);
    if (this.frame !== null) this.view.cancelAnimationFrame(this.frame);
    this.host?.remove();
    this.host = null;
    this.button = null;
  }

  private setField(field: HTMLElement | null): void {
    if (field === this.field) {
      this.refresh();
      return;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.field = field;
    if (field && typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(this.onLayout);
      this.resizeObserver.observe(field);
    }
    this.refresh();
  }

  private shouldShow(field: HTMLElement): boolean {
    if (!field.isConnected) return false;
    if (!this.deps.isEnabled() || !this.deps.canShowFor(field)) return false;
    // A Gutenberg review shows its whole canvas, which contains the focused field.
    if (this.deps.reviewedElement()?.contains(field)) return false;
    if (fieldText(field).trim().length < MIN_TEXT_CHARS) return false;
    return true;
  }

  /** False when off-screen. */
  private place(field: HTMLElement, button: HTMLButtonElement): boolean {
    const slot = reviewLauncherSlot(field);
    if (!slot) return false;
    const { left, top } = slot;
    button.style.left = `${Math.round(left)}px`;
    button.style.top = `${Math.round(top)}px`;
    return true;
  }

  private schedule(): void {
    if (this.frame !== null || !this.field) return;
    this.frame = this.view.requestAnimationFrame(() => {
      this.frame = null;
      this.refresh();
    });
  }

  private hide(): void {
    if (this.button) this.button.hidden = true;
  }

  /** In the current UI language, which can change while the page is open. */
  private label(button: HTMLButtonElement): void {
    const label = reviewText("review_launcher_label", this.deps.uiLanguage());
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  private ensureButton(field: HTMLElement): HTMLButtonElement {
    // Inside a modal dialog everything outside it is inert: the button goes in the dialog.
    // Otherwise it goes on the document element, never in the body: an editable
    // body (TinyMCE and CKEditor 4 frames, designMode) would save it with the text.
    const mount = reviewMountFor(field) ?? this.doc.documentElement;
    if (this.button && this.host?.isConnected && this.host.parentNode === mount) {
      this.label(this.button);
      return this.button;
    }
    this.host?.remove();
    const { host, root } = createOverlayHost(this.doc, REVIEW_LAUNCHER_ATTRIBUTE, 2147483000);
    const style = this.doc.createElement("style");
    style.textContent = LAUNCHER_STYLES;
    const button = this.doc.createElement("button");
    button.type = "button";
    button.hidden = true;
    // Not a tab stop: the keyboard shortcut reviews the field without leaving it.
    button.tabIndex = -1;
    const updateStyle = () => {
      if (this.field)
        styleFieldActionButton(
          button,
          fieldActionTone(this.field),
          button.matches(":hover, :focus-visible") ? "hover" : "idle",
        );
    };
    for (const event of ["mouseenter", "mouseleave", "focus", "blur"])
      button.addEventListener(event, updateStyle);
    button.append(svgIcon(this.doc, ["M4 7h11", "M4 12h7", "M4 17h5", "m13 17 3 3 5-6"]));
    // Keep the field's focus and selection: the review reads both.
    const keepFocus = (event: Event) => event.preventDefault();
    button.addEventListener("pointerdown", keepFocus);
    button.addEventListener("mousedown", keepFocus);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Starting a review only reads, so a scripted click can do no harm.
      const field = this.field;
      if (!field) return;
      this.hide();
      this.deps.review(field);
    });
    this.label(button);
    root.append(style, button);
    mount.append(host);
    enterTopLayer(host);
    this.host = host;
    this.button = button;
    return button;
  }
}

const LAUNCHER_STYLES = `
:host { all: initial; }
button { position: fixed; }
button[hidden] { display: none !important; }
svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
`;
