import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { namedExampleBefore, OPENING_QUOTES } from "./exampleCues";
import {
  CLOSED_COMPOUNDS,
  NAME_CASING,
  PHRASE_CORRECTIONS,
  STYLE_PHRASES,
  UNAMBIGUOUS_CAPS_ABBREVIATIONS,
  type PhraseRow,
} from "./englishPhraseTables";
import { EXTENSION_COMPOUNDS, EXTENSION_PHRASES, EXTENSION_STYLE } from "./english";
import { OPTIONAL_TABLES } from "./english/dialects";
import { LANGUAGE_PHRASE_TABLES } from "./languagePhraseTables";
import { EDGE, SPACE } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

type Phrase = {
  /** The typed words only: literals and spaces, so thousands of rows compile cheaply. */
  body: RegExp;
  /** Ends in a letter or digit: the next character must not continue the word. */
  bounded: boolean;
  replacements: readonly string[];
  ruleId: RawFinding["ruleId"];
  messageKey: RawFinding["messageKey"];
  length: number;
};

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const wordKey = (word: string) => word.toLowerCase().replace(/’/g, "'");

// French elided articles and pronouns stay attached: "l'addresse", "d'apeller".
const ELIDED = "(?:[cdjlmnst]|qu|jusqu|lorsqu|puisqu)['’]";
const FRENCH_ELIDED = new RegExp(`^${ELIDED}(?=\\p{L})`, "iu");

// Word boundaries are checked once per position, not compiled into every row: a
// Unicode property class costs about a millisecond per regex to build in V8.
const WORD_STARTS = new Map(
  ["en", "fr"].map((lang) => [
    lang,
    new RegExp(
      `(?<![.])${lang === "fr" ? `(?:(?<=(?<!\\p{L})${ELIDED})|(?<!${EDGE}))` : `(?<!${EDGE})`}`,
      "iuy",
    ),
  ]),
);
const WORD_ENDS = new RegExp(`(?!${EDGE}|\\.[\\p{L}\\p{N}])`, "iuy");
// Arabic "و" (and) and "ف" (so) are written onto the next word: "وقال", "فإن".
WORD_STARTS.set("ar", new RegExp(`(?<![.])(?:(?<=(?<![\\p{L}\\p{M}])[وف])|(?<!${EDGE}))`, "uy"));
const startsWord = (text: string, at: number, lang: string) => {
  const regex = WORD_STARTS.get(lang === "fr" || lang === "ar" ? lang : "en")!;
  regex.lastIndex = at;
  return regex.test(text);
};

