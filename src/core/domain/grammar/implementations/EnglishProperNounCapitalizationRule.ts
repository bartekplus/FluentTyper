import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  resolveEnglishBoundaryContext,
  resolveUserDictionarySet,
} from "./helpers/EnglishRuleShared";
import { isTechnicalToken, normalizeWordSet } from "./helpers/GenericRuleShared";

// Names that are never a common word, so a lowercase one is always a slip.
// Seasons, directions, job titles and holidays that are also ordinary phrases
// ("memorial day", "mother's day", "boxing day", "good friday", "lent",
// "thanksgiving" as in "a prayer of thanksgiving") stay out on purpose.
const PHRASES = [
  // Multi-word first so "christmas eve" wins over "christmas".
  "New Year's Day",
  "New Year's Eve",
  "Christmas Eve",
  "Christmas Day",
  "Valentine's Day",
  "North America",
  "South America",
  "Latin America",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "January",
  "February",
  "April",
  "June",
  "July",
  "September",
  "October",
  "November",
  "December",
  "Christmas",
  "Easter",
  "Halloween",
  "Hanukkah",
  "Passover",
  "Ramadan",
  "Diwali",
  "Africa",
  "America",
  "Antarctica",
  "Asia",
  "Australia",
  "Europe",
  "Oceania",
];

// Not glued to a word, number, mention, hashtag, path, dotted name or key=value.
const NAME_START = "(?<![\\p{L}\\p{N}_@#/\\\\.'’=:&?])";
// Matches end within this many characters of the cursor; regexes start scanning
// here (the g flag keeps lookbehinds working) so long documents stay cheap.
const TAIL = 64;

// A plural or possessive keeps its ending: "mondays", "easter's".
const PHRASE_REGEX = new RegExp(
  `${NAME_START}(${PHRASES.map((phrase) =>
    phrase.replace(/'/g, "['’]?").replace(/ /g, "[ \\t]+"),
  ).join("|")})(?:['’]?s)?$`,
  "giu",
);
const CANONICAL = new Map(PHRASES.map((phrase) => [phraseKey(phrase), phrase]));

