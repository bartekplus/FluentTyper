import { parseThemeColor, relativeLuminance } from "@core/domain/color";
import { composedParent } from "@core/application/dom-utils";

export const FIELD_ACTION_SIZE_PX = 24;
export const FIELD_ACTION_INSET_PX = 6;
export const FIELD_ACTION_CHANGE_EVENT = "fluenttyper-field-action-change";
const fieldActionVisibility = new WeakMap<HTMLElement, boolean>();

function fieldActionPainted(field: HTMLElement): boolean {
  if (field.checkVisibility)
    return field.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const visibility = field.ownerDocument.defaultView?.getComputedStyle(field).visibility;
  return visibility !== "hidden" && visibility !== "collapse";
}

/** Compact editors need space below the text. Larger editors use the inside corner. */
export function fieldActionSlot(
  field: HTMLElement,
  minimumWidth = 120,
): { left: number; top: number; size: number } | null {
  if (fieldActionVisibility.get(field) === false || !fieldActionPainted(field)) return null;
  const rect = field.getBoundingClientRect();
  if (rect.width < minimumWidth || rect.height < FIELD_ACTION_SIZE_PX) return null;
  const rtl = field.ownerDocument.defaultView?.getComputedStyle(field).direction === "rtl";
  const scaleX = field.offsetWidth ? rect.width / field.offsetWidth : 1;
  const scaleY = field.offsetHeight ? rect.height / field.offsetHeight : 1;
  const innerLeft = rect.left + field.clientLeft * scaleX;
  const innerRight = innerLeft + (field.clientWidth ? field.clientWidth * scaleX : rect.width);
  const innerBottom =
    rect.top +
    field.clientTop * scaleY +
    (field.clientHeight ? field.clientHeight * scaleY : rect.height);
  const left = rtl
    ? innerLeft + FIELD_ACTION_INSET_PX
    : innerRight - FIELD_ACTION_INSET_PX - FIELD_ACTION_SIZE_PX;
  const top =
    rect.height < FIELD_ACTION_SIZE_PX + 2 * FIELD_ACTION_INSET_PX
      ? rect.bottom + FIELD_ACTION_INSET_PX
      : innerBottom - FIELD_ACTION_INSET_PX - FIELD_ACTION_SIZE_PX;
  if (top >= rect.bottom && field.ownerDocument.elementsFromPoint) {
    const ancestors = new Set<Node>();
    for (let node: Node | null = field; node; node = composedParent(node)) ancestors.add(node);
    const root = field.getRootNode() as Document | ShadowRoot;
    // ponytail: five samples can miss thin obstacles. Use rectangle checks if a site exposes that case.
    for (const [x, y] of [
      [1, 1],
      [23, 1],
      [1, 23],
      [23, 23],
      [12, 12],
    ]) {
      const hits = field.ownerDocument.elementsFromPoint(left + x, top + y);
      if (root !== field.ownerDocument && root.elementsFromPoint)
        hits.push(...root.elementsFromPoint(left + x, top + y));
      const seen = new Set<Element>();
      for (const element of hits) {
        if (
          seen.has(element) ||
          element.closest("[data-fluenttyper-review-launcher], .ft-manual-attach")
        )
          continue;
        seen.add(element);
        if (element.shadowRoot?.elementsFromPoint)
          hits.push(...element.shadowRoot.elementsFromPoint(left + x, top + y));
        if (
          !ancestors.has(element) &&
          (element.matches(
            'a, button, input, textarea, select, iframe, object, embed, video, audio, canvas, img, svg, [contenteditable], [role="button"], [role="textbox"], [role="combobox"]',
          ) ||
            element.textContent?.trim())
        )
          return null;
      }
    }
  }
  const view = field.ownerDocument.defaultView;
  if (
    view &&
    (left < 0 ||
      top < 0 ||
      left + FIELD_ACTION_SIZE_PX > view.innerWidth ||
      top + FIELD_ACTION_SIZE_PX > view.innerHeight)
  )
    return null;
  return { left, top, size: FIELD_ACTION_SIZE_PX };
}

