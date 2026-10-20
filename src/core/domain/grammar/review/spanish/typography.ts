import { namedExampleBefore } from "../exampleCues";
import { invalidIsoDates } from "../isoDates";
import { EMPHASIS_MARKS } from "../markdownEmphasis";
import type { Detector, FindingsFilter, MatchFixer } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  Around,
  attributeOf,
  carryCase,
  replaceToken,
  tokenize,
  words,
  type Token,
} from "./common";
import { isGenderedEntry, isNoun } from "./lexicon";
import { readNoun } from "./agreement";
import { contextYear, daysInMonth, nearestDayOn, weekdayOf, yearsFor } from "../reviewClock";
import { PREPOSITIONS, verbLike } from "./common";
import { finding } from "../finding";
import { rangeDashes } from "../rangeDash";
import { isLang } from "../phraseTemplates";

const known = (word: string) =>
  isNoun(word) || !!attributeOf(word) || isGenderedEntry(word) || verbLike(word);

// Spanish writing conventions: "y" -> "e" before an /i/ sound and "o" -> "u" before /o/,
// years without a thousands point, lowercase months and weekdays, invariable acronyms.

const RULE = "spanishTypography" as const;

const MONTHS = words(
  "enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre noviembre diciembre",
);
const WEEKDAYS = words("lunes martes miércoles jueves viernes sábado domingo");
// "este Verano", "cada Invierno"; "la Primavera de Praga" keeps its capital.
const SEASONS = words("primavera verano otoño invierno");
// Spanish acronyms that stay invariable in the plural ("las ONG", "los ERE").
const ACRONYMS = words("ong tic ere ett dni");

/** The word starts with the vowel sound /i/ (not the /j/ of "hielo", "iones"). */
const iSound = (word: string) => /^h?[ií](?![aeoáéó])/iu.test(word);
const oSound = (word: string) => /^h?[oó]/iu.test(word) || /^8/u.test(word);

function conjunction(at: Around, token: Token): string | null {
  const next = at.tokens[at.i + 1];
  if (!next || next.broken || (!next.word && !/^\p{N}/u.test(next.text))) return null;
  const after = next.text;
  // "¿Y Inés?": a stressed "y" opening a question keeps its form.
  if (at.tokens[at.i - 1]?.text === "¿") return null;
  // English names keep the English sound: "Ryanair y easyJet".
  if (/^\p{Ll}+\p{Lu}/u.test(after)) return null;
  // An "h" in a foreign word is sounded: "y Hitler", "y hip-hop", "o hobbies".
  const foreignH =
    /^h/iu.test(after) &&
    (/^\p{Lu}/u.test(after) && token.lower === "y"
      ? true
      : /^\p{Ll}/u.test(after) &&
        (!known(after.toLowerCase()) || at.tokens[at.i + 2]?.text === "-"));
  if (foreignH) return null;
  if (token.lower === "y" && iSound(after)) return "e";
  if (token.lower === "e" && !iSound(after) && /^h?[ií]/iu.test(after)) return "y";
  if (
    token.lower === "o" &&
    oSound(after) &&
    (!/^\p{N}/u.test(after) || /^\p{N}/u.test(at.tokens[at.i - 1]?.text ?? ""))
  )
    return "u";
  // "hobbys u hobbies"; "la u" is the letter.
  const prev = at.prev();
  if (
    token.text === "u" &&
    next.word &&
    prev &&
    !/^(?:la|una|letra|vocal)$/u.test(prev) &&
    known(after.toLowerCase()) &&
    !oSound(after)
  )
    return "o";
  return null;
}

/** "del año 1.989": a year is written without the thousands point. */
function yearDot(at: Around, token: Token): string | null {
  const m = /^([12])\.(\d{3})$/u.exec(token.text);
  if (!m) return null;
  const year = Number(m[1] + m[2]);
  if (year < 1100 || year > 2099) return null;
  const prev = at.tokens[at.i - 1]?.text.toLowerCase() ?? "";
  if (/^(?:año|años|del)$/u.test(prev)) return m[1] + m[2];
  if (!/^(?:de|en|para|desde|hasta|y|-)$/u.test(prev)) return null;
  // "de 2.000 euros", "en 1.500 metros": an amount with its unit.
  const next = at.next();
  return !next || (!isNoun(next) && !attributeOf(next)) ? m[1] + m[2] : null;
}

