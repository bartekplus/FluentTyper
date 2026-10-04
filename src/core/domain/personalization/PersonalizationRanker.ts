import { getOwnProperty } from "../guards";
import {
  calculateEffectivePersonalizationScore,
  normalizePersonalizationWord,
} from "./PersonalizationPolicy";
import type { RankedCandidateOptions } from "./types";

const PERSONALIZATION_PROMOTION_THRESHOLD = 2;

export function rankPersonalizedCandidates(options: RankedCandidateOptions): string[] {
  const candidates = options.candidates.slice();
  const languageSnapshot = getOwnProperty(options.snapshot, options.language);
  if (!languageSnapshot || candidates.length < 2) {
    return candidates;
  }

  const pinnedCandidates = options.pinnedCandidates ?? new Set<string>();
  const ranked = candidates.map((candidate, index) => {
    const normalized = normalizePersonalizationWord(candidate, options.language);
    const learned = normalized
      ? getOwnProperty(languageSnapshot, normalized.normalizedWord)
      : undefined;
    const effectiveScore = learned
      ? calculateEffectivePersonalizationScore(learned, options.nowMs)
      : 0;
    return {
      candidate,
      index,
      pinned: pinnedCandidates.has(candidate),
      effectiveScore,
      eligible: effectiveScore >= PERSONALIZATION_PROMOTION_THRESHOLD,
    };
  });

  ranked.sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }
    if (left.pinned && right.pinned) {
      return left.index - right.index;
    }
    if (left.eligible !== right.eligible) {
      return left.eligible ? -1 : 1;
    }
    if (left.eligible && right.eligible && left.effectiveScore !== right.effectiveScore) {
      return right.effectiveScore - left.effectiveScore;
    }
    return left.index - right.index;
  });

  return ranked.map(({ candidate }) => candidate);
}
