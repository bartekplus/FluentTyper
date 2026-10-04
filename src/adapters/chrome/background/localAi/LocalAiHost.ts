import type {
  LocalAiErrorCode,
  LocalAiInstallState,
  LocalAiRuntimeState,
  LocalAiStatus,
  LocalAiUnavailableReason,
  ReviewPortHostMessage,
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
import { serialQueue } from "@core/domain/serialQueue";
import { JobScheduler, type ScheduledJob } from "./JobScheduler";
import type { LoadResult, LocalAiEngine } from "./LocalAiEngine";

/**
 * Background owner of the optional engine (in-process), its job queue and the
 * review ports. The controller authorizes ports and actions and configures it.
 */

/** chrome.runtime.Port subset (fakeable in tests). */
export interface PortLike {
  name: string;
  sender?: chrome.runtime.MessageSender;
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(callback: (message: unknown) => void): void };
  onDisconnect: { addListener(callback: () => void): void };
}

export type EngineLike = Pick<
  LocalAiEngine,
  | "probe"
  | "cacheState"
  | "install"
  | "load"
  | "generate"
  | "interrupt"
  | "unload"
  | "delete"
  | "deleteAllExcept"
  | "deleteDropped"
>;

/** What the controller merges into LocalAiStatus. */
export interface HostState {
  runtime: LocalAiRuntimeState;
  install: LocalAiInstallState;
  /** The model `install` describes (consented model, or the one being installed). */
  modelId: string | null;
  unavailable?: LocalAiUnavailableReason;
  error?: LocalAiErrorCode;
  progress?: number;
  installing: boolean;
}

interface LocalAiHostOptions {
  engine: EngineLike;
  /** Called after every state change. */
  onChange(): void;
  /** A trivial extension API call: it resets Chrome's 30 s service-worker idle timer. */
  keepAlive(): void;
  keepAliveMs?: number;
  /** GPU idle timeout while a review stays open without jobs. */
  idleMs?: number;
  /** After an interrupt, abandon (and dispose) a generation that has not settled by then. */
  cancelSettleMs?: number;
  /** Upper bound on one generation before it is interrupted as a timeout. */
  jobTimeoutMs?: number;
  /** Upper bound on loading a cached model into the GPU; a hung load is abandoned. */
  loadTimeoutMs?: number;
}

const DEFAULT_KEEP_ALIVE_MS = 5_000;
const DEFAULT_IDLE_MS = 5 * 60_000;
const DEFAULT_CANCEL_SETTLE_MS = 3_000;
const DEFAULT_JOB_TIMEOUT_MS = 60_000;
// Generous: a cold load of the larger model from disk on a slow GPU; never an unbounded wait.
const DEFAULT_LOAD_TIMEOUT_MS = 180_000;
const MAX_REVIEW_PORTS = 32;
const MAX_REQUEST_ID_LENGTH = 64;
/** Engine disposals after a failed generation (e.g. a lost GPU device) before staying in `error`. */
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

type LoadFailure = Exclude<LoadResult, { ok: true }>;

function loadFailureCode(result: LoadFailure): AiErrorCode {
  if (result.unavailable) {
    return "unavailable";
  }
  return result.error === "cache-failed" ? "not-installed" : "engine-failed";
}

export class LocalAiHost {
  private config: HostConfig | null = null;
  private stateModelId: string | null = null;
  private install: LocalAiInstallState = "unknown";
  private unavailable: LocalAiUnavailableReason | undefined;
  private error: LocalAiErrorCode | undefined;
  private progress: number | undefined;
  private activity: Activity = "idle";
  private fatal = false;
  private recoveries = 0;
  private loadedModelId: string | null = null;
  /** An install owns the shared install state until it ends. */
  installing = false;
  private installAbort: AbortController | null = null;
  /** Support/cache probes queued or running: jobs wait for them. */
  private refreshing = 0;
  private queuedRefresh: Promise<void> | null = null;
  /** The current `error` came from a failed probe (a later good probe clears it). */
  private probeFailed = false;
  private interruptRunning: (() => void) | null = null;
  private readonly exclusive = serialQueue();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastState = "";
  private lastStatus = "";
  private readonly reviewPorts = new Set<PortLike>();
  private readonly scheduler = new JobScheduler<PortLike>();
  private readonly engine: EngineLike;

  constructor(private readonly options: LocalAiHostOptions) {
    this.engine = options.engine;
  }

  get configured(): boolean {
    return this.config !== null;
  }

