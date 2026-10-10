import type { FieldEligibility } from "./NativeAutocompleteConflictDetector";
import { clamp } from "@core/domain/guards";
import { isInDocument } from "@core/application/dom-utils";
import { reviewLauncherSlot } from "../review/ReviewLauncher";
import { enterTopLayer } from "../review/reviewStyles";
import { reviewMountFor } from "../review/ReviewController";
import {
  FIELD_ACTION_CHANGE_EVENT,
  FIELD_ACTION_INSET_PX,
  FIELD_ACTION_SIZE_PX,
  fieldActionSlot,
  fieldActionTone,
  styleFieldActionButton,
  trackFieldActionLayout,
  watchFieldActionMedia,
} from "../FieldActionUi";

const BUTTON_SIZE_PX = FIELD_ACTION_SIZE_PX;
const FIELD_INSET_PX = FIELD_ACTION_INSET_PX;
const PADDING_RESERVE_PX = BUTTON_SIZE_PX + FIELD_INSET_PX * 2;
const SUCCESS_STATE_MS = 650;
const INLINE_OBSTACLE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[role='button']",
  "[role='combobox']",
  "[role='textbox']",
].join(", ");

const PAUSED_LABEL_MS = 2200;
const NOTICE_MS = 3000;
const NOTICE_FADE_MS = 300;
const MANUAL_ATTACH_BUTTON_CLASS = "ft-manual-attach-button";
const PAUSED_BADGE_CLASS = "ft-paused-badge";
const MANUAL_ATTACH_TOOLTIP = "Click to enable FluentTyper for this field.";

export type ManualAttachTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
type ManualAttachSurfaceTone = "light" | "dark";

interface ParentPositionState {
  count: number;
  originalPosition: string;
}

interface ManualAttachMountTarget {
  containerParent: HTMLElement | ShadowRoot;
  positioningParent: HTMLElement | null;
}

interface ManualAttachUiHandle {
  positioningParent: HTMLElement | null;
  container: HTMLDivElement;
  button: HTMLButtonElement;
  icon: HTMLImageElement;
  checkmark: HTMLSpanElement;
  surfaceTone: ManualAttachSurfaceTone;
  originalPaddingInlineEnd: string;
  successTimer: ReturnType<typeof setTimeout> | null;
  successPending: boolean;
  stopLayoutTracking: (() => void) | null;
}

export class ManualAttachUiManager {
  private readonly notices = new Map<
    ManualAttachTarget,
    { node: HTMLElement; passive: boolean; stop?: () => void }
  >();
  private readonly handles = new Map<ManualAttachTarget, ManualAttachUiHandle>();
  private readonly parentPositionStates = new Map<HTMLElement, ParentPositionState>();

  constructor(
    private readonly options: {
      iconUrl: string;
      onActivate: (element: ManualAttachTarget) => void;
    },
  ) {}

  public ensureForElement(element: ManualAttachTarget, eligibility?: FieldEligibility): void {
    if (!isInDocument(element)) {
      this.removeForElement(element);
      return;
    }

    const existing = this.handles.get(element);
    if (existing) {
      this.updatePlacement(element, existing);
      existing.surfaceTone = fieldActionTone(element);
      if (!existing.successPending) {
        this.applyIdleState(existing);
      }
      return;
    }

    const mountTarget = this.resolveMountTarget(element);
    const handle = this.createHandle(element, mountTarget);
    if (eligibility?.kind === "manual") {
      const reason = {
        structured: "This field expects structured information.",
        selector: "This field may select an item from a list.",
        browser: "This field has browser-managed suggestions.",
      }[eligibility.reason];
      handle.button.title = `${reason} Enable writing assistance here.`;
      handle.button.setAttribute("aria-label", handle.button.title);
    }
    this.handles.set(element, handle);
    this.updatePlacement(element, handle);
    if (this.shouldReserveInlinePadding(element)) {
      this.applyPadding(element);
    }
    element.ownerDocument.dispatchEvent(new Event(FIELD_ACTION_CHANGE_EVENT));
  }

  public removeForElement(element: ManualAttachTarget): void {
    const handle = this.handles.get(element);
    if (!handle) {
      return;
    }
    this.handles.delete(element);
    handle.stopLayoutTracking?.();
    if (handle.successTimer !== null) {
      clearTimeout(handle.successTimer);
      handle.successTimer = null;
    }
    handle.container.remove();
    this.restorePadding(element, handle);
    if (handle.positioningParent) {
      this.releaseParent(handle.positioningParent);
    }
    element.ownerDocument.dispatchEvent(new Event(FIELD_ACTION_CHANGE_EVENT));
  }

