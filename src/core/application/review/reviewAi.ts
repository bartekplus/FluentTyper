import type { LocalAiStatus } from "@core/domain/contracts/localAi";
import { baseLanguage } from "@core/domain/lang";
import { localAiModelForTier } from "@core/domain/localAi/modelRegistry";
import type {
  AiGenerationOutcome,
  AiGenerationRequest,
  ConcreteRewriteStyle,
  EditorContextHint,
  RewriteStyle,
  AiRejectionReason,
} from "@core/domain/grammar/review/ai/types";
import { applyEdits, rangesOverlap, sameEdit } from "@core/domain/grammar/review/textRanges";
import type { ReviewDiagnostic, ReviewEdit } from "@core/domain/grammar/review/types";

/**
 * Optional Local AI provider for a ReviewSession (application port).
 *
 * One provider instance per review session; `dispose` ends it (and cancels
 * everything it started). The adapter behind it owns the transport; the
 * session never sees browser or engine types.
 */
export interface ReviewAiProvider {
  /** Current status (preference, consent, install, runtime). Never starts a download. */
  status(): Promise<LocalAiStatus>;
  /** Subscribe to status pushes while the session is open; returns an unsubscribe. */
  onStatus(listener: (status: LocalAiStatus) => void): () => void;
  /**
   * One generation. Resolves with the outcome; rejects never (errors are
   * outcomes). Aborting the signal cancels it on the runtime and resolves
   * `{ ok: false, error: "cancelled" }` once the runtime has settled it.
   */
  generate(
    request: AiGenerationRequest,
    signal: AbortSignal,
  ): Promise<{ outcome: AiGenerationOutcome; modelId: string; promptVersion: string }>;
  /** Opens the extension's setup page (explicit consent happens there). */
  openSetup(): void;
  /** The user declined the one-time setup offer. */
  dismissSetupOffer(): void;
  dispose(): void;
}

/** Where Local AI stands for this review; the UI turns this into one status line. */
export type ReviewAiAvailability =
  /** Preference off, or no provider (Firefox, build without the runtime). */
  | "off"
  /** Preference on, setup not done: the panel may offer setup once. */
  | "setup-needed"
  /** Setup done but model artifacts missing/partial: explicit reinstall needed. */
  | "install-needed"
  | "installing"
  | "unsupported"
  /** The engine kept failing (host gave up until the next Review): AI controls go. */
  | "failed"
  /** Ready (engine may still need to load from cache). */
  | "ready"
  /** Paused by the user for this review. */
  | "paused"
  /** The review's language is not one the selected model was evaluated for. */
  | "language";

/** Local AI coverage of the CURRENT text, tracked apart from rule coverage. */
export type ReviewAiCoverage =
  "idle" | "waiting" | "loading" | "checking" | "complete" | "partial" | "cancelled" | "failed";

export interface ReviewAiViewState {
  availability: ReviewAiAvailability;
  coverage: ReviewAiCoverage;
  /** Fraction of planned chunks checked, including cached answers; only while checking. */
  progress?: number;
  /** Status snapshot for the setup/unsupported/install notes (no text). */
  status: LocalAiStatus | null;
  /** Characters not sent (protected, unsafe boundaries, AI size limit). */
  skippedChars: number;
  /** The panel should show its one-time setup offer. */
  offerSetup: boolean;
}

export type ReviewMode = "correct" | "rewrite";

type RewriteStatus =
  /** Nothing generated yet for this scope/style. */
  | "idle"
  | "generating"
  /** Complete, validated proposal: Apply may be enabled. */
  | "ready"
  /** Generated but failed validation: shown with the reason, never applicable. */
  | "rejected"
  | "failed"
  /** The text changed after generation: regenerate. */
  | "stale"
  /** Scope longer than the rewrite budget: select a passage. */
  | "too-long"
  | "applying";

export interface RewriteViewState {
  style: RewriteStyle;
  /** What "context-aware" resolved to (shown), or the style itself. */
  resolvedStyle: ConcreteRewriteStyle;
  contextHint: EditorContextHint;
  status: RewriteStatus;
  /** Scope text the proposal is for. */
  before: string;
  /** Proposed scope text (null until a complete, parsed result exists). */
  after: string | null;
  /** Changed regions against `before` (offsets into `before`). */
  hunks: ReviewEdit[];
  rejection: AiRejectionReason | null;
  /** Sentences kept as written because their rewrite failed a check, by reason. */
  kept: Partial<Record<AiRejectionReason, number>>;
  /** True only for a complete validated proposal on a target that can apply it. */
  canApply: boolean;
  /** Apply is impossible here (review-only editor): the UI offers Copy instead. */
  previewOnly: boolean;
}

/** Preview of "Apply selected AI corrections": one combined, conflict-free diff. */
export interface AiBatchPreview {
  diagnosticIds: string[];
  /** Findings left out because they overlap another selected finding. */
  excluded: number;
  /** Target supports a verified multi-edit transaction. */
  canApply: boolean;
}

/** Where Local AI stands, from the provider's status and this review's own switches. */
export function reviewAiAvailability(
  status: LocalAiStatus | null,
  enabled: boolean,
  paused: boolean,
  lang = "en",
): ReviewAiAvailability {
  if (!enabled || !status?.enabled) return "off";
  // No runtime host in this browser or build (Firefox): Review stays exactly as without AI.
  if (status.unavailable === "host-unsupported" || status.unavailable === "not-in-build") {
    return "off";
  }
  if (status.runtime === "unavailable" || status.unavailable) return "unsupported";
  // Only evaluated languages: elsewhere a small model damages text (docs/local-ai-evaluation.md).
  // "auto_detect" means the session is still identifying the text's language (AI waits).
  if (
    lang !== "auto_detect" &&
    !localAiModelForTier(status.tier).languages.includes(baseLanguage(lang))
  ) {
    return "language";
  }
  if (!status.consented) return "setup-needed";
  // A download in progress is a partial install: it is installing, not missing.
  if (status.runtime === "downloading") return "installing";
  if (status.install === "none" || status.install === "partial") return "install-needed";
  if (status.runtime === "error") return "failed";
  return paused ? "paused" : "ready";
}

export function editsOf(diagnostic: ReviewDiagnostic): ReviewEdit[] {
  return diagnostic.alternatives[0]?.edits ?? [];
}

/** Both change exactly the same characters in the same way. */
export function sameChange(a: ReviewDiagnostic, b: ReviewDiagnostic): boolean {
  const edits = editsOf(b);
  return a.alternatives.some(
    (alternative) =>
      alternative.edits.length === edits.length &&
      alternative.edits.every((edit, index) => sameEdit(edit, edits[index])),
  );
}

/**
 * The selected AI findings that can be applied together: a pair that overlaps
 * (or cannot be combined) is left out entirely rather than silently composed.
 */
export function conflictFreeFindings(
  text: string,
  findings: readonly ReviewDiagnostic[],
): ReviewDiagnostic[] {
  const conflicting = new Set<string>();
  // ponytail: pairwise O(n²) over one review's AI findings (tens); sort + sweep if that grows.
  for (let i = 0; i < findings.length; i += 1) {
    for (let j = i + 1; j < findings.length; j += 1) {
      const a = findings[i];
      const b = findings[j];
      if (
        rangesOverlap(a.range, b.range) ||
        applyEdits(text, [...editsOf(a), ...editsOf(b)]) === null
      ) {
        conflicting.add(a.id).add(b.id);
      }
    }
  }
  return findings.filter((finding) => !conflicting.has(finding.id));
}
