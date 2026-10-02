import type { DetectContext, RawFinding } from "../reviewDetectors";
import { caseLike, findingAt, isPl, owned, userOrNamed } from "./shared";

/*
 * Numbers in Polish prose: a digit takes no case ending ("5-ty" is "5." or
 * "piąty", "6-ciu" is "6" or "sześciu"), a digit compound takes a hyphen
 * ("5-minutowy", "3-krotny"), and a numeral governs its noun's form
 * ("dwoje dzieci", "5 złotych", "100 gramów").
 */

const RULE = "polishNumerals" as const;

/** Spelled-out cardinals (nominative, then the personal "-u" form) for 1–10. */
const CARDINALS: Record<number, [string, string]> = {
  1: ["jeden", "jednego"],
  2: ["dwa", "dwóch"],
  3: ["trzy", "trzech"],
  4: ["cztery", "czterech"],
  5: ["pięć", "pięciu"],
  6: ["sześć", "sześciu"],
  7: ["siedem", "siedmiu"],
  8: ["osiem", "ośmiu"],
  9: ["dziewięć", "dziewięciu"],
  10: ["dziesięć", "dziesięciu"],
};

/** The numeral nouns ("piątka", "setka") without their "-ka" ending. */
const NOUN_STEMS: Record<number, string> = {
  1: "jedyn",
  2: "dwój",
  3: "trój",
  4: "czwór",
  5: "piąt",
  6: "szóst",
  7: "siódem",
  8: "ósem",
  9: "dziewiąt",
  10: "dziesiąt",
  11: "jedenast",
  12: "dwunast",
  13: "trzynast",
  14: "czternast",
  15: "piętnast",
  16: "szesnast",
  17: "siedemnast",
  18: "osiemnast",
  19: "dziewiętnast",
  20: "dwudziest",
  30: "trzydziest",
  40: "czterdziest",
  50: "pięćdziesiąt",
  60: "sześćdziesiąt",
  70: "siedemdziesiąt",
  80: "osiemdziesiąt",
  90: "dziewięćdziesiąt",
  100: "set",
  200: "dwuset",
  300: "trzyset",
  400: "czteryset",
  500: "pięćset",
  600: "sześćset",
  700: "siedemset",
  800: "osiemset",
  900: "dziewięćset",
};

const ORDINAL =
  "w?sz[yaeąę]|w?sz(?:ego|ej|emu|ym|ych|ymi)|wsi|g[iaeą]|gie|gi(?:ego|ej|emu|m|ch|mi)|c[iaeą]|cie|ci(?:ego|ej|emu|m|ch|mi)|[dt]?m[yaeą]|[dt]?m(?:ego|ej|emu|ym|ych|ymi)|s?t[yaeą]|s?t(?:ego|ej|emu|ym|ych|ymi)|go|ego|mu|emu|ej|ym|ych|ymi|y|i|a|e";
const CARDINAL = "u|ch|óch|ech|ciu|miu|ściu|tu|stu|ięć|ro|cio|mio|dmio|ścio|oro|oma|ma";
const NOUN = "[jrt]?(?:ka|ki|kę|ką|kom|kami|kach|ce)|t?ek|jek|rek";
const MONTHS_GENITIVE =
  "stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia";

// A digit (or Roman numeral), a dash or nothing, then a closed set of endings; not a unit ("5kg").
const SUFFIXED = new RegExp(
  `(?<![\\p{L}\\p{N}_.,/-])(?<num>\\d{1,4}|[IVXLC]{1,7})(?<dash>[ \\t]?[-—–][ \\t]?|’|')?(?<end>${ORDINAL}|${CARDINAL}|${NOUN})(?![\\p{L}\\p{N}_-])(?<rest>[ \\t\\u00a0]+(?<next>\\p{L}+))?`,
  "gu",
);

