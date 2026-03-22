import type { InFlightPredictorRequest, PredictorRequest } from "./types";

export class GenerationCoordinator {
  private activeGenerationSeq = 0;
  private inFlightGenerationSeq: number | null = null;
  private inFlightRequest: InFlightPredictorRequest | null = null;
  private readonly cancelledGenerationSeqs = new Set<number>();
  private readonly generationDonePromises = new Map<number, Promise<void>>();
  private readonly generationDoneResolvers = new Map<number, () => void>();
  private isGenerating = false;

  nextGenerationSeq(): number {
    this.activeGenerationSeq += 1;
    return this.activeGenerationSeq;
  }

  advanceGenerationSeq(): void {
    this.activeGenerationSeq += 1;
  }

  getActiveGenerationSeq(): number {
    return this.activeGenerationSeq;
  }

  getInFlightGenerationSeq(): number | null {
    return this.inFlightGenerationSeq;
  }

  getInFlightRequest(): InFlightPredictorRequest | null {
    return this.inFlightRequest;
  }

  getIsGenerating(): boolean {
    return this.isGenerating;
  }

  markCancelled(seq: number): void {
    this.cancelledGenerationSeqs.add(seq);
  }

  isCancelled(seq: number): boolean {
    return this.cancelledGenerationSeqs.has(seq);
  }

  registerGeneration(seq: number, request: PredictorRequest): void {
    const deferred = this.createDeferred();
    this.generationDonePromises.set(seq, deferred.promise);
    this.generationDoneResolvers.set(seq, deferred.resolve);
    this.inFlightGenerationSeq = seq;
    this.inFlightRequest = {
      lang: request.lang,
      predictionInput: request.predictionInput,
    };
    this.isGenerating = true;
  }

  completeGeneration(seq: number): void {
    this.resolveGeneration(seq);
    if (this.inFlightGenerationSeq === seq) {
      this.inFlightGenerationSeq = null;
      this.inFlightRequest = null;
      this.isGenerating = false;
    }
    this.cancelledGenerationSeqs.delete(seq);
  }

  async waitForGenerationToSettle(seq: number, timeoutMs: number): Promise<void> {
    const donePromise = this.generationDonePromises.get(seq);
    if (!donePromise || timeoutMs <= 0) {
      return;
    }
    await this.raceWithTimeout(donePromise, timeoutMs);
  }

  clearGenerationTracking(): void {
    for (const resolveDone of this.generationDoneResolvers.values()) {
      resolveDone();
    }
    this.generationDoneResolvers.clear();
    this.generationDonePromises.clear();
    this.inFlightGenerationSeq = null;
    this.inFlightRequest = null;
    this.cancelledGenerationSeqs.clear();
    this.isGenerating = false;
  }

  private createDeferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve = () => {};
    const promise = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise;
    });
    return { promise, resolve };
  }

  private resolveGeneration(seq: number): void {
    const resolveDone = this.generationDoneResolvers.get(seq);
    if (!resolveDone) {
      return;
    }
    this.generationDoneResolvers.delete(seq);
    this.generationDonePromises.delete(seq);
    resolveDone();
  }

  private async raceWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, timeoutMs);
      }),
    ]);
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
