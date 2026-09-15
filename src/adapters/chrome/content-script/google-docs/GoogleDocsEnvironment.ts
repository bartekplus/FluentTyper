import { INPUT_FRAME_SELECTOR, isGoogleDocsURL } from "./GoogleDocsModel";

export function isGoogleDocsPage(win: Window = window): boolean {
  return win.top === win && isGoogleDocsURL(win.location.href);
}
export function isGoogleDocsInputFrame(win: Window = window): boolean {
  try {
    return (
      win.top !== win &&
      !!win.top &&
      isGoogleDocsPage(win.top) &&
      !!win.frameElement?.matches(INPUT_FRAME_SELECTOR)
    );
  } catch {
    return false;
  }
}
export interface DocsInput {
  frame: HTMLIFrameElement;
  document: Document;
  element: HTMLElement;
}
export function getDocsInput(doc: Document = document): DocsInput | null {
  const frame = doc.activeElement;
  if (!frame?.matches(INPUT_FRAME_SELECTOR)) return null;
  try {
    const iframe = frame as HTMLIFrameElement;
    const inner = iframe.contentDocument;
    // Docs' setSelection blurs the inner editable while the frame stays focused; fall back
    // to the frame's editable target instead of treating that transient blur as inactive.
    const active = inner?.activeElement as HTMLElement | null;
    const element = active?.isContentEditable
      ? active
      : inner?.querySelector<HTMLElement>('[contenteditable="true"]');
    if (!inner || !element || element.getAttribute("aria-readonly") === "true") return null;
    return { frame: iframe, document: inner, element };
  } catch {
    return null;
  }
}

/** Read visual geometry only; never move the selection to measure. */
export function getDocsCaret(
  doc: Document = document,
): { element: HTMLElement; rect: DOMRect } | null {
  const view = doc.defaultView;
  if (!view) return null;
  const visible = Array.from(doc.querySelectorAll<HTMLElement>(".kix-cursor-caret"))
    .filter(
      (el) =>
        !el.closest('[aria-hidden="true"]') && view.getComputedStyle(el).visibility !== "hidden",
    )
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(
      ({ rect }) =>
        rect.height > 0 &&
        rect.width >= 0 &&
        rect.bottom > 0 &&
        rect.top < view.innerHeight &&
        rect.right >= 0 &&
        rect.left < view.innerWidth,
    );
  // Collaborator carets are colored; Docs draws the local caret with a black border.
  const own = visible.filter(
    ({ element }) => view.getComputedStyle(element).borderLeftColor === "rgb(0, 0, 0)",
  );
  const candidates = own.length ? own : visible;
  // Bidi can show coincident caret fragments. Deduplicate geometry.
  const unique = candidates.filter(
    (item, index) =>
      !candidates
        .slice(0, index)
        .some(
          (other) =>
            Math.abs(item.rect.left - other.rect.left) < 0.5 &&
            Math.abs(item.rect.top - other.rect.top) < 0.5 &&
            Math.abs(item.rect.height - other.rect.height) < 0.5,
        ),
  );
  return unique.length === 1 ? unique[0] : null;
}
