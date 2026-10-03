export class MutationScheduler {
  private timeoutId: number | null = null;
  private animationFrameId: number | null = null;
  private pendingMutations: MutationRecord[] = [];
  private scheduled = false;
  private overflow = false;
  private static readonly MAX_PENDING_RECORDS = 200;

  constructor(
    private readonly coalesceDelayMs: number,
    private readonly onReady: (mutations: MutationRecord[], overflow?: boolean) => void,
  ) {}

  enqueue(mutations: MutationRecord[]): void {
    if (mutations.length === 0) {
      return;
    }
    if (!this.overflow) {
      if (this.pendingMutations.length + mutations.length > MutationScheduler.MAX_PENDING_RECORDS) {
        // Release retained DOM references. One full discovery pass preserves correctness.
        this.pendingMutations = [];
        this.overflow = true;
      } else {
        this.pendingMutations.push(...mutations);
      }
    }
    if (this.scheduled) {
      return;
    }
    this.scheduled = true;
    if (
      typeof window.requestAnimationFrame === "function" &&
      document.visibilityState === "visible"
    ) {
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
    this.overflow = false;
  }

  private flush(): void {
    this.scheduled = false;
    const mergedMutations = this.pendingMutations;
    this.pendingMutations = [];
    const overflow = this.overflow;
    this.overflow = false;
    if (mergedMutations.length === 0 && !overflow) {
      return;
    }
    if (overflow) this.onReady(mergedMutations, true);
    else this.onReady(mergedMutations);
  }
}
