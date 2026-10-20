import type { MatchFixer, MatchResult } from "../../engine/reviewRules";
import type { DetectContext } from "../reviewDetectors";
import { rangeDashFixer } from "../rangeDash";
import { caseLike, findingAt } from "./shared";

/*
 * Polish typesetting: „…” quotes (opt-in), one dash style per inserted phrase, spaces
 * around "=" and "×", no space before "%", the decimal comma before a unit, symbols
 * typed as letters ("(C)"), spacing inside abbreviations, and a space after ";" or ")".
 */

const QUOTES = "polishQuotes" as const;
const RULE = "polishTypography" as const;
const MESSAGE = "review_msg_pl_typography" as const;

/* --------------------------------------------------------------------- quotes */

/**
 * A quote pair: the opening mark (unless `fixOpen` is false) and the closing mark get the
 * Polish ones. `marks` is the length of each typed mark.
 */
const quotePair =
  (open: string, close: string, fixOpen = true, marks = 1): MatchFixer =>
  (m, ctx) => {
    const end = m.index + m[0].length;
    const closeFinding = findingAt(ctx, end - marks, end, [close], QUOTES, MESSAGE);
    if (!fixOpen) return [closeFinding];
    return [findingAt(ctx, m.index, m.index + marks, [open], QUOTES, MESSAGE), closeFinding];
  };

const QUOTE_FIXERS = {
  straightQuotes: quotePair("„", "”"),
  englishQuotes: quotePair("„", "”"),
  germanClose: quotePair("„", "”", false),
  singleLowQuotes: quotePair("„", "”"),
  angleQuotes: quotePair("»", "«", true, 2),
} satisfies Record<string, MatchFixer>;

/* --------------------------------------------------------------------- dashes */

function dashPair(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { open, close } = m.groups!;
  if (open === close) return null;
  const spaced = m[0].slice(1, -1);
  return findingAt(
    ctx,
    m.index,
    m.index + m[0].length,
    [`${open}${spaced}${open}`, `${close}${spaced}${close}`],
    RULE,
    MESSAGE,
  );
}

/* -------------------------------------------------------- symbols and numbers */

/** A fix of the whole match: `fix` gives the replacement, or null to keep it. */
const swap =
  (fix: (m: RegExpExecArray) => string | null): MatchFixer =>
  (m, ctx) => {
    const fixed = fix(m);
    if (fixed === null || fixed === m[0]) return null;
    return findingAt(ctx, m.index, m.index + m[0].length, [fixed], RULE, MESSAGE);
  };

/** An abbreviation written as `fixed`, in the typed case. */
const abbreviation = (fixed: string) =>
  swap((m) => {
    // A row's last dot is the abbreviation's own: "p. n. e" with no dot after it gets one.
    const replacement = caseLike(m[0], fixed);
    return replacement === m[0] ? null : replacement;
  });

const SYMBOL_FIXERS = {
  equalsSpaced: swap((m) => (m[0] === " = " ? null : " = ")),
  timesSign: swap((m) => `${m[1]} × ${m[2]}`),
  percentClose: swap(() => "%"),
  decimalComma: swap((m) => `${m[1]},${m[2]}`),
  copyrightSign: swap(() => "©"),
  registeredSign: swap(() => "®"),
  trademarkSign: swap(() => "™"),
  postalHyphen: swap((m) => m[0].replace(/[–—]/, "-")),
  romanDate: swap((m) => `${m[1]} ${m[2]} ${m[3]}`),
  odDoRange: swap((m) => `${m[1]} do ${m[2]}`),
  spaceAfterSemicolon: swap(() => "; "),
  spaceAfterBracket: swap(() => ") "),
  spaceBeforeSemicolon: swap(() => ";"),
  spaceBeforeQuote: swap(() => " „"),
  doubleEllipsis: swap(() => "…"),
  gramSpace: swap((m) => `${m[1]} g`),
  yearSpace: swap((m) => `${m[1]} r.`),
  decimalCommaSpace: swap((m) => `${m[1]},${m[2]}`),
  hangingPrefix: swap(() => "-"),
  adWord: swap((m) => m[1]),
  dashSpaceBefore: swap((m) => ` ${m[0]}`),
  dashSpaceAfter: swap((m) => `${m[0]} `),
  dotBeforeComma: swap(() => ""),
  abbrMIn: abbreviation("m.in."),
  abbrZoo: abbreviation("z o.o."),
  abbrPne: abbreviation("p.n.e."),
  abbrNe: abbreviation("n.e."),
  abbrDzCyt: abbreviation("dz. cyt."),
  abbrOpCit: abbreviation("op. cit."),
  abbrDs: abbreviation("ds."),
} satisfies Record<string, MatchFixer>;

/* --------------------------------------------------------------- range dashes */

// "w latach 1990-1995", "s. 12-14": a range takes an en dash (opt-in; see rangeDash.ts).

/** A number, not a range: "nr 12-15", "tel. 500-600", "NIP 123-45". */
const ID_BEFORE =
  /(?<![\p{L}])(?:nr|tel|fax|faks|nip|pesel|regon|krs|isbn|issn|sygn|kod|kodu|kodem)\.?[ \u00a0]*$/iu;
/** A score: "wygrali 1-2", "mecz zakończył się 2-3", "2-3 dla gości". */
const SCORE_BEFORE =
  /(?<![\p{L}])(?:wynik|wygra|przegra|remis|mecz|pokona|zwycięż|zakończ|prowadz|set|bramk|gol|punkt|spotkani|starci)\p{L}*(?:[ \u00a0]+\p{L}+){0,4}[ \u00a0]+$/iu;
const SCORE_AFTER = /^[ \u00a0]+(?:dla|po)(?![\p{L}])/u;

/** The named frame fixes of the typography rules of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = {
  ...QUOTE_FIXERS,
  dashPair,
  rangeDash: rangeDashFixer({
    code: ID_BEFORE,
    score: SCORE_BEFORE,
    scoreAfter: SCORE_AFTER,
    // "31-123 Kraków": a postal code.
    codeShape: (a, b) => a.length === 2 && b.length === 3,
  }),
  ...SYMBOL_FIXERS,
} satisfies Record<string, MatchFixer>;
