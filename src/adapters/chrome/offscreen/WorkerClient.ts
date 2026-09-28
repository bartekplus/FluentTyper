import type {
  WorkerCall,
  WorkerProgressPhase,
  WorkerReply,
  WorkerRequest,
  WorkerResults,
} from "./workerProtocol";

/** The subset of `Worker` used (fakeable in tests). */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

/** Rejection reason of calls pending when the worker is torn down or crashes. */
export class WorkerGoneError extends Error {
  constructor(readonly crashed: boolean) {
    super(crashed ? "Local AI worker crashed" : "Local AI worker terminated");
    this.name = "WorkerGoneError";
  }
}

interface PendingCall {
  resolve(result: unknown): void;
  reject(error: WorkerGoneError): void;
  onProgress?: (phase: WorkerProgressPhase, progress: number) => void;
}

/**
 * Request/response client for the engine worker. The worker is created on
 * first use; terminate() (teardown) and a crash both reject every pending call,
 * and the next call starts a fresh worker.
 */
export class WorkerClient {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();

  constructor(
    private readonly createWorker: () => WorkerLike,
    private readonly onCrash: () => void,
  ) {}

  get active(): boolean {
    return this.worker !== null;
  }

  call<T extends WorkerCall>(
    call: T,
    onProgress?: (phase: WorkerProgressPhase, progress: number) => void,
  ): Promise<WorkerResults[T["type"]]> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject,
        onProgress,
      });
      worker.postMessage({ ...call, id });
    });
  }

  interrupt(): void {
    this.worker?.postMessage({ type: "interrupt" });
  }

  terminate(): void {
    this.teardown(false);
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) {
      return this.worker;
    }
    const worker = this.createWorker();
    worker.onmessage = (event) => this.onReply(event.data as unknown);
    worker.onerror = () => this.crash(worker);
    worker.onmessageerror = () => this.crash(worker);
    this.worker = worker;
    return worker;
  }

  private onReply(data: unknown): void {
    const reply = data as WorkerReply | null;
    const pending = typeof reply?.id === "number" ? this.pending.get(reply.id) : undefined;
    if (!reply || !pending) {
      return;
    }
    if (reply.type === "progress") {
      pending.onProgress?.(reply.phase, reply.progress);
      return;
    }
    this.pending.delete(reply.id);
    pending.resolve(reply.result);
  }

  private crash(worker: WorkerLike): void {
    if (this.worker !== worker) {
      return;
    }
    this.teardown(true);
    this.onCrash();
  }

  private teardown(crashed: boolean): void {
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const call of pending) {
      call.reject(new WorkerGoneError(crashed));
    }
  }
}
