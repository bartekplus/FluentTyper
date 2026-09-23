import { randomUUID } from "@core/domain/randomId";

export interface PredictionTraceContext {
  traceId: string;
  traceStartedAtMs: number;
}

export function createPredictionTraceContext(
  startedAtMs: number = Date.now(),
  traceId?: string,
): PredictionTraceContext {
  return {
    traceId: traceId ?? `pred-${randomUUID()}`,
    traceStartedAtMs: startedAtMs,
  };
}

export function resolveTraceAgeMs(
  traceStartedAtMs?: number,
  now: number = Date.now(),
): number | null {
  if (typeof traceStartedAtMs !== "number" || !Number.isFinite(traceStartedAtMs)) {
    return null;
  }
  return Math.max(0, now - traceStartedAtMs);
}
