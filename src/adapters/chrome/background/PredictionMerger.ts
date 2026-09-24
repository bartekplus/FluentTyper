const PRESAGE_INTERLEAVE_COUNT = 2;

const NBSP_REGEX = /\xA0/g;

export function normalizePrediction(prediction: string): string {
  return prediction.replace(NBSP_REGEX, " ").trim().toLowerCase();
}

export function mergePredictions<T extends string | { text: string }>(
  presagePredictions: T[],
  aiPredictions: T[],
  limit: number,
): T[] {
  if (limit <= 0) {
    return [];
  }

  const merged: T[] = [];
  const seen = new Set<string>();

  const addPrediction = (prediction: T | undefined): void => {
    if (!prediction || merged.length >= limit) {
      return;
    }
    const normalized = normalizePrediction(
      typeof prediction === "string" ? prediction : prediction.text,
    );
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    merged.push(prediction);
  };

  let presageIndex = 0;
  let aiIndex = 0;

  while (
    merged.length < limit &&
    (presageIndex < presagePredictions.length || aiIndex < aiPredictions.length)
  ) {
    for (let i = 0; i < PRESAGE_INTERLEAVE_COUNT; i += 1) {
      addPrediction(presagePredictions[presageIndex]);
      presageIndex += 1;
    }
    addPrediction(aiPredictions[aiIndex]);
    aiIndex += 1;
  }

  return merged;
}
