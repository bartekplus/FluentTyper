import {
  LOCAL_AI_REVIEW_PORT,
  type HostPortUpMessage,
  type LocalAiErrorCode,
  type LocalAiInstallState,
  type LocalAiRuntimeState,
  type LocalAiStatus,
  type LocalAiUnavailableReason,
  type ReviewPortHostMessage,
} from "@core/domain/contracts/localAi";
import {
  localAiModelById,
  localAiModelForTier,
  type LocalAiModelTier,
} from "@core/domain/localAi/modelRegistry";
import { AI_PROMPT_VERSION } from "@core/domain/grammar/review/ai/prompts";
import { isObjectRecord } from "@core/domain/guards";
import { validateAiRequest } from "@core/domain/grammar/review/ai/parse";
import type {
  AiErrorCode,
  AiGenerationOutcome,
  AiGenerationRequest,
} from "@core/domain/grammar/review/ai/types";
import { JobScheduler, type ScheduledJob } from "./JobScheduler";
import { WorkerClient, type WorkerLike } from "./WorkerClient";
import type { WorkerLoadResult } from "./workerProtocol";

/** Offscreen owner of the optional model worker and review ports. */

/** chrome.runtime.Port subset (fakeable in tests). */
export interface PortLike {
  name: string;
  sender?: { tab?: unknown; url?: string };
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(callback: (message: unknown) => void): void };
  onDisconnect: { addListener(callback: () => void): void };
}

interface LocalAiHostOptions {
  connectBackground(): PortLike;
  createWorker(): WorkerLike;
  /** Used to reject extension pages that happen to have a tab. */
  extensionOrigin: string;
  /** GPU idle timeout with a review open; document idle timeout otherwise. */
  idleMs?: number;
  /** After an interrupt, tear the worker down if generation has not settled by then. */
  cancelSettleMs?: number;
  /** Upper bound on one generation before it is interrupted as a timeout. */
  jobTimeoutMs?: number;
  /** Upper bound on loading a cached model into the GPU; a hung load tears the worker down. */
  loadTimeoutMs?: number;
}

const DEFAULT_IDLE_MS = 5 * 60_000;
const DEFAULT_CANCEL_SETTLE_MS = 3_000;
const DEFAULT_JOB_TIMEOUT_MS = 60_000;
// Generous: a cold load of the larger model from disk on a slow GPU; never an unbounded wait.
const DEFAULT_LOAD_TIMEOUT_MS = 180_000;
const MAX_REVIEW_PORTS = 32;
const MAX_REQUEST_ID_LENGTH = 64;
/** Automatic worker recreations after a crash/device loss before staying in `error`. */
const MAX_RECOVERIES = 1;

type Activity = "idle" | "checking" | "downloading" | "loading" | "generating" | "unloading";

interface HostConfig {
  model: { modelId: string } | null;
  enabled: boolean;
}

function sanitizeOutcome(outcome: AiGenerationOutcome): AiGenerationOutcome {
  return outcome.ok
    ? { ok: true, segments: outcome.segments.map(({ id, text }) => ({ id, text })) }
    : { ok: false, error: outcome.error };
}

type LoadFailure = Exclude<WorkerLoadResult, { ok: true }>;

function loadFailureCode(result: LoadFailure): AiErrorCode {
  if (result.unavailable) {
    return "unavailable";
  }
  if (result.error === "cache-failed") {
    return "not-installed";
  }
  return result.error === "device-lost" ? "device-lost" : "engine-failed";
}

export class LocalAiHost {
  private background: PortLike | null = null;
  private config: HostConfig | null = null;
  /** The model `install` describes (consented model, or the one being installed). */
  private stateModelId: string | null = null;
  private install: LocalAiInstallState = "unknown";
  private unavailable: LocalAiUnavailableReason | undefined;
  private error: LocalAiErrorCode | undefined;
  private progress: number | undefined;
  private activity: Activity = "idle";
  private fatal = false;
  private recoveries = 0;
  private loadedModelId: string | null = null;
  private installing = false;
  private installRunning = false;
  private installCancelled = false;
  private interruptRunning: (() => void) | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastState = "";
  private lastStatus = "";
  private readonly reviewPorts = new Set<PortLike>();
  private readonly scheduler = new JobScheduler<PortLike>();
  private readonly worker: WorkerClient;
  private readonly idleMs: number;
  private readonly cancelSettleMs: number;
  private readonly jobTimeoutMs: number;
  private readonly loadTimeoutMs: number;

