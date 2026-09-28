import type { ReviewDiagnostic, ReviewEdit, TextRange } from "../types";

/**
 * Local AI Review contract (pure; no browser, DOM or engine types).
 *
 * The model only ever sees editable segment text and read-only context. It
 * returns proposed text per host-assigned segment id; offsets, protection and
 * edits are derived on the host from the immutable snapshot. Model output is
 * untrusted data until it passes parsing and validation.
 */

export type ReviewAiMode = "correct" | "rewrite";

export const REWRITE_STYLES = [
  "keep-voice",
  "professional",
  "friendly",
  "concise",
  "clearer",
  "context-aware",
] as const;
export type RewriteStyle = (typeof REWRITE_STYLES)[number];
/** A style the model is actually asked for: context-aware resolves to one of these first. */
export type ConcreteRewriteStyle = Exclude<RewriteStyle, "context-aware">;

/** Coarse, locally known editor context; never page content, URLs or titles. */
export type EditorContextHint = "chat" | "email" | "general";

/** Placeholder standing for protected text inside a segment; host-owned. */
export interface AiPlaceholder {
  /** Opaque token as written into segment text, e.g. "⟦1⟧". */
  token: string;
  /** Snapshot range the token stands for. */
  range: TextRange;
}

/** One editable piece of prose. `text` is what the model sees (placeholders substituted). */
export interface AiSegment {
  /** Host-assigned, stable within its chunk ("s0", "s1", …). */
  id: string;
  /** Snapshot range this segment covers (host-only; never sent). */
  range: TextRange;
  text: string;
  placeholders: AiPlaceholder[];
}

/** One model request's worth of segments, with bounded read-only context. */
export interface AiChunk {
  segments: AiSegment[];
  /** Read-only neighbouring prose from the same editor and scope (may be ""). */
  contextBefore: string;
  contextAfter: string;
  /** Covering snapshot range of the editable segments. */
  range: TextRange;
}

export interface AiChunkPlan {
  chunks: AiChunk[];
  /**
   * Characters of scope NOT sent to the model, by reason: protected (code,
   * technical, structure), unsafe boundaries (cut words at a selection edge),
   * or limit (beyond the AI size budget). Unchecked text is never "all clear".
   */
  skipped: { protected: number; unsafe: number; limit: number };
}

/** What crosses the extension transport: text only, no offsets, no page metadata. */
export interface AiGenerationRequest {
  mode: ReviewAiMode;
  lang: string;
  /** Required for rewrite, null for correct. */
  style: ConcreteRewriteStyle | null;
  contextBefore: string;
  contextAfter: string;
  segments: Array<{ id: string; text: string }>;
}

export type AiErrorCode =
  | "not-ready"
  | "not-installed"
  | "unavailable"
  | "busy"
  | "cancelled"
  | "timeout"
  | "too-large"
  | "truncated"
  | "malformed"
  | "engine-failed"
  | "device-lost"
  | "invalid-request";

export type AiGenerationOutcome =
  { ok: true; segments: Array<{ id: string; text: string }> } | { ok: false; error: AiErrorCode };

/** Why a generated proposal was not turned into a finding or an applicable rewrite. */
export type AiRejectionReason =
  | "shape"
  | "placeholder"
  | "protected"
  | "number"
  | "technical-token"
  | "name"
  | "negation"
  | "uncertainty"
  | "quoted"
  | "drift"
  /** Rewrite added a commitment, deadline, apology, greeting or sign-off not in the original. */
  | "invented"
  | "length"
  | "too-many-edits"
  | "unsafe-boundary";

export interface AiCorrectionResult {
  /** Findings as ReviewDiagnostics with ruleId REVIEW_LOCAL_AI_CHECK (bulk ineligible). */
  diagnostics: ReviewDiagnostic[];
  /** Segments whose proposal was rejected, by reason (counts only; no text). */
  rejected: Partial<Record<AiRejectionReason, number>>;
}

export type RewriteProposal =
  | {
      ok: true;
      style: ConcreteRewriteStyle;
      /** Scope text before and after, for the diff preview. */
      before: string;
      after: string;
      /** Non-overlapping edits against the snapshot, applied atomically on accept. */
      edits: ReviewEdit[];
      /** Segments kept as written because their rewrite failed validation, by reason. */
      kept: Partial<Record<AiRejectionReason, number>>;
    }
  | { ok: false; reason: AiRejectionReason };
