import { parseThemeColor, relativeLuminance } from "@core/domain/color";
import { composedParent } from "@core/application/dom-utils";

export const FIELD_ACTION_SIZE_PX = 24;
export const FIELD_ACTION_INSET_PX = 6;
export const FIELD_ACTION_CHANGE_EVENT = "fluenttyper-field-action-change";

/** Compact editors need space below the text. Larger editors use the inside corner. */
export function fieldActionSlot(
  field: HTMLElement,
): { left: number; top: number; size: number } | null {
  const rect = field.getBoundingClientRect();
  if (rect.width < 120 || rect.height < FIELD_ACTION_SIZE_PX) return null;
  const rtl = field.ownerDocument.defaultView?.getComputedStyle(field).direction === "rtl";
  const innerLeft = rect.left + field.clientLeft;
  const innerRight = innerLeft + (field.clientWidth || rect.width);
  const innerBottom = rect.top + field.clientTop + (field.clientHeight || rect.height);
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
      const occupied = hits.some(
        (element) =>
          !element.closest("[data-fluenttyper-review-launcher], .ft-manual-attach") &&
          !ancestors.has(element) &&
          (element.matches(
            'a, button, input, textarea, select, [contenteditable], [role="button"], [role="textbox"], [role="combobox"]',
          ) ||
            element.textContent?.trim()),
      );
      if (occupied) return null;
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
}