  public removeAll(): void {
    for (const element of this.notices.keys()) this.removeNotice(element);
    for (const element of [...this.handles.keys()]) {
      this.removeForElement(element);
    }
  }

  /**
   * The F badge inside an attached field that FluentTyper paused. With `expand`, a callout
   * above the badge says why and fades after a moment. Hover or focus shows it again.
   */
  public showPausedBadge(
    element: ManualAttachTarget,
    options: {
      label: string;
      hint?: string;
      title: string;
      expand: boolean;
      onActivate?: () => void;
    },
  ): void {
    const existing = this.notices.get(element);
    if (existing?.passive === false) return;
    if (existing?.node.classList.contains(PAUSED_BADGE_CLASS)) return;
    this.removeNotice(element);
    const doc = element.ownerDocument;
    const view = doc.defaultView!;
    const dark = fieldActionTone(element) === "dark";
    const rtl = view.getComputedStyle(element).direction === "rtl";
    const reducedMotion = view.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const node = doc.createElement(options.onActivate ? "button" : "div");
    // Follows the field: page controls such as a search "Clear" can resize it after the badge shows.
    const place = () => {
      const rect = element.getBoundingClientRect();
      // Same spot as the manual attach F: the inline end, centered on one-line fields.
      let left = this.resolveInlineOffset({
        rectStart: rect.left,
        rectSize: rect.width,
        isRtl: rtl,
      });
      let top = rect.top + this.resolveOffsetTop(rect.height, rect.height > 40);
      const review = reviewLauncherSlot(element);
      if (review && top < review.top + review.size && top + BUTTON_SIZE_PX > review.top) {
        // Share the row with the Review button: just before it, centered on it.
        left = rtl
          ? review.left + review.size + FIELD_INSET_PX
          : review.left - FIELD_INSET_PX - BUTTON_SIZE_PX;
        top = review.top + (review.size - BUTTON_SIZE_PX) / 2;
      }
      node.style.left = `${Math.round(left)}px`;
      node.style.top = `${Math.round(top)}px`;
      calloutAbove = top >= 56;
      for (const [part, gap] of [
        [callout, 9],
        [arrow, 5],
      ] as const) {
        part.style.top = calloutAbove ? "" : `calc(100% + ${gap}px)`;
        part.style.bottom = calloutAbove ? `calc(100% + ${gap}px)` : "";
      }
      callout.style.transformOrigin = `${calloutAbove ? "bottom" : "top"} ${rtl ? "left" : "right"}`;
      // Keep the callout on screen when the badge is near the viewport edge.
      callout.style[rtl ? "left" : "right"] = "-6px";
      const box = callout.getBoundingClientRect();
      const overflow = rtl ? box.right - (view.innerWidth - 4) : 4 - box.left;
      if (overflow > 0) callout.style[rtl ? "left" : "right"] = `${-6 - overflow}px`;
    };
    let calloutAbove = true;

    if (options.onActivate) node.setAttribute("type", "button");
    node.className = PAUSED_BADGE_CLASS;
    node.setAttribute("data-ft-suggestion-owned", "true");
    node.title = options.title;
    node.setAttribute("aria-label", options.title);
    if (!options.onActivate) node.setAttribute("role", "status");
    Object.assign(node.style, {
      position: "fixed",
      zIndex: "2147483001",
      boxSizing: "border-box",
      width: `${BUTTON_SIZE_PX}px`,
      height: `${BUTTON_SIZE_PX}px`,
      padding: "0",
      margin: "0",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "999px",
      border: `1px solid ${dark ? "rgba(148, 163, 184, 0.34)" : "rgba(148, 163, 184, 0.24)"}`,
      background: dark ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.94)",
      boxShadow: dark
        ? "0 10px 18px -14px rgba(2, 6, 23, 0.96)"
        : "0 8px 14px -14px rgba(15, 23, 42, 0.4)",
      cursor: options.onActivate ? "pointer" : "default",
      pointerEvents: options.onActivate ? "auto" : "none",
      outline: "none",
      transition: "transform 140ms ease, background-color 140ms ease, border-color 140ms ease",
    });

    const icon = doc.createElement("img");
    icon.alt = "";
    icon.src = this.options.iconUrl;
    icon.draggable = false;
    const iconIdle = { opacity: dark ? "0.7" : "0.5", filter: "grayscale(1)" };
    Object.assign(icon.style, {
      width: "14px",
      height: "14px",
      display: "block",
      pointerEvents: "none",
      transition: "opacity 140ms ease, filter 140ms ease",
      ...iconIdle,
    });

