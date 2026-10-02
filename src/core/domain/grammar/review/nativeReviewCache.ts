import type { PreparedReview } from "./reviewDiagnostics";
import type { DetectContext, RawFinding } from "./reviewDetectors";
import type { CatalogRuleId } from "../ruleCatalog";

// Only detector entries marked here use the audited phraseTemplates/frameMatches read contract.
// Marked by entry, not rule id: other detectors serve the same rules and must not share keys.
const AUDITED = new WeakSet<object>();
/** Marks a detector entry whose reads stay inside the window below, so its results are cached. */
export function cacheable<T extends object>(entry: T): T {
  AUDITED.add(entry);
  return entry;
}
const MAX_ENTRIES = 64;
const MAX_UNITS = 500_000;

/** Session-owned raw results. Finalization must still validate and rebuild diagnostics. */
export class NativeReviewCache {
  private entries = new Map<string, { findings: RawFinding[]; units: number }>();
  private units = 0;

  clear(): void {
    this.entries.clear();
    this.units = 0;
  }

  detect(
    prepared: PreparedReview,
    ctx: DetectContext,
    detector: { rules: CatalogRuleId[]; detect: (ctx: DetectContext) => RawFinding[] },
  ): RawFinding[] {
    const snapshot = prepared.snapshot;
    if (
      !AUDITED.has(detector) ||
      snapshot.selection ||
      snapshot.incomplete ||
      snapshot.scope.start !== 0 ||
      snapshot.scope.end !== snapshot.text.length ||
      snapshot.text.length > 50_000
    )
      return detector.detect(ctx);

    // frameMatches starts at from-256, reads another 128 behind a match (the
    // named-example guard), and sees the scan's 1024 lookahead. Include 10 more for end evidence.
    const left = Math.max(0, ctx.from - 384);
    const right = Math.min(ctx.text.length, ctx.to + 1034);
    const source = ctx.source.slice(left, right);
    const text = ctx.text.slice(left, right);
    const scanText = ctx.scanText.slice(left, right);
    const key = JSON.stringify([
      3, // Audited detector/read-contract version; bump when either changes.
      detector.rules[0],
      prepared.options,
      [...prepared.rules],
      [...prepared.dictionary],
      ctx.from - left,
      ctx.to - left,
      left === 0,
      right === ctx.text.length,
      source,
      text === source ? null : text,
      scanText === text ? null : scanText,
      prepared.protectedRanges
        .filter((range) => range.end >= left && range.start <= right)
        .map((range) => [range.start - left, range.end - left, range.reason]),
    ]);
    const cached = this.entries.get(key);
    if (cached) return shiftFindings(cached.findings, ctx.from);

    const findings = detector.detect(ctx);
    const relative = shiftFindings(findings, -ctx.from);
    const units = key.length + JSON.stringify(relative).length;
    // ponytail: FIFO, at most 64 entries/500k serialized UTF-16 units. No LRU bookkeeping.
    if (units <= MAX_UNITS) {
      while (this.entries.size >= MAX_ENTRIES || this.units + units > MAX_UNITS) {
        const oldest = this.entries.keys().next().value!;
        this.units -= this.entries.get(oldest)!.units;
        this.entries.delete(oldest);
      }
      this.entries.set(key, { findings: relative, units });
      this.units += units;
    }
    return findings;
  }
}

function shiftFindings(findings: readonly RawFinding[], delta: number): RawFinding[] {
  return findings.map((finding) => ({
    ...finding,
    alternatives: [...finding.alternatives],
    range: { start: finding.range.start + delta, end: finding.range.end + delta },
    ...(finding.context && {
      context: { start: finding.context.start + delta, end: finding.context.end + delta },
    }),
  }));
}
