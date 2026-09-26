import { reviewText } from "@core/domain/grammar/review/reviewMessages";
import { modalDialogOf } from "./ReviewController";
import { editingHost, isReviewEligible } from "./ReviewTargets";

/** Marks FluentTyper's own launcher host; never a review target itself. */
export const REVIEW_LAUNCHER_ATTRIBUTE = "data-fluenttyper-review-launcher";

const BUTTON_PX = 24;
const INSET_PX = 6;
// A field must fit the button with room to spare, and hold some text worth reviewing.
const MIN_WIDTH_PX = 120;
const MIN_HEIGHT_PX = 36;
const MIN_TEXT_CHARS = 3;
// After the last keystroke, how long the button stays hidden.
const TYPING_PAUSE_MS = 900;

export interface ReviewLauncherDependencies {
  /** The setting is on and FluentTyper runs here with review rules (not code mode). */
  isEnabled(): boolean;
  /** False while another FluentTyper control owns the field (the "enable here" icon). */
  canShowFor(field: HTMLElement): boolean;
  /** The field an open review is showing, if any. */
  reviewedElement(): HTMLElement | null;
  /** Reviews `field`; it already holds focus and its selection. */
  review(field: HTMLElement): void;
  uiLanguage?: string;
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
    if (field === field?.ownerDocument.documentElement) field = field.ownerDocument.body;
    if (field?.getAttribute("aria-multiline") === "false") return null;
  }
  return field && isReviewEligible(field) ? field : null;
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
 * focused multi-line field once it holds some text, hides while the user types,
 * and hides while that field's review is open. Clicking it keeps the field's
 * focus and selection and reviews exactly that field.
 */
export class ReviewLauncher {
  private host: HTMLElement | null = null;
  private button: HTMLButtonElement | null = null;
  private field: HTMLElement | null = null;
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private frame: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly view: Window;
  private readonly lang: string;

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
    if (!this.field || !event.composedPath().includes(this.field)) return;
    this.hide();
    if (this.typingTimer !== null) clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => {
      this.typingTimer = null;
      this.refresh();
    }, TYPING_PAUSE_MS);
  };
  private readonly onLayout = () => this.schedule();

  constructor(
    private readonly doc: Document,
    private readonly deps: ReviewLauncherDependencies,
  ) {
    this.view = doc.defaultView ?? window;
    this.lang = deps.uiLanguage ?? navigator.language;
    doc.addEventListener("focusin", this.onFocusIn, true);
    doc.addEventListener("focusout", this.onFocusOut, true);
    doc.addEventListener("input", this.onInput, true);
    this.view.addEventListener("scroll", this.onLayout, { capture: true, passive: true });
    this.view.addEventListener("resize", this.onLayout);
    // Focus that was already inside a field when the launcher started.
    const active = doc.activeElement;
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
    button.hidden = false;
  }

  dispose(): void {
    this.doc.removeEventListener("focusin", this.onFocusIn, true);
    this.doc.removeEventListener("focusout", this.onFocusOut, true);
    this.doc.removeEventListener("input", this.onInput, true);
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
    if (this.typingTimer !== null) clearTimeout(this.typingTimer);
    this.typingTimer = null;
    this.field = field;
    if (field && typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(this.onLayout);
      this.resizeObserver.observe(field);
    }
    this.refresh();
  }

  private shouldShow(field: HTMLElement): boolean {
    if (this.typingTimer !== null || !field.isConnected) return false;
    if (!this.deps.isEnabled() || !this.deps.canShowFor(field)) return false;
    if (this.deps.reviewedElement() === field) return false;
    if (fieldText(field).trim().length < MIN_TEXT_CHARS) return false;
    const rect = field.getBoundingClientRect();
    return rect.width >= MIN_WIDTH_PX && rect.height >= MIN_HEIGHT_PX;
  }

  /** Bottom inline-end corner, inside the field and clear of its scrollbar; false when off-screen. */
  private place(field: HTMLElement, button: HTMLButtonElement): boolean {
    const rect = field.getBoundingClientRect();
    const rtl = this.view.getComputedStyle(field).direction === "rtl";
    const innerLeft = rect.left + field.clientLeft;
    const innerRight = innerLeft + (field.clientWidth || rect.width);
    const innerBottom = rect.top + field.clientTop + (field.clientHeight || rect.height);
    const left = rtl ? innerLeft + INSET_PX : innerRight - INSET_PX - BUTTON_PX;
    const top = innerBottom - INSET_PX - BUTTON_PX;
    const visible =
      top >= 0 &&
      left >= 0 &&
      top + BUTTON_PX <= this.view.innerHeight &&
      left + BUTTON_PX <= this.view.innerWidth;
    button.style.left = `${Math.round(left)}px`;
    button.style.top = `${Math.round(top)}px`;
    return visible;
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

  private ensureButton(field: HTMLElement): HTMLButtonElement {
    // Inside a modal dialog everything outside it is inert: the button goes in the dialog.
    const mount = modalDialogOf(field) ?? this.doc.body ?? this.doc.documentElement;
    if (this.button && this.host?.isConnected && this.host.parentNode === mount) return this.button;
    this.host?.remove();
    const host = this.doc.createElement("div");
    host.setAttribute(REVIEW_LAUNCHER_ATTRIBUTE, "");
    // Never part of an editing host, even on designMode pages.
    host.setAttribute("contenteditable", "false");
    // A viewport-sized, click-through layer the page's CSS cannot reach or move.
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
      "z-index": "2147483000",
      display: "block",
    })) {
      host.style.setProperty(name, value, "important");
    }
    const root = host.attachShadow({ mode: "open" });
    const style = this.doc.createElement("style");
    style.textContent = LAUNCHER_STYLES;
    const button = this.doc.createElement("button");
    button.type = "button";
    button.hidden = true;
    // Not a tab stop: the keyboard shortcut reviews the field without leaving it.
    button.tabIndex = -1;
    const label = reviewText("review_launcher_label", this.lang);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.append(icon(this.doc));
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
    root.append(style, button);
    mount.append(host);
    // The top layer escapes page transforms, stacking contexts and clipping.
    const popover = host as HTMLElement & { showPopover?: () => void };
    if (typeof popover.showPopover === "function") {
      try {
        host.setAttribute("popover", "manual");
        popover.showPopover();
      } catch {
        host.removeAttribute("popover");
      }
    }
    this.host = host;
    this.button = button;
    return button;
  }
}

function icon(doc: Document): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ["M4 7h11", "M4 12h7", "M4 17h5", "m13 17 3 3 5-6"]) {
    const path = doc.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

const LAUNCHER_STYLES = `
:host { all: initial; }
button {
  position: fixed;
  pointer-events: auto;
  width: ${BUTTON_PX}px;
  height: ${BUTTON_PX}px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid rgba(79, 70, 229, 0.45);
  background: #ffffff;
  color: #4338ca;
  box-shadow: 0 2px 8px -2px rgba(15, 23, 42, 0.35);
  cursor: pointer;
  transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
}
button[hidden] { display: none; }
button:hover { transform: scale(1.08); border-color: #4f46e5; box-shadow: 0 4px 12px -4px rgba(79, 70, 229, 0.6); }
svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
@media (prefers-color-scheme: dark) {
  button { background: #1e293b; color: #c7d2fe; border-color: rgba(165, 180, 252, 0.5); }
}
@media (forced-colors: active) {
  button { border-color: ButtonText; background: ButtonFace; color: ButtonText; forced-color-adjust: none; }
}
@media (prefers-reduced-motion: reduce) {
  button { transition: none; }
}
`;
