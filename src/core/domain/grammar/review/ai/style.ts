import type { ConcreteRewriteStyle, EditorContextHint, RewriteStyle } from "./types";

/**
 * Resolves "context-aware" to a restrained concrete style from the reviewed
 * text and a coarse editor hint; other styles pass through. Never triggers a
 * rewrite by itself. STUB: implemented by the domain workstream.
 */
export function resolveRewriteStyle(
  style: RewriteStyle,
  hint: EditorContextHint,
  text: string,
): ConcreteRewriteStyle {
  void hint;
  void text;
  return style === "context-aware" ? "keep-voice" : style;
}
