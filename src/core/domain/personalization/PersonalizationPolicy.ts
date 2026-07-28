import { SUPPORTED_LANGUAGES } from "../lang";
import type {
  PersonalizationRecentEvent,
  PersonalizationStoreV1,
  PersonalizationWord,
} from "./types";

export const PERSONALIZATION_STORE_VERSION = 1 as const;
export const PERSONALIZATION_DECAY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const PERSONALIZATION_PROMOTION_THRESHOLD = 2;
export const PERSONALIZATION_MAX_WORDS_PER_LANGUAGE = 500;
export const PERSONALIZATION_MAX_RECENT_EVENTS = 100;

const EMPTY_STORE: PersonalizationStoreV1 = {
  version: PERSONALIZATION_STORE_VERSION,
  languages: {},
  recentEvents: {},
};

export function createEmptyPersonalizationStore(): PersonalizationStoreV1 {
  return {
    version: EMPTY_STORE.version,
    languages: {},
    recentEvents: {},
  };
}

export function isPersonalizationLanguage(language: unknown): language is string {
  return (
    typeof language === "string" &&
    language !== "auto_detect" &&
    language !== "textExpander" &&
    Object.hasOwn(SUPPORTED_LANGUAGES, language)
  );
}

export function normalizePersonalizationWord(
  value: unknown,
  language: string,
): { normalizedWord: string; display: string } | null {
  if (typeof value !== "string" || !isPersonalizationLanguage(language)) {
    return null;
  }

  const display = value.replace(/^[\s\u00a0]+|[\s\u00a0]+$/gu, "").normalize("NFC");
  const hasControlCharacter = Array.from(display).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (
    display.length === 0 ||
    hasControlCharacter ||
    display.includes("\\b") ||
    /\s|\u00a0/u.test(display) ||
    display.includes("${") ||
    !/\p{L}/u.test(display)
  ) {
    return null;
  }

  return {
    normalizedWord: display.toLocaleLowerCase(resolveLocale(language)).normalize("NFC"),
    display,
  };
}

export function calculateEffectivePersonalizationScore(
  word: Pick<PersonalizationWord, "score" | "updatedAtMs">,
  nowMs: number,
): number {
  const elapsedMs = Math.max(0, nowMs - word.updatedAtMs);
  return word.score * Math.exp(-elapsedMs / PERSONALIZATION_DECAY_WINDOW_MS);
}

export function isPromotionEligible(score: number): boolean {
  return score >= PERSONALIZATION_PROMOTION_THRESHOLD;
}

export function prunePersonalizationLanguage(
  words: Record<string, PersonalizationWord>,
  nowMs: number,
  limit = PERSONALIZATION_MAX_WORDS_PER_LANGUAGE,
): Record<string, PersonalizationWord> {
  const entries = Object.entries(words);
  if (entries.length <= limit) {
    return { ...words };
  }

  entries.sort((left, right) => {
    const scoreDelta =
      calculateEffectivePersonalizationScore(right[1], nowMs) -
      calculateEffectivePersonalizationScore(left[1], nowMs);
    return scoreDelta !== 0 ? scoreDelta : right[1].updatedAtMs - left[1].updatedAtMs;
  });
  return Object.fromEntries(entries.slice(0, Math.max(0, limit)));
}

export function sanitizePersonalizationStore(
  value: unknown,
  nowMs: number,
): PersonalizationStoreV1 {
  if (!isRecord(value) || value.version !== PERSONALIZATION_STORE_VERSION) {
    return createEmptyPersonalizationStore();
  }

  const languages: PersonalizationStoreV1["languages"] = {};
  if (isRecord(value.languages)) {
    for (const [language, rawWords] of Object.entries(value.languages)) {
      if (!isPersonalizationLanguage(language) || !isRecord(rawWords)) {
        continue;
      }
      const words: Record<string, PersonalizationWord> = {};
      for (const [rawKey, rawWord] of Object.entries(rawWords)) {
        if (!isRecord(rawWord)) {
          continue;
        }
        const normalized = normalizePersonalizationWord(rawKey, language);
        const display = normalizePersonalizationWord(rawWord.display, language);
        if (
          !normalized ||
          !display ||
          normalized.normalizedWord !== display.normalizedWord ||
          !isPositiveFiniteNumber(rawWord.score) ||
          !isValidTimestamp(rawWord.updatedAtMs)
        ) {
          continue;
        }
        defineOwnProperty(words, normalized.normalizedWord, {
          display: display.display,
          score: rawWord.score,
          updatedAtMs: rawWord.updatedAtMs,
        });
      }
      const pruned = prunePersonalizationLanguage(words, nowMs);
      if (Object.keys(pruned).length > 0) {
        languages[language] = pruned;
      }
    }
  }

  const recentEvents: Record<string, PersonalizationRecentEvent> = {};
  if (isRecord(value.recentEvents)) {
    for (const [eventId, rawEvent] of Object.entries(value.recentEvents)) {
      if (!isValidEventId(eventId) || !isRecord(rawEvent)) {
        continue;
      }
      const language = rawEvent.language;
      if (
        !isPersonalizationLanguage(language) ||
        !isValidTimestamp(rawEvent.acceptedAtMs) ||
        typeof rawEvent.applied !== "boolean"
      ) {
        continue;
      }
      const normalized = normalizePersonalizationWord(rawEvent.normalizedWord, language);
      if (!normalized || normalized.normalizedWord !== rawEvent.normalizedWord) {
        continue;
      }
      defineOwnProperty(recentEvents, eventId, {
        language,
        normalizedWord: normalized.normalizedWord,
        acceptedAtMs: rawEvent.acceptedAtMs,
        applied: rawEvent.applied,
      });
    }
  }

  return {
    version: PERSONALIZATION_STORE_VERSION,
    languages,
    recentEvents: trimRecentEvents(recentEvents),
  };
}

export function trimRecentEvents(
  events: Record<string, PersonalizationRecentEvent>,
): Record<string, PersonalizationRecentEvent> {
  const entries = Object.entries(events);
  return Object.fromEntries(entries.slice(-PERSONALIZATION_MAX_RECENT_EVENTS));
}

export function isValidEventId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function resolveLocale(language: string): string {
  return language.replace("_", "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function defineOwnProperty<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}
