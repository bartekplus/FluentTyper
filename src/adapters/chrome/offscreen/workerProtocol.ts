import type {
  AiGenerationOutcome,
  AiGenerationRequest,
} from "@core/domain/grammar/review/ai/types";
import type {
  LocalAiErrorCode,
  LocalAiInstallState,
  LocalAiUnavailableReason,
} from "@core/domain/contracts/localAi";

/**
 * Offscreen host <-> dedicated worker protocol (private to the offscreen
 * adapter; never page-visible). Every call carries a request id and gets one
 * `result`; install/load may also stream numeric `progress` (never text).
 */

/** Worker script, relative to the extension root (bundled by build.ts). */
export const LOCAL_AI_WORKER_PATH = "local-ai/worker.js";

export type WorkerCall =
  | { type: "probe"; modelId: string }
  | { type: "cache-state"; modelId: string }
  | { type: "install"; modelId: string }
  | { type: "load"; modelId: string }
  | { type: "generate"; modelId: string; request: AiGenerationRequest }
  | { type: "unload" }
  | { type: "delete"; modelId: string };

export type WorkerLoadResult =
  { ok: true } | { ok: false; error?: LocalAiErrorCode; unavailable?: LocalAiUnavailableReason };

export interface WorkerResults {
  probe: { unavailable: LocalAiUnavailableReason | null };
  "cache-state": { install: Exclude<LocalAiInstallState, "unknown"> };
  install: WorkerLoadResult;
  load: WorkerLoadResult;
  generate: AiGenerationOutcome;
  unload: null;
  delete: null;
}

export type WorkerProgressPhase = "download" | "load";

/** Host -> worker. `interrupt` stops the current generation (no reply). */
export type WorkerRequest = (WorkerCall & { id: number }) | { type: "interrupt" };

/** Worker -> host. */
export type WorkerReply =
  | { id: number; type: "progress"; phase: WorkerProgressPhase; progress: number }
  | { id: number; type: "result"; result: WorkerResults[WorkerCall["type"]] };
