import type { DetectContext, RawFinding } from "../reviewDetectors";
import { rangeDashes } from "../rangeDash";
import { caseLike, findingAt, isPl, owned } from "./shared";

/*
 * Polish typesetting: „…” quotes (opt-in), one dash style per inserted phrase, spaces
 * around "=" and "×", no space before "%", the decimal comma before a unit, symbols
 * typed as letters ("(C)"), spacing inside abbreviations, and a space after ";" or ")".
 */

const QUOTES = "polishQuotes" as const;
const RULE = "polishTypography" as const;
const MESSAGE = "review_msg_pl_typography" as const;
const SP = "[ \\t\\u00a0]";

/* --------------------------------------------------------------------- quotes */

/** A straight or English quote pair around a phrase on one line: „phrase”. */
const STRAIGHT_PAIR =
  /(?<![\p{L}\p{N}"])"(?=[\p{L}\p{N}])([^"\n]{1,200}?)(?<=[\p{L}\p{N}.!?…])"(?![\p{L}\p{N}])/gu;
const ENGLISH_PAIR = /“(?=[\p{L}\p{N}])([^“”"\n]{1,200}?)(?<=[\p{L}\p{N}.!?…])”/gu;
/** „phrase“: the German closing quote after a Polish opening one. */
const GERMAN_CLOSE = /„(?=[\p{L}\p{N}])([^„“”"\n]{1,200}?)(?<=[\p{L}\p{N}.!?…])“/gu;
const SINGLE_LOW = /‚(?=[\p{L}\p{N}])([^‚‘’\n]{1,200}?)(?<=[\p{L}\p{N}.!?…])’/gu;
const ANGLE = /(?<!<)>>(?=[\p{L}\p{N}])([^<>\n]{1,200}?)(?<=[\p{L}\p{N}.!?…])<<(?!<)/gu;

function quotes(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const pair = (regex: RegExp, open: string, close: string, fixOpen = true) => {
    for (const m of owned(ctx, regex)) {
      const end = m.index + m[0].length;
      const closeLength = regex === ANGLE ? 2 : 1;
      if (fixOpen)
        findings.push(
          findingAt(ctx, m.index, m.index + (regex === ANGLE ? 2 : 1), [open], QUOTES, MESSAGE),
        );
      findings.push(findingAt(ctx, end - closeLength, end, [close], QUOTES, MESSAGE));
    }
  };
  pair(STRAIGHT_PAIR, "„", "”");
  pair(ENGLISH_PAIR, "„", "”");
  pair(GERMAN_CLOSE, "„", "”", false);
  pair(SINGLE_LOW, "„", "”");
  pair(ANGLE, "»", "«");
  return findings;
}

/* --------------------------------------------------------------------- dashes */

/** "— powiedział –": an inserted phrase opened with one dash and closed with the other. */
const DASH_PAIR = new RegExp(
  `(?<=${SP})(?<open>[—–])${SP}(?<inner>[^—–.!?\\n]{1,80}?)${SP}(?<close>[—–])(?=${SP})`,
  "gu",
);

function dashes(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, DASH_PAIR)) {
    const { open, close } = m.groups!;
    if (open === close) continue;
    const spaced = m[0].slice(1, -1);
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + m[0].length,
        [`${open}${spaced}${open}`, `${close}${spaced}${close}`],
        RULE,
        MESSAGE,
      ),
    );
  }
  return findings;
}

/* -------------------------------------------------------- symbols and numbers */

interface Swap {
  regex: RegExp;
  /** The replacement for the match, or null to keep it. */
  fix: (m: RegExpExecArray) => string | null;
}

const SWAPS: Swap[] = [
  // "19=20", "19 =20" -> "19 = 20" between numbers.
  {
    regex: /(?<=\p{N})[ \t]*=[ \t]*(?=\p{N})/gu,
    fix: (m) => (m[0] === " = " ? null : " = "),
  },
  // "800x600", "800 x 600" -> "800 × 600" (not hex "0x1F").
  {
    // A spaced capital X is a Roman month ("12 X 1945").
    regex: /(?<![\p{L}\p{N}.,])(?!0x)(\p{N}{1,5})(?:[ \t]?x[ \t]?|X)(\p{N}{1,5})(?![\p{L}\p{N}])/gu,
    fix: (m) => `${m[1]} × ${m[2]}`,
  },
  // "10 %" -> "10%": Polish sets the percent sign close to the number.
  { regex: /(?<=\p{N})[ \u00a0]%/gu, fix: () => "%" },
  // "312.12 zł", "0.5%" -> the decimal comma before a unit or currency.
  {
    regex:
      /(?<![\p{L}\p{N}.,])(\p{N}{1,6})\.(\p{N}{1,2})(?=[ \u00a0]?(?:zł|złotych|gr|%|proc\.|kg|km|cm|mm|ml)(?![\p{L}]))/gu,
    fix: (m) => `${m[1]},${m[2]}`,
  },
  // "(C) 2012", "Linux(R)", "Choice(TM)" -> the symbol ("Hagan (R)" may name a party).
  { regex: /\(C\)(?=[ \u00a0]+(?:\p{N}|\p{Lu}))/gu, fix: () => "©" },
  { regex: /(?<=\p{L})\(R\)/gu, fix: () => "®" },
  { regex: /(?<=\p{L}[ \u00a0]?)\(TM\)/gu, fix: () => "™" },
  // "00–950 Warszawa": a postal code takes a hyphen.
  {
    regex: /(?<![\p{N}–—-])\p{N}{2}[–—]\p{N}{3}(?=[ \u00a0]+\p{Lu}\p{Ll})/gu,
    fix: (m) => m[0].replace(/[–—]/, "-"),
  },
  // "11.XI.1918", "11-XI-1918" -> "11 XI 1918".
  {
    regex: /(?<![\p{L}\p{N}.])(\p{N}{1,2})[.-]([IVX]{1,4})[.-](\p{N}{4})(?![\p{N}])/gu,
    fix: (m) => `${m[1]} ${m[2]} ${m[3]}`,
  },
  // "od 12 – 17 lutego" -> "od 12 do 17".
  {
    regex:
      /(?<![\p{L}])([Oo]d[ \u00a0]+\p{N}+(?:,\p{N}+)?)[ \u00a0]*[–—-][ \u00a0]*(\p{N}+)(?![\p{N}])/gu,
    fix: (m) => `${m[1]} do ${m[2]}`,
  },
  // "błąd;wiem", "(od dawna)odpowiednim" -> a space after ";" and a closing bracket.
  { regex: /(?<=\p{Ll}{2})[;](?=\p{Ll}{2})/gu, fix: () => "; " },
  { regex: /(?<=\([^()\n]{2,80}\p{Ll})\)(?=\p{Ll}{3})/gu, fix: () => ") " },
  // "zdanie ;" -> "zdanie;".
  { regex: /(?<=\p{L})[ \t]+;(?=[ \t])/gu, fix: () => ";" },
  // "Zrobił to.„Naprawdę" -> a space between the sentence and the quote.
  { regex: /(?<=\p{L}[.!?])„(?=\p{L})/gu, fix: () => " „" },
  // "problem…." -> one ellipsis.
  { regex: /…\.(?!\.)/gu, fix: () => "…" },
  // "30g cukru", "w 2000r." -> a space between a number and "g" or the year's "r.".
  { regex: /(?<![\p{L}\p{N}.,])(\p{N}{1,4})g(?=[ \u00a0]+\p{Ll}{3,})/gu, fix: (m) => `${m[1]} g` },
  { regex: /(?<![\p{L}\p{N}.,])(\p{N}{3,4})r\.(?![\p{L}])/gu, fix: (m) => `${m[1]} r.` },
  // "o 1, 9 proc." -> "1,9": no space after a decimal comma before a percentage.
  {
    regex:
      /(?<![\p{N}][ \u00a0]?,[ \u00a0]?|[\p{N}.,])(\p{N}{1,3}), (\p{N}{1,2})(?=[ \u00a0]?(?:%|proc\.|procent))/gu,
    fix: (m) => `${m[1]},${m[2]}`,
  },
  // "pierwszo–, drugo- i trzeciorzędowy": a hanging prefix in a list takes a hyphen, not a dash.
  {
    regex: /(?<=(?<![\p{L}])\p{Ll}{2,}[ouy])[–—](?=,)/gu,
    fix: () => "-",
  },
  // "przykład.," -> "przykład,": a full word takes no dot before a comma.
  { regex: /(?<=(?<![\p{L}.])\p{Ll}{5,})\.(?=,)/gu, fix: () => "" },
];

/** Abbreviations written with a space inside, or without the space between their parts. */
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [new RegExp(`(?<![\\p{L}])m\\.${SP}+in\\.`, "gu"), "m.in."],
  [new RegExp(`(?<![\\p{L}])z${SP}+o\\.${SP}+o\\.`, "gu"), "z o.o."],
  [new RegExp(`(?<![\\p{L}])p\\.${SP}*n\\.${SP}+e\\.?(?![\\p{L}])`, "gu"), "p.n.e."],
  [new RegExp(`(?<![\\p{L}])p\\.${SP}+n\\.${SP}*e\\.?(?![\\p{L}])`, "gu"), "p.n.e."],
  [new RegExp(`(?<![\\p{L}.]${SP}?)n\\.${SP}+e\\.?(?![\\p{L}])`, "gu"), "n.e."],
  [/(?<![\p{L}])dz\.cyt\./gu, "dz. cyt."],
  [/(?<![\p{L}])op\.cit\./gu, "op. cit."],
  // A wrong letter or a lost dot: "m.im." and "M.in" are "m.in.", "d.s" is "ds.", "44 p.n.e?"
  // needs its dot before the question mark.
  [/(?<![\p{L}])m\.im\.?(?![\p{L}])/giu, "m.in."],
  [/(?<![\p{L}])m\.in(?![\p{L}.])/giu, "m.in."],
  [/(?<![\p{L}.])d\.s\.?(?![\p{L}.])/gu, "ds."],
  [/(?<![\p{L}])p\.n\.e(?![\p{L}.])/gu, "p.n.e."],
];

function symbols(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { regex, fix } of SWAPS)
    for (const m of owned(ctx, regex)) {
      const fixed = fix(m);
      if (fixed === null || fixed === m[0]) continue;
      findings.push(findingAt(ctx, m.index, m.index + m[0].length, [fixed], RULE, MESSAGE));
    }
  for (const [regex, fixed] of ABBREVIATIONS)
    for (const m of owned(ctx, regex)) {
      // A row's last dot is the abbreviation's own: "p. n. e" with no dot after it gets one.
      const replacement = caseLike(m[0], fixed);
      if (replacement === m[0]) continue;
      findings.push(findingAt(ctx, m.index, m.index + m[0].length, [replacement], RULE, MESSAGE));
    }
  return findings;
}

/* --------------------------------------------------------------- range dashes */

// "w latach 1990-1995", "s. 12-14": a range takes an en dash (opt-in; see rangeDash.ts).

/** A number, not a range: "nr 12-15", "tel. 500-600", "NIP 123-45". */
const ID_BEFORE =
  /(?<![\p{L}])(?:nr|tel|fax|faks|nip|pesel|regon|krs|isbn|issn|sygn|kod|kodu|kodem)\.?[ \u00a0]*$/iu;
/** A score: "wygrali 1-2", "mecz zakończył się 2-3", "2-3 dla gości". */
const SCORE_BEFORE =
  /(?<![\p{L}])(?:wynik|wygra|przegra|remis|mecz|pokona|zwycięż|zakończ|prowadz|set|bramk|gol|punkt|spotkani|starci)\p{L}*(?:[ \u00a0]+\p{L}+){0,4}[ \u00a0]+$/iu;
const SCORE_AFTER = /^[ \u00a0]+(?:dla|po)(?![\p{L}])/u;

export const DETECTORS = [
  {
    rules: [QUOTES] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) => (isPl(ctx) ? quotes(ctx) : []),
  },
  {
    rules: [RULE] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) => (isPl(ctx) ? [...dashes(ctx), ...symbols(ctx)] : []),
  },
  {
    rules: ["emdashShortcut"] as RawFinding["ruleId"][],
    lang: "pl",
    detect: (ctx: DetectContext) =>
      isPl(ctx)
        ? rangeDashes(ctx, {
            code: ID_BEFORE,
            score: SCORE_BEFORE,
            scoreAfter: SCORE_AFTER,
            // "31-123 Kraków": a postal code.
            codeShape: (a, b) => a.length === 2 && b.length === 3,
          })
        : [],
  },
];
