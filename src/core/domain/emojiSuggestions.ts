import emojiKeywords from "emojilib";

/** Shortest typed word that also matches emoji names and keywords by prefix. */
const MIN_EMOJI_PREFIX_LENGTH = 3;
// Shorter keywords are flag country codes and letters: "is" -> 🇮🇸, "to" -> 🇹🇴.
const MIN_KEYWORD_LENGTH = 3;
// emojilib keywords that are everyday filler words: "not" -> 🙈, "for" -> ⏹️.
const FILLER_KEYWORDS = new Set([
  "can",
  "for",
  "have",
  "here",
  "its",
  "not",
  "off",
  "out",
  "over",
  "then",
  "this",
  "what",
  "when",
  "you",
]);

export interface EmojiMatch {
  emoji: string;
  /** Canonical emojilib name, e.g. "face_with_tears_of_joy" or "man in tuxedo". */
  name: string;
}

interface EmojiEntry extends EmojiMatch {
  nameWords: string[];
  keywords: string[];
}

// emojilib lists the canonical name first, then the search keywords.
const EMOJI_ENTRIES: EmojiEntry[] = Object.entries(emojiKeywords).map(
  ([emoji, [name = "", ...keywords]]) => {
    const words = name.split(/[_ ]/u);
    return {
      emoji,
      name,
      // Only the first and last word: middle words are "with", "of", "the" ("the" -> 🤣).
      nameWords: [words[0] ?? "", words.at(-1) ?? ""],
      keywords: keywords
        .map((keyword) => keyword.toLocaleLowerCase())
        .filter((keyword) => keyword.length >= MIN_KEYWORD_LENGTH && !FILLER_KEYWORDS.has(keyword)),
    };
  },
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
  const namePrefix = entry.nameWords.findIndex((word) => word.startsWith(token));
  if (namePrefix !== -1) {
    return 3 * TIER_STEP + namePrefix;
  }
  const keywordPrefix = entry.keywords.findIndex((word) => word.startsWith(token));
  return keywordPrefix === -1 ? null : 4 * TIER_STEP + keywordPrefix;
}

/**
 * Emoji whose name or keyword matches the lowercased word being typed, best first:
 * full name, first or last name word, keyword, then name and keyword prefixes.
 * Prefixes only with `prefix` set and from MIN_EMOJI_PREFIX_LENGTH letters.
 * shortcut: linear scan per keystroke, build a prefix index if profiling shows cost.
 */
export function matchEmoji(token: string, limit: number, prefix = true): EmojiMatch[] {
  // One letter ("a", "i") is never meant as an emoji.
  if (token.length < 2) {
    return [];
  }
  const allowPrefix = prefix && token.length >= MIN_EMOJI_PREFIX_LENGTH;
  return EMOJI_ENTRIES.flatMap((entry) => {
    const score = matchScore(entry, token, allowPrefix);
    return score === null ? [] : [{ score, entry }];
  })
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ entry: { emoji, name } }) => ({ emoji, name }));
}
