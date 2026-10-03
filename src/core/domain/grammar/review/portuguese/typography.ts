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
const MASCULINE_DET =
  "(?:[oO]|[dDnN]o|[aA]o|[pP]elo|[uU]m|[sS]eu|[mM]eu|[nN]osso|[eE]ste|[eE]sse|[aA]quele|[dDnN]este|[dDnN]esse|[dDnN]aquele)";
const FEMININE_DET =
  "(?:[dDnN]a|[àÀ]|[pP]ela|[uU]ma|[sS]ua|[mM]inha|[nN]ossa|[eE]sta|[eE]ssa|[aA]quela|[dDnN]esta|[dDnN]essa|[dDnN]aquela)";
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
  // "1 999 349.56": an English decimal point after a spaced thousands group.
  {
    pattern: `(?<![\\d.,])\\d{1,3}(?:[ \\u00a0]\\d{3}){1,6}(?<target>\\.)\\d{1,6}(?![\\d.,]{0,12}\\d)`,
    replace: ",",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  // "21,349.56", "4,500.00": English separators; Portuguese swaps them.
  {
    pattern: `(?<![\\d.,])(?<target>\\d{1,3}(?:,\\d{3}){1,6}\\.\\d{1,6})(?![\\d.,]{0,12}\\d)`,
    replace: (m) => m.groups!.target.replace(/[.,]/g, (c) => (c === "," ? "." : ",")),
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  // "896.96 km²", "2.5 kg": a decimal point before a unit (a thousands group has 3 digits).
  {
    pattern: `(?<![\\d.,])\\d{1,3}(?<target>\\.)\\d{1,2}(?=${GAP}(?:km²?|m[²³]?|cm|mm|kg|g|mg|ml|l|L|t|ha|GB|MB|TB|kW|W|V|°C|%)(?![\\p{L}\\p{N}]))`,
    replace: ",",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
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
  // "25º 29' 49\"" -> "25° 29′ 49″": degrees before minutes, and the primes that mark them.
  {
    pattern: `(?<target>\\d{1,3}${GAP}º${GAP}\\d{1,2}(?:,\\d+)?${GAP}['’′](?:${GAP}\\d{1,2}(?:,\\d+)?${GAP}(?:["”″]|['’′]{1,2}))?)`,
    replace: (m) => {
      const [deg, min, sec] = m.groups!.target.match(/\d+(?:,\d+)?/g)!;
      // Narrow no-break spaces keep the coordinate on one line.
      return `${deg}° ${min}′${sec ? ` ${sec}″` : ""}`;
    },
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  // "38,8º", "3,5o": an ordinal is a whole number, so a decimal takes the degree sign.
  {
    pattern: `[−-]?\\d{1,3},\\d{1,3}(?<target>[ºo])(?![\\p{L}\\p{N}])`,
    replace: "°",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  // "18º norte", "55o N", "39º de calor": a bearing, a latitude or a temperature.
  {
    pattern: `\\d{1,3}(?<target>[ºo])(?=${GAP}(?:N|S|E|W|L|NE|NO|NW|SE|SO|SW)(?![\\p{L}\\p{N}-])|${S}(?:(?:ao|a)${S})?(?:norte|sul|leste|oeste|nordeste|noroeste|sudeste|sudoeste|de${S}(?:latitude|longitude|calor|frio))(?![\\p{L}\\p{N}-]))`,
    replace: "°",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  // "um ângulo de 137º.", "ontem fez 25º.": an angle or the weather closes the phrase.
  {
    pattern: `(?:ângulos?|temperaturas?|fez|faz|fazia|fará|marcou|marca|atingiu|atinge|chegou${S}a|chegam${S}a|chegar${S}a)${S}(?:de${S})?[−-]?\\d{1,3}(?:,\\d{1,3})?(?<target>[ºo])(?=[ \\t\\u00a0]{0,2}(?:[.,;:!?)]|$))`,
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
  // "no 1ª lugar" -> "1º", "na 2º posição" -> "2ª": the ordinal agrees with its determiner.
  {
    pattern: `(?<![\\dºª°][ \\t\\u00a0]{0,8})${MASCULINE_DET}${S}\\d{1,4}\\.?(?<target>ª)(?=${S}\\p{L})`,
    replace: "º",
    ruleId: "portugueseNumberFormat",
    messageKey: "review_msg_pt_number_format",
  },
  {
    pattern: `(?<![\\dºª°][ \\t\\u00a0]{0,8})(?:${FEMININE_DET}|(?<=(?:^|[.!?][ \\t\\u00a0]{0,8}|(?:é|será|foi|era|ser|seria|como)${S}))[aA])${S}\\d{1,4}\\.?(?<target>º)(?=${S}\\p{Ll})(?!${S}(?:de|graus?|à|no|na|em|celsius)${W})`,
    replace: "ª",
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
  // "às 10.00", "às 6,05 h", "das 9.30 às 11.00": Brazilian usage writes a clock time
  // with a colon (European texts also write 17.40 h, so this stays opt-in).
  {
    pattern: `(?:[àÀ]s|[dD]as?|até${S}[àa]s)${S}(?<target>(?:[01]?\\d|2[0-3])[.,][0-5]\\d(?:[.,][0-5]\\d(?:,\\d+)?)?)(?!\\d)(?=${GAP}h${W}|${S}d[ae]${S}(?:manhã|tarde|noite|madrugada)${W}|${S}(?:às|e|até)${W}|[ \\t\\u00a0]{0,2}(?:[;!?]|\\.(?!\\d)|$))`,
    replace: (m) =>
      m.groups!.target.replace(
        /^(\d+)[.,](\d\d)(?:[.,](\d\d))?/,
        (_, h, min, sec) => `${h}:${min}${sec ? `:${sec}` : ""}`,
      ),
    ruleId: "portugueseTypographyStyle",
    messageKey: "review_msg_pt_number_format",
  },
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
