import type { PreparedReview } from "../reviewDiagnostics";
import type { AiChunk, AiCorrectionResult, ConcreteRewriteStyle, RewriteProposal } from "./types";

/**
 * Turns one chunk's parsed Correct-mode output into guarded findings against
 * the prepared snapshot: word-level diff, placeholder restore, protection and
 * scope checks, risk guards (numbers, technical tokens, names, negation,
 * uncertainty, quotes), drift rejection, sentence-grouped atomic hunks and a
 * reconstruction check. `snapshotId` becomes the diagnostics' snapshot.
 * STUB: implemented by the domain workstream.
 */
export function correctionFindings(
  prepared: PreparedReview,
  chunk: AiChunk,
  segments: ReadonlyArray<{ id: string; text: string }>,
): AiCorrectionResult {
  void prepared;
  void chunk;
  void segments;
  throw new Error("correctionFindings: not implemented");
}

/**
 * Builds one validated rewrite proposal for the whole requested scope from
 * all chunks' parsed outputs, or a rejection. Facts (numbers, names, technical
 * tokens), negation and uncertainty must be preserved.
 * STUB: implemented by the domain workstream.
 */
export function rewriteProposal(
  prepared: PreparedReview,
  chunks: readonly AiChunk[],
  outputs: ReadonlyArray<ReadonlyArray<{ id: string; text: string }>>,
  style: ConcreteRewriteStyle,
): RewriteProposal {
  void prepared;
  void chunks;
  void outputs;
  void style;
  throw new Error("rewriteProposal: not implemented");
}