function suffixFix(
  num: string,
  ending: string,
  next: string | undefined,
  before: string,
): string[] | null {
  const roman = /^[IVXLC]+$/.test(num);
  const n = roman ? 0 : Number(num);
  const end = ending.toLowerCase();
  if (roman) return /^(?:go|ego|tego|ty|tym|wiecz|ym)$/u.test(end) ? [num] : null;
  if (new RegExp(`^(?:${NOUN})$`, "u").test(end)) {
    const stem = NOUN_STEMS[n];
    const caseEnding = /(?:kami|kach|kom|ka|ki|kę|ką|ce|ek)$/u.exec(end)?.[0];
    if (!stem || !caseEnding) return [num];
    return [stem + caseEnding, num];
  }
  if (new RegExp(`^(?:${CARDINAL})$`, "u").test(end)) {
    const spelled = CARDINALS[n];
    // "10-cio", "4-ro" are compound stems ("dziesięcio-"): the digits alone.
    if (!spelled || /^(?:ro|oro|cio|mio|dmio|ścio)$/u.test(end)) return [num];
    return [/^(?:u|ciu|miu|ściu|tu|stu|ech|óch|ch)$/u.test(end) ? spelled[1] : spelled[0], num];
  }
  // An ordinal day before a month name is written without a dot: "21 maja".
  if (next && new RegExp(`^(?:${MONTHS_GENITIVE})$`, "iu").test(next)) return [num];
  // "w latach 90." — a decade.
  if (/(?:lat|latach|latami|latom)[ \t ]+$/iu.test(before)) return [`${num}.`];
  return [`${num}.`];
}

function numeralSuffixes(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, SUFFIXED)) {
    const { num, dash, end, next } = m.groups!;
    // Glued without a dash, only the unmistakable ordinal endings ("21go", "90tych").
    if (!dash && !/^(?:go|ego|tego|ty|tych|tym|szy|wszy|gi|ci|ciu|miu|stu)$/u.test(end)) continue;
    if (dash && /^['’]$/.test(dash) && !/^(?:ty|go|ego|tych)$/u.test(end)) continue;
    // "32-u bitowy", "4-ro pasmowa": the digit joins the adjective with a hyphen.
    const start = m.index;
    const tokenEnd = start + num.length + (dash?.length ?? 0) + end.length;
    if (
      next &&
      /^(?:u|ro|cio|mio|dmio|ścio|ciu|miu|o|ech|óch|oma)$/u.test(end) &&
      /^\p{Ll}+(?:ow|n|t|sk|cz|ln|ni)(?:y|a|e|ego|ej|emu|ą|ym|ych|ymi|i)$/u.test(next) &&
      !/^(?:lat|osób|ludzi)/u.test(next)
    ) {
      const nextEnd = tokenEnd + m.groups!.rest.length;
      findings.push(
        findingAt(ctx, start, nextEnd, [`${num}-${next}`], RULE, "review_msg_pl_numeral_hyphen"),
      );
      continue;
    }
    // "32-u i 64-bitowe": the first digit keeps only its hyphen.
    const after = ctx.text.slice(tokenEnd, tokenEnd + 24);
    if (
      /^(?:u|ro|cio|mio|dmio|ścio|ciu|o)$/u.test(end) &&
      /^[ \t ]+(?:i|lub|albo|oraz|czy)[ \t ]+\d+-\p{L}/u.test(after)
    ) {
      findings.push(
        findingAt(ctx, start, tokenEnd, [`${num}-`], RULE, "review_msg_pl_numeral_hyphen"),
      );
      continue;
    }
    const before = ctx.text.slice(Math.max(0, start - 12), start);
    const fixed = suffixFix(num, end, next, before);
    if (!fixed) continue;
    findings.push(findingAt(ctx, start, tokenEnd, fixed, RULE, "review_msg_pl_numeral_suffix"));
  }
  return findings;
}

/*
 * A digit compound typed apart: "5 minutowy" (a five-minute ...), "3 krotny", "25 latek".
 * Only singular adjective forms: after a plural numeral a plural adjective can agree
 * on its own ("2 roczne raporty" are two annual reports).
 */
const COMPOUND_PART =
  "krotn\\p{L}*|krotnie|latek|latka|latki|latków|latkiem|latkowi|latku|lecie|lecia|leciu|leciem|(?:minutow|sekundow|godzinn|dniow|tygodniow|miesięczn|osobow|pokojow|piętrow|procentow|kilometrow|metrow|centymetrow|litrow|bitow|stopniow|tonow|kilogramow|gramow|punktow|pasmow|drzwiow|biegow|cylindrow|calow|częściow|elementow|tysięczn|milionow|letni|roczn|dzienn)(?:y|a|ego|ej|emu|ą|i)";
const DIGIT_COMPOUND = new RegExp(
  `(?<![\\p{L}\\p{N}_.,/-])(?<num>\\d{1,4})(?<gap>[ \\t\\u00a0]*['’][ \\t\\u00a0]*|[ \\t\\u00a0]+[-–—][ \\t\\u00a0]+|[ \\t\\u00a0]+[-–—]|[-–—][ \\t\\u00a0]+|[ \\t\\u00a0]{1,3})(?<part>${COMPOUND_PART})(?![\\p{L}\\p{N}_-])`,
  "giu",
);

function digitCompounds(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, DIGIT_COMPOUND)) {
    const { num, part } = m.groups!;
    // "letni"/"roczny" with 1 is fine both ways; "letni" alone is "summer": only after 2+.
    if (/^(?:letni|roczn|dzienn)/iu.test(part) && Number(num) < 2) continue;
    if (/^(?:letni)$/iu.test(part)) continue;
    if (userOrNamed(ctx, part)) continue;
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + m[0].length,
        [`${num}-${part.toLowerCase()}`],
        RULE,
        "review_msg_pl_numeral_hyphen",
      ),
    );
  }
  return findings;
}