// "may", "march" and "august" are also a verb, a verb and an adjective ("it may
// rain", "we march on", "an august institution"). Only evidence that cannot be
// the verb or adjective counts: "mid-may", or a day number or year after it
// ("may 15", "august 2026"). "march" before a number is also the verb ("march 2
// abreast"), so it also needs a date word or day number before it ("on march
// 10", "3 march 2026"). Anything less certain ("in may,", "15 august and") is
// left as typed.
const CONTEXT_MONTH_REGEX = new RegExp(
  `${NAME_START}(may|march|august)(?:[ \\t]+([\\p{L}\\p{N}]+))?$`,
  "giu",
);
const MARCH_DATE_WORDS = new Set(["on", "in", "since", "until", "till", "from", "by", "of"]);
const DAY_NUMBER = /^(?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?$/i;
const DAY_OR_YEAR = /^(?:(?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?|(?:19|20)\d\d)$/i;
const PREVIOUS_WORD_REGEX = /(?:^|\s)[(["“]?([\p{L}\p{N}'’]+)[ \t]+$/gu;
const MID_PREFIX_REGEX = /(?<!\p{L})mid-$/giu;

/** `regex` (g flag) run over only the last TAIL characters of `text`. */
function execTail(regex: RegExp, text: string): RegExpExecArray | null {
  regex.lastIndex = Math.max(0, text.length - TAIL);
  return regex.exec(text);
}

function phraseKey(phrase: string): string {
  return phrase.toLowerCase().replace(/[^\p{L}]/gu, "");
}

/** Gives each all-lowercase word of `typed` the canonical casing, letter for letter. */
export function recase(typed: string, canonical: string): string {
  const letters = [...canonical.replace(/[^\p{L}]/gu, "")];
  let index = 0;
  return typed.replace(/\S+/g, (word) => {
    const lower = word === word.toLowerCase();
    return word.replace(/\p{L}/gu, (ch) => {
      const target = letters[index++] ?? ch;
      return lower ? target : ch;
    });
  });
}

export class EnglishProperNounCapitalizationRule implements GrammarRule {
  readonly id = "englishProperNounCapitalization" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  private readonly fallbackUserDictionary: Set<string>;

  constructor(userDictionaryList: string[] = []) {
    this.fallbackUserDictionary = normalizeWordSet(userDictionaryList);
  }

  apply(context: GrammarContext): GrammarEdit | null {
    const boundary = resolveEnglishBoundaryContext(context);
    if (!boundary) {
      return null;
    }
    const { core, trailing, input } = boundary;
    // "monday." may still become "monday.com" or "june.pdf"; wait for the next key.
    if (trailing === ".") {
      return null;
    }
    const found = findProperName(core);
    if (!found) {
      return null;
    }
    let tokenStart = found.start;
    while (tokenStart > 0 && !/\s/.test(core[tokenStart - 1])) {
      tokenStart -= 1;
    }
    if (isTechnicalToken(core.slice(tokenStart))) {
      return null;
    }
    // The whole word, with any plural or possessive ending: casing and the user
    // dictionary apply to "mondays" and "easter's" as typed, and to their base.
    const typed = core.slice(found.start, found.end);
    const dictionary = resolveUserDictionarySet(context, this.fallbackUserDictionary);
    const replaced = recase(typed, found.canonical);
    if (
      replaced === typed ||
      dictionary.has(typed.toLowerCase()) ||
      dictionary.has(found.canonical.toLowerCase())
    ) {
      return null;
    }

    return {
      replacement: `${replaced}${core.slice(found.end)}${trailing}`,
      deleteBackwards: input.length - found.start,
      deleteForwards: 0,
    };
  }
}

/**
 * The name ending at the end of `core` (a word end), with its canonical form.
 * `contextual` marks may/march/august, which needed date evidence to count.
 */
// Letters-only last words of the names findProperName can end on.
const LAST_WORDS = new Set([
  ...PHRASES.map((phrase) => phraseKey(phrase.split(" ").at(-1)!)),
  "may",
  "march",
  "august",
]);

// The month words whose date evidence is the number right after them.
const MONTH_BEFORE_NUMBER = /(?:may|march|august)[ \t]+$/i;

/**
 * Cheap pre-check for scanning finished text: false when no name found by
 * findProperName can end with `word` (a whole word, possibly possessive or
 * plural, or a day/year right after a month word in `before`).
 */
export function couldEndProperName(word: string, before: string): boolean {
  if (DAY_OR_YEAR.test(word)) return MONTH_BEFORE_NUMBER.test(before);
  const key = phraseKey(word);
  return LAST_WORDS.has(key) || LAST_WORDS.has(key.replace(/s$/, ""));
}

export function findProperName(
  core: string,
): { start: number; end: number; canonical: string; contextual: boolean } | null {
  const phrase = execTail(PHRASE_REGEX, core);
  if (phrase) {
    // PHRASE_REGEX is built from PHRASES, so every match has a canonical form.
    const canonical = CANONICAL.get(phraseKey(phrase[1]))!;
    return { start: phrase.index, end: core.length, canonical, contextual: false };
  }

  const month = execTail(CONTEXT_MONTH_REGEX, core);
  if (!month) {
    return null;
  }
  const [, word, next] = month;
  const before = core.slice(0, month.index);
  const previous = execTail(PREVIOUS_WORD_REGEX, before)?.[1].toLowerCase() ?? "";
  const isMonth = next
    ? DAY_OR_YEAR.test(next) &&
      (word.toLowerCase() !== "march" ||
        MARCH_DATE_WORDS.has(previous) ||
        DAY_NUMBER.test(previous))
    : execTail(MID_PREFIX_REGEX, before) !== null;
  if (!isMonth) {
    return null;
  }
  const canonical = word[0].toUpperCase() + word.slice(1).toLowerCase();
  return { start: month.index, end: month.index + word.length, canonical, contextual: true };
}

// Months that are only ever months, for "april or may" and "may to june".
const PLAIN_MONTHS = "january|february|april|june|july|september|october|november|december";
// Before a month and never before the verb or adjective: "in may", "until march".
const MONTH_PREPOSITIONS = new Set(
  "in during since until till by from before through throughout".split(" "),
);
// "last march" is a month; "the last march" or "his early march" is a march.
const MONTH_MODIFIERS = new Set(["last", "next", "every", "early", "late"]);
const NOUN_DETERMINERS = new Set(
  "the a an this that his her their our my your its whose one".split(" "),
);
// "the end of may", "the 5th of march".
const OF_MONTH_HEADS = new Set(["end", "beginning", "start", "middle", "ides", "rest", "month"]);
// The word ends its clause: sentence mark, comma, closing bracket or the line's
// end (LF, CRLF or CR).
const CLAUSE_END = /^(?:[.,;:!?)\]]|[ \t]*(?:[\r\n]|$))/u;
const YEAR_AFTER = /^[ \t]+(?:19|20)\d\d(?![\p{L}\p{N}])/u;
const RANGE_AFTER = new RegExp(
  `^[ \\t]*(?:to|through|until|till|and|or|[-–—])[ \\t]*(?:${PLAIN_MONTHS})(?![\\p{L}])`,
  "iu",
);
const RANGE_BEFORE = new RegExp(
  `(?<![\\p{L}])(?:${PLAIN_MONTHS})[ \\t]*(?:,|to|through|until|till|and|or|[-–—])[ \\t]*$`,
  "iu",
);
const LAST_TWO_WORDS = /(?:^|[^\p{L}\p{N}'’])([\p{L}\p{N}'’]+)[ \t]+([\p{L}\p{N}'’]+)[ \t]+$/u;

/**
 * Finished text only (review): whether a lowercase "may", "march" or
 * "august" is the month, judged with the text AFTER it too, which typing
 * never has. `before` ends right before the word and `after` starts right
 * after it. The verb and the adjective need a subject or a noun next to
 * them, so the month is what is left when neither can fit:
 * - a date preposition before it and its clause ending after it:
 *   "in may.", "until march,", "by august" at the end of a line;
 * - "last"/"next"/"every"/"early"/"late" before it, not after a determiner
 *   ("last may," is a month; "the last march," is a march);
 * - "the end of may", "the 5th of march", ending its clause or before a year;
 * - a day number before it, ending its clause: "on 5 may.";
 * - a range or list with a month that is only a month: "april or may",
 *   "may to june".
 * Anything else ("this may.", "in august company", "they march,") stays.
 */
export function isMonthInContext(word: string, before: string, after: string): boolean {
  if (!/^(?:may|march|august)$/.test(word)) return false;
  if (RANGE_AFTER.test(after)) return true;
  const ends = CLAUSE_END.test(after) || YEAR_AFTER.test(after);
  if (!ends) return false;
  if (RANGE_BEFORE.test(before)) return true;
  const words = LAST_TWO_WORDS.exec(before);
  const previous = (words?.[2] ?? execTail(PREVIOUS_WORD_REGEX, before)?.[1] ?? "").toLowerCase();
  const earlier = (words?.[1] ?? "").toLowerCase();
  if (MONTH_PREPOSITIONS.has(previous)) return true;
  if (MONTH_MODIFIERS.has(previous)) return !NOUN_DETERMINERS.has(earlier);
  if (previous === "of") return OF_MONTH_HEADS.has(earlier) || DAY_NUMBER.test(earlier);
  return DAY_NUMBER.test(previous) && (MARCH_DATE_WORDS.has(earlier) || /\D$/.test(previous));
}