  /** Which model the user consented to; null disables review jobs (no consent, or preference off). */
  configure(model: HostConfig["model"], enabled: boolean): void {
    const previous = this.config;
    if (previous?.enabled === enabled && previous.model?.modelId === model?.modelId) {
      return;
    }
    this.config = { model, enabled };
    this.fatal = false;
    this.recoveries = 0;
    // The consented model stays known while disabled: the options page still sees and deletes it.
    if (model && this.stateModelId !== model.modelId) {
      this.stateModelId = model.modelId;
      this.install = "unknown";
    }
    if (!model || !enabled) {
      this.cancelAllJobs("not-ready");
      this.releaseNow();
      this.publish();
      return;
    }
    if (previous?.model && previous.model.modelId !== model.modelId) {
      this.cancelAllJobs("not-ready");
    }
    if (this.loadedModelId !== null && this.loadedModelId !== model.modelId) {
      void this.releaseGpu();
    }
    if (this.install === "unknown") {
      void this.refresh();
    } else {
      this.publish();
      this.pump();
    }
  }

  state(): HostState {
    const { runtime, install, unavailable, error, progress } = this.status();
    return {
      runtime,
      install,
      modelId: this.stateModelId,
      unavailable,
      error,
      progress,
      installing: this.installing,
    };
  }

  // ------------------------------------------------------------ explicit actions

  /**
   * Probe support and, for the current model, what is cached. A request joins a
   * refresh still waiting for the lock (it will read the latest state when it runs);
   * one already running may describe an older model, so a new one queues behind it.
   */
  refresh(): Promise<void> {
    if (this.queuedRefresh) return this.queuedRefresh;
    this.refreshing += 1;
    const refresh = this.exclusive(async () => {
      this.queuedRefresh = null;
      const modelId = this.stateModelId ?? localAiModelForTier(undefined).modelId;
      this.activity = "checking";
      this.publish();
      try {
        // Revisions an extension update dropped go even without a new install.
        await this.engine.deleteDropped().catch(() => undefined);
        this.unavailable = (await this.engine.probe(modelId)) ?? undefined;
        if (this.stateModelId) {
          this.install = await this.engine.cacheState(this.stateModelId);
          if (this.install === "complete" && this.config?.model?.modelId === this.stateModelId) {
            // Retries a replaced tier's cleanup that failed (e.g. after a restart).
            await this.engine.deleteAllExcept(this.stateModelId).catch(() => undefined);
          }
        }
        if (this.probeFailed) {
          this.probeFailed = false;
          // Only the probe's own error: a newer one (e.g. delete-failed) stays.
          if (this.error === "load-failed") this.error = undefined;
        }
      } catch {
        // `install` stays unknown: waiting jobs fail as engine failures instead of hanging.
        this.probeFailed = true;
        this.error = "load-failed";
      }
      this.activity = "idle";
    }).finally(() => {
      this.refreshing -= 1;
      this.settle();
    });
    this.queuedRefresh = refresh;
    return refresh;
  }

  /**
   * One install at a time (two options pages can both click Install); cancel it to
   * install another. Claims the install at once; nothing downloads before `consentRecorded`.
   */
  async installModel(tier: LocalAiModelTier, consentRecorded: Promise<unknown>): Promise<void> {
    if (this.installing) return;
    const modelId = localAiModelForTier(tier).modelId;
    const abort = new AbortController();
    this.fatal = false;
    this.recoveries = 0;
    this.error = undefined;
    this.installing = true;
    this.installAbort = abort;
    this.stateModelId = modelId;
    this.clearIdle();
    this.publish();
    await this.exclusive(async () => {
      let result: LoadResult = { ok: false, error: "download-cancelled" };
      try {
        await consentRecorded;
        if (!abort.signal.aborted) {
          this.activity = "checking";
          this.publish();
          const unavailable = await this.engine.probe(modelId);
          this.unavailable = unavailable ?? undefined;
          if (unavailable) {
            result = { ok: false, unavailable };
          } else {
            this.activity = "downloading";
            this.setProgress(0);
            result = await this.engine.install(
              modelId,
              (phase, progress) => {
                this.activity = phase === "download" ? "downloading" : "loading";
                this.setProgress(progress);
              },
              abort.signal,
              this.options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS,
            );
            this.loadedModelId = result.ok ? modelId : null;
            // Consent names one model, so other cached models are unusable. A refusal
            // leaves them for the next refresh to retry.
            if (result.ok) await this.engine.deleteAllExcept(modelId).catch(() => undefined);
          }
        }
      } catch {
        result = { ok: false, error: "download-failed" };
      }
      this.activity = "idle";
      this.progress = undefined;
      this.error = result.ok ? undefined : result.error;
      this.install = await this.engine.cacheState(modelId);
    });
    this.installing = false;
    this.installAbort = null;
    if (this.reviewPorts.size === 0) {
      // Installed, failed or cancelled: nothing needs the GPU any more.
      this.releaseNow();
    } else {
      this.settle();
    }
  }

