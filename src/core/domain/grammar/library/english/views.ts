// The rule library (library/english.ts): engine machinery for views. A view is a window of the
// text with some characters changed, where other rules run: it lets them see a phrase that a
// mark hides from them (scare quotes, a soft line wrap, capitals).
import type { DetectContext, RawFinding } from "../../review/reviewDetectors";

type Detector = (ctx: DetectContext) => RawFinding[];

/** A same-length substitution: the text at `at` reads as `text` in the view. */
type ViewSwap = readonly [at: number, text: string];

/**
 * Runs `detect` over a window of the text with `swaps` applied, owning [start, end). Offsets
 * hold, so findings map back as they are.
 */
export function inView(
  ctx: DetectContext,
  start: number,
  end: number,
  swaps: readonly ViewSwap[],
  detect: Detector,
  rules: ReadonlySet<string> | undefined,
): RawFinding[] {
  const left = Math.max(0, start - 256);
  const right = Math.min(ctx.text.length, end + 256);
  let text = ctx.text.slice(left, right);
  for (const [at, swap] of swaps) {
    // A swap outside the window cannot change the view.
    if (at < left || at + swap.length > right) continue;
    text = text.slice(0, at - left) + swap + text.slice(at - left + swap.length);
  }
  const view: DetectContext = {
    ...ctx,
    source: text,
    text,
    scanText: text,
    from: start - left,
    to: end - left,
    rules,
    quotationRanges: [],
    exampleRanges: [],
  };
  return detect(view).map((f) => ({
    ...f,
    range: { start: f.range.start + left, end: f.range.end + left },
    context: f.context && { start: f.context.start + left, end: f.context.end + left },
  }));
}

// The detector of a frame rule by its id: Review sets the builder when it builds its detectors
// (review/reviewDetectors.ts). An import of the engine here would make an import cycle.
let build: ((id: string) => Detector) | undefined;
const BUILT = new Map<string, Detector>();

/** Sets the builder of `ruleFindings`. */
export function useRuleDetectors(builder: (id: string) => Detector): void {
  build = builder;
}

/** The findings of the frame rule `id` (a rule of the rule files) in the chunk `ctx`. */
export function ruleFindings(id: string, ctx: DetectContext): RawFinding[] {
  let detect = BUILT.get(id);
  if (!detect) {
    if (!build) throw new Error("ruleFindings: Review did not set the rule detectors");
    BUILT.set(id, (detect = build(id)));
  }
  return detect(ctx);
}
