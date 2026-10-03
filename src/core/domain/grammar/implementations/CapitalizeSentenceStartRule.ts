import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { isGreekQuestionMark } from "../typographyProfiles";
import {
  isLowercaseLetter,
  isTechnicalToken,
  resolveInputAction,
} from "./helpers/GenericRuleShared";

// "؟" is the Arabic question mark: Latin text after it still starts a sentence.
const SENTENCE_ENDING_CHARS = new Set([".", "!", "?", "؟"]);
// Spanish opens a question or exclamation with an inverted mark: "¿Qué?".
export const SENTENCE_OPENING_MARKS = new Set(["¿", "¡"]);
// A period closing one of these is an abbreviation at least as often as a
// sentence end, so the following word is left exactly as the user typed it.
// Each language only gets its own list: "co." (pl "what"), "est." (fr "east"),
// "ave." (pt "bird") and "min." (sv "my") end sentences elsewhere. Words that
// often end a sentence in their own language stay out: en "no", fr "art",
// "vol", "ex", "bd" and "prof", de "art", "dir", "tab" and "mag", pl "gen",
// "por", "im", "min", "ok", "zł" and "gr", es "col", sv "kap", "kr" and "sek",
// hr "kn", el "εκ".
// ar_SA needs no entries: Arabic script is uncased, so the rule never fires on it.
// Month abbreviations are in their own lists: a capitalized one needs context (see below).
// es "mar" (sea) and "may", and pt "mar" (sea) and "dez" (ten), stay out.
const MONTHS_BY_LANGUAGE: Record<string, readonly string[]> = {
  en: ["jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"],
  de: ["jan", "feb", "mär", "apr", "jun", "jul", "aug", "sep", "sept", "okt", "nov", "dez"],
  es: ["ene", "abr", "ago", "sept", "oct", "nov", "dic"],
  pt: ["jan", "fev", "abr", "jun", "jul", "ago", "set", "out", "nov"],
  fr: ["janv", "févr", "avr", "juil", "sept", "oct", "nov", "déc"],
};
const SHARED_ABBREVIATIONS = ["etc", "vs", "cf", "al", "eg", "ie", "dr"];
const ABBREVIATIONS_BY_LANGUAGE: Record<string, readonly string[]> = {
  en: [
    ...["approx", "fig", "resp", "est", "min", "max", "mr", "mrs", "ms", "jr", "sr", "prof"],
    ...["inc", "ltd", "co", "corp", "dept", "univ", "ave", "blvd", "st", "mt", "ft", "sgt"],
    ...["capt", "lt", "col", "rev", "esp", "ref", "vol", "ch", "pp", "eq", "rd"],
    // Months, editors and translators, "circa", "Bros.", degrees and short units.
    ...MONTHS_BY_LANGUAGE.en,
    ...["ca", "ed", "eds", "tr", "trans", "bros", "phd", "govt", "intl", "misc", "nos", "viz"],
    ...["mm", "cm", "km", "kg", "lb", "lbs", "oz", "sec", "msec", "hr", "hrs", "mins", "yr"],
    ...["yrs", "wk", "wks"],
  ],
  de: [
    ...["usw", "bzw", "evtl", "ggf", "vgl", "inkl", "ca", "bspw", "nr", "hr", "fr", "sog"],
    ...["bzgl", "zzgl", "tel", "str", "geb", "jh", "mio", "mrd", "abb", "kap", "bd", "aufl"],
    ...["hrsg", "prof", "tsd", "std", "min", "sek", "chr", "st", "dipl", "ing", "fa", "hbf"],
    ...["pkt", "anm", "abs", "bsp", "ebd", "insb", "einschl", "usf", "etw", "jmd", "od"],
    ...["gegr", "co", "lt", "abk", "allg", "betr", "dgl", "ehem", "eigtl", "entspr", "gem"],
    ...["ggü", "jhd", "lfd", "mind", "näml", "rd", "urspr", "zzt", "jew", "gest", "verh"],
    // Months (not "Mai"), academic degrees ("Dr. med."), languages and denominations.
    ...MONTHS_BY_LANGUAGE.de,
    ...["med", "rer", "nat", "phil", "jur", "dent", "vet", "habil", "theol", "oec"],
    ...["engl", "franz", "frz", "lat", "griech", "ital", "röm", "kath", "evang"],
    ...["idr", "btw", "inc"],
  ],
  pl: [
    ...["np", "tzn", "itd", "itp", "tj", "mgr", "inż", "ul", "godz", "wg", "św", "tys"],
    ...["mln", "mld", "tzw", "zob", "wyd", "ks", "hab", "pkt", "poz", "str", "nr", "tel"],
    ...["prof", "pl", "os", "ds", "dyr", "mjr", "płk", "kpt", "ppor", "sierż", "cz", "rozdz"],
    ...["tłum", "oprac", "red", "dot", "dn", "ob", "ang", "niem", "łac", "przyp", "jw"],
    ...["wsp", "bp", "br", "proc", "ew", "ww", "ub", "dz", "nast", "wym", "mkw", "art"],
    ...["tab", "pt", "prez", "doc", "zw", "wł", "płn", "płd", "wsch", "zach", "zał", "ryc"],
  ],
  es: [
    ...["sr", "sra", "srta", "ej", "aprox", "pág", "núm", "ud", "uds", "dra", "avda"],
    ...["tel", "art", "cap", "vol", "máx", "mín", "dña", "lic", "ing", "prof", "págs"],
    ...["fig", "pp", "dpto", "gral", "arq", "sto", "admón", "apdo", "atte", "cía", "vda"],
    ...["dcha", "izq", "izda", "tfno", "hnos", "prov", "ed", "esq", "excmo", "ilmo", "ldo"],
    ...["lda", "sres", "sras", "vd", "vds", "nro", "pdo", "ppal", "pte", "sig", "trad", "cód"],
    ...MONTHS_BY_LANGUAGE.es,
  ],
  pt: [
    ...["sr", "sra", "srta", "pág", "núm", "av", "dra", "profa", "tel", "art", "cap"],
    ...["vol", "exmo", "ltda", "cia", "prof", "págs", "fig", "pp", "eng", "arq", "sto"],
    ...["sta", "apto", "aprox", "máx", "mín", "obs", "ilmo", "séc", "cel", "pg", "inc"],
    ...["ed", "trad", "hab", "proc", "ass", "dir", "gen", "ten", "ref", "op", "cit"],
    ...MONTHS_BY_LANGUAGE.pt,
  ],
  sv: [
    ...["dvs", "osv", "tys", "ca", "nr", "bl", "st", "kl", "jfr", "resp", "tel", "ang"],
    ...["avd", "prof", "uppl", "tim", "ev", "pga", "mha", "enl", "inkl", "exkl", "forts"],
    ...["sid", "ff", "dir", "hr", "tf"],
  ],
  hr: [
    ...["npr", "tzv", "itd", "sl", "br", "god", "tj", "mr", "dipl", "ing", "tel", "ul"],
    ...["sv", "gđa", "st", "str", "prof", "gđica", "odn", "tis", "mil", "mlrd", "pr", "kr"],
    ...["vj", "gl", "hrv", "engl", "lat", "sur", "pog", "izd", "prir", "gosp"],
  ],
  fr: [
    ...["env", "av", "apr", "mme", "mlle", "mm", "chap", "tél", "fig", "éd", "réf", "ste"],
    ...["st", "pp", "hab", "min", "sq", "sqq", "suiv", "ibid", "op", "cit", "boul", "dép"],
    ...["dir", "coll", "trad", "arr", "adj", "gén", "cie", "mgr", "pr", "resp", "max"],
    ...MONTHS_BY_LANGUAGE.fr,
    ...["vol", "ex", "éq", "suppl", "intr", "trim", "cm", "km", "kg"],
  ],
  el: [
    ...["κλπ", "δηλ", "βλ", "σελ", "αρ", "κα", "τηλ", "οδ", "χλμ", "δρ", "κκ", "βλπ"],
    ...["σημ", "υποσ", "λεπ", "εκατ", "δισ", "χιλ", "κεφ", "τομ", "εκδ", "καθ", "αγ"],
  ],
};
const ALL_ABBREVIATIONS = new Set([
  ...SHARED_ABBREVIATIONS,
  ...Object.values(ABBREVIATIONS_BY_LANGUAGE).flat(),
]);
const LANGUAGE_ABBREVIATIONS = new Map(
  Object.entries(ABBREVIATIONS_BY_LANGUAGE).map(([lang, words]) => [
    lang,
    new Set([...SHARED_ABBREVIATIONS, ...words]),
  ]),
);