    const pause = doc.createElement("span");
    Object.assign(pause.style, {
      position: "absolute",
      right: "-3px",
      bottom: "-3px",
      display: "inline-flex",
      gap: "1.5px",
      alignItems: "center",
      justifyContent: "center",
      width: "10px",
      height: "10px",
      borderRadius: "999px",
      background: dark ? "#fbbf24" : "#b45309",
      boxShadow: `0 0 0 1.5px ${dark ? "#0f172a" : "#ffffff"}`,
      pointerEvents: "none",
      transition: "opacity 140ms ease",
    });
    for (let bar = 0; bar < 2; bar += 1) {
      const line = doc.createElement("span");
      Object.assign(line.style, {
        width: "1.5px",
        height: "5px",
        borderRadius: "1px",
        background: dark ? "#0f172a" : "#ffffff",
      });
      pause.append(line);
    }

    const checkmark = doc.createElement("span");
    checkmark.textContent = "✓";
    Object.assign(checkmark.style, {
      position: "absolute",
      inset: "0",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      font: "800 12px/1 system-ui, sans-serif",
      color: dark ? "#d1fae5" : "#047857",
      opacity: "0",
      transform: "scale(0.6)",
      transition: "opacity 140ms ease, transform 140ms ease",
      pointerEvents: "none",
    });

    // The callout: dark on light pages, light on dark pages, with an arrow to the badge.
    const calloutBg = dark ? "#f8fafc" : "#1e293b";
    const callout = doc.createElement("span");
    Object.assign(callout.style, {
      position: "absolute",
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      padding: "7px 10px",
      borderRadius: "8px",
      background: calloutBg,
      color: dark ? "#0f172a" : "#f8fafc",
      boxShadow: "0 10px 24px -12px rgba(15, 23, 42, 0.6)",
      font: "500 12px/1.3 system-ui, sans-serif",
      textAlign: rtl ? "right" : "left",
      whiteSpace: "nowrap",
      pointerEvents: "none",
    });
    const title = doc.createElement("span");
    title.textContent = options.label;
    callout.append(title);
    if (options.hint) {
      const hint = doc.createElement("span");
      hint.textContent = options.hint;
      Object.assign(hint.style, { opacity: "0.72", fontWeight: "400" });
      callout.append(hint);
    }
    const arrow = doc.createElement("span");
    Object.assign(arrow.style, {
      position: "absolute",
      left: "50%",
      width: "8px",
      height: "8px",
      marginLeft: "-4px",
      background: calloutBg,
      transform: "rotate(45deg)",
      pointerEvents: "none",
    });
    const motion = reducedMotion
      ? "opacity 160ms ease"
      : "opacity 180ms ease, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
    for (const part of [callout, arrow]) part.style.transition = motion;

