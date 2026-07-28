export interface PersonalizationWord {
  display: string;
  score: number;
  updatedAtMs: number;
}

export interface PersonalizationRecentEvent {
  language: string;
  normalizedWord: string;
  applied: boolean;
}

export interface PersonalizationStoreV1 {
  version: 1;
  languages: Record<string, Record<string, PersonalizationWord>>;
  recentEvents: Record<string, PersonalizationRecentEvent>;
}

export type PersonalizationRankingSnapshot = Readonly<
  Record<string, Readonly<Record<string, Readonly<PersonalizationWord>>>>
>;

export type PersonalizationEvent =
  | {
      eventType: "suggestion_accepted";
      eventId: string;
      suggestion: string;
      triggerText: string;
      language: string;
    }
  | {
      eventType: "suggestion_reverted";
      eventId: string;
    };

export interface RankedCandidateOptions {
  candidates: readonly string[];
  language: string;
  snapshot: PersonalizationRankingSnapshot;
  nowMs: number;
  pinnedCandidates?: ReadonlySet<string>;
}
