import { englishInitialSound } from "../implementations/helpers/EnglishInitialSound";
import { isTechnicalToken } from "../implementations/helpers/GenericRuleShared";
import { lookupMeasurementUnit } from "../measurement/registry";
import type { Token } from "./types";

/**
 * Named token predicates for pattern elements (`predicate: name`): the checks a token
 * pattern cannot state, such as a sound, a unit table or a word list. A predicate is pure
 * and fast: it reads the token, its neighbours and the language, and nothing else. It is
 * loaded by content scripts too (live pattern rules), so it must not import Review data.
 */
export type TokenPredicate = (tokens: readonly Token[], index: number, lang: string) => boolean;

// Abbreviations whose period does not end a sentence, by language; lowercase keys. The
// period is a token of its own, so a key is the word before it.
const ABBREVIATIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set(["etc", "vs", "mr", "mrs", "ms", "dr", "prof", "approx", "no", "st"]),
  de: new Set(["z", "b", "usw", "bzw", "ca", "dr", "nr", "vgl", "evtl", "ggf", "u", "a"]),
  fr: new Set(["m", "mme", "mlle", "dr", "etc", "cf", "env", "p", "ex"]),
  es: new Set(["sr", "sra", "srta", "dr", "dra", "etc", "p", "ej", "aprox", "núm"]),
  pt: new Set(["sr", "sra", "dr", "dra", "etc", "p", "ex", "aprox", "nº"]),
  pl: new Set(["np", "itd", "itp", "dr", "prof", "ok", "tzw", "tj", "ul", "nr"]),
};

/** Token `i` touches the token before it, and that token ends with a character of `chars`. */
const gluedBefore = (tokens: readonly Token[], i: number, chars: RegExp) =>
  i > 0 && tokens[i].space === "" && chars.test(tokens[i - 1].text.slice(-1));
/** Token `i` touches the token after it, and that token starts with a character of `chars`. */
const gluedAfter = (tokens: readonly Token[], i: number, chars: RegExp) =>
  tokens[i + 1]?.space === "" && chars.test(tokens[i + 1].text[0]);

export const TOKEN_PREDICATES: Readonly<Record<string, TokenPredicate>> = {
  /** An English word heard with a vowel sound first: "hour", "FBI" ("an"). */
  enStartsWithVowelSound: (tokens, i) => englishInitialSound(tokens[i].text) === "vowel",
  /** An English word heard with a consonant sound first: "user", "GIF" ("a"). */
  enStartsWithConsonantSound: (tokens, i) => englishInitialSound(tokens[i].text) === "consonant",
  /** A unit symbol of the measurement registry ("kg", "km/h" pieces, "MiB"). */
  isMeasurementUnit: (tokens, i) => lookupMeasurementUnit(tokens[i].text) !== undefined,
  /** Not an abbreviation of the language whose period continues the sentence. */
  isNotAbbreviation: (tokens, i, lang) => !ABBREVIATIONS[lang.slice(0, 2)]?.has(tokens[i].key),
  /** A mention, hashtag, URL, e-mail or code-like name. */
  isTechnical: (tokens, i) =>
    tokens[i].type === "protected" ||
    isTechnicalToken(tokens[i].text) ||
    /^[@#]$/.test(tokens[i - 1]?.text ?? ""),
  /**
   * The first of three periods typed for an ellipsis: no period or digit right before the run,
   * no period, digit or slash right after it ("....", "1...2", ".../"), and not a spread
   * ("(...args)").
   */
  isProseEllipsis: (tokens, i) =>
    !gluedBefore(tokens, i, /[.\p{N}]/u) &&
    !gluedAfter(tokens, i + 2, /[.\p{N}/\\]/u) &&
    !(gluedBefore(tokens, i, /[[({]/) && gluedAfter(tokens, i + 2, /[\p{L}_$]/u)),
  /** Glued to a symbol or a dotted name on either side: "src/dont", "teh.com". */
  isGlued: (tokens, i) =>
    (i > 0 && tokens[i].space === "" && /^[@#/\\_=$.]$/.test(tokens[i - 1].text)) ||
    (tokens[i + 1]?.space === "" && /^[@/\\_=$]$/.test(tokens[i + 1].text)),
};

export const isTokenPredicate = (name: string) => Object.hasOwn(TOKEN_PREDICATES, name);