  constructor(private readonly options: LocalAiHostOptions) {
    this.worker = new WorkerClient(
      () => options.createWorker(),
      () => this.recordFailure("worker-crashed"),
    );
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.cancelSettleMs = options.cancelSettleMs ?? DEFAULT_CANCEL_SETTLE_MS;
    this.jobTimeoutMs = options.jobTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;
    this.loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  }

  /** Connects to the background, which answers with `configure`. */
  start(): void {
    this.publish();
    this.touchIdle();
  }

  // ------------------------------------------------------------ background

  /** Also called when the background asks this host to reconnect after a service-worker restart. */
  connect(): PortLike {
    if (this.background) {
      return this.background;
    }
    const port = this.options.connectBackground();
    port.onMessage.addListener((message) => this.onBackgroundMessage(message));
    port.onDisconnect.addListener(() => {
      if (this.background === port) {
        this.background = null;
      }
    });
    this.background = port;
    this.lastState = "";
    return port;
  }

  private sendUp(message: HostPortUpMessage): void {
    try {
      this.connect().postMessage(message);
    } catch {
      this.background = null;
    }
  }

  private onBackgroundMessage(value: unknown): void {
    const message = isObjectRecord(value) ? value : null;
    switch (message?.type) {
      case "configure": {
        const model = isObjectRecord(message.model) ? message.model : null;
        const record = model ? localAiModelById(model.modelId) : null;
        this.configure(record ? { modelId: record.modelId } : null, message.enabled === true);
        return;
      }
      case "install":
        void this.installModel(localAiModelForTier(message.tier).tier);
        return;
      case "cancel-install":
        this.cancelInstall();
        return;
      case "delete-model":
        if (typeof message.modelId === "string") {
          void this.deleteModel(message.modelId);
        }
        return;
      case "probe":
        void this.refresh();
        return;
      default:
        return;
    }
  }

  private configure(model: HostConfig["model"], enabled: boolean): void {
    const previousModelId = this.config?.model?.modelId ?? null;
    this.config = { model, enabled };
    this.fatal = false;
    this.recoveries = 0;
    if (!model || !enabled) {
      this.cancelAllJobs("not-ready");
      this.releaseNow();
      return;
    }
    if (previousModelId !== null && previousModelId !== model.modelId) {
      this.cancelAllJobs("not-ready");
    }
    if (this.loadedModelId !== null && this.loadedModelId !== model.modelId) {
      void this.releaseGpu();
    }
    if (this.stateModelId !== model.modelId) {
      this.stateModelId = model.modelId;
      this.install = "unknown";
    }
    if (this.install === "unknown") {
      void this.refresh();
    } else {
      this.publish();
      this.pump();
    }
  }

