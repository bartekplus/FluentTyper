import { frameMatches, SPACE, WORD_END, WORD_START } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { ReviewMessageKey } from "../types";

/**
 * Portuguese number writing. portugueseNumberFormat (on): hour abbreviations
 * (12hrs -> 12h, 14:30 hrs -> 14:30), the ordinal indicator used as a degree
 * sign (25ºC) and the reverse (o 8° colocado), ordinals typed with a letter
 * (o 12o -> 12º), a capital K in units (30 Km) and plain exponents (2 m3 -> m³).
 * portugueseTypographyStyle (opt-in): the × sign, chemical subscripts (H2O -> H₂O) and the
 * en dash between a Brazilian city and its state code (Niterói/RJ -> Niterói–RJ).
 */

type Frame = {
  /** Compiled with WORD_START; case-sensitive (unit symbols and hour letters are cased). */
  pattern: string;
  /** The replacement, or a function of the match. */
  replace: string | ((m: RegExpExecArray) => string);
  ruleId: "portugueseNumberFormat" | "portugueseTypographyStyle";
  messageKey: ReviewMessageKey;
};

const S = SPACE;
const W = WORD_END;
const GAP = "[ \\t\\u00a0]?";
const NUM = "\\d[\\d.,]*";
const SUPER: Record<string, string> = { "2": "²", "3": "³" };
const SUB = "₀₁₂₃₄₅₆₇₈₉";
const ORDINAL: Record<string, string> = { o: "º", a: "ª", os: "ºs", as: "ªs" };
const ARTICLE =
  "(?:[oaOA]s?|d[oa]s?|n[oa]s?|ao|aos|à|às|pel[oa]s?|seus?|suas?|meu|minha|nosso|nossa|est[ea]|ess[ea])";
const MASCULINE = "(?:[oO]s?|dos?|nos?|aos?|pelos?|seus?|meu|nosso|este|esse|aquele)";
// The 27 Brazilian federative units.
const UF = "(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)";
/** "Niterói/RJ": a place and its state code, prose rather than a path. */
export const PLACE_STATE_TOKEN = new RegExp(`^\\p{Lu}[\\p{Ll}\\p{M}]+/${UF}$`, "u");
const CITY = `(?:em|de|para|até)${SPACE}\\p{Lu}[\\p{Ll}\\p{M}]+(?:[ \\t\\u00a0-](?:d[aoe]s?|\\p{Lu}[\\p{Ll}\\p{M}]+)){0,6}`;
const HOUR_TYPOS = "hrs?|hs|Hrs?|Hs|HRS?|HS";
// Element symbols; formulas() adds the guards that keep names and models out.
const ELEMENT =
  "(?:H|He|Li|Be|B|C|N|O|F|Ne|Na|Mg|Al|Si|P|S|Cl|Ar|K|Ca|Ti|Cr|Mn|Fe|Co|Ni|Cu|Zn|Br|Ag|I|Ba|Pt|Au|Hg|Pb|U)";