// Each of these is also a name when it starts with a capital: "et al." but "Al.",
// "ed." but "Ed.", "max." but "Max.", "Dr. phil." but "Phil.", "Dr. rer. nat." but
// "Nat.", de "franz." (French) but "Franz.", sv "tim." (hour) but "Tim.". They are
// abbreviations only in lowercase.
const LOWERCASE_ONLY_ABBREVIATIONS = new Set(["al", "ed", "max", "phil", "nat", "tim", "franz"]);

// Capitalized, these are also names: "Jan.", "Mar.", "Aug.", "Jun.", "Min.". German
// writes "5 Min." with a capital, so a number next to it makes "Min." an abbreviation.
const NUMBER_CONTEXT_ABBREVIATIONS = new Set(["min"]);

// Strong date words: alone, they make the next capitalized abbreviation a month: "in Jan.",
// "seit Jan.", "end of Jan.", "mid-Jan.". Weak date words (en "to", "from", "by", "on", de
// "am", "ab") also come before names: "I talked to Jan.". They are not in this list, so
// they need the same evidence as any other word: a number next to the month or another
// month near it ("from Jan. to Mar.", "by Jan. 5").
const DATE_WORDS_BY_LANGUAGE: Record<string, readonly string[]> = {
  en: [...["in", "since", "until", "till", "early", "late", "mid"], ...["end of", "beginning of"]],
  de: ["im", "seit", "bis", "anfang", "ende", "mitte"],
  es: ["en", "desde", "hasta", "principios de", "finales de", "fines de", "mediados de"],
  pt: ["em", "desde", "até", "início de", "fim de", "final de", "meados de"],
  fr: ["en", "depuis", "dès", "début", "fin", "mi", "jusqu'en", "jusqu’en"],
};