/* ---------------------------------------------------------- numeral + noun */

const COLLECTIVE: Record<string, string> = {
  dwa: "dwoje",
  trzy: "troje",
  cztery: "czworo",
  pięć: "pięcioro",
  sześć: "sześcioro",
  siedem: "siedmioro",
  osiem: "ośmioro",
  dziewięć: "dziewięcioro",
  dziesięć: "dziesięcioro",
  jedenaście: "jedenaścioro",
  dwanaście: "dwanaścioro",
  trzynaście: "trzynaścioro",
  czternaście: "czternaścioro",
  piętnaście: "piętnaścioro",
  szesnaście: "szesnaścioro",
  siedemnaście: "siedemnaścioro",
  osiemnaście: "osiemnaścioro",
  dziewiętnaście: "dziewiętnaścioro",
  dwadzieścia: "dwadzieścioro",
  trzydzieści: "trzydzieścioro",
  czterdzieści: "czterdzieścioro",
  pięćdziesiąt: "pięćdziesięcioro",
  sześćdziesiąt: "sześćdziesięcioro",
  siedemdziesiąt: "siedemdziesięcioro",
  osiemdziesiąt: "osiemdziesięcioro",
  dziewięćdziesiąt: "dziewięćdziesięcioro",
};
/** Nouns counted with collective numerals, nominative plural -> genitive plural. */
const COLLECTIVE_NOUNS: Record<string, string> = {
  dzieci: "dzieci",
  drzwi: "drzwi",
  oczy: "oczu",
  uszy: "uszu",
  sanie: "sań",
  kurczęta: "kurcząt",
  kocięta: "kociąt",
  szczenięta: "szczeniąt",
  źrebięta: "źrebiąt",
  cielęta: "cieląt",
  prosięta: "prosiąt",
  pisklęta: "piskląt",
  niemowlęta: "niemowląt",
};
const COLLECTIVE_FRAME = new RegExp(
  `(?<![\\p{L}\\p{N}])(?<num>${Object.keys(COLLECTIVE).join("|")})(?<sp>[ \\t\\u00a0]+)(?<noun>${Object.keys(COLLECTIVE_NOUNS).join("|")})(?![\\p{L}])`,
  "giu",
);

function collectives(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, COLLECTIVE_FRAME)) {
    const { num, sp, noun } = m.groups!;
    if (userOrNamed(ctx, m[0])) continue;
    // "rozmowa w cztery oczy" (in private) is an idiom.
    if (/(?:^|[^\p{L}])w[ \t\u00a0]+$/iu.test(ctx.text.slice(Math.max(0, m.index - 4), m.index)))
      continue;
    const fixed = `${COLLECTIVE[num.toLowerCase()]}${sp}${COLLECTIVE_NOUNS[noun.toLowerCase()]}`;
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + m[0].length,
        [caseLike(m[0], fixed)],
        RULE,
        "review_msg_pl_numeral_noun",
      ),
    );
  }
  return findings;
}

/** 1 złoty; 2–4 złote (not 12–14); else złotych; a fraction takes "złotego". */
function pluralForm(amount: string, forms: [string, string, string, string]): string {
  if (/[.,]\d/.test(amount)) return forms[3];
  const n = Number(amount.replace(/[\s ]/g, ""));
  if (n === 1) return forms[0];
  const lastTwo = n % 100;
  const last = n % 10;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return forms[1];
  return forms[2];
}

