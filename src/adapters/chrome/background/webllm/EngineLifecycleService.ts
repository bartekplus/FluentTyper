import { CreateMLCEngine } from "@mlc-ai/web-llm";
import type { InitProgressReport, MLCEngineInterface } from "@mlc-ai/web-llm";
import { getErrorMessage } from "@core/domain/error";
import type { InitProgressEntry } from "./types";

const FAILURE_RETRY_MS = 30000;
const INIT_PROGRESS_LOG_LIMIT = 12;

export enum PredictorStatus {
  Idle = "idle",
  Loading = "loading",
  Ready = "ready",
  Failed = "failed",
}

export interface EngineLifecycleRawState {
  status: PredictorStatus;
  hasWebGPU: boolean;
  initAttemptCount: number;
  lastFailureAt: number;
  lastInitStartedAt: number;
  lastInitDurationMs: number;
  lastInitProgress: number;
  lastInitProgressAt: number;
  lastInitProgressText: string | null;
  lastInitError: string | null;
  lastInitProgressLog: InitProgressEntry[];
}

export class EngineLifecycleService {
  private engine: MLCEngineInterface | null = null;
  private status: PredictorStatus = PredictorStatus.Idle;
  private initPromise: Promise<boolean> | null = null;
  private lastFailureAt = 0;
  private initAttemptCount = 0;
  private lastInitStartedAt = 0;
  private lastInitDurationMs = -1;
  private lastInitProgress = -1;
  private lastInitProgressAt = 0;
  private lastInitProgressText: string | null = null;
  private lastInitError: string | null = null;
  private lastInitProgressLog: InitProgressEntry[] = [];

  getEngine(): MLCEngineInterface | null {
    return this.engine;
  }

  getStatus(): PredictorStatus {
    return this.status;
  }

  hasWebGPU(): boolean {
    const maybeNavigator = (globalThis as { navigator?: { gpu?: unknown } })
      .navigator;
    return Boolean(maybeNavigator?.gpu);
  }

  getRawState(): EngineLifecycleRawState {
    return {
      status: this.status,
      hasWebGPU: this.hasWebGPU(),
      initAttemptCount: this.initAttemptCount,
      lastFailureAt: this.lastFailureAt,
      lastInitStartedAt: this.lastInitStartedAt,
      lastInitDurationMs: this.lastInitDurationMs,
      lastInitProgress: this.lastInitProgress,
      lastInitProgressAt: this.lastInitProgressAt,
      lastInitProgressText: this.lastInitProgressText,
      lastInitError: this.lastInitError,
      lastInitProgressLog: this.lastInitProgressLog.slice(),
    };
  }

  async ensureReady(enabled: boolean, modelId: string): Promise<boolean> {
    if (!enabled) {
      return false;
    }
    if (!this.hasWebGPU()) {
      return false;
    }
    if (this.status === PredictorStatus.Ready && this.engine) {
      return true;
    }
    if (this.status === PredictorStatus.Loading && this.initPromise) {
      return this.initPromise;
    }
    if (
      this.status === PredictorStatus.Failed &&
      Date.now() - this.lastFailureAt < FAILURE_RETRY_MS
    ) {
      return false;
    }

    this.status = PredictorStatus.Loading;
    this.initAttemptCount += 1;
    const initStartedAt = Date.now();
    this.lastInitStartedAt = initStartedAt;
    this.lastInitDurationMs = 0;
    this.lastInitProgress = 0;
    this.lastInitProgressAt = initStartedAt;
    this.lastInitProgressText = "initializing";
    this.lastInitError = null;
    this.lastInitProgressLog = [];
    this.recordInitProgress({
      progress: 0,
      timeElapsed: 0,
      text: "initializing",
    });

    this.initPromise = (async () => {
      try {
        this.engine = await CreateMLCEngine(modelId, {
          initProgressCallback: (report: InitProgressReport) => {
            this.recordInitProgress(report);
          },
        });
        this.status = PredictorStatus.Ready;
        this.lastFailureAt = 0;
        this.lastInitDurationMs = Date.now() - initStartedAt;
        this.lastInitProgress = 1;
        this.lastInitProgressAt = Date.now();
        this.lastInitProgressText = "ready";
        this.recordInitProgress({
          progress: 1,
          timeElapsed: this.lastInitDurationMs,
          text: "ready",
        });
        return true;
      } catch (error) {
        this.engine = null;
        this.status = PredictorStatus.Failed;
        this.lastFailureAt = Date.now();
        this.lastInitDurationMs = Date.now() - initStartedAt;
        this.lastInitError = getErrorMessage(error);
        this.lastInitProgressAt = Date.now();
        this.lastInitProgressText = "failed";
        this.recordInitProgress({
          progress:
            this.lastInitProgress >= 0 && Number.isFinite(this.lastInitProgress)
              ? this.lastInitProgress
              : 0,
          timeElapsed: this.lastInitDurationMs,
          text: `failed: ${this.lastInitError}`,
        });
        console.warn(
          "WebLLM init failed, fallback to Presage:",
          getErrorMessage(error),
        );
        return false;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  reset(): void {
    this.status = PredictorStatus.Idle;
    this.initPromise = null;
    if (this.engine) {
      const engine = this.engine;
      this.engine = null;
      void engine.unload().catch(() => {
        // Ignore unload errors; predictor can still recover via re-init.
      });
    }
  }

  private recordInitProgress(report: InitProgressReport): void {
    const now = Date.now();
    const progress =
      typeof report.progress === "number" && Number.isFinite(report.progress)
        ? Math.max(0, Math.min(1, report.progress))
        : this.lastInitProgress >= 0
          ? this.lastInitProgress
          : 0;
    const text =
      typeof report.text === "string" && report.text.trim().length > 0
        ? report.text.trim()
        : this.lastInitProgressText || "working";
    this.lastInitProgress = progress;
    this.lastInitProgressAt = now;
    this.lastInitProgressText = text;
    const lastEntry = this.lastInitProgressLog[this.lastInitProgressLog.length - 1];
    const shouldRecord =
      !lastEntry ||
      lastEntry.text !== text ||
      Math.abs(lastEntry.progress - progress) >= 0.01;
    if (!shouldRecord) {
      return;
    }
    this.lastInitProgressLog.push({
      atMs: now,
      progress,
      text,
    });
    if (this.lastInitProgressLog.length > INIT_PROGRESS_LOG_LIMIT) {
      this.lastInitProgressLog = this.lastInitProgressLog.slice(
        this.lastInitProgressLog.length - INIT_PROGRESS_LOG_LIMIT,
      );
    }
  }
}
