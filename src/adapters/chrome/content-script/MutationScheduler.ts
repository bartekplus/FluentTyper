export class MutationScheduler {
  private timeoutId: number | null = null;
  private animationFrameId: number | null = null;
  private pendingMutations: MutationRecord[] = [];
  private scheduled = false;

  constructor(
    private readonly coalesceDelayMs: number,
    private readonly onReady: (mutations: MutationRecord[]) => void,
  ) {}

  enqueue(mutations: MutationRecord[]): void {
    if (mutations.length === 0) {
      return;
    }
    this.pendingMutations.push(...mutations);
    if (this.scheduled) {
      return;
    }
    this.scheduled = true;
    if (this.shouldUseAnimationFrame()) {
      this.animationFrameId = window.requestAnimationFrame(() => {
        this.animationFrameId = null;
        this.flush();
      });
      return;
    }

    this.timeoutId = window.setTimeout(() => {
      this.timeoutId = null;
      this.flush();
    }, this.coalesceDelayMs);
  }

  clear(): void {
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.scheduled = false;
    this.pendingMutations = [];
  }

  private shouldUseAnimationFrame(): boolean {
    return (
      typeof window.requestAnimationFrame === "function" && document.visibilityState === "visible"
    );
  }

  private flush(): void {
    this.scheduled = false;
    const mergedMutations = this.pendingMutations;
    this.pendingMutations = [];
    if (mergedMutations.length === 0) {
      return;
    }
    this.onReady(mergedMutations);
  }
}