/** "el 4 de Julio", "todos los Lunes": months and weekdays are common nouns. */
function capitalName(at: Around, token: Token): string | null {
  if (!/^\p{Lu}\p{Ll}+$/u.test(token.text) || at.starts) return null;
  const word = token.lower;
  const prev = at.prev();
  const before = at.tokens[at.i - 2];
  if (MONTHS.has(word)) {
    // "4 de Julio de 2020", "en Agosto.", "de Julio del año pasado".
    const dated = prev === "de" && !!before && /^\p{N}/u.test(before.text);
    const yearAfter =
      /^(?:de|del)$/u.test(at.next()) && /^\p{N}|^año$/u.test(at.tokens[at.i + 2]?.text ?? "");
    const alone = /^(?:en|de|desde|hasta|y)$/u.test(prev) && at.endsAfter();
    return dated || yearAfter || alone ? word : null;
  }
  // "Viernes de Dolores", "Domingo de Ramos": holidays keep their capital.
  if (WEEKDAYS.has(word) || SEASONS.has(word))
    return /^(?:el|los|cada|este|próximo|pasado|del|al)$/u.test(prev) &&
      !/^\p{Lu}/u.test(at.tokens[at.i + 1]?.text ?? "") &&
      !(/^(?:de|del)$/u.test(at.next()) && /^\p{Lu}/u.test(at.tokens[at.i + 2]?.text ?? ""))
      ? word
      : null;
  return null;
}