function dateWordPattern(words: readonly string[]): RegExp {
  const alternatives = words.map((word) => word.replace(/ /g, "\\s+")).join("|");
  return new RegExp(`(?:^|[^\\p{L}])(?:${alternatives})[\\s\u00A0-]+$`, "iu");
}
const MONTHS_BY_KEY = new Map(
  Object.keys(ABBREVIATIONS_BY_LANGUAGE).map((key) => [
    key,
    new Set(MONTHS_BY_LANGUAGE[key] ?? []),
  ]),
);
const ALL_MONTHS = new Set(Object.values(MONTHS_BY_LANGUAGE).flat());
const DATE_WORD_PATTERNS = new Map(
  Object.entries(DATE_WORDS_BY_LANGUAGE).map(([key, words]) => [key, dateWordPattern(words)]),
);
const ALL_DATE_WORDS_PATTERN = dateWordPattern(Object.values(DATE_WORDS_BY_LANGUAGE).flat());
// A number before the token, with an optional "of" or "de": "5 Jan.", "5th of Jan.", "5. Jan.".
const NUMBER_BEFORE_PATTERN = /\p{N}\p{L}*\.?[\s\u00A0]+(?:(?:of|de)[\s\u00A0]+)?$/iu;
// A spelled ordinal after the month: "Jan. twelfth", "Mar. twenty-first".
const ORDINAL_AFTER_PATTERN = new RegExp(
  "^[\\s\u00A0]*(?:(?:twenty|thirty)[\\s-]?(?:first|second|third|fourth|fifth|sixth|seventh|" +
    "eighth|ninth)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|" +
    "twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|" +
    "twentieth|thirtieth)(?![\\p{L}])",
  "iu",
);
// How many words on each side of a month can hold another month: "Jan. and Feb.".
const NEARBY_MONTH_WORDS = 5;
// How many characters on each side of a token the context checks read.
const CONTEXT_CHARS = 80;

function languageKey(lang?: string): string {
  return (lang ?? "").slice(0, 2).toLowerCase();
}

/** The month abbreviations of `lang`; a language without its own list keeps every month. */
function monthsFor(lang?: string): ReadonlySet<string> {
  return MONTHS_BY_KEY.get(languageKey(lang)) ?? ALL_MONTHS;
}

