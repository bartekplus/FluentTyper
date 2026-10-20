import type { DetectContext } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { rangeDashFixer } from "../rangeDash";

/**
 * Portuguese number writing. portugueseNumberFormat (on): hour abbreviations
 * (12hrs -> 12h, 14:30 hrs -> 14:30), the ordinal indicator used as a degree
 * sign (25ºC) and the reverse (o 8° colocado), ordinals typed with a letter
 * (o 12o -> 12º), a capital K in units (30 Km) and plain exponents (2 m3 -> m³).
 * portugueseTypographyStyle (opt-in): the × sign, chemical subscripts (H2O -> H₂O) and the
 * en dash between a Brazilian city and its state code (Niterói/RJ -> Niterói–RJ).
 */

const SUPER: Record<string, string> = { "2": "²", "3": "³" };
const SUB = "₀₁₂₃₄₅₆₇₈₉";
const ORDINAL: Record<string, string> = { o: "º", a: "ª", os: "ºs", as: "ªs" };
// The 27 Brazilian federative units.
const UF = "(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)";
/** "Niterói/RJ": a place and its state code, prose rather than a path. */
export const PLACE_STATE_TOKEN = new RegExp(`^\\p{Lu}[\\p{Ll}\\p{M}]+/${UF}$`, "u");
/** Prose that looks technical: a dotted ordinal ("12.º", "3.ª", "12.o"), "e.t.c", "kW/h". */
export const PORTUGUESE_PROSE_TOKEN = /^(?:\d{1,4}\.[ºªoa]s?|e\.t\.c|[kK]W[/.]h)$/u;

// "páginas 10-15" -> "10–15" (emdashShortcut, opt-in). Not after a label of a code or a law
// ("tel. 12-34", "art. 3-5", "CEP 12-14").
const RANGE_CODE =
  /(?:^|[^\p{L}])(?:tel|telefone|celular|fax|whatsapp|cep|nº|n\.º|no|número|ref|referência|processo|protocolo|art|artigo|lei|decreto|inciso|parágrafo|cpf|cnpj|rg|conta|agência|pedido|nota|versão|voo|linha|modelo|matrícula|isbn)\.?[ \t ]*:?[ \t ]*$|§[ \t ]*$/iu;
// "venceu 3-1", "o jogo terminou 2-2", "placar de 1-0".
const RANGE_SCORE =
  /(?:^|[^\p{L}])(?:venc|ganh|perd|derrot|empat|golead|goleou|placar|resultado|partida|jogo|set|vitória|derrota)\p{L}*(?:[ \t ]+\p{L}+){0,3}[ \t ]+$/iu;

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const NUMBER_FIXERS = {
  // "21,349.56", "4,500.00": English separators; Portuguese swaps them.
  typographyD: (m) => m.groups!.target.replace(/[.,]/g, (c) => (c === "," ? "." : ",")),
  // "25º 29' 49\"" -> "25° 29′ 49″": degrees before minutes, and the primes that mark them.
  typographyD2: (m) => {
    const [deg, min, sec] = m.groups!.target.match(/\d+(?:,\d+)?/g)!;
    // Narrow no-break spaces keep the coordinate on one line.
    return `${deg}° ${min}′${sec ? ` ${sec}″` : ""}`;
  },
  // "o 12o lugar", "a 1a vez": ordinals take º and ª.
  typographyOs: (m) => ORDINAL[m.groups!.target],
  typographyM: (m) => m.groups!.target.toLowerCase(),
  // "2 m3", "por km2", "m/s2": exponents are superscript.
  typographyP: (m) => SUPER[m.groups!.target.slice(-1)],
  // "22° C" -> "22 °C": the degree sign stays with its scale letter.
  typographyU: (m) => ` °${m.groups!.target.slice(-1)}`,
  // "no ano de 1.989", "em maio de 2.014": a year has no thousands dot.
  typographyD3: (m) => m.groups!.target.replace(".", ""),
  // "5,500,300": English commas between digit groups; Portuguese groups them with dots.
  typographyD4: (m) => m.groups!.target.replaceAll(",", "."),
  // A year range with a space on one side of the dash only: "2013– 2021" -> "2013–2021".
  typographyD5: (m) => m.groups!.target.replace(/[ \u00a0]*[-–—][ \u00a0]*/, "–"),
} satisfies Record<string, (m: RegExpExecArray) => string>;

const ROMAN: Array<[number, string]> = [
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];
/** 1-99 in Roman numerals. */
function roman(n: number): string {
  let out = "";
  for (const [value, letters] of ROMAN) for (; n >= value; n -= value) out += letters;
  return out;
}

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = {
  // "século 20" -> "século XX": centuries take Roman numerals.
  styleD: (m) => roman(Number(m.groups!.target)),
  // "às 10.00", "às 6,05 h", "das 9.30 às 11.00": Brazilian usage writes a clock time
  // with a colon (European texts also write 17.40 h, so this stays opt-in).
  styleD2: (m) =>
    m.groups!.target.replace(
      /^(\d+)[.,](\d\d)(?:[.,](\d\d))?/,
      (_, h, min, sec) => `${h}:${min}${sec ? `:${sec}` : ""}`,
    ),
  // "6,626 x 10", "5 * 2", "10,5x17,2km": multiplication between numbers (not hex "0x1F").
  styleT: (m) => m.groups!.target.replace(/[xX*]/g, "×"),
  styleT2: (m) => `–${m.groups!.target.trim().slice(1, 3)}`,
} satisfies Record<string, (m: RegExpExecArray) => string>;

/** The flagged text, or the token around it, is in the user's dictionary. */
export function userWord(ctx: DetectContext, start: number, end: number): boolean {
  const before = /\S*$/.exec(ctx.text.slice(Math.max(0, start - 24), start))![0];
  const after = /^\S*/.exec(ctx.text.slice(end, end + 24))![0];
  const token = `${before}${ctx.text.slice(start, end)}${after}`.replace(/[.,;:!?]+$/, "");
  return [ctx.text.slice(start, end), token].some((word) =>
    ctx.dictionary.has(word.trim().toLowerCase()),
  );
}

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FORMULA_FIXERS = {
  formula: (m, ctx) => {
    const token = m[0];
    if (userWord(ctx, m.index, m.index + token.length)) return null;
    const lead = /^\d*/.exec(token)![0];
    const body = token.slice(lead.length);
    // A count of 1 or 0 is never written (H1N1 is a virus), two-digit counts follow only C
    // or H (HB20 is a car, ISO9001 a norm), and C, H or O anchors a formula (PS4, SNS24).
    if (
      !/[A-Za-z]\d/.test(body) ||
      /\d{3}|[A-Za-z][10](?!\d)|[A-GI-Za-z]\d\d/.test(body) ||
      !/[CHO]/.test(body)
    )
      return null;
    return {
      ruleId: "portugueseTypographyStyle",
      messageKey: "review_msg_pt_typography_style",
      range: { start: m.index, end: m.index + token.length },
      alternatives: [lead + body.replace(/\d/g, (digit) => SUB[Number(digit)])],
    };
  },
  rangeDash: rangeDashFixer({ code: RANGE_CODE, score: RANGE_SCORE }),
} satisfies Record<string, MatchFixer>;
