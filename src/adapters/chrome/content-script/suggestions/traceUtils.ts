export interface CaretTrace {
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
