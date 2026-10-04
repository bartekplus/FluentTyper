import type { ReviewAiProvider } from "@core/application/review/reviewAi";
import {
  CMD_LOCAL_AI_DISMISS_SETUP_OFFER,
  CMD_LOCAL_AI_ENSURE_HOST,
  CMD_LOCAL_AI_GET_STATUS,
  CMD_LOCAL_AI_OPEN_SETUP,
} from "@core/domain/constants";
import {
  LOCAL_AI_REVIEW_PORT,
  type LocalAiStatus,
  type ReviewPortClientMessage,
  type ReviewPortHostMessage,
} from "@core/domain/contracts/localAi";
import type {
  AiErrorCode,
  AiGenerationOutcome,
  AiGenerationRequest,
} from "@core/domain/grammar/review/ai/types";
import type { LocalAiCommandResponse } from "@core/domain/messageTypes";
import { randomUUID } from "@core/domain/randomId";
import { isObjectRecord } from "@core/domain/guards";

/** The slice of a runtime port the provider uses (chrome.runtime.Port fits). */
export interface LocalAiPort {
  postMessage(message: ReviewPortClientMessage): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

/** The slice of chrome.runtime the provider uses. */
export interface LocalAiRuntime {
  sendMessage(message: { command: string }): Promise<unknown>;
  connect(info: { name: string }): LocalAiPort;
}

type GenerateResult = Awaited<ReturnType<ReviewAiProvider["generate"]>>;

interface PendingJob {
  request: AiGenerationRequest;
  resolve: (result: GenerateResult) => void;
  cancelled: boolean;
  reconnected: boolean;
}

/** How long an aborted job waits for the host to settle it before it is given up. */
const CANCEL_SETTLE_MS = 5000;
/** How often a portless review re-reads a status that is still changing (install, load). */
const STATUS_POLL_MS = 2000;
const TRANSITIONAL = new Set(["checking-support", "downloading", "loading", "unloading"]);

function isOutcome(value: unknown): value is AiGenerationOutcome {
  if (!isObjectRecord(value)) return false;
  if (value.ok === false) return typeof value.error === "string";
  return (
    value.ok === true &&
    Array.isArray(value.segments) &&
    value.segments.every(
      (segment) =>
        isObjectRecord(segment) &&
        typeof segment.id === "string" &&
        typeof segment.text === "string",
    )
  );
}

function isStatus(value: unknown): value is LocalAiStatus {
  return (
    isObjectRecord(value) &&
    typeof value.enabled === "boolean" &&
    typeof value.consented === "boolean" &&
    typeof value.tier === "string" &&
    typeof value.modelId === "string" &&
    typeof value.displayName === "string" &&
    typeof value.downloadBytes === "number" &&
    typeof value.install === "string" &&
    typeof value.runtime === "string" &&
    typeof value.offerSetup === "boolean"
  );
}

/** Runtime check of a port message from the host; anything else is dropped. */
function hostMessage(value: unknown): ReviewPortHostMessage | null {
  if (!isObjectRecord(value)) return null;
  if (value.type === "status")
    return isStatus(value.status) ? (value as ReviewPortHostMessage) : null;
  if (
    value.type === "result" &&
    typeof value.requestId === "string" &&
    typeof value.modelId === "string" &&
    typeof value.promptVersion === "string" &&
    isOutcome(value.outcome)
  ) {
    return value as ReviewPortHostMessage;
  }
  return null;
}

function statusOf(response: unknown): LocalAiStatus | null {
  const answer = response as LocalAiCommandResponse | undefined;
  return answer?.ok === true && isStatus(answer.status) ? answer.status : null;
}

/**
 * Local AI for one review session, over the extension's own runtime: status
 * and setup through the background, generations over a port straight to the
 * runtime host. The port is opened lazily on the first generation, or once by
 * status() to reset a failed engine, and IS the session: disposing it cancels
 * everything it started. No text is logged.
 */
export class LocalAiReviewProvider implements ReviewAiProvider {
  private port: LocalAiPort | null = null;
  private hostReady = false;
  private disposed = false;
  private readonly pending = new Map<string, PendingJob>();
  private readonly listeners = new Set<(status: LocalAiStatus) => void>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  /** This review already opened its port to give a failed engine a fresh start. */
  private retried = false;

  constructor(
    private readonly runtime: LocalAiRuntime,
    private readonly cancelSettleMs = CANCEL_SETTLE_MS,
    private readonly pollMs = STATUS_POLL_MS,
  ) {
    document.addEventListener("visibilitychange", this.onVisible);
  }

  /**
   * Without an open port nothing pushes status here (setup happens in the options
   * tab): coming back to this tab re-reads it, so a finished install shows up.
   */
  private readonly onVisible = (): void => {
    if (document.visibilityState !== "visible" || this.port || this.listeners.size === 0) return;
    this.status().then(
      (status) => {
        if (!this.disposed && !this.port) this.notify(status);
      },
      () => {},
    );
  };