  // ------------------------------------------------------------ explicit actions

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.lock.then(work);
    this.lock = run.catch(() => undefined);
    return run;
  }

  /** Probe support and, for the current model, what is cached. */
  private refresh(): Promise<void> {
    return this.exclusive(async () => {
      const modelId = this.stateModelId ?? localAiModelForTier(undefined).modelId;
      this.activity = "checking";
      this.publish();
      try {
        this.unavailable =
          (await this.worker.call({ type: "probe", modelId })).unavailable ?? undefined;
        if (this.stateModelId) {
          this.install = (
            await this.worker.call({ type: "cache-state", modelId: this.stateModelId })
          ).install;
        }
      } catch {
        // Worker gone: the crash policy already recorded it.
      }
      this.activity = "idle";
    }).finally(() => this.settle());
  }

  private async installModel(tier: LocalAiModelTier): Promise<void> {
    const record = localAiModelForTier(tier);
    const modelId = record.modelId;
    this.fatal = false;
    this.recoveries = 0;
    this.error = undefined;
    this.installCancelled = false;
    this.installing = true;
    this.stateModelId = modelId;
    this.clearIdle();
    this.publish();
    let result: WorkerLoadResult = { ok: false, error: "download-failed" };
    await this.exclusive(async () => {
      this.installRunning = true;
      try {
        if (this.installCancelled) {
          throw new Error("cancelled");
        }
        this.activity = "checking";
        this.publish();
        const unavailable = (await this.worker.call({ type: "probe", modelId })).unavailable;
        this.unavailable = unavailable ?? undefined;
        if (unavailable) {
          result = { ok: false, unavailable };
        } else {
          this.activity = "downloading";
          this.setProgress(0);
          result = await this.worker.call({ type: "install", modelId }, (phase, progress) => {
            this.activity = phase === "download" ? "downloading" : "loading";
            this.setProgress(progress);
          });
          this.loadedModelId = result.ok ? modelId : null;
        }
      } catch {
        result = {
          ok: false,
          error: this.installCancelled ? "download-cancelled" : "download-failed",
        };
        this.loadedModelId = null;
      }
      this.installRunning = false;
      this.activity = "idle";
      this.progress = undefined;
      this.error = result.ok ? undefined : result.error;
      try {
        this.install = (await this.worker.call({ type: "cache-state", modelId })).install;
      } catch {
        this.install = "unknown";
      }
    });
    this.installing = false;
    this.sendUp({
      type: "installed",
      modelId,
      ok: result.ok,
      ...(result.ok || !result.error ? {} : { error: result.error }),
    });
    if (this.reviewPorts.size === 0) {
      // Installed, failed or cancelled: nothing needs the GPU any more.
      this.releaseNow();
    } else {
      this.settle();
    }
  }

  /** A running install is cancelled by tearing the worker down (downloads stop with it). */
  private cancelInstall(): void {
    if (!this.installing) {
      return;
    }
    this.installCancelled = true;
    if (this.installRunning) {
      this.teardownWorker();
    }
  }

  /** The resulting `state` messages tell the background what changed. */
  private deleteModel(modelId: string): Promise<void> {
    return this.exclusive(async () => {
      this.activity = "unloading";
      this.publish();
      try {
        await this.worker.call({ type: "delete", modelId });
        if (this.loadedModelId === modelId) {
          this.loadedModelId = null;
        }
        if (this.stateModelId === modelId) {
          this.install = (await this.worker.call({ type: "cache-state", modelId })).install;
        }
      } catch {
        // Worker gone: the crash policy already recorded it.
      }
      this.activity = "idle";
    }).finally(() => this.settle());
  }

  /**
   * Frees the GPU: after any running work (the lock), unload the engine, then
   * terminate the worker, since an unloaded engine may keep its WebGPU device.
   * The next job starts a fresh worker and loads from cache.
   */
  private releaseGpu(): Promise<void> {
    return this.exclusive(async () => {
      if (this.worker.active) {
        this.activity = "unloading";
        this.publish();
        try {
          await this.worker.call({ type: "unload" });
        } catch {
          // Worker gone: nothing is loaded any more.
        }
        this.worker.terminate();
      }
      this.loadedModelId = null;
      this.activity = "idle";
    }).finally(() => {
      this.publish();
      this.pump();
    });
  }

  /** Release now; with no review open and nothing pending, let the background close us. */
  private releaseNow(): void {
    this.clearIdle();
    void this.releaseGpu().then(() => {
      if (this.reviewPorts.size === 0 && !this.busy()) {
        this.sendUp({ type: "idle" });
      } else {
        this.touchIdle();
      }
    });
  }

  private teardownWorker(): void {
    this.worker.terminate();
    this.loadedModelId = null;
  }

  private recordFailure(code: "worker-crashed" | "device-lost"): void {
    this.loadedModelId = null;
    this.recoveries += 1;
    if (this.recoveries > MAX_RECOVERIES) {
      this.fatal = true;
      this.error = code;
    }
    this.publish();
  }

  // ------------------------------------------------------------ review ports

  acceptReviewPort(port: PortLike): void {
    if (port.name !== LOCAL_AI_REVIEW_PORT) {
      return;
    }
    const origin = this.options.extensionOrigin;
    const fromExtensionPage = port.sender?.url?.startsWith(origin) === true;
    if (!port.sender?.tab || fromExtensionPage || this.reviewPorts.size >= MAX_REVIEW_PORTS) {
      port.disconnect();
      return;
    }
    this.reviewPorts.add(port);
    this.clearIdle();
    // A new review is a fresh start after exhausted recoveries.
    this.fatal = false;
    this.recoveries = 0;
    port.onMessage.addListener((message) => this.onReviewMessage(port, message));
    port.onDisconnect.addListener(() => this.onReviewDisconnect(port));
    this.post(port, { type: "status", status: this.status() });
    this.publish();
  }

  private onReviewMessage(port: PortLike, value: unknown): void {
    if (!this.reviewPorts.has(port)) {
      return;
    }
    const message = isObjectRecord(value) ? value : null;
    const requestId = message?.requestId;
    if (
      typeof requestId !== "string" ||
      requestId.length === 0 ||
      requestId.length > MAX_REQUEST_ID_LENGTH
    ) {
      this.dropPort(port);
      return;
    }
    if (message?.type === "cancel") {
      this.cancelRequest(port, requestId);
      return;
    }
    if (message?.type !== "generate") {
      this.dropPort(port);
      return;
    }
    let request: AiGenerationRequest | null;
    try {
      request = validateAiRequest(message.request);
    } catch {
      request = null;
    }
    const modelId = this.config?.model?.modelId ?? "";
    if (!request) {
      this.postResult(port, requestId, modelId, { ok: false, error: "invalid-request" });
      return;
    }
    const blocker = this.jobBlocker();
    if (blocker && blocker !== "wait") {
      this.postResult(port, requestId, modelId, { ok: false, error: blocker });
      return;
    }
    if (this.scheduler.enqueue(port, requestId, request) === "busy") {
      this.postResult(port, requestId, modelId, { ok: false, error: "busy" });
      return;
    }
    this.post(port, { type: "progress", requestId, phase: "queued" });
    this.clearIdle();
    this.pump();
  }

  private cancelRequest(port: PortLike, requestId: string): void {
    const cancelled = this.scheduler.cancel(port, requestId);
    if (!cancelled) {
      return;
    }
    this.postResult(port, requestId, this.config?.model?.modelId ?? "", {
      ok: false,
      error: "cancelled",
    });
    if (cancelled.orphaned && cancelled.job === this.scheduler.running) {
      this.interruptRunning?.();
    }
  }

  private onReviewDisconnect(port: PortLike): void {
    if (!this.reviewPorts.delete(port)) {
      return;
    }
    if (this.scheduler.removePort(port)) {
      this.interruptRunning?.();
    }
    if (this.reviewPorts.size === 0 && !this.installing) {
      // The last review closed: release behind its settling job, no grace period.
      this.releaseNow();
    } else {
      this.touchIdle();
    }
  }

  private dropPort(port: PortLike): void {
    this.onReviewDisconnect(port);
    port.disconnect();
  }

  private post(port: PortLike, message: ReviewPortHostMessage): void {
    if (!this.reviewPorts.has(port)) {
      return;
    }
    try {
      port.postMessage(message);
    } catch {
      this.onReviewDisconnect(port);
    }
  }

  private postResult(
    port: PortLike,
    requestId: string,
    modelId: string,
    outcome: AiGenerationOutcome,
  ): void {
    this.post(port, {
      type: "result",
      requestId,
      modelId,
      promptVersion: AI_PROMPT_VERSION,
      outcome: sanitizeOutcome(outcome),
    });
  }

  // ------------------------------------------------------------ jobs

  /** Why jobs cannot run now: an error for the requester, "wait", or null (runnable). */
  private jobBlocker(): AiErrorCode | "wait" | null {
    if (!this.config) {
      return "wait";
    }
    if (!this.config.model || !this.config.enabled) {
      return "not-ready";
    }
    if (this.unavailable) {
      return "unavailable";
    }
    if (this.fatal) {
      return "engine-failed";
    }
    if (this.installing || this.install === "unknown" || this.activity === "checking") {
      return "wait";
    }
    return this.install === "complete" ? null : "not-installed";
  }

  private deliver(job: ScheduledJob<PortLike>, outcome: AiGenerationOutcome): void {
    const modelId = this.config?.model?.modelId ?? "";
    for (const requestId of job.requestIds) {
      this.postResult(job.port, requestId, modelId, outcome);
    }
    job.requestIds = [];
  }

  private notify(job: ScheduledJob<PortLike>, phase: "loading" | "generating"): void {
    for (const requestId of job.requestIds) {
      this.post(job.port, { type: "progress", requestId, phase });
    }
  }

  private cancelAllJobs(error: AiErrorCode): void {
    for (const job of this.scheduler.drain()) {
      this.deliver(job, { ok: false, error });
    }
    const running = this.scheduler.running;
    if (running && !running.cancelled) {
      this.deliver(running, { ok: false, error });
      running.cancelled = true;
      this.interruptRunning?.();
    }
  }

  private pump(): void {
    if (this.scheduler.running) {
      return;
    }
    const blocker = this.jobBlocker();
    if (blocker === "wait") {
      return;
    }
    if (blocker) {
      for (const job of this.scheduler.drain()) {
        this.deliver(job, { ok: false, error: blocker });
      }
      return;
    }
    const job = this.scheduler.next();
    if (!job) {
      return;
    }
    void this.exclusive(() => this.runJob(job)).finally(() => {
      this.scheduler.finish(job);
      this.settle();
    });
  }

  private async runJob(job: ScheduledJob<PortLike>): Promise<void> {
    const modelId = this.config?.model?.modelId;
    const blocker = this.jobBlocker();
    if (job.cancelled) {
      return;
    }
    if (!modelId || blocker) {
      this.deliver(job, {
        ok: false,
        error: blocker && blocker !== "wait" ? blocker : "not-ready",
      });
      return;
    }
    if (this.loadedModelId !== modelId) {
      this.activity = "loading";
      this.progress = undefined;
      this.publish();
      this.notify(job, "loading");
      let result: WorkerLoadResult;
      // Terminating the worker rejects the pending load, so the queue never waits forever.
      const loadTimer = setTimeout(() => this.teardownWorker(), this.loadTimeoutMs);
      try {
        result = await this.worker.call({ type: "load", modelId }, (_phase, progress) =>
          this.setProgress(progress),
        );
      } catch {
        result = { ok: false, error: "load-failed" };
      } finally {
        clearTimeout(loadTimer);
      }
      this.activity = "idle";
      this.progress = undefined;
      if (!result.ok) {
        this.onLoadFailure(result);
        this.deliver(job, { ok: false, error: loadFailureCode(result) });
        return;
      }
      this.loadedModelId = modelId;
    }
    if (job.cancelled) {
      return;
    }
    this.activity = "generating";
    this.publish();
    this.notify(job, "generating");
    const outcome = await this.generate(job, modelId);
    this.activity = "idle";
    if (!outcome.ok && outcome.error === "device-lost") {
      this.teardownWorker();
      this.recordFailure("device-lost");
    }
    this.deliver(job, outcome);
  }

  private onLoadFailure(result: LoadFailure): void {
    if (result.unavailable) {
      this.unavailable = result.unavailable;
      return;
    }
    if (result.error === "device-lost") {
      this.teardownWorker();
      this.recordFailure("device-lost");
      return;
    }
    this.error = result.error;
    if (result.error === "cache-failed") {
      // The cache is not complete after all (evicted or damaged): never claim offline readiness.
      this.install = "partial";
    }
  }

  /**
   * Runs one generation. A cancel or timeout interrupts it and waits for the
   * worker to settle; if it does not within the bound, the worker is torn
   * down (the next job starts a fresh one and reloads).
   */
  private async generate(
    job: ScheduledJob<PortLike>,
    modelId: string,
  ): Promise<AiGenerationOutcome> {
    let settled = false;
    let timedOut = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const interrupt = (): void => {
      this.worker.interrupt();
      settleTimer ??= setTimeout(() => {
        if (!settled) {
          this.teardownWorker();
        }
      }, this.cancelSettleMs);
    };
    this.interruptRunning = interrupt;
    const timeout = setTimeout(() => {
      timedOut = true;
      interrupt();
    }, this.jobTimeoutMs);
    try {
      const outcome = await this.worker.call({ type: "generate", modelId, request: job.request });
      return timedOut && !outcome.ok ? { ok: false, error: "timeout" } : outcome;
    } catch {
      return {
        ok: false,
        error: timedOut ? "timeout" : job.cancelled ? "cancelled" : "engine-failed",
      };
    } finally {
      settled = true;
      clearTimeout(timeout);
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      this.interruptRunning = null;
    }
  }

  // ------------------------------------------------------------ idle

  private busy(): boolean {
    return this.scheduler.running !== null || this.scheduler.pending > 0 || this.installing;
  }

  private settle(): void {
    this.publish();
    this.pump();
    this.touchIdle();
  }

  private clearIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private touchIdle(): void {
    this.clearIdle();
    if (!this.busy()) {
      this.idleTimer = setTimeout(() => void this.onIdle(), this.idleMs);
    }
  }

  /** Idle interval over: release the GPU; with no review open, let the background close us. */
  private async onIdle(): Promise<void> {
    this.idleTimer = null;
    if (this.busy()) {
      return;
    }
    await this.releaseGpu();
    if (!this.busy() && this.reviewPorts.size === 0) {
      this.sendUp({ type: "idle" });
    }
  }

  // ------------------------------------------------------------ state

  private setProgress(progress: number): void {
    if (
      this.progress === undefined ||
      Math.abs(progress - this.progress) >= 0.01 ||
      progress === 1
    ) {
      this.progress = progress;
      this.publish();
    }
  }

  private runtime(): LocalAiRuntimeState {
    if (!this.config) {
      return "unconfigured";
    }
    if (this.unavailable) {
      return "unavailable";
    }
    if (this.fatal) {
      return "error";
    }
    switch (this.activity) {
      case "checking":
        return "checking-support";
      case "idle":
        break;
      default:
        return this.activity;
    }
    if (this.installing) {
      // Install requested, waiting for other work: never flash "download-required" meanwhile.
      return "downloading";
    }
    if (this.install === "complete") {
      // Usable: warm, or loaded on the next job.
      return "ready";
    }
    if (this.install === "none" || this.install === "partial") {
      return "download-required";
    }
    return this.stateModelId ? "checking-support" : "unconfigured";
  }

  /**
   * Status for review ports. The host knows only what `configure` carries, so
   * `consented` means "configured with a model" and the one-time setup offer
   * is never shown from here (the background's CMD_LOCAL_AI_GET_STATUS owns it).
   */
  private status(): LocalAiStatus {
    const record = localAiModelById(this.stateModelId) ?? localAiModelForTier(undefined);
    return {
      enabled: this.config?.enabled ?? false,
      consented: Boolean(this.config?.model),
      tier: record.tier,
      modelId: record.modelId,
      displayName: record.displayName,
      downloadBytes: record.downloadBytes,
      install: this.install,
      runtime: this.runtime(),
      unavailable: this.unavailable,
      error: this.error,
      progress: this.progress,
      offerSetup: false,
    };
  }

  private publish(): void {
    const status = this.status();
    const state: HostPortUpMessage = {
      type: "state",
      runtime: status.runtime,
      install: status.install,
      modelId: this.stateModelId,
      unavailable: status.unavailable,
      error: status.error,
      progress: status.progress,
    };
    const stateKey = JSON.stringify(state);
    if (stateKey !== this.lastState) {
      this.sendUp(state);
      this.lastState = stateKey;
    }
    const statusKey = JSON.stringify(status);
    if (statusKey !== this.lastStatus) {
      this.lastStatus = statusKey;
      for (const port of this.reviewPorts) {
        this.post(port, { type: "status", status });
      }
    }
  }
}
