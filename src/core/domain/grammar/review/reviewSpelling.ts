import { startsSentence } from "../implementations/CapitalizeSentenceStartRule";
import { englishNounForms } from "../implementations/helpers/EnglishNounNumber";
import { lastNonBlankBefore } from "../implementations/helpers/EnglishRuleShared";
import { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import type { PreparedReview } from "./reviewDiagnostics";
import { MASK_CHAR, type TextRange } from "./types";

/**
 * Review spelling: words the language's dictionary does not know, offered with
 * a short list of replacements to choose from. The lookup itself is the same
 * local Presage engine (Hunspell and Aspell predictors) that suggests words
 * while typing; this module only decides which words to ask about and which
 * of Presage's candidates are close enough to offer. Nothing is ever applied
 * without the user picking a word.
 */

/** One word to look up. `before` is up to two preceding words, for ranking. */
export interface SpellingCandidate {
  range: TextRange;
  /** The word as written. */
  word: string;
  /** The word as looked up: typographic apostrophes made plain, composed (NFC). */
  lookup: string;
  before: string;
  /** "LEt's": the word with only its first capital, offered when the dictionary knows it. */
  casing?: string;
}

const MAX_SPELLING_SUGGESTIONS = 5;
const MIN_WORD_CHARS = 2;
const MAX_WORD_CHARS = 40;

// Letters with their combining marks ("e\u0301"), joined by inner apostrophes.
const WORD = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu;
// Separate from WORD: String#match resets a shared regex's lastIndex.
const CONTEXT_WORD = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu;
const SUGGESTION = /^\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*$/u;
// A word glued to these is part of a number, path, handle, identifier or compound.
const GLUE = /[\p{N}_@#$%&/\\=+*<>~^`|-]/u;
const TWO_INITIAL_CAPITALS = /^\p{Lu}\p{Lu}\p{Ll}+(?:['’]\p{Ll}+)*$/u;
// "IDs", "TVs" are acronym plurals, but "LEs", "LOs" and "WAs" are the
// language's own short words typed with a held Shift.
const SHORT_S_WORDS: Record<string, ReadonlySet<string>> = {
  en: new Set(["was", "has", "his", "yes", "its"]),
  fr: new Set(["les", "des", "mes", "tes", "ses", "ces", "nos", "vos"]),
  es: new Set(["los", "las", "les", "mis", "tus", "sus", "nos"]),
  pt: new Set(["dos", "das", "nos", "nas", "mas"]),
  de: new Set(["das", "des", "als", "bis", "uns", "was", "aus"]),
  pl: new Set(["nas", "was"]),
};

function shortSWord(word: string, lang: string): boolean {
  return SHORT_S_WORDS[lang.slice(0, 2)]?.has(word.toLowerCase()) ?? false;
}

/**
 * Words worth a dictionary lookup, in document order: prose words inside the
 * scope that no other finding already covers. Left out, because a dictionary
 * miss there is usually deliberate or not a word: anything touching protected
 * text, glued to digits, symbols or hyphens, mixed case ("iPhone", "NASA"),
 * a capitalized word inside a sentence (a name), and the user's own words.
 */
export function spellingCandidates(
  prepared: PreparedReview,
  covered: readonly TextRange[],
): SpellingCandidate[] {
  const { text } = prepared;
  const { scope } = prepared.snapshot;
  const protectedRanges = prepared.protectedRanges;
  const taken = [...covered, ...prepared.terminology.ranges, ...prepared.quotations.examples].sort(
    (a, b) => a.start - b.start,
  );
  let nextProtected = 0;
  let nextTaken = 0;
  const candidates: SpellingCandidate[] = [];
  WORD.lastIndex = scope.start;
  for (let match = WORD.exec(text); match && match.index < scope.end; match = WORD.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    const word = match[0];
    if (end > scope.end) break;
    while (nextProtected < protectedRanges.length && protectedRanges[nextProtected].end <= start) {
      nextProtected += 1;
    }
    while (nextTaken < taken.length && taken[nextTaken].end <= start) nextTaken += 1;
    if (
      (nextProtected < protectedRanges.length && protectedRanges[nextProtected].start < end) ||
      (nextTaken < taken.length && taken[nextTaken].start < end)
    ) {
      continue;
    }
    if (word.length < MIN_WORD_CHARS || word.length > MAX_WORD_CHARS) continue;
    // A number supplies unit context for the conventional abbreviation; this
    // does not expand or convert the user's measurement.
    if (
      /^secs?$/i.test(word) &&
      /(?:^|[ \t])[0-9]+(?:[.,][0-9]+)?[ \t\u00a0]+$/.test(
        text.slice(Math.max(0, start - 32), start),
      )
    )
      continue;
    const previous = text[start - 1] ?? "";
    const next = text[end] ?? "";
    // A selection that starts inside a word ("c|arefully") holds only part of it:
    // the part is not a word to look up. (A word running past the end is cut above.)
    if (/[\p{L}\p{M}\p{N}]/u.test(previous)) continue;
    if (/['’]/u.test(previous) && /[\p{L}\p{M}\p{N}]/u.test(text[start - 2] ?? "")) continue;
    if (GLUE.test(previous) || GLUE.test(next) || previous === MASK_CHAR || next === MASK_CHAR) {
      continue;
    }
    // "example.com", "e.g": a dot joining letters is not a sentence end.
    if (next === "." && /\p{L}/u.test(text[end + 1] ?? "")) continue;
    if (previous === "." && start >= 2 && /\p{L}/u.test(text[start - 2])) continue;
    const rest = word.slice(1);
    // "LEt's", "THe": a held Shift, unless an acronym plural ("IDs", "TVs").
    if (
      TWO_INITIAL_CAPITALS.test(word) &&
      (!/^\p{Lu}{2}s$/u.test(word) || shortSWord(word, prepared.options.lang))
    ) {
      const casing = word[0] + rest.toLowerCase();
      const lookup = lookupForm(casing);
      if (isLookupWord(lookup) && !prepared.dictionary.has(word.toLowerCase())) {
        candidates.push({
          range: { start, end },
          word,
          lookup,
          before: wordsBefore(text, start),
          casing,
        });
      }
      continue;
    }
    if (/\p{Lu}/u.test(rest)) continue;
    if (/\p{Lu}/u.test(word[0]) && !opensSentence(prepared, start)) continue;
    // "cafe\u0301" is looked up as "café"; the snapshot and its offsets keep the word as written.
    const lookup = lookupForm(word);
    // Only what the lookup request accepts is asked; one refused word would fail its batch.
    if (!isLookupWord(lookup)) continue;
    if (
      prepared.dictionary.has(lookup.toLowerCase()) ||
      prepared.dictionary.has(word.toLowerCase())
    )
      continue;
    candidates.push({ range: { start, end }, word, lookup, before: wordsBefore(text, start) });
  }
  return candidates;
}

// Measured with the bundled dictionaries (words the candidates filter keeps,
// so names and capitalized nouns are not counted): paragraphs in another
// language had 0-38% known words; English with many typos, slang or
// technical terms 60-75%, and Polish typed without diacritics 45%. Fewer
// than 8 looked-up words is too little to tell.
const OTHER_LANGUAGE_MIN_WORDS = 8;
const OTHER_LANGUAGE_MAX_KNOWN = 0.4;

/**
 * Paragraphs (lines) in the scope that look written in another language than
 * the review's: enough looked-up words, and too few of them known to the
 * dictionary. Their unknown words are other-language words, not typos.
 * `lookups` are answered candidates, in document order.
 */
export function otherLanguageParagraphs(
  prepared: PreparedReview,
  lookups: ReadonlyArray<{ range: TextRange; known: boolean }>,
): TextRange[] {
  const { text } = prepared;
  const { scope } = prepared.snapshot;
  const paragraphs: TextRange[] = [];
  for (let i = 0; i < lookups.length;) {
    const start = text.lastIndexOf("\n", lookups[i].range.start - 1) + 1;
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline;
    let words = 0;
    let known = 0;
    for (; i < lookups.length && lookups[i].range.start < end; i += 1) {
      words += 1;
      if (lookups[i].known) known += 1;
    }
    if (words >= OTHER_LANGUAGE_MIN_WORDS && known < words * OTHER_LANGUAGE_MAX_KNOWN) {
      paragraphs.push({ start: Math.max(start, scope.start), end: Math.min(end, scope.end) });
    }
  }
  return paragraphs;
}

function opensSentence(prepared: PreparedReview, start: number): boolean {
  const { text } = prepared;
  const i = lastNonBlankBefore(text, start);
  if (i < 0 || text[i] === "\n") return true;
  // An opening quote or bracket before the word: look past it.
  if (/[("'“‘«»„‚”¿¡[]/u.test(text[i])) return opensSentence(prepared, i);
  return startsSentence(text, start, prepared.options.lang);
}

/** Up to two words before `start` in the same sentence, for ranking candidates in context. */
function wordsBefore(text: string, start: number): string {
  const window = text.slice(Math.max(0, start - 48), start);
  const cut = window.search(/[^.!?؟\n￼]*$/u);
  const words = window.slice(cut).match(CONTEXT_WORD) ?? [];
  // The first word of a cut-off window may be partial.
  const complete = cut === 0 && start > 48 ? words.slice(1) : words;
  const last = complete.slice(-2);
  return last.length > 0 ? `${last.join(" ")} ` : "";
}

/**
 * Single-word replacements for an unknown word, in Presage's order. Presage
 * already ranks them for context; Review offers them without an edit cutoff.
 * Likely unlisted compounds are left alone when their split ranks first.
 * An English word with a regular ending on an irregular stem ("finded",
 * "childs") offers the irregular form first, which Presage rarely suggests.
 */
export function rankSpellingSuggestions(
  word: string,
  candidates: readonly string[],
  lang = "",
): string[] {
  const lower = lookupForm(word).toLowerCase();
  const seen = new Set<string>([lower]);
  const ranked: Array<{ text: string; order: number }> = [];
  const irregular = lang.startsWith("en") ? irregularForms(lower) : [];
  if (irregular.length > 0) candidates = [...irregular, ...candidates];
  candidates.forEach((candidate, order) => {
    const text = candidate.trim();
    if (!SUGGESTION.test(text)) return;
    const key = lookupForm(text).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ranked.push({ text, order });
  });
  const splitAt = compoundIndex(lower, candidates);
  if (splitAt >= 0 && !ranked.some(({ order }) => order < splitAt)) return [];
  return ranked.slice(0, MAX_SPELLING_SUGGESTIONS).map(({ text }) => matchStyle(word, text));
}

const IRREGULAR_DEGREE: Readonly<Record<string, string>> = {
  gooder: "better",
  goodest: "best",
  badder: "worse",
  baddest: "worst",
  worser: "worse",
};

/**
 * Irregular forms for a lowercase word built with a regular ending on a stem
 * from the authored tables: "-ed" on a verb ("finded", "writed", "runned") and
 * "-s"/"-es" on a noun ("childs", "oxes"). Only asked for words the dictionary
 * does not know, so real regular forms never reach it.
 */
function irregularForms(lower: string): string[] {
  if (Object.hasOwn(IRREGULAR_DEGREE, lower)) return [IRREGULAR_DEGREE[lower]];
  const forms: string[] = [];
  if (lower.endsWith("ed")) {
    const stems = [lower.slice(0, -2), lower.slice(0, -1)];
    if (lower.at(-3) === lower.at(-4)) stems.push(lower.slice(0, -3));
    for (const stem of stems) {
      const verb = englishVerbForms(stem);
      if (verb?.lemma === stem) forms.push(verb.past, verb.participle);
    }
  } else if (lower.endsWith("s")) {
    for (const stem of [lower.slice(0, -1), lower.replace(/es$/, "")]) {
      const noun = englishNounForms(stem);
      if (noun?.singular === stem) forms.push(noun.plural);
    }
  }
  return forms;
}

/**
 * Position where the dictionary offers the word split into two words of three or
 * more letters ("changelog" -> "change log", "webhook" -> "web hook"): a
 * compound the dictionary lacks, usually deliberate, not a typo. Real typos
 * split only into fragments ("occured" -> "occur ed").
 */
function compoundIndex(lower: string, candidates: readonly string[]): number {
  return candidates.findIndex((candidate) => {
    const parts = /^(\p{L}{3,})[ -](\p{L}{3,})$/u.exec(candidate.trim());
    return !!parts && (parts[1] + parts[2]).toLowerCase() === lower;
  });
}

/** A capitalized word gets capitalized suggestions; its apostrophe style is kept. */
function matchStyle(word: string, suggestion: string): string {
  let styled = word.includes("’") ? suggestion.replace(/'/g, "’") : suggestion;
  if (/\p{Lu}/u.test(word[0]) && !/\p{Lu}/u.test(styled[0])) {
    styled = styled[0].toUpperCase() + styled.slice(1);
  }
  return styled;
}

/** Words per lookup request; the session sends larger documents in several. */
const MAX_SPELLING_BATCH = 100;
// The same word shape as WORD (letters with their combining marks: "हिंदी"),
// with plain apostrophes only.
const LOOKUP_WORD = /^\p{L}[\p{L}\p{M}]*(?:'\p{L}[\p{L}\p{M}]*)*$/u;

/** A word as it is looked up: typographic apostrophes made plain, and composed (NFC). */
function lookupForm(word: string): string {
  return word.replace(/’/g, "'").normalize("NFC");
}

/** True when a lookup request accepts `word` (see parseSpellingRequest). */
function isLookupWord(word: string): boolean {
  return word.length <= MAX_WORD_CHARS && LOOKUP_WORD.test(word);
}
const MAX_BEFORE_CHARS = 100;

/**
 * Validates a lookup request from a content script: a language and a bounded
 * list of plain words, each with a short context. Anything else is refused.
 */
export function parseSpellingRequest(
  value: unknown,
): { lang: string; words: Array<{ word: string; before: string }> } | null {
  if (typeof value !== "object" || value === null) return null;
  const { lang, words } = value as { lang?: unknown; words?: unknown };
  if (typeof lang !== "string" || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(lang)) return null;
  if (!Array.isArray(words) || words.length === 0 || words.length > MAX_SPELLING_BATCH) {
    return null;
  }
  const parsed: Array<{ word: string; before: string }> = [];
  for (const item of words as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const { word, before } = item as { word?: unknown; before?: unknown };
    if (
      typeof word !== "string" ||
      !isLookupWord(word) ||
      typeof before !== "string" ||
      before.length > MAX_BEFORE_CHARS
    ) {
      return null;
    }
    parsed.push({ word, before });
  }
  return { lang, words: parsed };
}
