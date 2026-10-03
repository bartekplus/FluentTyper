export function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  return {
    n: sorted.length,
    min: sorted[0] ?? null,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1) ?? null,
  };
}

export function assertNoGrowth(
  before: Record<string, number>,
  after: Record<string, number>,
  keys: string[],
) {
  for (const key of keys) {
    if (!Number.isFinite(before[key]) || !Number.isFinite(after[key]) || after[key] > before[key]) {
      throw new Error(`Resource growth: ${key} (${before[key]} -> ${after[key]})`);
    }
  }
}
