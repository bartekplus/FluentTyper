import type {
  ReviewApplyResult,
  ReviewCapabilities,
  ReviewTargetPort,
  ReviewTargetRead,
} from "../../src/core/application/review/ReviewSession";
import type { ProtectedRange, ReviewEdit } from "../../src/core/domain/grammar/review/types";

export class FakeEditor implements ReviewTargetPort {
  capabilities: ReviewCapabilities = { inline: true, apply: true, bulk: true, undo: "single-step" };
  protectedRanges: ProtectedRange[] = [];
  composing = false;
  unread = 0;
  applyCalls: Array<{ edits: ReviewEdit[]; before: string; after: string }> = [];
  /** Forces the next apply result. */
  nextResult: ReviewApplyResult | null = null;

  constructor(public text: string) {}

  read(): ReviewTargetRead {
    if (this.composing) return { ok: false, reason: "composing" };
    return {
      ok: true,
      text: this.text,
      unread: this.unread,
      protectedRanges: this.protectedRanges,
      signature: JSON.stringify(this.protectedRanges),
    };
  }

  apply(request: { edits: ReviewEdit[]; before: string; after: string; signature: string }) {
    this.applyCalls.push(request);
    if (this.nextResult) {
      const result = this.nextResult;
      this.nextResult = null;
      return Promise.resolve(result);
    }
    if (this.text !== request.before) return Promise.resolve({ status: "stale" as const });
    let text = this.text;
    for (const edit of request.edits) {
      text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
    }
    this.text = text;
    return Promise.resolve(
      text === request.after ? { status: "applied" as const } : { status: "unverified" as const },
    );
  }
}

type Timer = { callback: () => void; delay: number };

/** Manual timers for a ReviewSession: the test runs them from `timers`. */
export function manualTimers() {
  const timers: Timer[] = [];
  return {
    timers,
    /** A chunk yield for LocalReviewEngine that waits for the next timer run. */
    yieldToTimers: () =>
      new Promise<void>((resolve) => timers.push({ callback: resolve, delay: 0 })),
    setTimer: (callback: () => void, delay: number) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle: unknown) => {
      const index = timers.indexOf(handle as Timer);
      if (index >= 0) timers.splice(index, 1);
    },
  };
}