// One lookup per language and word: phrases are indexed by their first word, longest first.
const INDEXES = new Map<string, Map<string, Phrase[]>>();
function index(
  lang: string,
  rows: readonly PhraseRow[] = [],
  ruleId: Phrase["ruleId"],
  messageKey: Phrase["messageKey"],
) {
  const INDEX = INDEXES.get(lang) ?? new Map<string, Phrase[]>();
  INDEXES.set(lang, INDEX);
  for (const [typed, replacement] of rows) {
    for (const form of [typed].flat()) {
      const body = form
        .split(" ")
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['’]"))
        .join(SPACE);
      const key = wordKey(form.match(WORD)![0]);
      const list = INDEX.get(key) ?? [];
      list.push({
        body: new RegExp(body, "iuy"),
        bounded: /[\p{L}\p{N}]$/u.test(form),
        replacements: [replacement].flat(),
        ruleId,
        messageKey,
        length: form.length,
      });
      INDEX.set(key, list);
    }
  }
  // Stable: rows of equal length keep table order.
  for (const list of INDEX.values()) list.sort((a, b) => b.length - a.length);
}

/** A row typed at `at`: its words, then (for a bounded row) no word continuing them. */
function matchPhrase(text: string, phrase: Phrase, at: number): RegExpExecArray | null {
  phrase.body.lastIndex = at;
  const match = phrase.body.exec(text);
  if (!match || !phrase.bounded) return match;
  WORD_ENDS.lastIndex = at + match[0].length;
  return WORD_ENDS.test(text) ? match : null;
}
index(
  "en",
  [...PHRASE_CORRECTIONS, ...EXTENSION_PHRASES],
  "englishPhraseCorrections",
  "review_msg_phrase_correction",
);
index(
  "en",
  [...CLOSED_COMPOUNDS, ...EXTENSION_COMPOUNDS],
  "englishClosedCompounds",
  "review_msg_closed_compound",
);
// Before style: a dialect row outranks a style row on the same word when both are on.
for (const { rows, ruleId, messageKey } of OPTIONAL_TABLES) index("en", rows, ruleId, messageKey);
index("en", [...STYLE_PHRASES, ...EXTENSION_STYLE], "stylePhrasing", "review_msg_style_phrasing");
index(
  "en",
  NAME_CASING.map((name) => [name.toLowerCase(), name]),
  "englishCanonicalCasing",
  "review_msg_name_casing",
);
for (const [lang, tables] of Object.entries(LANGUAGE_PHRASE_TABLES)) {
  index(lang, tables.words, "englishPhraseCorrections", "review_msg_typo");
  index(lang, tables.phrases, "englishPhraseCorrections", "review_msg_contextual_grammar");
  index(lang, tables.compounds, "englishClosedCompounds", "review_msg_closed_compound");
  index(lang, tables.style, "stylePhrasing", "review_msg_style_phrasing");
}

/** The typed casing carried onto a replacement written in its ordinary form. */
function matchCase(
  typed: string,
  replacement: string,
  abbreviation: boolean,
  sentenceStart: boolean,
): string {
  // Only the joiner changes ("BLU ray" -> "BLU-ray"): every letter keeps its case.
  const pieces = (text: string) => text.toLowerCase().split(/[\s-]+/);
  if (pieces(typed).join(" ") === pieces(replacement).join(" ")) {
    let at = 0;
    const kept = typed.replace(/[\s-]+/g, "");
    return replacement.replace(/[^\s-]/g, () => kept[at++]);
  }
  const letters = typed.replace(/\P{L}/gu, "");
  // "ALL THE SUDDEN" shouts; "BTW" is just how the abbreviation is written.
  if (letters.length > 1 && letters === letters.toUpperCase()) {
    if (!abbreviation) return replacement.toUpperCase();
    if (!sentenceStart) return replacement;
  } else if (!/^\P{L}*\p{Lu}/u.test(typed)) return replacement;
  // "Eagle Eyed" in a title keeps every word capitalized: "Eagle-Eyed".
  const titled = /^\p{Lu}\p{Ll}*(?:\P{L}+\p{Lu}\p{Ll}*)+$/u.test(typed);
  return replacement.replace(titled ? /(?<!\p{L})\p{L}/gu : /\p{L}/u, (letter) =>
    letter.toUpperCase(),
  );
}

/**
 * Fixed phrases from the review language's authored tables, matched as whole
 * words. Names, mentions, quoted examples and user-dictionary words stay as typed.
 */
export function phraseCorrections(ctx: DetectContext): RawFinding[] {
  const INDEX = INDEXES.get(ctx.lang.slice(0, 2));
  if (!INDEX) return [];
  const findings: RawFinding[] = [];
  const words = new RegExp(WORD);
  words.lastIndex = ctx.from;
  for (
    let word = words.exec(ctx.scanText);
    word && word.index < ctx.to;
    word = words.exec(ctx.scanText)
  ) {
    // A French word may also start after its elided article: "l'" + "addresse".
    const elided = ctx.lang.startsWith("fr")
      ? (FRENCH_ELIDED.exec(word[0])?.[0].length ?? 0)
      : ctx.lang.startsWith("ar") && /^[وف]\p{L}{2}/u.test(word[0])
        ? 1
        : 0;
    lookup: for (const at of elided ? [0, elided] : [0]) {
      const phrases = INDEX.get(wordKey(word[0].slice(at)));
      if (!phrases || !startsWord(ctx.scanText, word.index + at, ctx.lang.slice(0, 2))) continue;
      for (const phrase of phrases) {
        if (ctx.rules && !ctx.rules.has(phrase.ruleId)) continue;
        const match = matchPhrase(ctx.scanText, phrase, word.index + at);
        if (!match) continue;
        const finding = toFinding(ctx, phrase, match[0], match.index);
        if (finding) {
          findings.push(finding);
          words.lastIndex = finding.range.end;
        }
        break lookup;
      }
    }
  }
  return findings;
}

function toFinding(
  ctx: DetectContext,
  phrase: Phrase,
  typed: string,
  start: number,
): RawFinding | null {
  const end = start + typed.length;
  if (
    (typed.match(/\p{L}+/gu) ?? []).some(
      (word) =>
        ctx.dictionary.has(word.toLowerCase()) ||
        applyWordCase(word, detectWordCase(word)) !== word,
    )
  )
    return null;
  if (
    OPENING_QUOTES.includes(ctx.text[start - 1] || "\n") &&
    /["”'’“‘»«›‹]/.test(ctx.text[end] ?? "")
  )
    return null;
  if (namedExampleBefore(ctx.text, start)) return null;
  // English "The Old Home Town", "Two Fold Clothing": capitalized words joined into one are a name;
  // a hyphen keeps a title's words ("An Eagle Eyed Reviewer" -> "Eagle-Eyed").
  if (
    phrase.ruleId === "englishClosedCompounds" &&
    ctx.lang.startsWith("en") &&
    /^\p{Lu}\p{Ll}*(?:\s+\p{Lu}\p{Ll}*)+$/u.test(typed) &&
    phrase.replacements.every((r) => !/[\s-]/.test(r))
  )
    return null;
  const casing = phrase.ruleId === "englishCanonicalCasing";
  // Capitals kept for emphasis are the writer's choice.
  if (casing && typed === typed.toUpperCase()) return null;
  const before = ctx.text.slice(Math.max(0, start - 8), start);
  const sentenceStart =
    /(?:[.!?]["”’)]*\s+|\n\s*)$/.test(before) || (start <= 8 && /^\s*$/.test(before));
  // Apostrophes follow the typed phrase, or the nearby text when it has none.
  const curly =
    typed.includes("’") ||
    (!typed.includes("'") && ctx.text.slice(Math.max(0, start - 200), end + 200).includes("’"));
  const abbreviation =
    (phrase.ruleId === "stylePhrasing" || phrase.ruleId === "styleWordChoice") && !/\s/.test(typed);
  if (
    abbreviation &&
    typed === typed.toUpperCase() &&
    typed !== typed.toLowerCase() &&
    !UNAMBIGUOUS_CAPS_ABBREVIATIONS.has(typed.toLowerCase())
  )
    return null;
  const alternatives = phrase.replacements.map((replacement) => {
    const cased = casing ? replacement : matchCase(typed, replacement, abbreviation, sentenceStart);
    return curly ? cased.replace(/'/g, "’") : cased;
  });
  if (alternatives.includes(typed)) return null;
  return {
    ruleId: phrase.ruleId,
    messageKey: phrase.messageKey,
    range: { start, end },
    alternatives,
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  };
}
