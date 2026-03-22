export interface PredictionTraceContext {
  traceId: string;
  traceStartedAtMs: number;
}

export function generatePredictionTraceId(): string {
  const randomPart =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  return `pred-${randomPart}`;
}

export function createPredictionTraceContext(
  startedAtMs: number = Date.now(),
  traceId?: string,
): PredictionTraceContext {
  return {
    traceId: traceId ?? generatePredictionTraceId(),
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
