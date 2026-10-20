import emojiKeywords from "emojilib";

/** Shortest typed word that also matches emoji names and keywords by prefix. */
export const MIN_EMOJI_PREFIX_LENGTH = 3;

export interface EmojiMatch {
  emoji: string;
  /** Canonical emojilib name, e.g. "face_with_tears_of_joy". */
  name: string;
}

interface EmojiEntry extends EmojiMatch {
  nameWords: string[];
  keywords: string[];
}

// emojilib lists the canonical name first, then the search keywords.
const EMOJI_ENTRIES: EmojiEntry[] = Object.entries(emojiKeywords).map(
  ([emoji, [name = "", ...keywords]]) => ({
    emoji,
    name,
    nameWords: name.split("_"),
    keywords: keywords.map((keyword) => keyword.toLocaleLowerCase()),
  }),
);

// Tiers step by 1000 so the position inside a tier only breaks ties.
const TIER_STEP = 1000;

function matchScore(entry: EmojiEntry, token: string, allowPrefix: boolean): number | null {
  if (entry.name === token) {
    return 0;
  }
  const nameWord = entry.nameWords.indexOf(token);
  if (nameWord !== -1) {
    return TIER_STEP + nameWord;
  }
  const keyword = entry.keywords.indexOf(token);
  if (keyword !== -1) {
    return 2 * TIER_STEP + keyword;
  }
  if (!allowPrefix) {
    return null;
  }
  const namePrefix = entry.name.startsWith(token)
    ? 0
    : entry.nameWords.findIndex((word) => word.startsWith(token));
  if (namePrefix !== -1) {
    return 3 * TIER_STEP + namePrefix;
  }
  const keywordPrefix = entry.keywords.findIndex((word) => word.startsWith(token));
  return keywordPrefix === -1 ? null : 4 * TIER_STEP + keywordPrefix;
}

/**
 * Emoji whose name or keyword matches the lowercased word being typed, best first:
 * full name, name word, keyword, then name and keyword prefixes.
 * shortcut: linear scan per keystroke, build a prefix index if profiling shows cost.
 */
export function matchEmoji(token: string, limit: number): EmojiMatch[] {
  if (!token || limit <= 0) {
    return [];
  }
  const allowPrefix = token.length >= MIN_EMOJI_PREFIX_LENGTH;
  return EMOJI_ENTRIES.flatMap((entry) => {
    const score = matchScore(entry, token, allowPrefix);
    return score === null ? [] : [{ score, entry }];
  })
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ entry: { emoji, name } }) => ({ emoji, name }));
}
