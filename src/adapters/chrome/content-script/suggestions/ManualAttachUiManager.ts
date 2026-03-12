import { isInDocument } from "@core/application/dom-utils";

const BUTTON_SIZE_PX = 18;
const FIELD_INSET_PX = 8;
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

export const MANUAL_ATTACH_BUTTON_CLASS = "ft-manual-attach-button";
export const MANUAL_ATTACH_TOOLTIP = "Click to enable FluentTyper for this field.";

export type ManualAttachTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface ParentPositionState {
  count: number;
  originalPosition: string;
}

interface ManualAttachMountTarget {
  containerParent: HTMLElement | ShadowRoot;
  positioningParent: HTMLElement | null;
}

interface ManualAttachUiHandle {
  containerParent: HTMLElement | ShadowRoot;
  positioningParent: HTMLElement | null;
  usesViewportPositioning: boolean;
  container: HTMLDivElement;
  button: HTMLButtonElement;
  icon: HTMLImageElement;
  checkmark: HTMLSpanElement;
  originalPaddingInlineEnd: string;
  successTimer: ReturnType<typeof setTimeout> | null;
  successPending: boolean;
}

export class ManualAttachUiManager {
  private readonly iconUrl: string;
  private readonly onActivate: (element: ManualAttachTarget) => void;
  private readonly handles = new Map<ManualAttachTarget, ManualAttachUiHandle>();
  private readonly parentPositionStates = new Map<HTMLElement, ParentPositionState>();

  constructor(options: { iconUrl: string; onActivate: (element: ManualAttachTarget) => void }) {
    this.iconUrl = options.iconUrl;
    this.onActivate = options.onActivate;
  }

  public ensureForElement(element: ManualAttachTarget): void {
    if (!isInDocument(element)) {
      this.removeForElement(element);
      return;
    }

    const existing = this.handles.get(element);
    if (existing) {
      this.updatePlacement(element, existing);
      if (!existing.successPending) {
        this.applyIdleState(existing);
      }
      return;
    }

    const mountTarget = this.resolveMountTarget(element);
    const handle = this.createHandle(element, mountTarget);
    this.handles.set(element, handle);
    this.updatePlacement(element, handle);
    if (this.shouldReserveInlinePadding(element)) {
      this.applyPadding(element);
    }
  }

  public removeForElement(element: ManualAttachTarget): void {
    const handle = this.handles.get(element);
    if (!handle) {
      return;
    }
    this.handles.delete(element);
    if (handle.successTimer !== null) {
      clearTimeout(handle.successTimer);
      handle.successTimer = null;
    }
    handle.container.remove();
    this.restorePadding(element, handle);
    if (handle.positioningParent) {
      this.releaseParent(handle.positioningParent);
    }
  }

  public removeAll(): void {
    for (const element of [...this.handles.keys()]) {
      this.removeForElement(element);
    }
  }

  public targets(): IterableIterator<ManualAttachTarget> {
    return this.handles.keys();
  }

  public isSuccessPending(element: ManualAttachTarget): boolean {
    return this.handles.get(element)?.successPending === true;
  }