/** True when the month at `start`..`index` has date context around it. */
function hasMonthContext(text: string, start: number, index: number, lang?: string): boolean {
  const before = text.slice(Math.max(0, start - CONTEXT_CHARS), start);
  const after = text.slice(index + 1, index + 1 + CONTEXT_CHARS);
  // A date word before it: "in Jan.", "seit Jan.", "end of Jan.".
  const dateWords = DATE_WORD_PATTERNS.get(languageKey(lang)) ?? ALL_DATE_WORDS_PATTERN;
  if (dateWords.test(before)) return true;
  // Another month in the same sentence: "Jan. and Feb.". "!", "?" and a line break end
  // the sentence for certain; a period may close an abbreviation, so it does not.
  const months = monthsFor(lang);
  const isMonth = (word: string) =>
    /^\p{L}+\.$/u.test(word) && months.has(word.slice(0, -1).toLowerCase());
  const words = (part: string) => part.split(/[\s\u00A0]+/u).filter(Boolean);
  return (
    words(before.split(/[!?\n]/u).pop() ?? "")
      .slice(-NEARBY_MONTH_WORDS)
      .some(isMonth) ||
    words(after.split(/[!?\n]/u)[0])
      .slice(0, NEARBY_MONTH_WORDS)
      .some(isMonth)
  );
}

/** True when a number is next to the token: "5 Jan.", "5th of Jan.", "Jan. 5", "Jan. twelfth". */
function hasNumberNextTo(text: string, start: number, index: number): boolean {
  const after = text.slice(index + 1, index + 1 + CONTEXT_CHARS);
  return (
    NUMBER_BEFORE_PATTERN.test(text.slice(Math.max(0, start - CONTEXT_CHARS), start)) ||
    /^[\s\u00A0]*\p{N}/u.test(after) ||
    ORDINAL_AFTER_PATTERN.test(after)
  );
}

/**
 * True when the token that ends at the period at `index` is in the list of `lang` and
 * written in a case that the entry allows. A capitalized month or name-like unit needs
 * context: "in Jan. the" (month) but "with Jan. she" (name).
 */
function isListedAbbreviation(text: string, start: number, index: number, lang?: string): boolean {
  const token = text.slice(start, index);
  const lower = token.toLowerCase();
  if (!abbreviationsFor(lang).has(lower)) return false;
  if (token === lower) return true;
  if (LOWERCASE_ONLY_ABBREVIATIONS.has(lower)) return false;
  const isMonth = monthsFor(lang).has(lower);
  if (!isMonth && !NUMBER_CONTEXT_ABBREVIATIONS.has(lower)) return true;
  return (
    hasNumberNextTo(text, start, index) || (isMonth && hasMonthContext(text, start, index, lang))
  );
}

/** A language without its own list (auto-detect not resolved yet) keeps every entry. */
function abbreviationsFor(lang?: string): ReadonlySet<string> {
  return LANGUAGE_ABBREVIATIONS.get(languageKey(lang)) ?? ALL_ABBREVIATIONS;
}

// Locales that write ordinals as "1." inside a sentence ("der 1. und 2. Platz").
const ORDINAL_PERIOD_LOCALES = new Set(["de_DE", "hr_HR", "pl_PL", "sv_SE"]);

/** True when the period at `index` closes an initial or a known abbreviation. */
export function closesAbbreviation(text: string, index: number, lang?: string): boolean {
  let start = index;
  while (start > 0 && /[\p{L}\p{N}.]/u.test(text[start - 1])) {
    start -= 1;
  }
  const token = text.slice(start, index);
  // An ellipsis trails off inside the sentence, as "…" does: "wait ... what".
  if (token.endsWith(".")) {
    return true;
  }
  if (!/\p{L}/u.test(token)) {
    // "2026." and "12." end sentences in English; elsewhere they are ordinals.
    return token.length > 0 && ORDINAL_PERIOD_LOCALES.has(lang ?? "");
  }
  // So are Roman numerals there: "Ludwig XIV. regierte".
  if (/^[IVXLC]{2,}$/.test(token) && ORDINAL_PERIOD_LOCALES.has(lang ?? "")) return true;
  // Portuguese and Spanish ordinals: "o 3o. lugar", "la 2a. edición".
  if (/^\p{N}+[oaºª]$/u.test(token) && /^(pt|es)/.test(lang ?? "")) return true;
  // Polish "ok." (about) before a numeral and "im." (named after) before a title: "ok. dwustu",
  // "im. dr. Jana". Elsewhere they end sentences ("Jest ok.", "Dałem im.").
  if (lang?.startsWith("pl") && /^(?:ok|im)$/.test(token)) {
    const next = text.slice(index + 1, index + 40);
    if (
      token === "ok"
        ? /^\s+(?:dw|trz|czter|pięć|pięci|sześ|siedem|siedmi|osiem|ośmi|dziewię|dziesię|jedenast|kilk|pół|stu|tysi)/u.test(
            next,
          )
        : /^\s+(?:dr|prof|ks|św|gen|płk|mjr|kpt|bp|kard|abp|marsz|hm|inż|mgr)\./u.test(next)
    )
      return true;
  }
  return token.length <= 1 || token.includes(".") || isListedAbbreviation(text, start, index, lang);
}
// Includes every closing quote the typography profiles emit: „…“ ‚…‘ «…» ›…‹.
export const CLOSING_CHARS = new Set([")", "]", "}", '"', "'", "”", "’", "“", "‘", "»", "›"]);
// French padding inside a closing guillemet and before "!" or "?": "« Oui ! »".
export const CLOSING_PADDING_CHARS = new Set(["\u00A0", "\u202F"]);
export const WORD_BOUNDARY_CHARS = [...SPACE_CHARS, "\n"];
// Punctuation that closes a prose word without making it a token: "done.",
// "hello,", "(quietly)".
export const TRAILING_PUNCTUATION_REGEX = /[.,!?;:)\]}"'”’“‘»›\u00A0\u202F]+$/u;