    let pinned = options.expand;
    let done = false;
    const setOpen = (open: boolean) => {
      const shown = open && !done;
      const shift = calloutAbove ? "4px" : "-4px";
      callout.style.opacity = arrow.style.opacity = shown ? "1" : "0";
      callout.style.transform =
        shown || reducedMotion ? "none" : `translateY(${shift}) scale(0.96)`;
      arrow.style.transform = `rotate(45deg)${shown || reducedMotion ? "" : ` translate(${shift}, ${shift})`}`;
      Object.assign(icon.style, shown ? { opacity: "1", filter: "none" } : iconIdle);
      node.style.transform = shown && options.onActivate ? "scale(1.05)" : "scale(1)";
    };
    setOpen(false);
    node.append(icon, pause, checkmark, arrow, callout);
    node.addEventListener("mouseenter", () => setOpen(true));
    node.addEventListener("mouseleave", () => setOpen(pinned));
    if (options.onActivate) {
      const onActivate = options.onActivate;
      // Keep focus in the field: a blur removes the badge before the click lands.
      const keepFocus = (event: Event) => event.preventDefault();
      node.addEventListener("mousedown", keepFocus);
      node.addEventListener("pointerdown", keepFocus);
      node.addEventListener("focus", () => setOpen(true));
      node.addEventListener("blur", () => setOpen(pinned));
      node.addEventListener("click", () => {
        if (done) return;
        done = true;
        setOpen(false);
        // The badge leaves the notice map so the resume does not cut the check short.
        if (this.notices.get(element)?.node === node) this.notices.delete(element);
        Object.assign(node.style, {
          background: dark ? "rgba(6, 78, 59, 0.94)" : "rgba(236, 253, 245, 0.98)",
          borderColor: dark ? "rgba(52, 211, 153, 0.48)" : "rgba(16, 185, 129, 0.32)",
          transform: "scale(1.08)",
        });
        icon.style.opacity = pause.style.opacity = "0";
        Object.assign(checkmark.style, { opacity: "1", transform: "scale(1)" });
        onActivate();
        setTimeout(() => {
          stop();
          node.remove();
        }, SUCCESS_STATE_MS);
      });
    }
    doc.documentElement.append(node);
    place();
    const stop = trackFieldActionLayout(element, place);
    this.notices.set(element, { node, passive: true, stop });
    if (options.expand) {
      void node.offsetWidth; // Start the transition from the hidden state.
      setOpen(true);
      setTimeout(() => {
        pinned = false;
        if (!node.matches(":hover, :focus")) setOpen(false);
      }, PAUSED_LABEL_MS);
    }
  }

  public showNotice(
    element: ManualAttachTarget,
    message: string,
    remember?: () => Promise<void>,
  ): void {
    this.removeNotice(element);
    const node = element.ownerDocument.createElement("div");
    node.setAttribute("data-ft-suggestion-owned", "true");
    node.setAttribute("role", "status");
    const rect = element.getBoundingClientRect();
    const action = this.isMultilineTarget(element)
      ? fieldActionSlot(element, PADDING_RESERVE_PX)
      : null;
    const noticeTop = Math.max(rect.bottom, action ? action.top + action.size : 0) + 4;
    Object.assign(node.style, {
      position: "fixed",
      left: `${Math.max(4, Math.min(rect.left, element.ownerDocument.defaultView!.innerWidth - 290))}px`,
      top: `${Math.min(noticeTop, element.ownerDocument.defaultView!.innerHeight - 110)}px`,
      zIndex: "2147483001",
      maxWidth: "280px",
      padding: "8px",
      background: "Canvas",
      color: "CanvasText",
      border: "1px solid GrayText",
      borderRadius: "6px",
      font: "13px system-ui",
      pointerEvents: "auto",
    });
    const text = element.ownerDocument.createElement("span");
    text.style.display = "block";
    text.style.marginBottom = "8px";
    text.textContent = message;
    node.append(text);
    if (remember) {
      const button = element.ownerDocument.createElement("button");
      button.type = "button";
      button.textContent = "Remember for this field";
      button.addEventListener("click", () => {
        void (async () => {
          button.disabled = true;
          try {
            await remember();
            text.textContent = "Remembered. Manage saved fields in Site settings.";
            button.remove();
          } catch (error) {
            text.textContent =
              error instanceof Error ? error.message : "Could not remember this field.";
            button.disabled = false;
          }
        })();
      });
      node.append(button);
    }
    const close = element.ownerDocument.createElement("button");
    close.type = "button";
    close.textContent = "Dismiss";
    close.addEventListener("click", () => this.removeNotice(element));
    node.append(close);
    for (const button of node.querySelectorAll("button")) {
      Object.assign(button.style, {
        font: "inherit",
        padding: "5px 8px",
        marginRight: "6px",
        border: "1px solid GrayText",
        borderRadius: "4px",
        background: "ButtonFace",
        color: "ButtonText",
        cursor: "pointer",
      });
    }
    element.ownerDocument.documentElement.append(node);
    this.notices.set(element, { node, passive: false });
    // Without a choice to make, the notice is only a confirmation: fade it out.
    if (!remember) this.fadeOutNotice(element, node);
  }

  private fadeOutNotice(element: ManualAttachTarget, node: HTMLElement): void {
    const view = element.ownerDocument.defaultView;
    const fade = () => {
      if (this.notices.get(element)?.node !== node) return;
      if (node.matches(":hover, :focus-within")) {
        node.addEventListener("mouseleave", fade, { once: true });
        node.addEventListener("focusout", fade, { once: true });
        return;
      }
      const reducedMotion = view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      node.style.transition = reducedMotion ? "none" : `opacity ${NOTICE_FADE_MS}ms ease`;
      node.style.opacity = "0";
      setTimeout(
        () => {
          if (this.notices.get(element)?.node === node) this.removeNotice(element);
        },
        reducedMotion ? 0 : NOTICE_FADE_MS,
      );
    };
    setTimeout(fade, NOTICE_MS);
  }

  public removeNotice(element: ManualAttachTarget, passiveOnly = false): void {
    const notice = this.notices.get(element);
    if (!notice || (passiveOnly && !notice.passive)) return;
    notice.stop?.();
    notice.node.remove();
    this.notices.delete(element);
    element.ownerDocument.dispatchEvent(new Event(FIELD_ACTION_CHANGE_EVENT));
  }

  public pruneNotices(): void {
    for (const element of this.notices.keys()) if (!element.isConnected) this.removeNotice(element);
  }

  public targets(): IterableIterator<ManualAttachTarget> {
    return this.handles.keys();
  }

  public has(element: ManualAttachTarget): boolean {
    return this.handles.has(element);
  }

  public isSuccessPending(element: ManualAttachTarget): boolean {
    return this.handles.get(element)?.successPending === true;
  }

  private createHandle(
    element: ManualAttachTarget,
    mountTarget: ManualAttachMountTarget,
  ): ManualAttachUiHandle {
    const positioningParent = this.isMultilineTarget(element)
      ? null
      : mountTarget.positioningParent;
    if (positioningParent) {
      this.reserveParent(positioningParent);
    }

    const container = element.ownerDocument.createElement("div");
    container.className = "ft-manual-attach";
    container.setAttribute("data-ft-suggestion-owned", "true");
    container.setAttribute("contenteditable", "false");
    Object.assign(container.style, {
      position: positioningParent === null ? "fixed" : "absolute",
      inset: "auto",
      margin: "0",
      padding: "0",
      border: "0",
      background: "transparent",
      zIndex: "2147483000",
      width: `${BUTTON_SIZE_PX}px`,
      height: `${BUTTON_SIZE_PX}px`,
      pointerEvents: "none",
    });

    const button = element.ownerDocument.createElement("button");
    button.type = "button";
    button.className = MANUAL_ATTACH_BUTTON_CLASS;
    button.title = MANUAL_ATTACH_TOOLTIP;
    button.setAttribute("aria-label", MANUAL_ATTACH_TOOLTIP);
    button.style.position = "relative";

    const icon = element.ownerDocument.createElement("img");
    icon.alt = "";
    icon.src = this.options.iconUrl;
    icon.draggable = false;
    Object.assign(icon.style, {
      width: "16px",
      height: "16px",
      display: "block",
      transition: "var(--ft-field-action-transition)",
      pointerEvents: "none",
    });

    const checkmark = element.ownerDocument.createElement("span");
    checkmark.textContent = "✓";
    Object.assign(checkmark.style, {
      position: "absolute",
      inset: "0",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "12px",
      fontWeight: "800",
      color: "#047857",
      opacity: "0",
      transform: "scale(0.6)",
      transition: "var(--ft-field-action-transition)",
      pointerEvents: "none",
    });

    const handle: ManualAttachUiHandle = {
      positioningParent,
      container,
      button,
      icon,
      checkmark,
      surfaceTone: fieldActionTone(element),
      originalPaddingInlineEnd: this.getInlineEndPaddingStyleValue(element),
      successTimer: null,
      successPending: false,
      stopLayoutTracking: null,
    };

    const enterHover = () => {
      if (!handle.successPending) {
        this.applyHoverState(handle);
      }
    };
    const leaveHover = () => {
      if (!handle.successPending) {
        this.applyIdleState(handle);
      }
    };
    const preventBlur = (event: Event) => {
      event.preventDefault();
    };
    const activate = () => {
      if (handle.successPending) {
        return;
      }
      handle.successPending = true;
      this.applySuccessState(handle);
      this.options.onActivate(element);
      handle.successTimer = setTimeout(() => {
        this.removeForElement(element);
      }, SUCCESS_STATE_MS);
    };

    button.addEventListener("mouseenter", enterHover);
    button.addEventListener("mouseleave", leaveHover);
    button.addEventListener("focus", enterHover);
    button.addEventListener("blur", leaveHover);
    button.addEventListener("mousedown", preventBlur);
    button.addEventListener("pointerdown", preventBlur);
    button.addEventListener("click", activate);

    button.append(icon, checkmark);
    container.appendChild(button);
    mountTarget.containerParent.appendChild(container);
    if (this.isMultilineTarget(element) && !enterTopLayer(container)) {
      const modal = reviewMountFor(element);
      if (modal) {
        handle.positioningParent = modal;
        this.reserveParent(modal);
        container.style.position = "absolute";
      }
      (modal ?? element.ownerDocument.documentElement).appendChild(container);
    }
    const refreshAppearance = () => {
      handle.surfaceTone = fieldActionTone(element);
      if (handle.successPending) this.applySuccessState(handle);
      else if (button.matches(":hover")) this.applyHoverState(handle);
      else this.applyIdleState(handle);
    };
    if (positioningParent === null) {
      handle.stopLayoutTracking = trackFieldActionLayout(element, () => {
        if (isInDocument(element)) {
          this.updatePlacement(element, handle);
          refreshAppearance();
        } else this.removeForElement(element);
      });
    } else {
      handle.stopLayoutTracking = watchFieldActionMedia(element, refreshAppearance);
    }
    this.applyIdleState(handle);

    return handle;
  }

  private applyIdleState(handle: ManualAttachUiHandle): void {
    const isDarkSurface = handle.surfaceTone === "dark";
    styleFieldActionButton(handle.button, handle.surfaceTone, "idle");
    Object.assign(handle.icon.style, {
      opacity: isDarkSurface ? "0.96" : "0.72",
      filter: isDarkSurface
        ? "drop-shadow(0 1px 2px rgba(2, 6, 23, 0.45))"
        : "grayscale(0.24) saturate(0.78) contrast(1.02)",
    });
    Object.assign(handle.checkmark.style, {
      opacity: "0",
      transform: "scale(0.6)",
    });
  }

  private applyHoverState(handle: ManualAttachUiHandle): void {
    const isDarkSurface = handle.surfaceTone === "dark";
    styleFieldActionButton(handle.button, handle.surfaceTone, "hover");
    Object.assign(handle.icon.style, {
      opacity: "1",
      filter: isDarkSurface ? "drop-shadow(0 1px 2px rgba(2, 6, 23, 0.42))" : "none",
    });
    Object.assign(handle.checkmark.style, {
      opacity: "0",
      transform: "scale(0.6)",
    });
  }

  private applySuccessState(handle: ManualAttachUiHandle): void {
    const isDarkSurface = handle.surfaceTone === "dark";
    styleFieldActionButton(handle.button, handle.surfaceTone, "success");
    Object.assign(handle.icon.style, {
      opacity: "0",
      filter: "none",
    });
    Object.assign(handle.checkmark.style, {
      color: isDarkSurface ? "#d1fae5" : "#047857",
      opacity: "1",
      transform: "scale(1)",
    });
  }

  /**
   * The box the page paints for an input: its own border, or a near wrapper's or a
   * notched-outline fieldset's border (Agoda, MUI). The input itself can overflow that box.
   */
  private resolvePaintedBox(element: ManualAttachTarget): DOMRect {
    const rect = element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView;
    if (!view || element.isContentEditable) return rect;
    const middle = rect.top + rect.height / 2;
    const painted = (candidate: Element) => {
      const style = view.getComputedStyle(candidate);
      return (["Top", "Right", "Bottom", "Left"] as const).some(
        (side) =>
          Number.parseFloat(style[`border${side}Width`]) > 0 &&
          style[`border${side}Style`] !== "none",
      );
    };
    let node: Element | null = element;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      if (node.getBoundingClientRect().height > rect.height + 40) break;
      const outlines = depth === 0 ? [] : node.querySelectorAll(":scope > fieldset");
      for (const candidate of [node, ...outlines]) {
        const box = candidate.getBoundingClientRect();
        if (
          box.top > middle ||
          box.bottom < middle ||
          box.right <= rect.left ||
          !painted(candidate)
        )
          continue;
        const legend =
          candidate.tagName === "FIELDSET" ? candidate.querySelector(":scope > legend") : null;
        const notch = legend ? legend.getBoundingClientRect().height / 2 : 0;
        // Clamp sideways only, so trailing icons in a wider wrapper keep their space.
        const left = Math.max(rect.left, box.left);
        return new DOMRect(
          left,
          box.top + notch,
          Math.min(rect.right, box.right) - left,
          box.height - notch,
        );
      }
    }
    return rect;
  }

  private updatePlacement(element: ManualAttachTarget, handle: ManualAttachUiHandle): void {
    const elementRect = this.isMultilineTarget(element)
      ? element.getBoundingClientRect()
      : this.resolvePaintedBox(element);
    const isTextarea = element.tagName.toLowerCase() === "textarea";
    const isContentEditableTarget = !isTextarea && element.isContentEditable;
    if (this.isMultilineTarget(element)) {
      const slot = fieldActionSlot(element, PADDING_RESERVE_PX);
      handle.container.hidden = !slot;
      handle.container.style.display = slot ? "" : "none";
      if (!slot) return;
      const parent = handle.positioningParent;
      const parentRect = parent?.getBoundingClientRect();
      const scaleX = parent?.offsetWidth ? parentRect!.width / parent.offsetWidth : 1;
      const scaleY = parent?.offsetHeight ? parentRect!.height / parent.offsetHeight : 1;
      if (!scaleX || !scaleY) {
        handle.container.hidden = true;
        return;
      }
      handle.container.style.left = `${Math.round((slot.left - (parentRect?.left ?? 0)) / scaleX - (parent?.clientLeft ?? 0) + (parent?.scrollLeft ?? 0))}px`;
      handle.container.style.top = `${Math.round((slot.top - (parentRect?.top ?? 0)) / scaleY - (parent?.clientTop ?? 0) + (parent?.scrollTop ?? 0))}px`;
      if (parent) {
        // ponytail: modal fallback handles translation and scale. Use matrix mapping if a modal rotates or skews.
        handle.container.style.transformOrigin = "top left";
        handle.container.style.transform = `scale(${1 / scaleX}, ${1 / scaleY})`;
      }
      return;
    }
    handle.container.hidden = false;
    const isRtl = element.ownerDocument.defaultView?.getComputedStyle(element).direction === "rtl";
    const inlineObstacle = isContentEditableTarget
      ? this.resolveInlineObstacle(element, handle, isRtl)
      : null;
    const offsetTop = this.resolveOffsetTop(
      elementRect.height,
      isTextarea || isContentEditableTarget,
    );
    // Without a positioning parent the container is fixed to the viewport.
    const parentRect = handle.positioningParent?.getBoundingClientRect();
    const parentLeft = parentRect?.left ?? 0;
    const left = this.resolveInlineOffset({
      rectStart: elementRect.left - parentLeft,
      rectSize: elementRect.width,
      isRtl,
      obstacleStart: inlineObstacle ? inlineObstacle.start - parentLeft : undefined,
      obstacleEnd: inlineObstacle ? inlineObstacle.end - parentLeft : undefined,
    });
    const top = Math.max(0, elementRect.top - (parentRect?.top ?? 0) + offsetTop);

    handle.container.style.left = `${Math.round(left)}px`;
    handle.container.style.top = `${Math.round(top)}px`;
  }

  private resolveInlineOffset(options: {
    rectStart: number;
    rectSize: number;
    isRtl: boolean;
    obstacleStart?: number;
    obstacleEnd?: number;
  }): number {
    let minOffset = options.rectStart;
    let maxOffset = options.rectStart + Math.max(0, options.rectSize - BUTTON_SIZE_PX);
    if (typeof options.obstacleStart === "number" && !options.isRtl) {
      maxOffset = Math.min(maxOffset, options.obstacleStart - BUTTON_SIZE_PX - FIELD_INSET_PX);
    }
    if (typeof options.obstacleEnd === "number" && options.isRtl) {
      minOffset = Math.max(minOffset, options.obstacleEnd + FIELD_INSET_PX);
    }
    const desired = options.isRtl
      ? options.rectStart + FIELD_INSET_PX
      : options.rectStart + options.rectSize - BUTTON_SIZE_PX - FIELD_INSET_PX;
    return clamp(desired, minOffset, maxOffset);
  }

  private resolveInlineObstacle(
    element: ManualAttachTarget,
    handle: ManualAttachUiHandle,
    isRtl: boolean,
  ): { start: number; end: number } | null {
    const positioningParent = handle.positioningParent;
    if (!positioningParent) {
      return null;
    }
    const layoutParent = positioningParent.parentElement;
    const elementRect = element.getBoundingClientRect();
    const elementMidpoint = elementRect.left + elementRect.width / 2;
    // Only consider peer layout boxes around the editor. Deep descendants inside
    // complex editors (like Slack) can appear/disappear while typing and should
    // not yank the manual-attach control around.
    const sameWrapperCandidates = Array.from(positioningParent.children).filter(
      (candidate): candidate is HTMLElement =>
        candidate instanceof HTMLElement &&
        candidate !== element &&
        candidate !== handle.container &&
        this.isInlineObstacleCandidate(candidate) &&
        !element.contains(candidate) &&
        !candidate.contains(element),
    );
    const siblingCandidates = layoutParent
      ? Array.from(layoutParent.children).filter(
          (candidate): candidate is HTMLElement =>
            candidate instanceof HTMLElement && candidate !== positioningParent,
        )
      : [];
    const obstacles = [...sameWrapperCandidates, ...siblingCandidates]
      .map((candidate) => candidate.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .filter((rect) => rect.bottom > elementRect.top && rect.top < elementRect.bottom)
      .filter((rect) => (isRtl ? rect.right <= elementMidpoint : rect.left >= elementMidpoint));
    if (obstacles.length === 0) {
      return null;
    }
    const nearest = obstacles.reduce((best, rect) =>
      (isRtl ? rect.right > best.right : rect.left < best.left) ? rect : best,
    );
    return { start: nearest.left, end: nearest.right };
  }

  private isInlineObstacleCandidate(candidate: HTMLElement): boolean {
    return (
      candidate.getAttribute("aria-hidden") !== "true" &&
      (candidate.matches(INLINE_OBSTACLE_SELECTOR) ||
        candidate.querySelector(INLINE_OBSTACLE_SELECTOR) instanceof HTMLElement)
    );
  }

  private resolveOffsetTop(height: number, prefersTopInset: boolean): number {
    const maxOffset = Math.max(0, height - BUTTON_SIZE_PX);
    const desired = prefersTopInset ? FIELD_INSET_PX : Math.max(0, (height - BUTTON_SIZE_PX) / 2);
    return clamp(desired, 0, maxOffset);
  }

  private resolveMountTarget(element: ManualAttachTarget): ManualAttachMountTarget {
    const { ownerDocument } = element;
    const { parentElement } = element;
    if (parentElement) {
      return { containerParent: parentElement, positioningParent: parentElement };
    }
    const root = element.getRootNode();
    if (root.nodeType === 11 && "host" in root) {
      return { containerParent: root as ShadowRoot, positioningParent: null };
    }
    return { containerParent: ownerDocument.body, positioningParent: ownerDocument.body };
  }

  private reserveParent(parent: HTMLElement): void {
    const existing = this.parentPositionStates.get(parent);
    if (existing) {
      existing.count += 1;
      return;
    }

    const computedPosition = parent.ownerDocument.defaultView?.getComputedStyle(parent).position;
    this.parentPositionStates.set(parent, {
      count: 1,
      originalPosition: parent.style.position,
    });
    if (!computedPosition || computedPosition === "static") {
      parent.style.position = "relative";
    }
  }

  private releaseParent(parent: HTMLElement): void {
    const existing = this.parentPositionStates.get(parent);
    if (!existing) {
      return;
    }
    if (--existing.count > 0) {
      return;
    }
    parent.style.position = existing.originalPosition;
    this.parentPositionStates.delete(parent);
  }

  private applyPadding(element: ManualAttachTarget): void {
    const computedStyle = element.ownerDocument.defaultView?.getComputedStyle(element);
    const computedPadding =
      Number.parseFloat(
        (computedStyle?.direction === "rtl"
          ? computedStyle.paddingLeft
          : computedStyle?.paddingRight) || "",
      ) || 0;
    const nextPadding = Math.ceil(computedPadding + PADDING_RESERVE_PX);
    const original = this.getInlineEndPaddingStyleValue(element);
    const width = element.getBoundingClientRect().width;
    this.setInlineEndPaddingStyleValue(element, `${nextPadding}px`);
    // A content-box or auto-width field grows with padding and moves the page (Agoda's
    // auto-sized sign-in iframe resizes), so the button overlays the field end instead.
    if (Math.abs(element.getBoundingClientRect().width - width) > 0.5) {
      this.setInlineEndPaddingStyleValue(element, original);
    }
  }

  private restorePadding(element: ManualAttachTarget, handle: ManualAttachUiHandle): void {
    if (this.shouldReserveInlinePadding(element)) {
      this.setInlineEndPaddingStyleValue(element, handle.originalPaddingInlineEnd);
    }
  }

  private isMultilineTarget(element: ManualAttachTarget): boolean {
    return (
      element.tagName === "TEXTAREA" ||
      (element.isContentEditable && element.getAttribute("aria-multiline") !== "false")
    );
  }

  private shouldReserveInlinePadding(element: ManualAttachTarget): boolean {
    return !element.isContentEditable && !this.isMultilineTarget(element);
  }

  private getInlineEndPaddingStyleValue(element: ManualAttachTarget): string {
    const direction = element.ownerDocument.defaultView?.getComputedStyle(element).direction;
    return direction === "rtl" ? element.style.paddingLeft : element.style.paddingRight;
  }

  private setInlineEndPaddingStyleValue(element: ManualAttachTarget, value: string): void {
    const direction = element.ownerDocument.defaultView?.getComputedStyle(element).direction;
    element.style[direction === "rtl" ? "paddingLeft" : "paddingRight"] = value;
  }
}

export function resolveManualAttachIconUrl(): string {
  const runtime = (
    globalThis as typeof globalThis & {
      chrome?: { runtime?: { getURL?: (path: string) => string } };
    }
  ).chrome?.runtime;
  if (typeof runtime?.getURL === "function") {
    return runtime.getURL("icon/icon16.png");
  }
  return "/icon/icon16.png";
}
