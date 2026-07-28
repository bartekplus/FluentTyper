import {
  calculateEffectivePersonalizationScore,
  createEmptyPersonalizationStore,
  isValidEventId,
  normalizePersonalizationWord,
  prunePersonalizationLanguage,
  sanitizePersonalizationStore,
  trimRecentEvents,
} from "@core/domain/personalization/PersonalizationPolicy";
import type {
  PersonalizationEvent,
  PersonalizationRankingSnapshot,
  PersonalizationStoreV1,
} from "@core/domain/personalization/types";
import type { PersonalizationRepository } from "./PersonalizationRepository";

export interface PersonalizationServiceOptions {
  repository: PersonalizationRepository;
  isEnabled: () => boolean | Promise<boolean>;
  isTextExpansionTrigger?: (triggerText: string) => boolean | Promise<boolean>;
  now?: () => number;
}

export class PersonalizationService {
  private readonly repository: PersonalizationRepository;
  private readonly isEnabled: PersonalizationServiceOptions["isEnabled"];
  private readonly isTextExpansionTrigger: NonNullable<
    PersonalizationServiceOptions["isTextExpansionTrigger"]
  >;
  private readonly now: NonNullable<PersonalizationServiceOptions["now"]>;
  private store = createEmptyPersonalizationStore();
  private snapshot: PersonalizationRankingSnapshot = Object.freeze({});
  private initializationPromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: PersonalizationServiceOptions) {
    this.repository = options.repository;
    this.isEnabled = options.isEnabled;
    this.isTextExpansionTrigger = options.isTextExpansionTrigger ?? (() => false);
    this.now = options.now ?? Date.now;
  }

  async initialize(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.loadInitialStore();
    }
    await this.initializationPromise;
  }

  getRankingSnapshot(): PersonalizationRankingSnapshot {
    return this.snapshot;
  }

  async handleEvent(event: PersonalizationEvent): Promise<boolean> {
    if (event.eventType === "suggestion_accepted") {
      return this.accept(event);
    }
    return this.revert(event.eventId);
  }

  async accept(event: Extract<PersonalizationEvent, { eventType: "suggestion_accepted" }>) {
    return this.serializeMutation(async () => {
      if (
        !isValidEventId(event.eventId) ||
        !(await this.safeIsEnabled()) ||
        this.store.recentEvents[event.eventId]
      ) {
        return false;
      }

      const normalized = normalizePersonalizationWord(event.suggestion, event.language);
      if (!normalized || (await this.safeIsTextExpansionTrigger(event.triggerText))) {
        return false;
      }

      const nowMs = this.now();
      const next = cloneStore(this.store);
      const languageWords = next.languages[event.language] ?? {};
      const current = languageWords[normalized.normalizedWord];
      languageWords[normalized.normalizedWord] = {
        display: normalized.display,
        score: (current ? calculateEffectivePersonalizationScore(current, nowMs) : 0) + 1,
        updatedAtMs: nowMs,
      };
      next.languages[event.language] = prunePersonalizationLanguage(languageWords, nowMs);
      next.recentEvents[event.eventId] = {
        language: event.language,
        normalizedWord: normalized.normalizedWord,
        applied: true,
      };
      next.recentEvents = trimRecentEvents(next.recentEvents);
      await this.commit(next);
      return true;
    });
  }

  async revert(eventId: string): Promise<boolean> {
    return this.serializeMutation(async () => {
      if (!isValidEventId(eventId)) {
        return false;
      }
      const recentEvent = this.store.recentEvents[eventId];
      if (!recentEvent?.applied) {
        return false;
      }

      const nowMs = this.now();
      const next = cloneStore(this.store);
      const nextEvent = next.recentEvents[eventId];
      const languageWords = next.languages[nextEvent.language];
      const word = languageWords?.[nextEvent.normalizedWord];
      if (word) {
        const reversedScore = calculateEffectivePersonalizationScore(word, nowMs) - 1;
        if (reversedScore <= Number.EPSILON) {
          delete languageWords[nextEvent.normalizedWord];
        } else {
          languageWords[nextEvent.normalizedWord] = {
            ...word,
            score: reversedScore,
            updatedAtMs: nowMs,
          };
        }
        if (Object.keys(languageWords).length === 0) {
          delete next.languages[nextEvent.language];
        }
      }
      nextEvent.applied = false;
      await this.commit(next);
      return true;
    });
  }

  async clear(): Promise<void> {
    await this.serializeMutation(async () => {
      const empty = createEmptyPersonalizationStore();
      this.replaceInMemoryStore(empty);
      await this.repository.clear();
    });
  }

  private async loadInitialStore(): Promise<void> {
    let raw: unknown;
    try {
      raw = await this.repository.load();
    } catch {
      this.replaceInMemoryStore(createEmptyPersonalizationStore());
      return;
    }

    const repaired = sanitizePersonalizationStore(raw, this.now());
    this.replaceInMemoryStore(repaired);
    if (JSON.stringify(raw) !== JSON.stringify(repaired)) {
      try {
        await this.repository.save(repaired);
      } catch {
        // Ranking can safely continue from the repaired in-memory snapshot.
      }
    }
  }

  private async commit(next: PersonalizationStoreV1): Promise<void> {
    this.replaceInMemoryStore(next);
    await this.repository.save(next);
  }

  private replaceInMemoryStore(store: PersonalizationStoreV1): void {
    this.store = cloneStore(store);
    this.snapshot = createImmutableSnapshot(this.store);
  }

  private serializeMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(async () => {
      await this.initialize();
      return mutation();
    });
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async safeIsEnabled(): Promise<boolean> {
    try {
      return await this.isEnabled();
    } catch {
      return false;
    }
  }

  private async safeIsTextExpansionTrigger(triggerText: string): Promise<boolean> {
    try {
      return await this.isTextExpansionTrigger(triggerText);
    } catch {
      return true;
    }
  }
}

function cloneStore(store: PersonalizationStoreV1): PersonalizationStoreV1 {
  return {
    version: 1,
    languages: Object.fromEntries(
      Object.entries(store.languages).map(([language, words]) => [
        language,
        Object.fromEntries(Object.entries(words).map(([key, word]) => [key, { ...word }])),
      ]),
    ),
    recentEvents: Object.fromEntries(
      Object.entries(store.recentEvents).map(([eventId, event]) => [eventId, { ...event }]),
    ),
  };
}

function createImmutableSnapshot(store: PersonalizationStoreV1): PersonalizationRankingSnapshot {
  const languages: Record<string, Readonly<Record<string, Readonly<object>>>> = {};
  for (const [language, words] of Object.entries(store.languages)) {
    const immutableWords = Object.fromEntries(
      Object.entries(words).map(([key, word]) => [key, Object.freeze({ ...word })]),
    );
    languages[language] = Object.freeze(immutableWords);
  }
  return Object.freeze(languages) as PersonalizationRankingSnapshot;
}