  /** Aborts the download; a file cut short is never marked verified. */
  cancelInstall(): void {
    this.installAbort?.abort();
  }

  deleteModel(modelId: string): Promise<void> {
    return this.exclusive(async () => {
      this.activity = "unloading";
      this.publish();
      try {
        await this.engine.delete(modelId);
        if (this.error === "delete-failed") this.error = undefined;
      } catch {
        // The files stay (the cache state below says so); the options page shows why.
        this.error = "delete-failed";
      }
      if (this.loadedModelId === modelId) {
        this.loadedModelId = null;
      }
      if (this.stateModelId === modelId) {
        this.install = await this.engine.cacheState(modelId);
      }
      this.activity = "idle";
    }).finally(() => this.settle());
  }

  /** Frees the GPU after any running work (the lock); the next job loads from cache. */
  private releaseGpu(): Promise<void> {
    return this.exclusive(async () => {
      if (this.loadedModelId !== null) {
        this.activity = "unloading";
        this.publish();
      }
      await this.engine.unload();
      this.loadedModelId = null;
      this.activity = "idle";
    }).finally(() => {
      this.publish();
      this.pump();
    });
  }

  private releaseNow(): void {
    this.clearIdle();
    void this.releaseGpu().then(() => this.touchIdle());
  }

  /** Abandons the engine's model without waiting (a hung load or generation). */
  private dropEngine(): void {
    this.loadedModelId = null;
    void this.engine.unload();
  }

  private recordFailure(): void {
    this.recoveries += 1;
    if (this.recoveries > MAX_RECOVERIES) {
      this.fatal = true;
      this.error = "load-failed";
    }
    this.publish();
  }

  // ------------------------------------------------------------ review ports

  /** The controller has verified the sender (this extension's content script). */
  acceptReviewPort(port: PortLike): void {
    if (this.reviewPorts.size >= MAX_REVIEW_PORTS) {
      port.disconnect();
      return;
    }
    this.reviewPorts.add(port);
    this.clearIdle();
    // A new review is a fresh start after exhausted recoveries or a failed probe.
    this.fatal = false;
    this.recoveries = 0;
    if (this.config?.model && this.install === "unknown" && this.refreshing === 0) {
      void this.refresh();
    }
    port.onMessage.addListener((message) => this.onReviewMessage(port, message));
    port.onDisconnect.addListener(() => this.onReviewDisconnect(port));
    // A fresh host (after a service-worker restart) says nothing until configured: its
    // default status reads as "off" and would end the review's first request.
    if (this.config) {
      this.post(port, { type: "status", status: this.status() });
      this.publish();
    }
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
    if (!this.scheduler.cancel(port, requestId)) {
      return;
    }
    this.postResult(port, requestId, this.config?.model?.modelId ?? "", {
      ok: false,
      error: "cancelled",
    });
    this.interruptIfOrphaned();
  }

  /**
   * After any cancel or port removal: a running job nobody wants any more is
   * interrupted (a load only once nothing else waits for the model).
   */
  private interruptIfOrphaned(): void {
    if (this.scheduler.running?.cancelled) this.interruptRunning?.();
  }

  private onReviewDisconnect(port: PortLike): void {
    if (!this.reviewPorts.delete(port)) {
      return;
    }
    this.scheduler.removePort(port);
    this.interruptIfOrphaned();
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
    if (this.installing || this.refreshing > 0) {
      return "wait";
    }
    if (this.install === "unknown") {
      // The support/cache probe failed.
      return "engine-failed";
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
    }
    // Also a load an earlier cancel kept for the queued work drained just now.
    this.interruptIfOrphaned();
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
    if (modelId && blocker === "wait") {
      // A refresh or an install started after pump: run the job after that work.
      this.scheduler.requeue(job);
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
      const result = await this.loadModel(modelId);
      this.activity = "idle";
      this.progress = undefined;
      if (!result.ok) {
        // A load abandoned for a cancel is not a failure (the job was already answered).
        if (job.cancelled) return;
        this.onLoadFailure(result);
        this.deliver(job, { ok: false, error: loadFailureCode(result) });
        return;
      }
      this.loadedModelId = modelId;
      if (this.error === "load-failed") this.error = undefined;
    }
    if (job.cancelled) {
      return;
    }
    this.activity = "generating";
    this.publish();
    this.notify(job, "generating");
    const outcome = await this.generate(job, modelId);
    this.activity = "idle";
    if (!outcome.ok && outcome.error === "engine-failed") {
      // The engine threw (e.g. its GPU device was lost): dispose it; the next job reloads.
      this.dropEngine();
      this.recordFailure();
    }
    this.deliver(job, outcome);
  }

