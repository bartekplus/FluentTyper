import type { ConcreteRewriteStyle, EditorContextHint, RewriteStyle } from "./types";

/** The draft itself opens like a letter: "Dear …", "Hi Anna,", "Szanowna Pani", "Dzień dobry". */
const EMAIL_OPENING =
  /^\s*(?:Dear\s+\S|(?:Hi|Hello|Good (?:morning|afternoon|evening))\s+\p{Lu}[\p{L}'’-]*\s*,|Szanown[aey]\s|Dzień dobry\b)/u;

/**
 * Resolves "context-aware" to a restrained concrete style from the reviewed
 * text and a coarse editor hint; other styles pass through. Never triggers a
 * rewrite by itself, and never guesses "friendly".
 */
export function resolveRewriteStyle(
  style: RewriteStyle,
  hint: EditorContextHint,
  text: string,
): ConcreteRewriteStyle {
  if (style !== "context-aware") return style;
  if (hint === "email") return "professional";
  if (hint === "chat") return "keep-voice";
  return EMAIL_OPENING.test(text.slice(0, 200)) ? "professional" : "keep-voice";
}
