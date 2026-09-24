/**
 * Optimal-string-alignment Damerau-Levenshtein distance. Stops early once every
 * cell in a row exceeds `maxDistance`, returning that row minimum (> maxDistance).
 */
export function damerauLevenshteinDistance(
  source: string,
  target: string,
  maxDistance: number,
): number {
  const sourceLength = source.length;
  const targetLength = target.length;
  if (sourceLength === 0) {
    return targetLength;
  }
  if (targetLength === 0) {
    return sourceLength;
  }
  const matrix: number[][] = Array.from({ length: sourceLength + 1 }, () =>
    new Array<number>(targetLength + 1).fill(0),
  );
  for (let i = 0; i <= sourceLength; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= targetLength; j += 1) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= sourceLength; i += 1) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let j = 1; j <= targetLength; j += 1) {
      const substitutionCost = source[i - 1] === target[j - 1] ? 0 : 1;
      let value = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + substitutionCost,
      );
      if (i > 1 && j > 1 && source[i - 1] === target[j - 2] && source[i - 2] === target[j - 1]) {
        value = Math.min(value, matrix[i - 2][j - 2] + 1);
      }
      matrix[i][j] = value;
      if (value < rowMin) {
        rowMin = value;
      }
    }
    if (rowMin > maxDistance) {
      return rowMin;
    }
  }
  return matrix[sourceLength][targetLength];
}