const CURRENCY: Record<string, [string, string, string, string]> = {
  złoty: ["złoty", "złote", "złotych", "złotego"],
  złote: ["złoty", "złote", "złotych", "złotego"],
  złotych: ["złoty", "złote", "złotych", "złotego"],
  grosz: ["grosz", "grosze", "groszy", "grosza"],
  grosze: ["grosz", "grosze", "groszy", "grosza"],
  groszy: ["grosz", "grosze", "groszy", "grosza"],
};
// A noun after "złote" makes it the adjective "golden": "2 złote medale".
const AMOUNT = new RegExp(
  `(?<![\\p{L}\\p{N}.,])(?<amount>\\d{1,3}(?:[ \\u00a0]\\d{3})*(?:[.,]\\d+)?)(?<sp>[ \\t\\u00a0]+)(?<unit>złoty|złote|złotych|grosz|grosze|groszy)(?![\\p{L}])(?=[ \\t\\u00a0]*(?:[.!?,;:)…]|$|[ \\t\\u00a0](?:i|a|na|za|do|od|w|z|ze|to|netto|brutto|miesięcznie|rocznie|dziennie)(?![\\p{L}])))`,
  "gu",
);

/** Unit names that take the plural after a number: "100 gramów", "2 kilogramy". */
const UNITS: Record<string, [string, string]> = {
  gram: ["gramy", "gramów"],
  kilogram: ["kilogramy", "kilogramów"],
  dekagram: ["dekagramy", "dekagramów"],
  miligram: ["miligramy", "miligramów"],
  wolt: ["wolty", "woltów"],
  amper: ["ampery", "amperów"],
  wat: ["waty", "watów"],
  kilowat: ["kilowaty", "kilowatów"],
};
const NUMBER_WORDS: Record<string, number> = {
  dwa: 2,
  trzy: 3,
  cztery: 4,
  pięć: 5,
  sześć: 6,
  siedem: 7,
  osiem: 8,
  dziewięć: 9,
  dziesięć: 10,
  dwadzieścia: 20,
  trzydzieści: 30,
  czterdzieści: 40,
  pięćdziesiąt: 50,
  sto: 100,
  dwieście: 200,
  trzysta: 300,
  pięćset: 500,
  tysiąc: 1000,
  kilka: 5,
  kilkanaście: 15,
  kilkadziesiąt: 50,
  kilkaset: 500,
};
const UNIT_FRAME = new RegExp(
  `(?<![\\p{L}\\p{N}.,])(?<num>\\d{1,6}|${Object.keys(NUMBER_WORDS).join("|")})(?<sp>[ \\t\\u00a0]+)(?<unit>${Object.keys(UNITS).join("|")})(?![\\p{L}])(?![ \\t\\u00a0]+(?:w|na|z|ze|o)(?![\\p{L}]))`,
  "giu",
);

function nounForms(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, AMOUNT)) {
    const { amount, unit } = m.groups!;
    const wanted = pluralForm(amount, CURRENCY[unit]);
    if (wanted === unit) continue;
    const start = m.index + amount.length + m.groups!.sp.length;
    findings.push(
      findingAt(ctx, start, start + unit.length, [wanted], RULE, "review_msg_pl_numeral_noun"),
    );
  }
  for (const m of owned(ctx, UNIT_FRAME)) {
    const { num, unit } = m.groups!;
    const n = /^\d+$/.test(num) ? Number(num) : NUMBER_WORDS[num.toLowerCase()];
    if (n === 1) continue;
    const [few, many] = UNITS[unit.toLowerCase()];
    const lastTwo = n % 100;
    const wanted = n % 10 >= 2 && n % 10 <= 4 && !(lastTwo >= 12 && lastTwo <= 14) ? few : many;
    const start = m.index + num.length + m.groups!.sp.length;
    if (userOrNamed(ctx, unit)) continue;
    findings.push(
      findingAt(ctx, start, start + unit.length, [wanted], RULE, "review_msg_pl_numeral_noun"),
    );
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: [RULE] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) =>
      isPl(ctx)
        ? [...numeralSuffixes(ctx), ...digitCompounds(ctx), ...collectives(ctx), ...nounForms(ctx)]
        : [],
  },
];
