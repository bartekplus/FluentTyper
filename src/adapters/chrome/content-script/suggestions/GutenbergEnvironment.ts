/** Gutenberg fields are model-owned. A missing native writer must not enable DOM writes. */
export const GUTENBERG_FIELD_SELECTOR =
  ".block-editor-rich-text__editable, .editor-post-title__input, .wp-block-post-title[contenteditable], .wp-block-post-title [contenteditable='true']";

export function isGutenbergField(element: HTMLElement): boolean {
  return element.matches(GUTENBERG_FIELD_SELECTOR);
}

/** The canvas owns the review, including all nested block layouts. */
export function gutenbergCanvas(element: HTMLElement): HTMLElement | null {
  if (!isGutenbergField(element)) return null;
  let layout = element.closest<HTMLElement>(".block-editor-block-list__layout");
  while (layout?.parentElement?.closest(".block-editor-block-list__layout"))
    layout = layout.parentElement.closest<HTMLElement>(".block-editor-block-list__layout");
  if (!layout && element.matches(".editor-post-title__input")) {
    const visual =
      element.closest(".edit-post-visual-editor, .editor-visual-editor") ?? element.ownerDocument;
    const frames = visual.querySelectorAll<HTMLIFrameElement>('iframe[name="editor-canvas"]');
    const layouts = visual.querySelectorAll<HTMLElement>(
      ".block-editor-block-list__layout.is-root-container",
    );
    if (frames.length === 1) {
      try {
        layout =
          frames[0].contentDocument?.querySelector(
            ".block-editor-block-list__layout.is-root-container",
          ) ?? null;
      } catch {
        /* Unavailable canvases remain outside the scan. */
      }
    } else if (layouts.length === 1) layout = layouts[0];
  }
  return (
    layout ??
    element.closest<HTMLElement>(".edit-post-visual-editor, .editor-visual-editor") ??
    element
  );
}

export function gutenbergFields(source: HTMLElement): HTMLElement[] {
  const canvas = gutenbergCanvas(source);
  if (!canvas) return [];
  const fields = canvas.matches(GUTENBERG_FIELD_SELECTOR)
    ? [canvas]
    : [
        ...canvas.querySelectorAll<HTMLElement>(
          `${GUTENBERG_FIELD_SELECTOR}, [data-block] [contenteditable='true'], [data-block][contenteditable='true']`,
        ),
      ].filter(
        (element) =>
          isGutenbergField(element) ||
          (!element.querySelector(GUTENBERG_FIELD_SELECTOR) &&
            !element.closest('code, pre, [role="toolbar"], [role="search"], [role="menu"]')),
      );
  const doc = source.ownerDocument;
  // Post titles can live outside the iframe. Do not collect other canvases.
  let owner = doc;
  try {
    const frame = doc.defaultView?.frameElement;
    if (frame) owner = frame.ownerDocument;
  } catch {
    // A cross-origin parent cannot supply fields for this editor.
  }
  const titles = [
    ...doc.querySelectorAll<HTMLElement>(".editor-post-title__input"),
    ...(owner === doc ? [] : owner.querySelectorAll<HTMLElement>(".editor-post-title__input")),
  ];
  return [...new Set([...titles.filter((title) => gutenbergCanvas(title) === canvas), ...fields])];
}

/** WritingFlow may make the surrounding canvas an editing host. Each native
 * RichText field still requires its own binding and suggestion session. */
export function isGutenbergContainer(element: HTMLElement): boolean {
  return (
    !isGutenbergField(element) &&
    element.isContentEditable &&
    (!!element.querySelector(GUTENBERG_FIELD_SELECTOR) ||
      !!element.closest(".block-editor-block-list__layout"))
  );
}