  /**
   * A load that never finishes is abandoned, so the queue never waits forever. So is
   * one whose only job was cancelled (or whose port left) while nothing else waits.
   */
  private async loadModel(modelId: string): Promise<LoadResult> {
    let abandoned = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<LoadResult>((resolve) => {
      const abandon = () => {
        abandoned = true;
        this.dropEngine();
        resolve({ ok: false, error: "load-failed" });
      };
      timer = setTimeout(abandon, this.options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS);
      this.interruptRunning = () => {
        if (this.scheduler.pending === 0) abandon();
      };
    });
    const load = async (): Promise<LoadResult> => {
      // Files can be evicted after the status probe. ONNX may hang while opening
      // an incomplete graph, so check the installed cache before allocating the GPU.
      const cached = await this.engine.cacheState(modelId);
      if (abandoned) return { ok: false, error: "load-failed" };
      if (cached !== "complete") return { ok: false, error: "cache-failed" };
      return this.engine.load(modelId, (_phase, progress) => this.setProgress(progress));
    };
    try {
      return await Promise.race([load(), stopped]);
    } finally {
      clearTimeout(timer);
      this.interruptRunning = null;
    }
  }

  private onLoadFailure(result: LoadFailure): void {
    if (result.unavailable) {
      this.unavailable = result.unavailable;
      return;
    }
    this.error = result.error;
    if (result.error === "cache-failed") {
      // Missing files are not a failed save: the partial-install status explains recovery.
      this.error = undefined;
      this.install = "partial";
    } else {
      // Same budget as failed generations: loads that keep failing end in `error`, not retries.
      this.recordFailure();
    }
  }

  /**
   * Runs one generation. A cancel or timeout interrupts it; if it does not
   * settle within the bound, it is abandoned and the engine disposed (the
   * next job reloads).
   */
  private async generate(
    job: ScheduledJob<PortLike>,
    modelId: string,
  ): Promise<AiGenerationOutcome> {
    let timedOut = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let abandon!: (outcome: AiGenerationOutcome) => void;
    const abandoned = new Promise<AiGenerationOutcome>((resolve) => (abandon = resolve));
    const interrupt = (): void => {
      this.engine.interrupt();
      settleTimer ??= setTimeout(() => {
        this.dropEngine();
        abandon({ ok: false, error: timedOut ? "timeout" : "cancelled" });
      }, this.options.cancelSettleMs ?? DEFAULT_CANCEL_SETTLE_MS);
    };
    this.interruptRunning = interrupt;
    const timeout = setTimeout(() => {
      timedOut = true;
      interrupt();
    }, this.options.jobTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS);
    try {
      const outcome = await Promise.race([this.engine.generate(modelId, job.request), abandoned]);
      return timedOut && !outcome.ok ? { ok: false, error: "timeout" } : outcome;
    } finally {
      clearTimeout(timeout);
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      this.interruptRunning = null;
    }
  }

  // ------------------------------------------------------------ idle and keepalive

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

  /** A review that stays open without jobs releases the GPU after the idle interval. */
  private touchIdle(): void {
    this.clearIdle();
    if (this.reviewPorts.size > 0 && !this.busy() && this.loadedModelId !== null) {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        if (!this.busy()) {
          void this.releaseGpu();
        }
      }, this.options.idleMs ?? DEFAULT_IDLE_MS);
    }
  }

  /**
   * Chrome stops an idle service worker after 30 s, dropping a multi-GB model.
   * While Local AI is in use (a review port open, a job, an install or delete),
   * a trivial API call every few seconds keeps it running; nothing else does.
   */
  private updateKeepAlive(): void {
    const active = this.reviewPorts.size > 0 || this.busy() || this.activity !== "idle";
    if (active && !this.keepAliveTimer) {
      this.keepAliveTimer = setInterval(
        () => this.options.keepAlive(),
        this.options.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS,
      );
    } else if (!active && this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
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
    if (this.unavailable) {
      return "unavailable";
    }
    if (this.fatal) {
      return "error";
    }
    if (this.installing && (this.activity === "idle" || this.activity === "checking")) {
      // From the Install click until it ends, never flash checking or "download-required".
      return "downloading";
    }
    if (this.activity !== "idle" && this.activity !== "checking") {
      return this.activity;
    }
    if (!this.config) {
      return "unconfigured";
    }
    if (this.activity === "checking") {
      return "checking-support";
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
    this.updateKeepAlive();
    const status = this.status();
    const statusKey = JSON.stringify(status);
    if (statusKey !== this.lastStatus) {
      this.lastStatus = statusKey;
      for (const port of this.reviewPorts) {
        this.post(port, { type: "status", status });
      }
    }
    const stateKey = JSON.stringify(this.state());
    if (stateKey !== this.lastState) {
      this.lastState = stateKey;
      this.options.onChange();
    }
  }
}
