import { randomUUID } from "@core/domain/randomId";

export interface PredictionTraceContext {
  traceId: string;
  traceStartedAtMs: number;
}

export function createPredictionTraceContext(): PredictionTraceContext {
  return { traceId: `pred-${randomUUID()}`, traceStartedAtMs: Date.now() };
}

export function resolveTraceAgeMs(traceStartedAtMs?: number): number | null {
  if (typeof traceStartedAtMs !== "number" || !Number.isFinite(traceStartedAtMs)) {
    return null;
  }
  return Math.max(0, Date.now() - traceStartedAtMs);
}
