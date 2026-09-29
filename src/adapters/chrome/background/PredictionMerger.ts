const NBSP_REGEX = /\xA0/g;

export function normalizePrediction(prediction: string): string {
  return prediction.replace(NBSP_REGEX, " ").trim().toLowerCase();
}
