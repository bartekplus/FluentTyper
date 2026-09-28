import type { PreparedReview } from "../reviewDiagnostics";
import type {
  AiChunk,
  AiChunkPlan,
  AiGenerationRequest,
  ConcreteRewriteStyle,
  ReviewAiMode,
} from "./types";

export interface AiChunkOptions {
  mode: ReviewAiMode;
  style: ConcreteRewriteStyle | null;
  /** Editable characters per chunk (conservative pre-check before the runtime's token budget). */
  maxChunkChars?: number;
  /** Read-only context characters on each side. */
  contextChars?: number;
  /** Cap on total editable characters sent for this pass. */
  maxTotalChars?: number;
}

/**
 * Splits the prepared review's scope into sentence/paragraph-aligned chunks of
 * editable prose. Protected ranges become segment boundaries or opaque
 * placeholders; nothing is cut inside a grapheme, a word or a protected span.
 * Read-only context comes only from the same snapshot (inside the editor).
 * STUB: implemented by the domain workstream.
 */
export function buildAiChunks(prepared: PreparedReview, options: AiChunkOptions): AiChunkPlan {
  void prepared;
  void options;
  throw new Error("buildAiChunks: not implemented");
}

/** The wire request for one chunk: text only, no offsets. */
export function aiRequestForChunk(
  chunk: AiChunk,
  lang: string,
  mode: ReviewAiMode,
  style: ConcreteRewriteStyle | null,
): AiGenerationRequest {
  return {
    mode,
    lang,
    style: mode === "rewrite" ? style : null,
    contextBefore: chunk.contextBefore,
    contextAfter: chunk.contextAfter,
    segments: chunk.segments.map((segment) => ({ id: segment.id, text: segment.text })),
  };
}