  private createHandle(
    element: ManualAttachTarget,
    mountTarget: ManualAttachMountTarget,
  ): ManualAttachUiHandle {
    if (mountTarget.positioningParent) {
      this.reserveParent(mountTarget.positioningParent);
    }

    const container = element.ownerDocument.createElement("div");
    container.className = "ft-manual-attach";
    Object.assign(container.style, {
      position: mountTarget.positioningParent === null ? "fixed" : "absolute",
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
    Object.assign(button.style, {
      width: `${BUTTON_SIZE_PX}px`,
      height: `${BUTTON_SIZE_PX}px`,
      position: "relative",
      borderRadius: "999px",
      border: "1px solid transparent",
      padding: "0",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "auto",
      cursor: "pointer",
      transition:
        "transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease, border-color 140ms ease",
      outline: "none",
    });

    const icon = element.ownerDocument.createElement("img");
    icon.alt = "";
    icon.src = this.iconUrl;
    icon.draggable = false;
    Object.assign(icon.style, {
      width: "16px",
      height: "16px",
      display: "block",
      transition: "opacity 140ms ease, filter 140ms ease",
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
      transition: "opacity 140ms ease, transform 140ms ease",
      pointerEvents: "none",
    });

    const handle: ManualAttachUiHandle = {
      containerParent: mountTarget.containerParent,
      positioningParent: mountTarget.positioningParent,
      usesViewportPositioning: mountTarget.positioningParent === null,
      container,
      button,
      icon,
      checkmark,
      originalPaddingInlineEnd: this.getInlineEndPaddingStyleValue(element),
      successTimer: null,
      successPending: false,
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
      this.onActivate(element);
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
    this.applyIdleState(handle);

    return handle;
  }

  private applyIdleState(handle: ManualAttachUiHandle): void {
    Object.assign(handle.button.style, {
      backgroundColor: "rgba(255, 255, 255, 0.82)",
      borderColor: "transparent",
      boxShadow: "none",
      transform: "scale(1)",
    });
    Object.assign(handle.icon.style, {
      opacity: "0.55",
      filter: "grayscale(1) saturate(0) contrast(0.98)",
    });
    Object.assign(handle.checkmark.style, {
      opacity: "0",
      transform: "scale(0.6)",
    });
  }

  private applyHoverState(handle: ManualAttachUiHandle): void {
    Object.assign(handle.button.style, {
      backgroundColor: "rgba(255, 255, 255, 0.96)",
      borderColor: "rgba(14, 165, 233, 0.24)",
      boxShadow: "0 6px 14px -10px rgba(14, 165, 233, 0.9)",
      transform: "scale(1.05)",
    });
    Object.assign(handle.icon.style, {
      opacity: "1",
      filter: "none",
    });
    Object.assign(handle.checkmark.style, {
      opacity: "0",
      transform: "scale(0.6)",
    });
  }

  private applySuccessState(handle: ManualAttachUiHandle): void {
    Object.assign(handle.button.style, {
      backgroundColor: "rgba(236, 253, 245, 0.98)",
      borderColor: "rgba(16, 185, 129, 0.32)",
      boxShadow: "0 8px 18px -12px rgba(4, 120, 87, 0.95)",
      transform: "scale(1.08)",
    });
    Object.assign(handle.icon.style, {
      opacity: "0",
      filter: "none",
    });
    Object.assign(handle.checkmark.style, {
      opacity: "1",
      transform: "scale(1)",
    });
  }

  private updatePlacement(element: ManualAttachTarget, handle: ManualAttachUiHandle): void {
    const elementRect = element.getBoundingClientRect();
    const isTextarea = element.tagName.toLowerCase() === "textarea";
    const isContentEditableTarget = !isTextarea && element.isContentEditable;
    const isRtl = element.ownerDocument.defaultView?.getComputedStyle(element).direction === "rtl";
    const inlineObstacle = isContentEditableTarget
      ? this.resolveInlineObstacle(element, handle, isRtl)
      : null;
    const offsetTop = this.resolveOffsetTop(elementRect.height, {
      prefersTopInset: isTextarea || isContentEditableTarget,
    });
    if (handle.usesViewportPositioning) {
      const left = this.resolveInlineOffset({
        rectStart: elementRect.left,
        rectSize: elementRect.width,
        isRtl,
        obstacleStart: inlineObstacle?.start,
        obstacleEnd: inlineObstacle?.end,
      });
      const top = Math.max(0, elementRect.top + offsetTop);
      handle.container.style.left = `${Math.round(left)}px`;
      handle.container.style.top = `${Math.round(top)}px`;
      return;
    }

    const parentRect = handle.positioningParent?.getBoundingClientRect();
    const left = this.resolveInlineOffset({
      rectStart: elementRect.left - (parentRect?.left ?? 0),
      rectSize: elementRect.width,
      isRtl,
      obstacleStart:
        typeof inlineObstacle?.start === "number"
          ? inlineObstacle.start - (parentRect?.left ?? 0)
          : undefined,
      obstacleEnd:
        typeof inlineObstacle?.end === "number"
          ? inlineObstacle.end - (parentRect?.left ?? 0)
          : undefined,
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
    return this.clampToRange(desired, minOffset, maxOffset);
  }

  private resolveInlineObstacle(
    element: ManualAttachTarget,
    handle: ManualAttachUiHandle,
    isRtl: boolean,
  ): { start: number; end: number } | null {
    const positioningParent = handle.positioningParent;
    const layoutParent = positioningParent?.parentElement;
    if (!positioningParent) {
      return null;
    }
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
      .filter((rect) => this.hasVerticalOverlap(rect, elementRect))
      .filter((rect) => (isRtl ? rect.right <= elementMidpoint : rect.left >= elementMidpoint));
    if (obstacles.length === 0) {
      return null;
    }
    if (isRtl) {
      const nearest = obstacles.reduce((best, rect) => (rect.right > best.right ? rect : best));
      return { start: nearest.left, end: nearest.right };
    }
    const nearest = obstacles.reduce((best, rect) => (rect.left < best.left ? rect : best));
    return { start: nearest.left, end: nearest.right };
  }

  private hasVerticalOverlap(candidateRect: DOMRect, elementRect: DOMRect): boolean {
    return candidateRect.bottom > elementRect.top && candidateRect.top < elementRect.bottom;
  }

  private isInlineObstacleCandidate(candidate: HTMLElement): boolean {
    if (candidate.getAttribute("aria-hidden") === "true") {
      return false;
    }
    if (candidate.matches(INLINE_OBSTACLE_SELECTOR)) {
      return true;
    }
    return candidate.querySelector(INLINE_OBSTACLE_SELECTOR) instanceof HTMLElement;
  }

  private resolveOffsetTop(
    height: number,
    options: {
      prefersTopInset: boolean;
    },
  ): number {
    const maxOffset = Math.max(0, height - BUTTON_SIZE_PX);
    const desired = options.prefersTopInset
      ? FIELD_INSET_PX
      : Math.max(0, (height - BUTTON_SIZE_PX) / 2);
    return this.clampToRange(desired, 0, maxOffset);
  }

  private clampToRange(value: number, min: number, max: number): number {
    if (max <= min) {
      return min;
    }
    return Math.min(Math.max(value, min), max);
  }

  private resolveMountTarget(element: ManualAttachTarget): ManualAttachMountTarget {
    const { ownerDocument } = element;
    const { parentElement } = element;
    if (this.isHtmlElement(parentElement, ownerDocument)) {
      return this.createMountTarget(parentElement, parentElement);
    }
    const root = element.getRootNode();
    if (this.isShadowRoot(root, ownerDocument) && this.isHtmlElement(root.host, ownerDocument)) {
      return this.createMountTarget(root, null);
    }
    return this.createMountTarget(ownerDocument.body, ownerDocument.body);
  }

  private createMountTarget(
    containerParent: ManualAttachMountTarget["containerParent"],
    positioningParent: ManualAttachMountTarget["positioningParent"],
  ): ManualAttachMountTarget {
    return {
      containerParent,
      positioningParent,
    };
  }

  private reserveParent(parent: HTMLElement): void {
    const existing = this.parentPositionStates.get(parent);
    if (existing) {
      existing.count += 1;
      return;
    }

    const computedPosition = parent.ownerDocument.defaultView?.getComputedStyle(parent).position;
    const shouldSetRelative = !computedPosition || computedPosition === "static";
    this.parentPositionStates.set(parent, {
      count: 1,
      originalPosition: parent.style.position,
    });
    if (shouldSetRelative) {
      parent.style.position = "relative";
    }
  }

  private releaseParent(parent: HTMLElement): void {
    const existing = this.parentPositionStates.get(parent);
    if (!existing) {
      return;
    }
    existing.count -= 1;
    if (existing.count > 0) {
      return;
    }
    parent.style.position = existing.originalPosition;
    this.parentPositionStates.delete(parent);
  }

  private applyPadding(element: ManualAttachTarget): void {
    const computedStyle = element.ownerDocument.defaultView?.getComputedStyle(element);
    const direction = computedStyle?.direction === "rtl" ? "left" : "right";
    const computedPadding =
      Number.parseFloat(
        direction === "right"
          ? computedStyle?.paddingRight || ""
          : computedStyle?.paddingLeft || "",
      ) || 0;
    const nextPadding = Math.ceil(computedPadding + PADDING_RESERVE_PX);
    this.setInlineEndPaddingStyleValue(element, `${nextPadding}px`);
  }

  private restorePadding(element: ManualAttachTarget, handle: ManualAttachUiHandle): void {
    if (this.shouldReserveInlinePadding(element)) {
      this.setInlineEndPaddingStyleValue(element, handle.originalPaddingInlineEnd);
    }
  }

  private shouldReserveInlinePadding(element: ManualAttachTarget): boolean {
    return !element.isContentEditable;
  }

  private getInlineEndPaddingStyleValue(element: ManualAttachTarget): string {
    const direction = element.ownerDocument.defaultView?.getComputedStyle(element).direction;
    return direction === "rtl" ? element.style.paddingLeft : element.style.paddingRight;
  }

  private setInlineEndPaddingStyleValue(element: ManualAttachTarget, value: string): void {
    const direction = element.ownerDocument.defaultView?.getComputedStyle(element).direction;
    if (direction === "rtl") {
      element.style.paddingLeft = value;
      return;
    }
    element.style.paddingRight = value;
  }

  private isHtmlElement(node: unknown, ownerDocument: Document): node is HTMLElement {
    if (!node || typeof node !== "object") {
      return false;
    }
    const candidate = node as Partial<HTMLElement> & {
      nodeType?: number;
      ownerDocument?: Document;
    };
    return candidate.nodeType === 1 && candidate.ownerDocument === ownerDocument;
  }

  private isShadowRoot(node: Node, ownerDocument: Document): node is ShadowRoot {
    const shadowRootConstructor = ownerDocument.defaultView?.ShadowRoot;
    if (typeof shadowRootConstructor === "function") {
      return node instanceof shadowRootConstructor;
    }
    return (
      "host" in node &&
      this.isHtmlElement((node as { host: unknown }).host, ownerDocument) &&
      node.ownerDocument === ownerDocument
    );
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