/** "las ONGs", "los ERE's": a Spanish acronym takes no plural ending. */
function acronymPlural(token: Token): string | null {
  const m = /^(\p{Lu}{2,})(?:['’]?s|S)$/u.exec(token.text);
  return m && ACRONYMS.has(m[1].toLowerCase()) ? m[1] : null;
}

const MONTH_LIST = [...MONTHS].filter((month) => month !== "setiembre");
export const monthNumber = (month: string) =>
  month.toLowerCase() === "setiembre" ? 9 : MONTH_LIST.indexOf(month.toLowerCase()) + 1;
export const MONTH_NAMES = `${[...MONTHS].join("|")}`;
const WEEKDAY_LIST = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Short month names in numeric dates: "29-feb-2005". The MONTH_SHORT fragment of
// grammar/rules/es.yaml holds the same list.
const MONTH_SHORT = "ene|feb|mar|abr|may|jun|jul|ago|sep|sept|set|oct|nov|dic";
const shortMonth = (month: string) =>
  ({ sept: 9, set: 9 })[month.toLowerCase()] ??
  MONTH_SHORT.split("|").indexOf(month.toLowerCase()) + 1;
// Where a date goes: "Cédula: 6-51-2032" and "N° 99/73/2022" are numbers. Markdown emphasis
// can come before the date: "el **32.04.2020**".
const DATED = new RegExp(
  `(?:^|\\s)(?:el|del|al|día|fecha|desde|hasta)\\s{1,8}${EMPHASIS_MARKS}$`,
  "iu",
);
// A label that makes the next number a code: "Pedido N° 12/34/2022", "Ref. 31/13/2020".
const CODE_LABEL =
  /(?:^|[\s(])(?:n[º°o]\.?|núm\.?|número|#|ref\.?|código|expediente)\s*:?\s{0,8}$/iu;

/** A day the month does not have: "31 de abril", "29 de febrero de 2023". */
function dayFinding(
  ctx: DetectContext,
  start: number,
  day: string,
  month: number,
  year?: number,
): RawFinding | null {
  const max = daysInMonth(month, year);
  if (Number(day) <= max || Number(day) > 31 || month < 1) return null;
  if (namedExampleBefore(ctx.text, start)) return null;
  const alternatives = month === 2 && year === undefined ? ["28", "29"] : [String(max)];
  return finding(RULE, "review_msg_spanish_date", start, start + day.length, alternatives, {
    bulkBlock: "ambiguous",
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  });
}

/** A named date (NAMED_DATE frame): its day, and the weekday before it. */
const namedDate: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  const [whole, weekday, gap, day, month, year] = m;
  const dayStart = m.index + (weekday ? weekday.length + gap.length : 0);
  if (dayStart < ctx.from) return null;
  const monthIndex = monthNumber(month);
  const yearNumber = year ? Number(year) : undefined;
  const overDay = dayFinding(ctx, dayStart, day, monthIndex, yearNumber);
  if (overDay) findings.push(overDay);
  // A full date with day 0 or a day above 31: "32 de abril de 2020". A weekday makes day 0
  // a date with no year: "el lunes 0 de abril". NO_SUCH_DAY reports day 0 and a day above 31
  // after an article.
  const dayNumber = Number(day);
  const fullDate =
    yearNumber !== undefined &&
    (dayNumber === 0 || dayNumber > 31) &&
    !/(?:^|[\s(])(?:el|del|al|El|Del|Al)[ \t]{1,8}$/u.test(
      ctx.text.slice(Math.max(0, dayStart - 12), dayStart),
    );
  if ((fullDate || (weekday && dayNumber === 0)) && !namedExampleBefore(ctx.text, m.index))
    findings.push(
      finding(RULE, "review_msg_spanish_date", dayStart, m.index + whole.length, [], {
        warningOnly: true,
      }),
    );
  // The weekday of a full date is fixed: "lunes, 7 de octubre de 2014" was a Tuesday.
  if (weekday && yearNumber && dayNumber >= 1 && dayNumber <= daysInMonth(monthIndex, yearNumber)) {
    const actual = WEEKDAY_LIST[weekdayOf(yearNumber, monthIndex, Number(day))];
    if (actual !== weekday.toLowerCase() && !namedExampleBefore(ctx.text, m.index))
      findings.push({
        ruleId: RULE,
        messageKey: "review_msg_spanish_date",
        range: { start: m.index, end: m.index + weekday.length },
        alternatives: [carryCase(weekday, actual)],
        context: { start: m.index, end: m.index + whole.length },
        bulkBlock: "ambiguous",
      });
  }
  // No year: the weekday of each year the date can mean (reviewClock), or the nearest day.
  if (
    weekday &&
    !year &&
    dayNumber >= 1 &&
    dayNumber <= daysInMonth(monthIndex) &&
    !namedExampleBefore(ctx.text, m.index)
  ) {
    const years = yearsFor(monthIndex, Number(day), contextYear(ctx.text, m.index, ctx.lang));
    const weekdays = [...new Set(years.map((y) => weekdayOf(y, monthIndex, Number(day))))];
    const typed = WEEKDAY_LIST.indexOf(weekday.toLowerCase());
    if (years.length && !weekdays.includes(typed)) {
      const near = nearestDayOn(years[0], monthIndex, Number(day), typed);
      findings.push({
        ruleId: RULE,
        messageKey: "review_msg_weekday_no_year",
        range: { start: m.index, end: dayStart + day.length },
        alternatives: [
          ...weekdays.map((w) => `${carryCase(weekday, WEEKDAY_LIST[w])}${gap}${day}`),
          ...(near === null ? [] : [`${weekday}${gap}${near}`]),
        ],
        requiresChoice: true,
        context: { start: m.index, end: m.index + whole.length },
      });
    }
  }
  return findings;
};

/** "el 32 de enero" (NO_SUCH_DAY frame): a warning only. */
const noSuchDay: MatchFixer = (m, ctx) =>
  m.index < ctx.from || namedExampleBefore(ctx.text, m.index)
    ? null
    : finding(RULE, "review_msg_spanish_date", m.index, m.index + m[0].length, [], {
        warningOnly: true,
      });

/** A numeric date (NUMERIC_DATE frame): "31/11/1988", "30-2-2001", "29-feb-2005". */
const numericDate: MatchFixer = (m, ctx) => {
  if (m.index < ctx.from) return null;
  const [whole, , separator, monthText, yearText = ""] = m;
  const month = /^\d/u.test(monthText)
    ? Number(monthText)
    : MONTHS.has(monthText.toLowerCase())
      ? monthNumber(monthText)
      : shortMonth(monthText);
  const day = Number(m[1]);
  const dated = DATED.test(ctx.text.slice(Math.max(0, m.index - 15), m.index));
  if (yearText.length !== 4) {
    // "el 31.04.", "el 30/2": a day and month only where a date goes and the clause ends;
    // "el 30.2 por ciento" and the score "el 3-2" are numbers.
    const after = ctx.text.slice(m.index + whole.length);
    if (!dated || (!yearText && (separator === "-" || !/^(?:[.;:!?)]|\s{0,8}$)/u.test(after))))
      return null;
  }
  // "01/32/2014", "31.13.2014": no day-month or month-day reading. A zero day or month has
  // none either; it is a date only with a four-digit year ("0/5/2020").
  const zero = yearText.length === 4 && (day === 0 || month === 0);
  if (((month > 12 || day > 31) && (day > 12 || month > 31)) || zero) {
    // "será 32/04/2020" needs no cue: a full slash date with parts near a day or a month.
    // "6-51-2032", "1.45.2020" and "Pedido N° 99/73/2022" are codes, versions or scores.
    const fullDate =
      separator === "/" &&
      yearText.length === 4 &&
      day <= 39 &&
      month <= 39 &&
      !CODE_LABEL.test(ctx.text.slice(Math.max(0, m.index - 16), m.index));
    if (!(dated || fullDate) || namedExampleBefore(ctx.text, m.index)) return null;
    return finding(RULE, "review_msg_spanish_date", m.index, m.index + m[0].length, [], {
      warningOnly: true,
    });
  }
  if (month < 1 || month > 12) return null;
  // "29.02.89": a two-digit year keeps its leap years ("00" may be 1900 or 2000).
  const year =
    yearText.length === 4
      ? Number(yearText)
      : yearText && yearText !== "00"
        ? 2000 + Number(yearText)
        : undefined;
  return dayFinding(ctx, m.index, m[1], month, year);
};

/** "2026-02-30": an ISO date the calendar does not have. */
const isoDates = (ctx: DetectContext): RawFinding[] =>
  invalidIsoDates(ctx).map((range) => ({
    ruleId: RULE,
    messageKey: "review_msg_spanish_date",
    range,
    alternatives: [],
    warningOnly: true,
  }));

function typography(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "es")) return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.start < ctx.from || token.start >= ctx.to) continue;
    const at = new Around(tokens, i);
    let fix: string | null = null;
    let key: RawFinding["messageKey"] = "review_msg_spanish_conjunction";
    if (token.word && /^[yeou]$/iu.test(token.text)) fix = conjunction(at, token);
    else if (/^\p{N}/u.test(token.text)) {
      fix = yearDot(at, token);
      key = "review_msg_spanish_year";
    } else if (/^tics$/iu.test(token.text) && /^(?:las|estas|sus|nuevas)$/u.test(at.prev())) {
      // "las tics": the feminine article names the technologies ("los tics" are twitches); the
      // acronym takes no plural ending. Lowercase "las tic" is accepted.
      fix = "TIC";
      key = "review_msg_spanish_acronym";
    } else if (token.lower === "asín" && (token.text === "asín" || at.starts)) {
      // "Hazlo asín": the rustic form of "así"; "Fernando Asín" is a surname.
      fix = "así";
      key = "review_msg_typo";
    } else if (token.word) {
      fix = capitalName(at, token);
      key = "review_msg_spanish_lowercase_name";
    }
    if (!fix && /^\p{Lu}{2,}(?:s|S)?$/u.test(token.text)) {
      // The tokenizer splits "ONG's" at the apostrophe: read the raw text after it.
      const raw = /^\p{Lu}{2,}(?:['’]s|s|S)(?!\p{L})/u.exec(ctx.text.slice(token.start));
      if (raw) {
        const acronym = acronymPlural({ ...token, text: raw[0] });
        if (acronym) {
          const span = { ...token, end: token.start + raw[0].length, text: raw[0] };
          const finding = replaceToken(
            ctx,
            span,
            [acronym],
            RULE,
            "review_msg_spanish_acronym",
            span,
            true,
          );
          if (finding) findings.push(finding);
        }
      }
      continue;
    }
    if (!fix) continue;
    const exact =
      key === "review_msg_spanish_lowercase_name" || key === "review_msg_spanish_acronym";
    const finding = replaceToken(ctx, token, [fix], RULE, key, tokens[i + 1] ?? token, exact);
    if (finding) findings.push(finding);
  }
  return findings;
}

/**
 * A fixer that replaces the whole match with `fix(m)`. No finding before the chunk, in a named
 * example, or when the fix is the typed text.
 */
const replaced =
  (fix: (m: RegExpExecArray, ctx: DetectContext) => string | null): MatchFixer =>
  (m, ctx, frame) => {
    if (m.index < ctx.from || namedExampleBefore(ctx.text, m.index)) return null;
    const replacement = fix(m, ctx);
    if (!replacement || replacement === m[0]) return null;
    return finding(RULE, frame.messageKey, m.index, m.index + m[0].length, [replacement]);
  };

const ABBREVIATION_FORMS: Record<string, string> = {
  nº: "n.º",
  "n.°": "n.º",
  num: "núm.",
  pag: "pág.",
  pags: "págs.",
  telf: "tel.",
  tlf: "tel.",
  tlfn: "tel.",
};
const NOT_ORDINAL_AFTER = /^(?:cent|fahr|kel|grad|norte|sur|este|oeste|latitud|longitud|bajo)/u;

/** The frames of the typographyMarks rule, in the order of its frames. */
const MARKS = {
  etcDots: (m, _ctx, frame) =>
    finding(RULE, frame.messageKey, m.index, m.index + m[0].length, [`${m[0].slice(0, 3)}.`]),
  etcEllipsis: (m, _ctx, frame) =>
    finding(RULE, frame.messageKey, m.index, m.index + m[0].length, [", etc.", "…"]),
  ordinal: replaced(([, n, suffix]) =>
    /^e?r$/u.test(suffix) ? `${n}.er` : `${n}.${suffix.endsWith("a") ? "ª" : "º"}`,
  ),
  unit: replaced((m, ctx) => {
    const [, n, gap, unit, dot] = m;
    if (/^g/iu.test(unit)) return `${n} g`;
    // Hours only where a time goes ("a las 15 h. será", "a las 5hrs."): "500 h." may be
    // inhabitants.
    if (
      !/(?:^|\s)(?:las|la|sobre|hacia|desde|hasta|durante|en)\s{1,8}$/iu.test(
        ctx.text.slice(Math.max(0, m.index - 12), m.index),
      )
    )
      return null;
    return unit === "h" && !dot && gap ? null : `${n} h`;
  }),
  genderedOrdinal: replaced(([, n, dot, letter, word]) => {
    const noun = readNoun(word.toLowerCase());
    if (!noun?.gender || noun.paired || noun.plural || !/^\p{Lu}?\p{Ll}+$/u.test(word)) return null;
    const fixed = noun.gender === "f" ? "ª" : "º";
    return fixed === letter ? null : `${n}${dot}${fixed}`;
  }),
  ordinalDegree: replaced(([, n, unit]) => `${n} °${unit}`),
  numberSign: replaced(([, n]) => `${n}.º `),
  bareAbbreviation: replaced(([abbreviation]) => `${abbreviation}.`),
  gluedCount: replaced(([, n, noun]) =>
    isNoun(noun) && noun.endsWith("s") ? `${n} ${noun}` : null,
  ),
  shoutedArticle: replaced(([article]) => `${article[0]}${article.slice(1).toLowerCase()}`),
  bareEtc: replaced(([etc]) => `${etc}.`),
  bareCentury: replaced((m, ctx) =>
    /(?:^|[.!?][ \t]{1,8})$/u.test(ctx.text.slice(Math.max(0, m.index - 9), m.index))
      ? `${m[0]}.`
      : "s.",
  ),
  openInitials: replaced(([initials]) => `${initials}.`),
  forExample: replaced(([, p]) => `${p}. ej.`),
  plainAbbreviation: replaced(([typed, word]) => {
    const fix = `${ABBREVIATION_FORMS[word.toLowerCase()]}${typed.includes(":") ? ":" : ""} `;
    return /^\p{Lu}/u.test(word) ? fix[0].toUpperCase() + fix.slice(1) : fix;
  }),
  degreeOrdinal: replaced(([, article, n, next]) =>
    PREPOSITIONS.has(next) || NOT_ORDINAL_AFTER.test(next)
      ? null
      : `${n}.${/^la$/iu.test(article) ? "ª" : "º"}`,
  ),
  yearApostrophe: replaced(([, year]) => year),
  lowerTreatment: replaced(([word]) => word[0].toUpperCase() + word.slice(1)),
  repeatedAnswer: replaced(([, a, b, c, d]) => `${a ?? c}, ${b ?? d}`),
  strokeDash: replaced(() => "—"),
  commaPeriod: (m, ctx, frame) =>
    namedExampleBefore(ctx.text, m.index)
      ? null
      : finding(RULE, frame.messageKey, m.index, m.index + 2, [",", "."], {
          requiresChoice: true,
        }),
} satisfies Record<string, MatchFixer>;

/** A dialogue or remark dash at [start, end) of the chunk gets the long dash. */
const longDash = (ctx: DetectContext, start: number, end: number): RawFinding | null =>
  start < ctx.from || start >= ctx.to
    ? null
    : finding("emdashShortcut", "review_msg_spanish_dialogue_dash", start, end, ["—"]);

// "las páginas 10-15" -> "10–15" (opt-in). A label that makes the pair a phone number, a
// postal code, an ID or a reference.
const CODE_BEFORE =
  /(?:^|[\s(])(?:tel|teléf|tfno|tlf|teléfono|móvil|fax|whatsapp|c\.?p|código|cód|n\.?º|núm|número|ref|referencia|expediente|exp|lote|pedido|factura|matrícula|dni|nie|nif|cif|cuenta|iban|tarjeta|art|artículo|ley|decreto|modelo|versión|vuelo|línea|ruta)\.?:?(?:[ \t]{1,8}(?:es|era|será))?[ \t]{0,8}$/iu;
// A result: "ganó 3-1", "empataron 2-2", "el marcador 1-2".
const SCORE_BEFORE =
  /(?:^|\s)(?:gan\p{L}*|perd\p{L}*|venc\p{L}*|empat\p{L}*|derrot\p{L}*|golea\p{L}*|marcador|resultado|partido|set|sets|tanteo)[ \t]{1,8}(?:\p{L}+[ \t]{1,8}){0,2}$/iu;
const rangeDash = (ctx: DetectContext) =>
  rangeDashes(ctx, { code: CODE_BEFORE, score: SCORE_BEFORE });

/** "Pesa 1.4 kg" -> "1,4 kg", "9,349.5" -> "9.349,5": the Spanish decimal comma. */
const decimalPoint: MatchFixer = (m, ctx) =>
  m.index < ctx.from || namedExampleBefore(ctx.text, m.index)
    ? null
    : {
        ruleId: "spanishTypographyStyle",
        messageKey: "review_msg_spanish_decimal",
        range: { start: m.index, end: m.index + m[0].length },
        alternatives: [m[0].replace(/[.,]/gu, (c) => (c === "." ? "," : "."))],
      };

/** "30 km2", "por m3": a unit's exponent is a superscript. */
const exponent: MatchFixer = (m, ctx) => {
  if (m.index < ctx.from || namedExampleBefore(ctx.text, m.index)) return null;
  const start = m.index + m[0].length - 1;
  return {
    ruleId: "spanishTypographyStyle",
    messageKey: "review_msg_typographic_symbol",
    range: { start, end: start + 1 },
    alternatives: [m[0].endsWith("2") ? "²" : "³"],
  };
};

// Words that open a Spanish sentence and never a dotted name's next part ("frase.Y otra"). The
// STARTERS fragment of grammar/rules/es.yaml holds the same list.
const STARTERS =
  "El|La|Los|Las|Lo|Un|Una|Unos|Unas|Y|Pero|Es|Son|Era|Fue|Está|Hay|No|Sí|Yo|Tú|Él|Ella|Ellos|" +
  "Ellas|Nosotros|Usted|Este|Esta|Estos|Estas|Eso|Esto|Ese|Esa|Se|Me|Te|Le|Les|Nos|Mi|Su|Sus|" +
  "Tu|En|Del|Al|Con|Por|Para|Sin|Como|Cuando|Si|Que|Qué|Cómo|Dónde|Cuándo|Pues|Así|Luego|" +
  "Después|Entonces|Ahora|Hoy|Ayer|También|Además|Ya|Todo|Siempre|Nunca|Aquí|Allí|Hola|" +
  "Gracias|Bueno|Claro|Aunque|Porque|Mientras|Desde|Hasta|Según";
/**
 * "frase.Y", "Ven.Como": two sentences glued at a period, prose rather than a dotted name.
 * "p.ej", "p.e": a squeezed "p. ej." is prose too.
 */
export const SPANISH_PROSE_DOTTED_TOKEN = new RegExp(
  `^(?:\\p{L}*\\p{Ll}{2}\\.(?:${STARTERS})|[pP]\\.ej?)$`,
  "u",
);

/**
 * 'Dijo " sí".' -> 'Dijo "sí".': no space inside a straight pair. The marks of a line pair up
 * in order, so a line with an odd count, or with a mark after a digit (6" for inches), is
 * left alone.
 */
function quoteSpaces(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const text = ctx.text;
  let lineStart = text.lastIndexOf("\n", ctx.from - 1) + 1;
  while (lineStart < ctx.to) {
    const next = text.indexOf("\n", lineStart);
    const lineEnd = next < 0 ? text.length : next;
    const marks: number[] = [];
    for (let k = text.indexOf('"', lineStart); k >= 0 && k < lineEnd; k = text.indexOf('"', k + 1))
      marks.push(k);
    const usable =
      marks.length >= 2 &&
      marks.length % 2 === 0 &&
      !marks.some((k) => /\d/.test(text[k - 1] ?? ""));
    for (let p = 0; usable && p < marks.length; p += 2) {
      const [open, close] = [marks[p], marks[p + 1]];
      const inner = text.slice(open + 1, close);
      if (!inner.trim() || inner.length > 200 || namedExampleBefore(text, open)) continue;
      const lead = /^[ \t ]+(?=[\p{L}\p{N}¿¡])/u.exec(inner)?.[0].length ?? 0;
      const trail = /(?<=[\p{L}\p{N}.!?…])[ \t ]+$/u.exec(inner)?.[0].length ?? 0;
      if (lead && open >= ctx.from && open < ctx.to)
        findings.push({
          ruleId: "commaPeriodSpacing",
          messageKey: "review_msg_space_after_opening_mark",
          range: { start: open, end: open + 1 + lead },
          alternatives: ['"'],
          context: { start: open, end: close + 1 },
          bulkBlock: "context-dependent",
        });
      if (trail && close >= ctx.from && close < ctx.to)
        findings.push({
          ruleId: "commaPeriodSpacing",
          messageKey: "review_msg_space_before_mark",
          range: { start: close - trail, end: close + 1 },
          alternatives: ['"'],
          context: { start: open, end: close + 1 },
          bulkBlock: "context-dependent",
        });
    }
    lineStart = lineEnd + 1;
  }
  return findings;
}

/** A sentence mark glued to the next sentence: "frase.Y otra" -> "frase. Y otra". */
const missingSpace: MatchFixer = (m, ctx) => {
  // "P.A.Čerenkov", "EE.UU.Hoy": initials and abbreviations stay glued.
  if (/\.\p{L}{1,3}$/u.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))) return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  return {
    ruleId: "commaPeriodSpacing",
    messageKey: "review_msg_space_after_mark",
    range: { start: m.index, end: m.index + m[0].length },
    alternatives: [`${m[0].trim()} `],
    context: { start: Math.max(0, m.index - 16), end: Math.min(ctx.text.length, m.index + 16) },
    bulkBlock: "context-dependent",
  };
};

