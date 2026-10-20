import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { addRows, scanRows, type PhraseEntry, type PhraseIndex } from "../engine/phraseRows";
import { namedExampleBefore, quotedSpan } from "./exampleCues";
import {
  CLOSED_COMPOUNDS,
  NAME_CASING,
  PHRASE_CORRECTIONS,
  STYLE_PHRASES,
  UNAMBIGUOUS_CAPS_ABBREVIATIONS,
  type PhraseRow,
} from "./englishPhraseTables";
import { EXTENSION_COMPOUNDS, EXTENSION_PHRASES, EXTENSION_STYLE } from "./english/tables";
import { OPTIONAL_TABLES } from "./english/dialects";
import { NAMES } from "./english/properNames";
import { OPTIONAL as PLAIN_OPTIONAL } from "./english/plainStyle";
import { rowGuarded } from "./english/fixedFrames";
import { nounGender } from "./french/frenchLexicon";
import { capitalizedName } from "./french/frenchTokens";
import { LANGUAGE_PHRASE_TABLES } from "./languagePhraseTables";
import { analyze as analyzeNoun } from "./portuguese/nounAgreement";
import { PORTUGUESE_DE_PHRASE_TAIL } from "./portuguese/phrases";
import { isLang } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";
import { finding } from "./finding";

// The phrase index of each language, built from the rule files on first use.
const INDEXES = new Map<string, PhraseIndex>();
/**
 * Built on first use for each language, not at load: a French text does not pay for the
 * English rows of grammar/rules/en.yaml.
 */
function buildIndex(lang: string) {
  // Read first: the tables of a language with Review data throw until the data is loaded,
  // and a failed build must not leave an empty index behind.
  const tables = LANGUAGE_PHRASE_TABLES[lang];
  const INDEX: PhraseIndex = new Map();
  INDEXES.set(lang, INDEX);
  if (tables) {
    addRows(INDEX, lang, tables.words, "englishPhraseCorrections", "review_msg_typo");
    addRows(
      INDEX,
      lang,
      tables.phrases,
      "englishPhraseCorrections",
      "review_msg_contextual_grammar",
    );
    addRows(INDEX, lang, tables.compounds, "englishClosedCompounds", "review_msg_closed_compound");
    addRows(INDEX, lang, tables.style, "stylePhrasing", "review_msg_style_phrasing");
  }
  if (lang !== "en") return;
  addRows(
    INDEX,
    "en",
    [...PHRASE_CORRECTIONS, ...EXTENSION_PHRASES],
    "englishPhraseCorrections",
    "review_msg_phrase_correction",
  );
  addRows(
    INDEX,
    "en",
    [...CLOSED_COMPOUNDS, ...EXTENSION_COMPOUNDS],
    "englishClosedCompounds",
    "review_msg_closed_compound",
  );
  // Before style: a dialect row outranks a style row on the same word when both are on.
  for (const { rows, ruleId, messageKey } of [...OPTIONAL_TABLES, ...PLAIN_OPTIONAL])
    addRows(INDEX, "en", rows, ruleId, messageKey);
  addRows(
    INDEX,
    "en",
    [...STYLE_PHRASES, ...EXTENSION_STYLE],
    "stylePhrasing",
    "review_msg_style_phrasing",
  );
  addRows(
    INDEX,
    "en",
    [...NAME_CASING.map((name): PhraseRow => [name.toLowerCase(), name]), ...NAMES],
    "englishCanonicalCasing",
    "review_msg_name_casing",
  );
}

