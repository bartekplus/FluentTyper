interface CaretTrace {
  beforePreview: string;
  afterPreview: string;
  aroundCaret: string;
  tokenBeforeCaret: string;
  tokenAfterCaret: string;
}

export function collapseTraceWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function clipTraceText(value: string, limit: number, mode: "start" | "end" = "end"): string {
  if (value.length <= limit) {
    return value;
  }
  if (mode === "start") {
    return `${value.slice(0, Math.max(0, limit - 3))}...`;
  }
  return `...${value.slice(-(limit - 3))}`;
}

export function buildCaretTrace(
  beforeCursor: string,
  afterCursor: string,
  limit: number,
): CaretTrace {
  const beforePreview = clipTraceText(
    collapseTraceWhitespace(beforeCursor.slice(-limit * 2)),
    limit,
  );
  const afterPreview = clipTraceText(
    collapseTraceWhitespace(afterCursor.slice(0, limit * 2)),
    limit,
    "start",
  );
  const tokenBeforeCaret =
    beforeCursor.match(/[^\s.,!?;:()[\]{}"'`<>/\\|@#$%^&*_+=~-]+$/u)?.[0] ?? "";
  const tokenAfterCaret =
    afterCursor.match(/^[^\s.,!?;:()[\]{}"'`<>/\\|@#$%^&*_+=~-]+/u)?.[0] ?? "";

  return {
    beforePreview,
    afterPreview,
    aroundCaret: `${beforePreview}|${afterPreview}`,
    tokenBeforeCaret: clipTraceText(tokenBeforeCaret, limit),
    tokenAfterCaret: clipTraceText(tokenAfterCaret, limit, "start"),
  };
}

const ELEMENT_TEXT_PREVIEW_LIMIT = 48;

export function buildElementSnapshot(
  element: HTMLElement | null,
  beforeCursor: string,
  afterCursor: string,
  caretLimit: number,
  htmlLimit: number,
): Record<string, unknown> | null {
  if (!element) {
    return null;
  }
  const className =
    typeof element.className === "string" ? collapseTraceWhitespace(element.className) : "";
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    className: className || null,
    textLength: (element.textContent ?? "").length,
    caretTrace: buildCaretTrace(beforeCursor, afterCursor, caretLimit),
    textPreview: clipTraceText(
      collapseTraceWhitespace(element.textContent ?? ""),
      ELEMENT_TEXT_PREVIEW_LIMIT,
    ),
    htmlPreview: clipTraceText(collapseTraceWhitespace(element.outerHTML), htmlLimit, "start"),
  };
}
