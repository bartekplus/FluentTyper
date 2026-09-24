import { damerauLevenshteinDistance } from "@core/domain/editDistance";
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
    // `predictions` is already de-duplicated case-insensitively; sort is stable, so ties keep input order.
    return predictions
      .map((token) => ({
        token,
        score: this.scoreCompletionCandidate(token.toLowerCase(), fragment),
      }))
      .filter((entry): entry is { token: string; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score)
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
    const distance = damerauLevenshteinDistance(fragment, candidate, maxDistance + 1);
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
}