// Articles that show a gender, and the gender of a noun, where table rows swap one noun for
// another ("team" -> "équipe", "meeting" -> "reunião").
const GENDERED: Record<string, { m: RegExp; f: RegExp; gender: (noun: string) => string | null }> =
  {
    fr: {
      m: /(?<!\p{L})(?:le|un|ce|cet|du|au|aucun)[ \t\u00a0]+$/iu,
      f: /(?<!\p{L})(?:la|une|cette|aucune)[ \t\u00a0]+$/iu,
      gender: nounGender,
    },
    pt: {
      m: /(?<!\p{L})(?:o|os|um|uns|este|estes|esse|esses|aquele|aqueles|do|dos|no|nos|ao|aos|pelo|pelos|num|dum)[ \t\u00a0]+$/iu,
      f: /(?<!\p{L})(?:a|as|uma|umas|esta|estas|essa|essas|aquela|aquelas|da|das|na|nas|à|às|pela|pelas|numa|duma)[ \t\u00a0]+$/iu,
      gender: (noun) => {
        const reading = analyzeNoun(noun);
        if (!reading?.certain || reading.feminine === null) return null;
        return reading.feminine ? "f" : "m";
      },
    },
  };
const FRENCH_VOWEL = /^[aeiouyàâäéèêëîïôöùûüœæ]/iu;
// French words whose form depends on whether the next word starts with a vowel: "le"/"l'".
const FRENCH_ELIDING =
  /(?<!\p{L})(?:(?:[cdjlmnst]|qu)['’]|(?:le|la|de|je|me|te|se|ne|que|ce|cet|ma|ta|sa|du|au)[ \t\u00a0]+)$/iu;
/**
 * A replacement noun that would leave the article before it wrong: "le team" -> "le équipe",
 * "l'email" -> "l'courriel". There is no article inflection: such a replacement is not offered.
 * A row that types the article itself is not checked.
 */
function articleClash(ctx: DetectContext, typed: string, start: number, replacement: string) {
  const lang = ctx.lang.slice(0, 2);
  const articles = GENDERED[lang];
  if (!articles || /\s/.test(replacement)) return false;
  const before = ctx.text.slice(Math.max(0, start - 12), start);
  const gender = articles.gender(replacement.toLowerCase());
  if (gender && articles[gender === "m" ? "f" : "m"].test(before)) return true;
  return (
    lang === "fr" &&
    FRENCH_VOWEL.test(typed) !== FRENCH_VOWEL.test(replacement) &&
    FRENCH_ELIDING.test(before)
  );
}

const caseless = (text: string) => text.toLowerCase().replace(/’/g, "'");
/**
 * A row that only changes letter case ("Wlan" -> "WLAN", "x-rated" -> "X-rated") applies its
 * own casing; the typed casing carried onto it gives the typed text back. The typed text stays
 * when it is all capitals (emphasis) or when it differs only by capitals at word starts (a
 * title, a sentence start: "X-Rated").
 */
function rowCasing(typed: string, replacement: string): string {
  const letters = typed.replace(/\P{L}/gu, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) return typed;
  if (typed.length !== replacement.length) return replacement;
  const wordStartCapital = (i: number) =>
    /\p{Lu}/u.test(typed[i]) &&
    replacement[i] === typed[i].toLowerCase() &&
    (i === 0 || /\P{L}/u.test(typed[i - 1]));
  for (let i = 0; i < typed.length; i++) {
    if (replacement[i] !== typed[i] && !wordStartCapital(i)) return replacement;
  }
  return typed;
}

/** The typed casing carried onto a replacement written in its ordinary form. */
function matchCase(
  typed: string,
  replacement: string,
  abbreviation: boolean,
  sentenceStart: boolean,
): string {
  if (caseless(typed) === caseless(replacement)) return rowCasing(typed, replacement);
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
  const lang = ctx.lang.slice(0, 2);
  if (!INDEXES.has(lang)) buildIndex(lang);
  const INDEX = INDEXES.get(lang)!;
  if (!INDEX.size) return [];
  const findings: RawFinding[] = [];
  scanRows(
    ctx.scanText,
    ctx.from,
    ctx.to,
    lang,
    INDEX,
    (phrase) => !ctx.rules || ctx.rules.has(phrase.ruleId),
    (phrase, typed, start) => {
      const found = toFinding(ctx, phrase, typed, start);
      if (!found) return null;
      findings.push(found);
      return found.range.end;
    },
  );
  return findings;
}

function toFinding(
  ctx: DetectContext,
  phrase: PhraseEntry,
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
  // French guillemets keep a space inside: « mot ».
  const spaced = (at: number, quote: string) =>
    /[ \u00a0\u202f]/.test(ctx.text[at] ?? "")
      ? ctx.text[at + (quote === "«" ? -1 : 1)] === quote
      : false;
  if (
    quotedSpan(ctx.text, start, end) ||
    (spaced(start - 1, "«") && spaced(end, "»")) ||
    namedExampleBefore(ctx.text, start)
  )
    return null;
  // French "Mary Quant, Quant on": a capitalized word inside a sentence is a name.
  if (isLang(ctx, "fr") && capitalizedName(ctx.text, start, typed)) return null;
  // "de Fernando Asín": a one-word lowercase row typed capitalized right after a capitalized word
  // inside the sentence is part of a name. English titles capitalize every word ("An Eagle Eyed
  // Reviewer"), so English rows stay.
  if (
    !isLang(ctx, "en") &&
    phrase.ruleId !== "englishCanonicalCasing" &&
    /^\p{Lu}\p{Ll}+$/u.test(typed) &&
    !/\p{Lu}/u.test(phrase.source) &&
    phrase.replacements.every((r) => !/^\P{L}*\p{Lu}/u.test(r)) &&
    /[^\s.!?…:;"“”«»(][ \t\u00a0]+\p{Lu}\p{Ll}+[ \t\u00a0]+$/u.test(
      ctx.text.slice(Math.max(0, start - 48), start),
    )
  )
    return null;
  // English "The Old Home Town", "Two Fold Clothing": capitalized words joined into one are a name;
  // a hyphen keeps a title's words ("An Eagle Eyed Reviewer" -> "Eagle-Eyed").
  if (
    phrase.ruleId === "englishClosedCompounds" &&
    isLang(ctx, "en") &&
    /^\p{Lu}\p{Ll}*(?:\s+\p{Lu}\p{Ll}*)+$/u.test(typed) &&
    phrase.replacements.every((r) => !/[\s-]/.test(r))
  )
    return null;
  if (isLang(ctx, "en") && rowGuarded(ctx.text, typed, start, end)) return null;
  const replacements = phrase.replacements.filter((r) => !articleClash(ctx, typed, start, r));
  if (!replacements.length) return null;
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
  // A Polish or Portuguese style row on a capital inside the sentence meets a name ("w Wysokiej
  // Cenie", "projeto de Braços Abertos", "MacBook Pro").
  if (
    phrase.ruleId === "stylePhrasing" &&
    (isLang(ctx, "pl") || isLang(ctx, "pt")) &&
    typed !== typed.toUpperCase() &&
    (typed.match(/\p{L}+/gu) ?? []).some(
      (word, i) => /^\p{Lu}/u.test(word) && (i > 0 || !sentenceStart),
    )
  )
    return null;
  // Portuguese "recuou para trás da ponte": a "de" after the tail makes it a place phrase.
  if (
    phrase.ruleId === "stylePhrasing" &&
    isLang(ctx, "pt") &&
    PORTUGUESE_DE_PHRASE_TAIL.test(typed) &&
    /^[ \t\u00a0]+d(?:e|o|a|os|as|um|uma)(?!\p{L})/iu.test(ctx.text.slice(end, end + 12))
  )
    return null;
  const abbreviation =
    (phrase.ruleId === "stylePhrasing" || phrase.ruleId === "styleWordChoice") && !/\s/.test(typed);
  if (
    abbreviation &&
    typed === typed.toUpperCase() &&
    typed !== typed.toLowerCase() &&
    !UNAMBIGUOUS_CAPS_ABBREVIATIONS.has(typed.toLowerCase())
  )
    return null;
  const alternatives = replacements.map((replacement) => {
    const cased = casing ? replacement : matchCase(typed, replacement, abbreviation, sentenceStart);
    return curly ? cased.replace(/'/g, "’") : cased;
  });
  if (alternatives.includes(typed)) return null;
  // buildIndex gives each row a catalog rule and a message key.
  const ruleId = phrase.ruleId as RawFinding["ruleId"];
  return finding(ruleId, phrase.messageKey as RawFinding["messageKey"], start, end, alternatives, {
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  });
}
