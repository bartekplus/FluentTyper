import type { PredictionModeContext } from "./types";

export class CandidateRanker {
  postProcessPredictions(
    predictions: string[],
    modeContext: PredictionModeContext,
    limit: number,
  ): string[] {
    const normalized = this.normalizePredictions(predictions);
    if (modeContext.mode !== "complete_or_correct" || !modeContext.fragment) {
      return normalized.slice(0, limit);
    }
    const ranked = this.rankCompletionCandidates(normalized, modeContext.fragment, limit);
    return ranked.length > 0 ? ranked : normalized.slice(0, limit);
  }

  private normalizePredictions(predictions: string[]): string[] {
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const item of predictions) {
      if (typeof item !== "string") {
        continue;
      }
      const token = item.trim();
      if (!token) {
        continue;
      }
      const normalizedToken = token.toLowerCase();
      if (seen.has(normalizedToken)) {
        continue;
      }
      seen.add(normalizedToken);
      normalized.push(token);
    }
    return normalized;
  }

  private rankCompletionCandidates(
    predictions: string[],
    fragment: string,
    limit: number,
  ): string[] {
    const bestByToken = new Map<string, { token: string; score: number; index: number }>();
    predictions.forEach((token, index) => {
      const tokenLower = token.toLowerCase();
      const score = this.scoreCompletionCandidate(tokenLower, fragment);
      if (score === null) {
        return;
      }
      const existing = bestByToken.get(tokenLower);
      if (
        !existing ||
        score < existing.score ||
        (score === existing.score && index < existing.index)
      ) {
        bestByToken.set(tokenLower, { token, score, index });
      }
    });

    return Array.from(bestByToken.values())
      .sort((a, b) => (a.score !== b.score ? a.score - b.score : a.index - b.index))
      .map((entry) => entry.token)
      .slice(0, limit);
  }

  private scoreCompletionCandidate(candidate: string, fragment: string): number | null {
    if (!candidate || !fragment) {
      return null;
    }
    if (candidate === fragment) {
      return 0;
    }
    if (candidate.startsWith(fragment)) {
      return 1 + Math.max(0, candidate.length - fragment.length) / 100;
    }
    const maxDistance = this.getMaxCorrectionDistance(fragment.length);
    const distance = this.damerauLevenshteinDistance(fragment, candidate, maxDistance + 1);
    const overlapRatio = this.getCharacterOverlapRatio(fragment, candidate);
    if (
      distance <= maxDistance &&
      candidate.length >= Math.max(2, fragment.length - 1) &&
      overlapRatio >= 0.55
    ) {
      return (
        10 +
        distance +
        (1 - overlapRatio) * 6 +
        Math.max(0, candidate.length - fragment.length) / 100
      );
    }
    return null;
  }

  private getMaxCorrectionDistance(fragmentLength: number): number {
    if (fragmentLength <= 4) {
      return 1;
    }
    if (fragmentLength <= 8) {
      return 3;
    }
    return 4;
  }

  private getCharacterOverlapRatio(source: string, target: string): number {
    if (!source || !target) {
      return 0;
    }
    const sourceCounts = new Map<string, number>();
    const targetCounts = new Map<string, number>();
    for (const char of source) {
      sourceCounts.set(char, (sourceCounts.get(char) ?? 0) + 1);
    }
    for (const char of target) {
      targetCounts.set(char, (targetCounts.get(char) ?? 0) + 1);
    }
    let overlapCount = 0;
    for (const [char, count] of sourceCounts.entries()) {
      overlapCount += Math.min(count, targetCounts.get(char) ?? 0);
    }
    return overlapCount / Math.max(source.length, target.length);
  }

  private damerauLevenshteinDistance(source: string, target: string, maxDistance: number): number {
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
}
