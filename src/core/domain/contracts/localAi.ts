import type { AiGenerationOutcome, AiGenerationRequest } from "../grammar/review/ai/types";
import type { LocalAiModelTier } from "../localAi/modelRegistry";

/**
 * Local AI Review transport contract.
 *
 * Topology (Chrome/Edge): the engine runs in the background service worker.
 *   options page   ──runtime messages──> background (settings/consent authority, engine)
 *   content script ──port LOCAL_AI_REVIEW_PORT──> background (review jobs)
 *
 * The port IS the session: the background binds every job to the port it
 * arrived on (and to port.sender tab/frame), so a result or cancel from one
 * tab can never reach another, and a disconnect cancels that port's work.
 * Nothing here is page-visible; no text is persisted or logged.
 */

/** Content script -> background review jobs. */
export const LOCAL_AI_REVIEW_PORT = "ft-local-ai-review";

export type LocalAiRuntimeState =
  | "unconfigured"
  | "checking-support"
  | "download-required"
  | "downloading"
  | "loading"
  | "ready"
  | "generating"
  | "unloading"
  | "unavailable"
  | "error";

export type LocalAiUnavailableReason =
  "no-webgpu" | "no-adapter" | "missing-feature" | "host-unsupported" | "not-in-build";

/** Sanitized, bounded error codes: never dependency error strings. */
export type LocalAiErrorCode =
  | "download-failed"
  | "download-cancelled"
  | "storage-full"
  | "cache-failed"
  | "delete-failed"
  | "load-failed"
  | "device-lost"
  | "integrity-failed";

export type LocalAiInstallState = "unknown" | "none" | "partial" | "complete";

/** Everything the UI needs; contains no text, no hardware fingerprint. */
export interface LocalAiStatus {
  /** The user's persistent "Local AI corrections in Review" preference. */
  enabled: boolean;
  /** The user completed setup (explicit download consent) for `tier`. */
  consented: boolean;
  tier: LocalAiModelTier;
  modelId: string;
  displayName: string;
  downloadBytes: number;
  install: LocalAiInstallState;
  runtime: LocalAiRuntimeState;
  unavailable?: LocalAiUnavailableReason;
  error?: LocalAiErrorCode;
  /** Stage progress for downloading/loading, 0..1. */
  progress?: number;
  /** The Review panel may show its one-time setup offer. */
  offerSetup: boolean;
}

// ---------------------------------------------------------------- review port

export type ReviewPortClientMessage =
  | { type: "generate"; requestId: string; request: AiGenerationRequest }
  | { type: "cancel"; requestId: string };

export type ReviewPortHostMessage =
  | { type: "progress"; requestId: string; phase: "queued" | "loading" | "generating" }
  | {
      type: "result";
      requestId: string;
      /** Identity of what produced this result; part of the client's cache key. */
      modelId: string;
      promptVersion: string;
      outcome: AiGenerationOutcome;
    }
  | { type: "status"; status: LocalAiStatus };