/** "dijo : ven" -> "dijo: ven", "vino;pero" -> "vino; pero". */
const colonSpacing: MatchFixer = (m, ctx) => {
  // "&nbsp;texto", "a;b" in code: an entity or a token with no space around it.
  const word = /\S*$/u.exec(ctx.text.slice(Math.max(0, m.index - 32), m.index))![0];
  if (namedExampleBefore(ctx.text, m.index) || /[&#=/]/u.test(word)) return null;
  const mark = m[0].trim();
  return {
    ruleId: "commaPeriodSpacing",
    messageKey: m[0].startsWith(";")
      ? "review_msg_space_after_mark"
      : "review_msg_space_before_mark",
    range: { start: m.index, end: m.index + m[0].length },
    alternatives: [m[0].startsWith(";") ? "; " : mark],
    context: { start: Math.max(0, m.index - 16), end: Math.min(ctx.text.length, m.index + 16) },
    bulkBlock: "context-dependent",
  };
};

/**
 * "¿Qué es lo que pasa aquí." -> "aquí?", "¡Qué bonito" -> "bonito!": an opening mark whose
 * sentence ends without a closing one. Either closing mark answers either opening one.
 */
const closingMark: MatchFixer = (m, ctx) => {
  const text = ctx.text;
  const close = m[0] === "¿" ? "?" : "!";
  let end = -1;
  let found = false;
  for (let k = m.index + 1; k < Math.min(text.length, m.index + 400); k++) {
    const c = text[k];
    if (c === "?" || c === "!") {
      found = true;
      break;
    }
    if (c === "¿" || c === "¡" || c === "\n" || c === "￼" || c === "«" || c === '"') {
      end = c === "\n" ? k : -2;
      break;
    }
    // "¿Vino el Sr. García?": a period ends the sentence only before a capital or the end.
    if (
      (c === "." || c === "…") &&
      /^(?:[ \t]+\p{Lu}|[ \t]*(?:\n|$))/u.test(text.slice(k + 1, k + 12))
    ) {
      if (/\p{Lu}\p{Ll}{0,3}$/u.test(text.slice(Math.max(0, k - 5), k))) continue;
      end = k;
      break;
    }
    if (k === text.length - 1) end = text.length;
  }
  if (found || end < 0 || namedExampleBefore(text, m.index)) return null;
  if (end === text.length || text[end] === "\n") {
    // The line ends without a mark: add the closing one after its last word.
    let last = end - 1;
    while (last > m.index && /\s/u.test(text[last])) last--;
    if (!/[\p{L}\p{N}]/u.test(text[last] ?? "")) return null;
    return finding(RULE, "review_msg_spanish_closing_mark", last, last + 1, [
      `${text[last]}${close}`,
    ]);
  }
  if (text[end] === ".")
    return finding(RULE, "review_msg_spanish_closing_mark", end, end + 1, [close]);
  return null;
};

/** "en los años 1930s" -> "1930", "los 80's" -> "80": the decade written invariable. */
const decade: MatchFixer = (m, ctx) => {
  if (m.index < ctx.from || namedExampleBefore(ctx.text, m.index)) return null;
  // "los años 20s y 30s": both decades of a pair.
  const second = m[2] ? m.index + m[0].lastIndexOf(m[2]) : -1;
  const first = /^\d+['’]?s/u.exec(m[0])![0];
  return [
    [m.index, first, m[1]] as const,
    ...(m[2] ? [[second, m[0].slice(second - m.index), m[2]] as const] : []),
  ].map(([start, typed, fixed]) =>
    finding(RULE, "review_msg_spanish_decade", start, start + typed.length, [fixed]),
  );
};

export const PREDICATES = {
  typography,
  isoDates,
  quoteSpaces,
  rangeDash,
} satisfies Record<string, Detector>;

/** The named frame fixes of grammar/rules/es.yaml (`fixer:`). */
export const FIXERS = {
  namedDate,
  noSuchDay,
  numericDate,
  ...MARKS,
  closingMark,
  decade,
  missingSpace,
  colonSpacing,
  dialogueDash: (m, ctx) =>
    namedExampleBefore(ctx.text, m.index) ? null : longDash(ctx, m.index, m.index + m[0].length),
  // "Se fue -¿no?-, y volvió", "Finol –medalla de bronce– ganó": both dashes of the remark.
  remarkDashes: (m, ctx) => {
    if (namedExampleBefore(ctx.text, m.index)) return null;
    const close = m.index + m[0].length - 1;
    return [longDash(ctx, m.index, m.index + 1), longDash(ctx, close, close + 1)].filter(
      (dash): dash is RawFinding => dash !== null,
    );
  },
  decimalPoint,
  exponent,
} satisfies Record<string, MatchFixer>;

/** The named findings filters of grammar/rules/es.yaml (`filter:`). */
export const FILTERS = {
  // A dash may both open a dialogue line and open a remark: one finding for it.
  firstAtStart: (_ctx, findings) => {
    const seen = new Set<number>();
    return findings.filter((f) => !seen.has(f.range.start) && !!seen.add(f.range.start));
  },
} satisfies Record<string, FindingsFilter>;