  async status(): Promise<LocalAiStatus> {
    const status = statusOf(await this.runtime.sendMessage({ command: CMD_LOCAL_AI_GET_STATUS }));
    if (!status) throw new Error("Local AI status unavailable");
    this.watchWhileChanging(status);
    if (status.runtime === "error" && !this.port && !this.retried) {
      // A new review is a fresh start after repeated engine failures, but the host
      // resets only when a review connects: connect once; its status then arrives.
      this.retried = true;
      void this.connect();
    }
    return status;
  }

  /**
   * Nothing pushes status to a review without a port: while an install or load is
   * under way, it is re-read (tab visible only) until it settles or a port opens.
   */
  private watchWhileChanging(status: LocalAiStatus): void {
    if (this.pollTimer !== null || !TRANSITIONAL.has(status.runtime)) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      if (this.disposed || this.port || document.visibilityState !== "visible") return;
      this.onVisible();
    }, this.pollMs);
  }

  onStatus(listener: (status: LocalAiStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  generate(request: AiGenerationRequest, signal: AbortSignal): Promise<GenerateResult> {
    if (this.disposed || signal.aborted) return Promise.resolve(failed("cancelled"));
    const requestId = randomUUID();
    return new Promise<GenerateResult>((resolve) => {
      const job: PendingJob = { request, resolve, cancelled: false, reconnected: false };
      this.pending.set(requestId, job);
      signal.addEventListener("abort", () => this.cancel(requestId), { once: true });
      void this.send(requestId, job);
    });
  }

  openSetup(): void {
    this.runtime.sendMessage({ command: CMD_LOCAL_AI_OPEN_SETUP }).catch(() => {});
  }

  dismissSetupOffer(): void {
    this.runtime.sendMessage({ command: CMD_LOCAL_AI_DISMISS_SETUP_OFFER }).catch(() => {});
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    document.removeEventListener("visibilitychange", this.onVisible);
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    const port = this.port;
    this.port = null;
    try {
      port?.disconnect();
    } catch {
      // Already gone with its context.
    }
    for (const requestId of [...this.pending.keys()]) this.settle(requestId, failed("cancelled"));
  }

  /** Makes sure the host exists and a port is open, then posts the job. */
  private async send(requestId: string, job: PendingJob): Promise<void> {
    const port = await this.connect();
    if (this.pending.get(requestId) !== job) return;
    if (job.cancelled) {
      this.settle(requestId, failed("cancelled"));
      return;
    }
    if (!port) {
      this.settle(requestId, failed("unavailable"));
      return;
    }
    try {
      port.postMessage({ type: "generate", requestId, request: job.request });
    } catch {
      this.settle(requestId, failed("unavailable"));
    }
  }

  private async connect(): Promise<LocalAiPort | null> {
    if (this.port) return this.port;
    if (!this.hostReady) {
      let response: unknown;
      try {
        response = await this.runtime.sendMessage({ command: CMD_LOCAL_AI_ENSURE_HOST });
      } catch {
        return null;
      }
      const status = statusOf(response);
      if (!status || this.disposed) return null;
      this.hostReady = true;
      this.notify(status);
    }
    // Another job may have opened it while the host was being made sure of.
    if (this.port || this.disposed) return this.port;
    let port: LocalAiPort;
    try {
      port = this.runtime.connect({ name: LOCAL_AI_REVIEW_PORT });
    } catch {
      return null;
    }
    this.port = port;
    port.onMessage.addListener((message) => {
      if (this.port === port) this.onMessage(message);
    });
    port.onDisconnect.addListener(() => {
      if (this.port === port) this.onDisconnect();
    });
    return port;
  }

  private onMessage(value: unknown): void {
    const message = hostMessage(value);
    if (!message) return;
    if (message.type === "status") {
      this.notify(message.status);
      return;
    }
    if (message.type !== "result") return;
    const { requestId, outcome, modelId, promptVersion } = message;
    this.settle(
      requestId,
      this.pending.get(requestId)?.cancelled
        ? failed("cancelled")
        : { outcome, modelId, promptVersion },
    );
  }

  /** The host went away: each live job may try one new connection, once. */
  private onDisconnect(): void {
    this.port = null;
    this.hostReady = false;
    for (const [requestId, job] of [...this.pending]) {
      if (job.cancelled) {
        this.settle(requestId, failed("cancelled"));
      } else if (job.reconnected) {
        this.settle(requestId, failed("unavailable"));
      } else {
        job.reconnected = true;
        void this.send(requestId, job);
      }
    }
  }

  private cancel(requestId: string): void {
    const job = this.pending.get(requestId);
    if (!job || job.cancelled) return;
    job.cancelled = true;
    try {
      this.port?.postMessage({ type: "cancel", requestId });
    } catch {
      // The disconnect settles it.
    }
    // The host normally answers the cancel; never wait on it forever.
    setTimeout(() => {
      if (this.pending.get(requestId) === job) this.settle(requestId, failed("cancelled"));
    }, this.cancelSettleMs);
  }

  private settle(requestId: string, result: GenerateResult): void {
    const job = this.pending.get(requestId);
    if (!job) return;
    this.pending.delete(requestId);
    job.resolve(result);
  }

  private notify(status: LocalAiStatus): void {
    for (const listener of [...this.listeners]) listener(status);
  }
}

function failed(error: AiErrorCode): GenerateResult {
  return { outcome: { ok: false, error }, modelId: "", promptVersion: "" };
}