export function fieldActionTone(field: HTMLElement): "light" | "dark" {
  for (let node: Node | null = field; node; node = composedParent(node)) {
    if (node.nodeType !== 1) continue;
    const color = field.ownerDocument.defaultView?.getComputedStyle(
      node as Element,
    ).backgroundColor;
    const parsed = color ? parseThemeColor(color) : null;
    if (parsed && parsed.a > 0.05) return relativeLuminance(parsed) < 0.36 ? "dark" : "light";
  }
  return field.ownerDocument.defaultView?.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Shared size, surface, hover, focus, and success treatment for field actions. */
export function styleFieldActionButton(
  button: HTMLButtonElement,
  tone: "light" | "dark",
  state: "idle" | "hover" | "success" = "idle",
): void {
  const dark = tone === "dark";
  const active = state === "hover";
  const success = state === "success";
  const view = button.ownerDocument.defaultView;
  const forcedColors = view?.matchMedia?.("(forced-colors: active)").matches;
  const reducedMotion = view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  Object.assign(button.style, {
    boxSizing: "border-box",
    width: `${FIELD_ACTION_SIZE_PX}px`,
    height: `${FIELD_ACTION_SIZE_PX}px`,
    margin: "0",
    padding: "0",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "999px",
    border: "1px solid",
    backgroundColor: forcedColors
      ? "ButtonFace"
      : success
        ? dark
          ? "#064e3b"
          : "#ecfdf5"
        : dark
          ? "#1e293b"
          : active
            ? "#eef2ff"
            : "#ffffff",
    color: forcedColors
      ? "ButtonText"
      : success
        ? dark
          ? "#d1fae5"
          : "#047857"
        : dark
          ? "#38bdf8"
          : "#4338ca",
    borderColor: forcedColors
      ? "ButtonText"
      : success
        ? "#10b981"
        : active
          ? dark
            ? "#38bdf8"
            : "#4f46e5"
          : dark
            ? "rgba(56, 189, 248, 0.45)"
            : "rgba(79, 70, 229, 0.45)",
    boxShadow: "0 2px 8px -2px rgba(15, 23, 42, 0.35)",
    cursor: "pointer",
    pointerEvents: "auto",
    transform: "none",
    outline: button.matches(":focus-visible") ? "2px solid currentColor" : "none",
    outlineOffset: "2px",
    transition: reducedMotion
      ? "none"
      : "background-color 150ms ease-out, border-color 150ms ease-out",
  });
  button.style.setProperty(
    "--ft-field-action-transition",
    reducedMotion ? "none" : "opacity 140ms ease, filter 140ms ease, transform 140ms ease",
  );
}

export function watchFieldActionMedia(field: HTMLElement, update: () => void): () => void {
  const view = field.ownerDocument.defaultView;
  const queries = [
    "(forced-colors: active)",
    "(prefers-reduced-motion: reduce)",
    "(prefers-color-scheme: dark)",
  ].map((query) => view?.matchMedia?.(query));
  for (const query of queries) query?.addEventListener?.("change", update);
  return () => {
    for (const query of queries) query?.removeEventListener?.("change", update);
  };
}

type FieldActionTracker = { dirty: boolean; run: () => void };
type FieldActionFrames = {
  view: Window;
  frame: number | null;
  fields: Map<HTMLElement, Set<FieldActionTracker>>;
  active: Set<FieldActionTracker>;
  observer: IntersectionObserver | null;
};
const fieldActionFrames = new WeakMap<Window, FieldActionFrames>();

function queueFieldActionFrame(frames: FieldActionFrames): void {
  if (!frames.active.size) {
    if (frames.frame !== null) frames.view.cancelAnimationFrame(frames.frame);
    frames.frame = null;
    return;
  }
  if (frames.frame !== null) return;
  frames.frame = frames.view.requestAnimationFrame(() => {
    frames.frame = null;
    for (const tracker of [...frames.active]) tracker.run();
    queueFieldActionFrame(frames);
  });
}

function framesFor(view: Window): FieldActionFrames {
  const existing = fieldActionFrames.get(view);
  if (existing) return existing;
  const frames: FieldActionFrames = {
    view,
    frame: null,
    fields: new Map(),
    active: new Set(),
    observer: null,
  };
  if (typeof IntersectionObserver === "function") {
    frames.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const field = entry.target as HTMLElement;
        const trackers = frames.fields.get(field);
        if (!trackers) continue;
        fieldActionVisibility.set(field, entry.isIntersecting);
        for (const tracker of [...trackers]) {
          if (entry.isIntersecting) frames.active.add(tracker);
          else frames.active.delete(tracker);
          tracker.dirty = true;
          tracker.run();
        }
      }
      queueFieldActionFrame(frames);
    });
  }
  fieldActionFrames.set(view, frames);
  return frames;
}

/** Tracks visible field actions through scrolling, resizing, and layout changes. */
export function trackFieldActionLayout(field: HTMLElement, update: () => void): () => void {
  const view = field.ownerDocument.defaultView;
  if (!view) return () => {};
  const frames = framesFor(view);
  let previousRect: DOMRect | null = null;
  let previousPainted: boolean | null = null;
  let stopped = false;
  const schedule = () => {
    tracker.dirty = true;
    queueFieldActionFrame(frames);
  };
  const run = () => {
    if (stopped) return;
    if (!field.isConnected) {
      update();
      stop();
      return;
    }
    const rect = field.getBoundingClientRect();
    const painted = fieldActionPainted(field);
    if (
      tracker.dirty ||
      painted !== previousPainted ||
      !previousRect ||
      rect.left !== previousRect.left ||
      rect.top !== previousRect.top ||
      rect.width !== previousRect.width ||
      rect.height !== previousRect.height
    ) {
      tracker.dirty = false;
      update();
    }
    previousRect = rect;
    previousPainted = painted;
  };
  const tracker: FieldActionTracker = { dirty: true, run };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  const stopMedia = watchFieldActionMedia(field, schedule);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    view.removeEventListener("scroll", schedule, true);
    view.removeEventListener("resize", schedule);
    observer?.disconnect();
    stopMedia();
    frames.active.delete(tracker);
    const trackers = frames.fields.get(field)!;
    trackers.delete(tracker);
    if (!trackers.size) {
      frames.fields.delete(field);
      frames.observer?.unobserve(field);
      fieldActionVisibility.delete(field);
    }
    queueFieldActionFrame(frames);
    if (!frames.fields.size) {
      frames.observer?.disconnect();
      fieldActionFrames.delete(view);
    }
  };
  view.addEventListener("scroll", schedule, { capture: true, passive: true });
  view.addEventListener("resize", schedule);
  observer?.observe(field);
  let trackers = frames.fields.get(field);
  if (!trackers) {
    frames.fields.set(field, (trackers = new Set()));
    if (frames.observer) fieldActionVisibility.set(field, false);
    frames.observer?.observe(field);
  }
  trackers.add(tracker);
  if (fieldActionVisibility.get(field) !== false) frames.active.add(tracker);
  // ponytail: visible controls read geometry each frame. Use native anchors when all target browsers support them.
  queueFieldActionFrame(frames);
  return stop;
}
