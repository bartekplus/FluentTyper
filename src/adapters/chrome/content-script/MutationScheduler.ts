export class MutationScheduler {
  private timeoutId: number | null = null;
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
    this.timeoutId = window.setTimeout(() => {
      this.scheduled = false;
      this.timeoutId = null;
      const mergedMutations = this.pendingMutations;
      this.pendingMutations = [];
      if (mergedMutations.length === 0) {
        return;
      }
      this.onReady(mergedMutations);
    }, this.coalesceDelayMs);
  }

  clear(): void {
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.scheduled = false;
    this.pendingMutations = [];
  }
}