const NUMBER_FORMAT: Frame[] = [
  // "12hrs", "15 hs", "01 hr": the hour symbol is "h".
  {
    pattern: `(?<!:)\\d{1,2}${GAP}(?<target>${HOUR_TYPOS})${W}`,
    replace: "h",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  // "às 14:30 hrs", "03:45H": a clock time takes at most a lowercase "h".
  {
    pattern: `\\d{1,2}:\\d\\d(?<target>${GAP}(?:${HOUR_TYPOS}|H))${W}`,
    replace: "",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  // "às 12H", "às 06 H".
  {
    pattern: `(?:[àÀ]s|[aA]s|das|até)${S}\\d{1,2}${GAP}(?<target>H)${W}`,
    replace: "h",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  // "Às 15 h. será": a symbol takes no period.
  {
    pattern: `\\d{1,2}${GAP}h(?<target>\\.)(?=${S}\\p{Ll})`,
    replace: "",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  // "25ºC", "40º de febre": the ordinal indicator stands in for the degree sign.
  {
    pattern: `${NUM}${GAP}(?<target>[ºo])${GAP}(?=[CF]${W})`,
    replace: "°",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  {
    pattern: `${NUM}(?<target>º)(?=${S}de${S}(?:febre|temperatura|latitude|longitude)${W})`,
    replace: "°",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  // "25º 29' 49\"": degrees before minutes.
  {
    pattern: `\\d{1,3}${GAP}(?<target>º)${GAP}(?=\\d{1,2}(?:,\\d+)?${GAP}['’′])`,
    replace: "°",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  // "o 12o lugar", "a 1a vez": ordinals take º and ª.
  {
    pattern: `${ARTICLE}${S}\\d{1,4}\\.?(?<target>os|as|o|a)(?=${W}(?:${S}\\p{Ll}|[ \\t\\u00a0]{0,2}[.,;:!?]))`,
    replace: (m) => ORDINAL[m.groups!.target],
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  // "o 8° colocado": the degree sign stands in for the ordinal indicator.
  {
    pattern: `${MASCULINE}${S}\\d{1,4}(?<target>°)(?=${S}\\p{Ll})(?!${S}(?:de${S}(?:febre|temperatura)|graus?)${W})`,
    replace: "º",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  // "30 Km", "120 KW", "por Km": the kilo prefix is a lowercase k.
  {
    pattern: `(?:\\d+${GAP}|por${S}|/)(?<target>K)(?=(?:m|M|ms|g|G|W|w|Wh|Hz|m²|m2)${W})`,
    replace: "k",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  {
    pattern: `(?:\\d+${GAP}|por${S}|/)k(?<target>M|G)(?=${W})`,
    replace: (m) => m.groups!.target.toLowerCase(),
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  // "2 m3", "por km2", "m/s2": exponents are superscript.
  {
    pattern: `(?:\\d+${GAP}|por${S}|/)(?:km|cm|mm|dm|m)(?<target>\\^?[23])(?![\\p{L}\\p{N}])`,
    replace: (m) => SUPER[m.groups!.target.slice(-1)],
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  {
    pattern: `\\d+${GAP}(?:km|cm|mm|m)/s(?<target>\\^?2)(?![\\p{L}\\p{N}])`,
    replace: "²",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
];

const STYLE: Frame[] = [
  // "6,626 x 10", "5 * 2", "10,5x17,2km": multiplication between numbers (not hex "0x1F").
  {
    pattern: `(?!0[xX])${NUM}(?<target>${GAP}[xX*]${GAP})(?=\\d)`,
    replace: (m) => m.groups!.target.replace(/[xX*]/, "×"),
    ruleId: "portugueseTypographyStyle",
    messageKey: "review_msg_pt_typography_style",
  },
  // "em Niterói/RJ", "de Niterói - RJ", "para Niterói (RJ)": a city and its state take an
  // en dash. Only after a place preposition: "Gabeira (RJ)" names a politician's state. A
  // bare hyphen stays: "Águia de Marabá-PA" names a club.
  {
    pattern: `${CITY}(?<target>/|[ \\t\\u00a0][-–—][ \\t\\u00a0])(?=${UF}(?![\\p{L}\\p{N}/-]))`,
    replace: "–",
    ruleId: "portugueseTypographyStyle",
    messageKey: "review_msg_pt_typography_style",
  },
  {
    pattern: `${CITY}(?<target>[ \\t\\u00a0]?\\(${UF}\\))`,
    replace: (m) => `–${m.groups!.target.trim().slice(1, 3)}`,
    ruleId: "portugueseTypographyStyle",
    messageKey: "review_msg_pt_typography_style",
  },
];

const FORMULA = new RegExp(
  `(?<![\\p{L}\\p{N}_./-])\\d*(?:${ELEMENT}\\d*){2,}(?![\\p{L}\\p{N}_-])`,
  "gu",
);

const COMPILED = new Map<Frame, RegExp>();
const compiled = (frame: Frame) => {
  let regex = COMPILED.get(frame);
  if (!regex) {
    regex = new RegExp(`${WORD_START}${frame.pattern}`, "gdu");
    COMPILED.set(frame, regex);
  }
  return regex;
};

/** The flagged text, or the token around it, is in the user's dictionary. */
function userWord(ctx: DetectContext, start: number, end: number): boolean {
  const before = /\S*$/.exec(ctx.text.slice(Math.max(0, start - 24), start))![0];
  const after = /^\S*/.exec(ctx.text.slice(end, end + 24))![0];
  const token = `${before}${ctx.text.slice(start, end)}${after}`.replace(/[.,;:!?]+$/, "");
  return [ctx.text.slice(start, end), token].some((word) =>
    ctx.dictionary.has(word.trim().toLowerCase()),
  );
}

function frameFindings(ctx: DetectContext, frames: Frame[]): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const frame of frames) {
    for (const m of frameMatches(ctx, compiled(frame))) {
      const [start, end] = m.indices!.groups!.target;
      if (userWord(ctx, start, end)) continue;
      findings.push({
        ruleId: frame.ruleId,
        messageKey: frame.messageKey,
        range: { start, end },
        alternatives: [typeof frame.replace === "string" ? frame.replace : frame.replace(m)],
        context: { start: m.index, end: Math.max(end, m.index + m[0].length) },
      });
    }
  }
  return findings;
}

function formulas(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  FORMULA.lastIndex = ctx.from;
  for (let m = FORMULA.exec(ctx.scanText); m && m.index < ctx.to; m = FORMULA.exec(ctx.scanText)) {
    const token = m[0];
    if (userWord(ctx, m.index, m.index + token.length)) continue;
    const lead = /^\d*/.exec(token)![0];
    const body = token.slice(lead.length);
    // A count of 1 or 0 is never written (H1N1 is a virus), two-digit counts follow only C
    // or H (HB20 is a car, ISO9001 a norm), and C, H or O anchors a formula (PS4, SNS24).
    if (
      !/[A-Za-z]\d/.test(body) ||
      /\d{3}|[A-Za-z][10](?!\d)|[A-GI-Za-z]\d\d/.test(body) ||
      !/[CHO]/.test(body)
    )
      continue;
    findings.push({
      ruleId: "portugueseTypographyStyle",
      messageKey: "review_msg_pt_typography_style",
      range: { start: m.index, end: m.index + token.length },
      alternatives: [lead + body.replace(/\d/g, (digit) => SUB[Number(digit)])],
    });
  }
  return findings;
}

export function numberFormat(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  return frameFindings(ctx, NUMBER_FORMAT);
}

export function typographyStyle(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  return [...frameFindings(ctx, STYLE), ...formulas(ctx)];
}