/** "iPhone", "eBay", "x2": a later capital or a digit means deliberate casing ("mid-May" does not). */
export function keepsOwnCasing(word: string): boolean {
  const head = word.split("-")[0];
  return /\p{Lu}/u.test(head.slice(1)) || /\p{N}/u.test(head);
}

/**
 * Capitalizes the word a boundary just completed when `opens` says it starts a
 * sentence or a line. The first letter waits for the whole word: "u" may
 * become "user.save()" and "i" may become "iPhone", and no keystroke before
 * the boundary says otherwise.
 */
export function capitalizeCompletedWord(
  context: GrammarContext,
  opens: (text: string, wordStart: number) => boolean,
): GrammarEdit | null {
  const text = context.beforeCursor;
  const boundary = text.length - 1;
  if (
    boundary < 1 ||
    !WORD_BOUNDARY_CHARS.includes(text[boundary]) ||
    WORD_BOUNDARY_CHARS.includes(text[boundary - 1]) ||
    resolveInputAction(context) === "delete"
  ) {
    return null;
  }

  let wordStart = boundary;
  while (wordStart > 0 && !WORD_BOUNDARY_CHARS.includes(text[wordStart - 1])) {
    wordStart -= 1;
  }
  const word = text.slice(wordStart, boundary);
  const letter = SENTENCE_OPENING_MARKS.has(word[0]) ? 1 : 0;
  const bare = word.replace(TRAILING_PUNCTUATION_REGEX, "");
  if (
    !isLowercaseLetter(word[letter] ?? "") ||
    isTechnicalToken(bare) ||
    keepsOwnCasing(bare) ||
    !opens(text, wordStart)
  ) {
    return null;
  }

  return {
    replacement: `${word.slice(0, letter)}${word[letter].toUpperCase()}${text.slice(wordStart + letter + 1)}`,
    deleteBackwards: text.length - wordStart,
    deleteForwards: 0,
  };
}

export class CapitalizeSentenceStartRule implements GrammarRule {
  readonly id = "capitalizeSentenceStart" as const;
  // A newline arrives as insertChar, hence both triggers.
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    return capitalizeCompletedWord(context, (text, wordStart) =>
      startsSentence(text, wordStart, context.hints?.lang),
    );
  }
}

/**
 * True when the word at `wordStart` opens a sentence: text start, or a sentence
 * end (not an abbreviation) followed by spaces. A newline is not a sentence
 * start here; capitalizeAfterLineBreak owns line starts.
 */
export function startsSentence(text: string, wordStart: number, lang?: string): boolean {
  let i = wordStart - 1;
  // A newline is left to the line-break rule.
  while (i >= 0 && SPACE_CHARS.includes(text[i])) {
    i -= 1;
  }
  if (i < 0) {
    return true;
  }
  if (CLOSING_CHARS.has(text[i])) {
    while (i >= 0 && (CLOSING_CHARS.has(text[i]) || CLOSING_PADDING_CHARS.has(text[i]))) {
      i -= 1;
    }
  }
  return (
    i >= 0 &&
    (SENTENCE_ENDING_CHARS.has(text[i]) || isGreekQuestionMark(text[i], lang)) &&
    !(text[i] === "." && closesAbbreviation(text, i, lang))
  );
}
