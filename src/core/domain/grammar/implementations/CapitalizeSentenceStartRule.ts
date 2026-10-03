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
// Two classes of abbreviation. An entry with no stop always needs a word after it ("Mr.",
// "Dr.", "Prof.", "St.", "Sra."): it never ends a sentence. An entry that ends in a stop
// ("etc.", "inc.") can also end a sentence: it ends the sentence when the next word starts
// with a capital letter, and keeps it open when the next word is lowercase. The stop is a
// mark only: the lists below compare the entry without it.
const SHARED_ABBREVIATIONS = ["etc.", "vs", "cf", "al.", "eg.", "ie.", "dr"];
const ABBREVIATIONS_BY_LANGUAGE: Record<string, readonly string[]> = {
  en: [
    ...["approx", "fig", "resp.", "est", "min.", "max.", "mr", "mrs", "ms", "jr.", "sr."],
    ...["prof", "inc.", "ltd.", "co.", "corp.", "dept", "univ", "ave.", "blvd.", "st", "mt"],
    ...["ft.", "sgt", "capt", "lt", "col", "rev", "esp", "ref", "vol", "ch", "pp", "eq", "rd."],
    // Months, editors and translators, "circa", "Bros.", degrees and short units.
    ...MONTHS_BY_LANGUAGE.en,
    ...["ca", "ed.", "eds.", "tr.", "trans.", "bros.", "phd.", "govt.", "intl", "misc.", "nos"],
    ...["viz", "mm.", "cm.", "km.", "kg.", "lb.", "lbs.", "oz.", "sec.", "msec.", "hr.", "hrs."],
    ...["mins.", "yr.", "yrs.", "wk.", "wks."],
  ],
  de: [
    // German writes each noun with a capital letter ("bzw. Kinder"). Thus only an entry that
    // closes a list or a phrase ("usw.", "v. Chr.", "19. Jh.") can end a sentence.
    ...["usw.", "bzw", "evtl", "ggf", "vgl", "inkl", "ca", "bspw", "nr", "hr", "fr", "sog"],
    ...["bzgl", "zzgl", "tel", "str", "geb", "jh.", "mio", "mrd", "abb", "kap", "bd", "aufl"],
    ...["hrsg", "prof", "tsd", "std", "min", "sek", "chr.", "st", "dipl", "ing", "fa", "hbf"],
    ...["pkt", "anm", "abs", "bsp", "ebd", "insb", "einschl", "usf.", "etw", "jmd", "od"],
    ...["gegr", "co.", "lt", "abk", "allg", "betr", "dgl", "ehem", "eigtl", "entspr", "gem"],
    ...["ggü", "jhd.", "lfd", "mind", "näml", "rd", "urspr", "zzt", "jew", "gest", "verh"],
    // Months (not "Mai"), academic degrees ("Dr. med."), languages and denominations.
    ...MONTHS_BY_LANGUAGE.de,
    ...["med", "rer", "nat", "phil", "jur", "dent", "vet", "habil", "theol", "oec"],
    ...["engl", "franz", "frz", "lat", "griech", "ital", "röm", "kath", "evang"],
    ...["idr", "btw", "inc."],
  ],
  pl: [
    ...["np", "tzn", "itd.", "itp.", "tj", "mgr", "inż", "ul", "godz", "wg", "św", "tys."],
    ...["mln.", "mld.", "tzw", "zob", "wyd", "ks", "hab", "pkt", "poz", "str", "nr", "tel"],
    ...["prof", "pl", "os", "ds", "dyr", "mjr", "płk", "kpt", "ppor", "sierż", "cz", "rozdz"],
    ...["tłum", "oprac", "red", "dot", "dn", "ob", "ang", "niem", "łac", "przyp", "jw."],
    ...["wsp.", "bp", "br.", "proc.", "ew", "ww", "ub", "dz", "nast", "wym", "mkw", "art"],
    ...["tab", "pt", "prez", "doc", "zw", "wł", "płn", "płd", "wsch", "zach", "zał", "ryc"],
  ],
  es: [
    ...["sr", "sra", "srta", "ej", "aprox", "pág", "núm", "ud", "uds", "dra", "avda"],
    ...["tel", "art", "cap", "vol", "máx", "mín", "dña", "lic", "ing", "prof", "págs"],
    ...["fig", "pp", "dpto", "gral", "arq", "sto", "admón", "apdo", "atte", "cía.", "vda"],
    ...["dcha", "izq", "izda", "tfno", "hnos.", "prov", "ed", "esq", "excmo", "ilmo", "ldo"],
    ...["lda", "sres", "sras", "vd", "vds", "nro", "pdo", "ppal", "pte", "sig", "trad", "cód"],
    ...MONTHS_BY_LANGUAGE.es,
  ],
  pt: [
    ...["sr", "sra", "srta", "pág", "núm", "av", "dra", "profa", "tel", "art", "cap"],
    ...["vol", "exmo", "ltda.", "cia.", "prof", "págs", "fig", "pp", "eng", "arq", "sto"],
    ...["sta", "apto", "aprox", "máx", "mín", "obs", "ilmo", "séc", "cel", "pg", "inc."],
    ...["ed", "trad", "hab", "proc", "ass", "dir", "gen", "ten", "ref", "op", "cit"],
    ...MONTHS_BY_LANGUAGE.pt,
  ],
  sv: [
    ...["dvs", "osv.", "tys", "ca", "nr", "bl", "st", "kl", "jfr", "resp", "tel", "ang"],
    ...["avd", "prof", "uppl", "tim", "ev", "pga", "mha", "enl", "inkl", "exkl", "forts"],
    ...["sid", "ff", "dir", "hr", "tf"],
  ],
  hr: [
    ...["npr", "tzv", "itd.", "sl", "br", "god", "tj", "mr", "dipl", "ing", "tel", "ul"],
    ...["sv", "gđa", "st", "str", "prof", "gđica", "odn", "tis", "mil", "mlrd", "pr", "kr"],
    ...["vj", "gl", "hrv", "engl", "lat", "sur", "pog", "izd", "prir", "gosp"],
  ],
  fr: [
    ...["env", "av", "apr", "mme", "mlle", "mm", "chap", "tél", "fig", "éd", "réf", "ste"],
    ...["st", "pp", "hab", "min", "sq.", "sqq.", "suiv.", "ibid.", "op", "cit.", "boul"],
    ...["dép", "dir", "coll", "trad", "arr", "adj", "gén", "cie.", "mgr", "pr", "resp", "max"],
    ...MONTHS_BY_LANGUAGE.fr,
    ...["vol", "ex", "éq", "suppl", "intr", "trim", "cm.", "km.", "kg."],
  ],
  el: [
    ...["κλπ.", "δηλ", "βλ", "σελ", "αρ", "κα", "τηλ", "οδ", "χλμ", "δρ", "κκ", "βλπ"],
    ...["σημ", "υποσ", "λεπ", "εκατ", "δισ", "χιλ", "κεφ", "τομ", "εκδ", "καθ", "αγ"],
  ],
};
/** The entry without its class mark: "etc." -> "etc". */
const bareEntry = (entry: string) => entry.replace(/\.$/, "");
const canEndEntry = (entry: string) => entry.endsWith(".");
const ALL_ENTRIES = [...SHARED_ABBREVIATIONS, ...Object.values(ABBREVIATIONS_BY_LANGUAGE).flat()];
const ALL_ABBREVIATIONS = new Set(ALL_ENTRIES.map(bareEntry));
const LANGUAGE_ABBREVIATIONS = new Map(
  Object.entries(ABBREVIATIONS_BY_LANGUAGE).map(([lang, words]) => [
    lang,
    new Set([...SHARED_ABBREVIATIONS, ...words].map(bareEntry)),
  ]),
);
// The abbreviations that can end a sentence. With no language list, an entry that a language
// marks as a continuation ("sr" is "Señor" in Spanish) keeps the sentence open.
const LANGUAGE_SENTENCE_ENDERS = new Map(
  Object.entries(ABBREVIATIONS_BY_LANGUAGE).map(([lang, words]) => [
    lang,
    new Set([...SHARED_ABBREVIATIONS, ...words].filter(canEndEntry).map(bareEntry)),
  ]),
);
const CONTINUATIONS = new Set(ALL_ENTRIES.filter((entry) => !canEndEntry(entry)));
const ALL_SENTENCE_ENDERS = new Set(
  ALL_ENTRIES.filter(canEndEntry)
    .map(bareEntry)
    .filter((entry) => !CONTINUATIONS.has(entry)),
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
// "seit Jan.", "end of Jan.", "mid-Jan.".
const DATE_WORDS_BY_LANGUAGE: Record<string, readonly string[]> = {
  en: [...["in", "since", "until", "till", "early", "late", "mid"], ...["end of", "beginning of"]],
  de: ["im", "seit", "bis", "anfang", "ende", "mitte"],
  es: ["en", "desde", "hasta", "principios de", "finales de", "fines de", "mediados de"],
  pt: ["em", "desde", "até", "início de", "fim de", "final de", "meados de"],
  fr: ["en", "depuis", "dès", "début", "fin", "mi", "jusqu'en", "jusqu’en"],
};

// Weak date words ("to", "from", "by", "on") also come before names: "I talked to Jan.".
// Review reads the whole text, so there a month after them needs a number next to it or
// another month joined to it: "from Jan. to Mar.", "by Jan. 5".

/** How a caller reads abbreviations. */
export interface AbbreviationOptions {
  /**
   * Typing: every capitalized month abbreviation is an abbreviation. Typing applies its edit
   * at once and cannot see the text after it, so a missed capital is better than a wrong one.
   */
  typing?: boolean;
}

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
// Words that join two months: "Jan. and Feb.", "from Jan. to Mar.", "ene. y feb.". A comma,
// a dash and a slash also join them: "Jan., Feb.", "Jan.–Mar.", "Jan./Feb.".
const MONTH_JOINERS_BY_LANGUAGE: Record<string, readonly string[]> = {
  en: ["and", "or", "to", "through", "till", "until"],
  de: ["und", "oder", "bis"],
  es: ["y", "e", "o", "u", "a", "hasta"],
  pt: ["e", "ou", "a", "até"],
  fr: ["et", "ou", "à", "au", "jusqu'à", "jusqu’à"],
};

/** The text between two joined months: ", ", " and ", ", and ", "–", " / ". */
function monthJoinSource(words: readonly string[]): string {
  const word = `(?:${words.join("|")})[\\s\u00A0]+`;
  return `[\\s\u00A0]*(?:,[\\s\u00A0]*(?:${word})?|[–\\-/][\\s\u00A0]*|${word})`;
}

interface MonthJoinPatterns {
  /** Another month, then a joiner, at the end of the text before this month. */
  before: RegExp;
  /** A joiner, then another month, at the start of the text after this month. */
  after: RegExp;
}

function monthJoinPatterns(words: readonly string[]): MonthJoinPatterns {
  const join = monthJoinSource(words);
  return {
    before: new RegExp(`(?:^|[^\\p{L}])(\\p{L}+)\\.${join}$`, "iu"),
    after: new RegExp(`^${join}(\\p{L}+)\\.`, "iu"),
  };
}
const MONTH_JOIN_PATTERNS = new Map(
  Object.entries(MONTH_JOINERS_BY_LANGUAGE).map(([key, words]) => [key, monthJoinPatterns(words)]),
);
const ALL_MONTH_JOIN_PATTERNS = monthJoinPatterns([
  ...new Set(Object.values(MONTH_JOINERS_BY_LANGUAGE).flat()),
]);
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
function hasMonthContext(
  text: string,
  start: number,
  index: number,
  lang: string | undefined,
): boolean {
  const before = text.slice(Math.max(0, start - CONTEXT_CHARS), start);
  const after = text.slice(index + 1, index + 1 + CONTEXT_CHARS);
  // A date word before it: "in Jan.", "seit Jan.", "end of Jan.".
  const key = languageKey(lang);
  const dateWords = DATE_WORD_PATTERNS.get(key) ?? ALL_DATE_WORDS_PATTERN;
  if (dateWords.test(before)) return true;
  // Another month joined directly to this one: "Jan. and Feb.", "Jan.–Mar.", "Jan., Feb.".
  // A month farther away does not count: in "I spoke with Jan. she moved in Feb.", "Jan."
  // is a name.
  const months = monthsFor(lang);
  const joins = MONTH_JOIN_PATTERNS.get(key) ?? ALL_MONTH_JOIN_PATTERNS;
  const isMonth = (match: RegExpExecArray | null) =>
    match !== null && months.has(match[1].toLowerCase());
  return isMonth(joins.before.exec(before)) || isMonth(joins.after.exec(after));
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
 * written in a case that the entry allows. In Review, a capitalized month or name-like unit
 * needs context: "in Jan. the" (month) but "with Jan. she" (name). Typing reads every
 * capitalized month as a month.
 */
function isListedAbbreviation(
  text: string,
  start: number,
  index: number,
  lang: string | undefined,
  options: AbbreviationOptions,
): boolean {
  const token = text.slice(start, index);
  const lower = token.toLowerCase();
  if (!abbreviationsFor(lang).has(lower)) return false;
  if (token === lower) return true;
  if (LOWERCASE_ONLY_ABBREVIATIONS.has(lower)) return false;
  const isMonth = monthsFor(lang).has(lower);
  if (isMonth && options.typing) return true;
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

/** The start of the token (letters, numbers and stops) that ends at the period at `index`. */
function abbreviationStart(text: string, index: number): number {
  let start = index;
  while (start > 0 && /[\p{L}\p{N}.]/u.test(text[start - 1])) {
    start -= 1;
  }
  return start;
}

/** True when the period at `index` closes an initial or a known abbreviation. */
export function closesAbbreviation(
  text: string,
  index: number,
  lang?: string,
  options: AbbreviationOptions = {},
): boolean {
  const start = abbreviationStart(text, index);
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
  return (
    token.length <= 1 ||
    token.includes(".") ||
    isListedAbbreviation(text, start, index, lang, options)
  );
}

// The sentence boundary after a stop, "!" or "?", in one place. Regex sources:
// SENTENCE_CLOSERS: more marks and closing quotes or brackets after the mark ("?!", ".”", ".)").
// SENTENCE_OPENERS: the marks and spaces between the spaces after the mark and the first
// letter of the next sentence: inverted marks ("¿", "¡"), dashes ("—", "–", "-"), brackets
// and quotes ("(", "[", "«", "„", "“", "‘", '"', "'") and bullets ("•", "·", "*").
// The quantifiers are bounded: the cost of one test stays small.
export const SENTENCE_CLOSERS = "[.!?…؟]{0,4}[\"'”’»)\\]]{0,4}";
export const SENTENCE_OPENERS = "[¿¡«„“‘\"'(\\[–—•·* \\t\\u00a0-]{0,8}";
const NEXT_WORD = new RegExp(
  `^${SENTENCE_CLOSERS}\\s+${SENTENCE_OPENERS}(\\p{L}[\\p{L}\\p{M}]*)`,
  "u",
);

// Lowercase words that start a new clause after an abbreviation that can end a sentence: subject
// pronouns and determiners. "pens, etc. she left" has two sentences. Any other lowercase word
// (a conjunction, a preposition, a relative word, a verb) continues the sentence: "pens, etc.
// and paper", "Smith Inc. in Boston". Words that are also object pronouns, relative pronouns or
// prepositions stay out: de "die", "das"; fr "le", "la", "les"; es "la", "lo"; pt "a", "o".
const NEW_CLAUSE_WORDS: Record<string, readonly string[]> = {
  en: [
    ...["i", "he", "she", "we", "they", "it", "you", "the", "a", "an", "this", "these"],
    ...["those", "my", "our", "your", "his", "their"],
  ],
  de: ["ich", "du", "er", "sie", "es", "wir", "ihr", "man"],
  fr: [
    ...["je", "j", "il", "elle", "on", "nous", "vous", "ils", "elles", "un", "une", "ce", "c"],
    ...["cette", "ces", "mon", "ma", "mes", "notre", "nos"],
  ],
  es: [
    ...["yo", "tú", "él", "ella", "nosotros", "nosotras", "vosotros", "vosotras", "ellos"],
    ...["ellas", "usted", "ustedes", "el", "un", "una", "unos", "unas", "este", "estos"],
    ...["estas", "mi", "mis", "nuestro", "nuestra"],
  ],
  pt: [
    ...["eu", "tu", "ele", "ela", "nós", "eles", "elas", "você", "vocês", "um", "uma", "uns"],
    ...["umas", "este", "esta", "estes", "estas", "meu", "minha", "nosso", "nossa"],
  ],
  pl: ["ja", "ty", "on", "ona", "ono", "my", "wy", "oni", "one"],
  sv: ["jag", "du", "han", "hon", "den", "det", "vi", "ni", "de", "man"],
  hr: ["ja", "ti", "on", "ona", "ono", "mi", "vi", "oni", "one"],
  el: ["εγώ", "εσύ", "αυτός", "αυτή", "αυτό", "εμείς", "εσείς", "αυτοί", "αυτές"],
};
const NEW_CLAUSE_BY_KEY = new Map(
  Object.entries(NEW_CLAUSE_WORDS).map(([lang, words]) => [lang, new Set(words)]),
);
// "e.g." and "i.e." come before an example: a lowercase word after them continues the sentence
// ("fruit, e.g. the apples").
const EXAMPLE_ENTRIES = new Set(["eg", "ie"]);

/** The abbreviation (no stops, lowercase) that the period at `index` closes: "e.g." -> "eg". */
function abbreviationEntry(text: string, index: number): string {
  return text.slice(abbreviationStart(text, index), index).replace(/\./g, "").toLowerCase();
}

/**
 * True when the abbreviation that the period at `index` closes can also end a sentence: "etc.",
 * "Inc.", "e.g." (an entry that ends in a stop in the lists above). A dotted abbreviation
 * ("e.g.") uses the entry with no stops ("eg").
 */
function canEndSentence(text: string, index: number, lang?: string): boolean {
  const enders = LANGUAGE_SENTENCE_ENDERS.get(languageKey(lang)) ?? ALL_SENTENCE_ENDERS;
  return enders.has(abbreviationEntry(text, index));
}

/**
 * True when the period at `index` ends a sentence. Review only: it reads the text after the
 * period. A period that closes no abbreviation ends it. A period after a continuation
 * abbreviation ("Mr.", "Dr.", "Prof.", "St.") never ends it. After an abbreviation that can end
 * a sentence ("etc.", "Inc."), the next word decides:
 * - A capitalized word ends it: "paper, etc. Sunday is next".
 * - A lowercase subject pronoun or determiner ends it: "paper, etc. she left".
 * - Any other lowercase word continues it: "paper, etc. and pens", "Smith Inc. in Boston".
 * - After "e.g." and "i.e.", every lowercase word continues it: "fruit, e.g. the apples".
 * A language with no word list (auto-detect not resolved) reads the case only.
 */
export function periodEndsSentence(text: string, index: number, lang?: string): boolean {
  if (!closesAbbreviation(text, index, lang)) return true;
  if (!canEndSentence(text, index, lang)) return false;
  const next = NEXT_WORD.exec(text.slice(index + 1, index + 1 + 64))?.[1];
  if (next === undefined) return false;
  if (/^\p{Lu}/u.test(next)) return true;
  if (EXAMPLE_ENTRIES.has(abbreviationEntry(text, index))) return false;
  return NEW_CLAUSE_BY_KEY.get(languageKey(lang))?.has(next) ?? false;
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
      startsSentence(text, wordStart, context.hints?.lang, { typing: true }),
    );
  }
}

/**
 * True when the word at `wordStart` opens a sentence: text start, or a sentence
 * end (not an abbreviation) followed by spaces. A newline is not a sentence
 * start here; capitalizeAfterLineBreak owns line starts.
 */
export function startsSentence(
  text: string,
  wordStart: number,
  lang?: string,
  options: AbbreviationOptions = {},
): boolean {
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
  if (i < 0 || !(SENTENCE_ENDING_CHARS.has(text[i]) || isGreekQuestionMark(text[i], lang))) {
    return false;
  }
  if (text[i] !== "." || !closesAbbreviation(text, i, lang, options)) {
    return true;
  }
  // After an abbreviation, typing keeps the word as typed: it cannot see the rest of the
  // sentence. Review reads the word after the abbreviation ("etc. she left").
  return !options.typing && periodEndsSentence(text, i, lang);
}
