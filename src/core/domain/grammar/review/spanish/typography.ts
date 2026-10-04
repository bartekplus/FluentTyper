import { namedExampleBefore } from "../exampleCues";
import { invalidIsoDates } from "../isoDates";
import { EMPHASIS_MARKS } from "../markdownEmphasis";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
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
import {
  contextYear,
  daysInMonth,
  nearestDayOn,
  weekdayOf,
  yearsFor,
  YEAR_DIGITS,
} from "../reviewClock";
import { PREPOSITIONS, verbLike } from "./common";
import { finding } from "../finding";
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

// "31 de abril de 2020", "29 de febrero 2023", "31/11/1988", "30-2-2001", and a weekday before
// a full date ("lunes, 7 de octubre de 2014"). Numeric dates need a four-digit year:
// "30/2" alone is a ratio.
const NAMED_DATE = new RegExp(
  `(?<![\\p{L}\\p{N}.,/-])(?:(${WEEKDAY_LIST.join("|")})(,?[ \\t]+))?(\\d{1,2})(?:[ \\t]+de)?[ \\t]+(${MONTH_NAMES})(?:[ \\t]+(?:de|del)?[ \\t]*(${YEAR_DIGITS}))?(?![\\p{L}\\p{N}])`,
  "giu",
);
// Short month names in numeric dates: "29-feb-2005".
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
// A two-digit year ("31.11.89") or none ("el 31.04.") only where a date goes.
const NUMERIC_DATE = new RegExp(
  `(?<![\\p{N}/.:-])(\\d{1,3})([/.-])(\\d{1,2}|${MONTH_NAMES}|${MONTH_SHORT})(?:\\2(${YEAR_DIGITS}|\\d{2}(?![\\p{N}])))?(?![\\p{N}/:-]|\\.\\p{N}|,\\p{N})`,
  "giu",
);
// "el 32 de enero", "el 0 de abril": a day no month has, after the article a date takes.
const NO_SUCH_DAY = new RegExp(
  `(?<=(?:^|[\\s(])(?:el|del|al|El|Del|Al)[ \\t]{1,8})(00?|3[2-9]|[4-9]\\d|\\d{3})(?:[ \\t]{1,8}de)?[ \\t]{1,8}(?:${MONTH_NAMES})(?![\\p{L}\\p{N}])`,
  "gu",
);

function impossibleDates(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const dayFinding = (start: number, day: string, month: number, year?: number) => {
    const max = daysInMonth(month, year);
    if (Number(day) <= max || Number(day) > 31 || month < 1) return;
    if (namedExampleBefore(ctx.text, start)) return;
    const alternatives = month === 2 && year === undefined ? ["28", "29"] : [String(max)];
    findings.push(
      finding(RULE, "review_msg_spanish_date", start, start + day.length, alternatives, {
        bulkBlock: "ambiguous",
        ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
      }),
    );
  };
  const named = new RegExp(NAMED_DATE);
  named.lastIndex = Math.max(0, ctx.from - 16);
  for (let m = named.exec(ctx.scanText); m && m.index < ctx.to; m = named.exec(ctx.scanText)) {
    const [whole, weekday, gap, day, month, year] = m;
    const dayStart = m.index + (weekday ? weekday.length + gap.length : 0);
    if (dayStart < ctx.from) continue;
    const monthIndex = monthNumber(month);
    const yearNumber = year ? Number(year) : undefined;
    dayFinding(dayStart, day, monthIndex, yearNumber);
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
    if (
      weekday &&
      yearNumber &&
      dayNumber >= 1 &&
      dayNumber <= daysInMonth(monthIndex, yearNumber)
    ) {
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
  }
  const noDay = new RegExp(NO_SUCH_DAY);
  noDay.lastIndex = Math.max(0, ctx.from - 16);
  for (let m = noDay.exec(ctx.scanText); m && m.index < ctx.to; m = noDay.exec(ctx.scanText)) {
    if (m.index < ctx.from || namedExampleBefore(ctx.text, m.index)) continue;
    findings.push(
      finding(RULE, "review_msg_spanish_date", m.index, m.index + m[0].length, [], {
        warningOnly: true,
      }),
    );
  }
  const numeric = new RegExp(NUMERIC_DATE);
  numeric.lastIndex = Math.max(0, ctx.from - 16);
  for (let m = numeric.exec(ctx.scanText); m && m.index < ctx.to; m = numeric.exec(ctx.scanText)) {
    if (m.index < ctx.from) continue;
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
        continue;
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
      if (!(dated || fullDate) || namedExampleBefore(ctx.text, m.index)) continue;
      findings.push(
        finding(RULE, "review_msg_spanish_date", m.index, m.index + m[0].length, [], {
          warningOnly: true,
        }),
      );
      continue;
    }
    if (month < 1 || month > 12) continue;
    // "29.02.89": a two-digit year keeps its leap years ("00" may be 1900 or 2000).
    const year =
      yearText.length === 4
        ? Number(yearText)
        : yearText && yearText !== "00"
          ? 2000 + Number(yearText)
          : undefined;
    dayFinding(m.index, m[1], month, year);
  }
  for (const range of invalidIsoDates(ctx))
    findings.push({
      ruleId: RULE,
      messageKey: "review_msg_spanish_date",
      range,
      alternatives: [],
      warningOnly: true,
    });
  return findings;
}

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
  findings.push(...impossibleDates(ctx));
  // "etc..." and "etc…": the abbreviation ends in one point.
  const etc = /(?<!\p{L})etc(?:\.{2,}|…|\.…)/giu;
  etc.lastIndex = ctx.from;
  for (let m = etc.exec(ctx.scanText); m && m.index < ctx.to; m = etc.exec(ctx.scanText))
    findings.push(
      finding(RULE, "review_msg_spanish_abbreviation", m.index, m.index + m[0].length, [
        `${m[0].slice(0, 3)}.`,
      ]),
    );
  // "uno, dos…etc.": the ellipsis and "etc." say the same; keep one of them.
  const both = /(?:,[ \t]*)?(?:\.{3}|…)[ \t]*etc(?!\p{L})\.?/giu;
  both.lastIndex = ctx.from;
  for (let m = both.exec(ctx.scanText); m && m.index < ctx.to; m = both.exec(ctx.scanText))
    findings.push(
      finding(RULE, "review_msg_spanish_abbreviation", m.index, m.index + m[0].length, [
        ", etc.",
        "…",
      ]),
    );
  return findings;
}

// "2do", "5ta.", "1er": ordinal abbreviations take a period and a raised letter: "2.º", "1.er".
const ORDINAL =
  /(?<![\p{L}\p{N}.,])(\d{1,3})(do|da|ro|ra|to|ta|vo|va|no|na|mo|ma|ero|era|er|r)(\.(?=[ \t]{1,8}\p{Ll}))?(?![\p{L}\p{N}])/gu;
// "5 hrs", "48hrs", "15 h. será", "5grs": unit symbols take no plural and no period.
const UNIT =
  /(?<![\p{L}\p{N}.,])(\d+(?:[.,:]\d+)?)([ \t]?)(hrs|hr|hs|HRS|HS|grs|gr|GRS|h)(\.(?=[ \t]{1,8}\p{Ll}))?(?![\p{L}\p{N}])/gu;
// Verbs of saying after a dialogue line: "Ven -dijo." uses the long dash.
const SAYING =
  "dijo|dije|dice|digo|respondió|contestó|preguntó|añadió|exclamó|gritó|susurró|murmuró|explicó|comentó|replicó|insistió|pensó|repuso|admitió|aclaró";
const DIALOGUE = new RegExp(
  `(?<=[\\p{L}.,!?…][ \\t]?)[-–‒](?=(?:${SAYING})(?![\\p{L}]))|(?<=^|\\n)[-–‒](?=[¿¡]|\\p{Lu}\\p{Ll})|(?<=[ \\t]|^)--(?=[ \\t]|$)`,
  "gu",
);

/** Ordinal and unit abbreviations and the dialogue dash, written the Spanish way. */
function marks(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const scan = (
    regex: RegExp,
    fix: (m: RegExpExecArray) => string | null,
    key: RawFinding["messageKey"],
  ) => {
    regex.lastIndex = Math.max(0, ctx.from - 8);
    for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
      if (m.index < ctx.from || namedExampleBefore(ctx.text, m.index)) continue;
      const replacement = fix(m);
      if (!replacement || replacement === m[0]) continue;
      findings.push(finding(RULE, key, m.index, m.index + m[0].length, [replacement]));
    }
  };
  scan(
    new RegExp(ORDINAL),
    ([, n, suffix]) =>
      /^e?r$/u.test(suffix) ? `${n}.er` : `${n}.${suffix.endsWith("a") ? "ª" : "º"}`,
    "review_msg_spanish_ordinal",
  );
  scan(
    new RegExp(UNIT),
    (m) => {
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
    },
    "review_msg_spanish_unit",
  );
  // "25ºC", "1 ºC": a degree sign, not the ordinal o, and a space before it ("3º C" is a
  // floor and a door).
  scan(new RegExp(ORDINAL_DEGREE), ([, n, unit]) => `${n} °${unit}`, "review_msg_spanish_unit");
  // "n° 18", "n°18": the number sign is "n.º", with the raised o, not a degree.
  scan(new RegExp(NUMBER_SIGN), ([, n]) => `${n}.º `, "review_msg_spanish_ordinal");
  // "el Sr García", "en el núm 25": an abbreviation before a name or a number takes its period.
  scan(
    new RegExp(BARE_ABBREVIATION),
    ([abbreviation]) => `${abbreviation}.`,
    "review_msg_spanish_abbreviation_period",
  );
  // "2000euros", "5000habitantes": a number glued to the noun it counts.
  scan(
    new RegExp(GLUED_COUNT),
    ([, n, noun]) => (isNoun(noun) && noun.endsWith("s") ? `${n} ${noun}` : null),
    "review_msg_spanish_number_space",
  );
  // "LA semana pasada", "EL 2 de diciembre": an article in capitals opening a sentence of
  // lowercase words.
  scan(
    new RegExp(SHOUTED_ARTICLE),
    ([article]) => `${article[0]}${article.slice(1).toLowerCase()}`,
    "review_msg_spanish_capital_article",
  );
  // "rojo, azul, etc", "el s XVIII", "N.I.F", "J. K Rowling": the abbreviation's period.
  scan(new RegExp(BARE_ETC), ([etc]) => `${etc}.`, "review_msg_spanish_abbreviation_period");
  scan(
    new RegExp(BARE_CENTURY),
    (m) =>
      /(?:^|[.!?][ \t]{1,8})$/u.test(ctx.text.slice(Math.max(0, m.index - 9), m.index))
        ? `${m[0]}.`
        : "s.",
    "review_msg_spanish_abbreviation_period",
  );
  scan(
    new RegExp(OPEN_INITIALS),
    ([initials]) => `${initials}.`,
    "review_msg_spanish_abbreviation_period",
  );
  // "p.ej.", "nº 18", "pag 4", "telf 666": the standard forms "p. ej.", "n.º", "pág.", "tel.".
  scan(new RegExp(FOR_EXAMPLE), ([, p]) => `${p}. ej.`, "review_msg_spanish_abbreviation_form");
  scan(
    new RegExp(PLAIN_ABBREVIATION),
    ([typed, word]) => {
      const fix = `${ABBREVIATION_FORMS[word.toLowerCase()]}${typed.includes(":") ? ":" : ""} `;
      return /^\p{Lu}/u.test(word) ? fix[0].toUpperCase() + fix.slice(1) : fix;
    },
    "review_msg_spanish_abbreviation_form",
  );
  // "el 9° clasificado", "la 2° edición": a degree sign for the ordinal's raised letter.
  scan(
    new RegExp(DEGREE_ORDINAL),
    ([, article, n, next]) =>
      PREPOSITIONS.has(next) || NOT_ORDINAL_AFTER.test(next)
        ? null
        : `${n}.${/^la$/iu.test(article) ? "ª" : "º"}`,
    "review_msg_spanish_ordinal",
  );
  // "del '90", "los años '71": a shortened year takes no apostrophe.
  scan(new RegExp(YEAR_APOSTROPHE), ([, year]) => year, "review_msg_spanish_year_apostrophe");
  // "la sra. García": abbreviations of address take a capital.
  scan(
    new RegExp(LOWER_TREATMENT),
    ([word]) => word[0].toUpperCase() + word.slice(1),
    "review_msg_spanish_treatment_capital",
  );
  // "Sí sí, ven": a repeated "sí" or "no" takes a comma between.
  scan(
    new RegExp(REPEATED_ANSWER),
    ([, a, b, c, d]) => `${a ?? c}, ${b ?? d}`,
    "review_msg_spanish_repeated_answer",
  );
  return findings;
}

const BARE_ETC = /(?<![\p{L}\p{N}.])etc(?![\p{L}\p{N}.…])/giu;
const ROMAN = "(?:X{1,2}(?:IX|IV|V?I{0,3})|IX|IV|V?I{1,3}|V)";
const BARE_CENTURY = new RegExp(
  `(?<=(?:^|[\\s(])(?:el|del|al|los|en|El|Del|Al|Los|En)[ \\t]{1,8}|^|[.!?][ \\t]{1,8})[sS](?=[ \\t]{1,8}${ROMAN}(?![\\p{L}\\p{N}]))`,
  "gu",
);
// "N.I.F", "D.C", "S. A,": the last letter of dotted initials lost its period. A lone "A", "E",
// "O", "U" or "Y" may be a word opening the next sentence.
const OPEN_INITIALS =
  /(?<![\p{L}\p{N}.])(?:\p{Lu}\.){1,5}\p{Lu}(?![\p{L}\p{N}.\-/@_])|(?<=(?<![\p{L}\p{N}.])\p{Lu}\.[ \t])(?:[B-DF-NP-TV-XZ](?=[ \t]\p{Lu}\p{Ll})|\p{Lu}(?=,))/gu;
const FOR_EXAMPLE =
  /(?<![\p{L}\p{N}.])([pP])(?:[ \t]?\.[ \t]?e(?:j[ \t]?)?|[ \t]ej[ \t]?)\.(?![\p{L}\p{N}])/gu;
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
const PLAIN_ABBREVIATION =
  /(?<![\p{L}\p{N}.])(nº|n\.°|num|pag|pags|telf|tlf|tlfn)\.?:?[ \t]?(?=\p{N})/giu;
const DEGREE_ORDINAL =
  /(?<=(?:^|[\s(])(el|la|del|al|El|La|Del|Al)[ \t]{1,8})(\d{1,3})[ \t]?°(?=[ \t]{1,8}(\p{Ll}+))/gu;
const NOT_ORDINAL_AFTER = /^(?:cent|fahr|kel|grad|norte|sur|este|oeste|latitud|longitud|bajo)/u;
const YEAR_APOSTROPHE =
  /(?:(?<=(?:^|[\s(])(?:del|el|los|años|década|en)[ \t]{1,8})|(?<=['’‘]\d\d[—–-]))['’‘](\d\d)(?![\p{L}\p{N}'’])/giu;
const LOWER_TREATMENT =
  /(?<![\p{L}\p{N}.])(?:sr|sra|srta|sres|sras|dr|dra)\.(?=[ \t]\p{Lu}\p{Ll})/gu;
const REPEATED_ANSWER =
  /(?<=(?:^|[.!?¡¿\n])[ \t]{0,8})(?:(Sí|sí|SÍ)[ \t]+(sí|SÍ)|(No|no|NO)[ \t]+(no|NO))(?=[ \t]*[,.!?])/gu;

// A degree sign right after a lowercase "n" ("n° 18"); "N° 54" heads forms and is left alone.
const ORDINAL_DEGREE = /(?<![\p{L}\p{N}.,])(\p{N}+(?:[.,]\p{N}+)?)[ \t]?º([CF])(?![\p{L}\p{N}])/gu;
const NUMBER_SIGN = /(?<![\p{L}\p{N}])(n)[ \t]?°[ \t]?(?=\p{N})/gu;
const BARE_ABBREVIATION =
  /(?<![\p{L}\p{N}.])(?:(?:Sr|Sra|Srta|Dr|Dra|Avda|Av|Lic|Ing|Prof|Mr|Mrs)(?=[ \t]\p{Lu}\p{Ll})|(?:núm|pág|págs)(?=[ \t]\p{N}))(?![.\p{L}])/gu;
const GLUED_COUNT = /(?<![\p{L}\p{N}.,])(\p{N}+(?:[.,]\p{N}{3})*)(\p{Ll}{4,})(?![\p{L}\p{N}])/gu;
const SHOUTED_ARTICLE =
  /(?<=(?:^|[.!?¡¿][ \t]{0,8}|\n))(?:EL|LA|LOS|LAS|UN|UNA|UNOS|UNAS|NO|ES|SE|LO|YO|HAY|YA|MUY|ESTE|ESTA|ESTO|ESO)(?=[ \t]{1,8}(?:\p{N}+[ \t]{1,8})?\p{Ll}\p{Ll})/gu;

/** "Ven -dijo.", "-¿Perdón?": the dialogue dash, an optional typography check like the dash. */
function dialogueDash(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "es")) return [];
  const findings: RawFinding[] = [];
  const seen = new Set<number>();
  const add = (start: number, end: number) => {
    if (start < ctx.from || start >= ctx.to || seen.has(start)) return;
    seen.add(start);
    findings.push(finding("emdashShortcut", "review_msg_spanish_dialogue_dash", start, end, ["—"]));
  };
  const regex = new RegExp(DIALOGUE);
  regex.lastIndex = Math.max(0, ctx.from - 8);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText))
    if (!namedExampleBefore(ctx.text, m.index)) add(m.index, m.index + m[0].length);
  // "Se fue -¿no?-, y volvió", "Finol –medalla de bronce– ganó": a remark set off by a pair
  // of hyphens or en dashes, open after a space and closed before a space or a mark.
  const inciso = new RegExp(INCISO);
  inciso.lastIndex = Math.max(0, ctx.from - 160);
  for (let m = inciso.exec(ctx.scanText); m && m.index < ctx.to; m = inciso.exec(ctx.scanText)) {
    if (namedExampleBefore(ctx.text, m.index)) continue;
    add(m.index, m.index + 1);
    const close = m.index + m[0].length - 1;
    add(close, close + 1);
  }
  return findings;
}
const INCISO = /(?<=[ \t])[-–](?=[\p{L}¿¡])[^-–\n]{0,150}?[\p{L}\p{N}?!.…][-–](?=[ \t,.;:)]|$)/gu;

// "páginas 10-15", "1990-1995": two numbers joined by a hyphen. A dash, colon, slash or digit
// group after the second number makes a date, a phone number or a code ("12-05-2020").
const NUMBER_PAIR = /(?<![\p{L}\p{N}.,:/#+–—-])(\d+)[-—](\d+)(?![\p{L}\p{N}_]|[-–—/:.,]\p{N})/gu;
// A label that makes the pair a phone number, a postal code, an ID or a reference.
const CODE_BEFORE =
  /(?:^|[\s(])(?:tel|teléf|tfno|tlf|teléfono|móvil|fax|whatsapp|c\.?p|código|cód|n\.?º|núm|número|ref|referencia|expediente|exp|lote|pedido|factura|matrícula|dni|nie|nif|cif|cuenta|iban|tarjeta|art|artículo|ley|decreto|modelo|versión|vuelo|línea|ruta)\.?:?(?:[ \t]{1,8}(?:es|era|será))?[ \t]{0,8}$/iu;
// A result: "ganó 3-1", "empataron 2-2", "el marcador 1-2".
const SCORE_BEFORE =
  /(?:^|\s)(?:gan\p{L}*|perd\p{L}*|venc\p{L}*|empat\p{L}*|derrot\p{L}*|golea\p{L}*|marcador|resultado|partido|set|sets|tanteo)[ \t]{1,8}(?:\p{L}+[ \t]{1,8}){0,2}$/iu;
const isYear = (n: string) => /^(?:1\d{3}|20\d\d)$/u.test(n);

/** "las páginas 10-15" -> "10–15": an ascending range of numbers takes an en dash, opt-in. */
function rangeDash(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "es")) return [];
  const findings: RawFinding[] = [];
  const regex = new RegExp(NUMBER_PAIR);
  regex.lastIndex = Math.max(0, ctx.from - 8);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    const [whole, a, b] = m;
    if (m.index < ctx.from || namedExampleBefore(ctx.text, m.index)) continue;
    // "2014-15" is a season; any other pair must go up: "3-1" is a score, "15-6" a date.
    const season = isYear(a) && b.length === 2 && Number(b) === (Number(a) + 1) % 100;
    if (!season && Number(b) <= Number(a)) continue;
    // Phone numbers and long codes: "915-5512", "28001-12", "0034-600", "12345-6789".
    if (/^0/u.test(a) || /^0/u.test(b) || a.length > 4 || b.length > 4) continue;
    if (a.length === 3 && b.length === 4) continue;
    const before = ctx.text.slice(Math.max(0, m.index - 40), m.index);
    if (CODE_BEFORE.test(before)) continue;
    if (a.length <= 2 && b.length <= 2 && SCORE_BEFORE.test(before)) continue;
    const at = m.index + a.length;
    findings.push(
      finding("emdashShortcut", "review_msg_range_dash", at, at + 1, ["–"], {
        context: { start: m.index, end: m.index + whole.length },
      }),
    );
  }
  return findings;
}

// spanishTypographyStyle (opt-in): the decimal comma Spain writes ("9,5 kg", "21.999.349,56").
const UNIT_AFTER =
  "[ \\t\\u00a0]?(?:%|‰|€|\\$|kg|g|mg|km|m|cm|mm|ml|l|t|°|°C|ºC|m²|m³|km²|ha|kWh|kW|W|V|GB|MB|TB|Hz|kHz|MHz|GHz|kilos?|metros?|litros?|euros?|dólares|grados|millones)(?![\\p{L}\\p{N}])";
// "9,349.5", "21,999,349": English digit groups, with a decimal point or with two commas.
const ENGLISH_GROUPS =
  /(?<![\p{N}.,])\d{1,3}(?:(?:,\d{3})+\.\d{1,3}|(?:,\d{3}){2,})(?![\p{N}]|[.,]\p{N})/gu;
// "1.4 kg", "9349.5", "1 999 349.56": a decimal point before a unit, after four digits or
// closing a group spaced by thousands. "a las 9.30", "versión 2.5" and "3.2.1" stay.
const DECIMAL_POINT = new RegExp(
  `(?<![\\p{N}.,])(?:\\d{1,3}(?: \\d{3})+|\\d{4,}|\\d{1,3}(?=\\.\\d{1,2}${UNIT_AFTER}))\\.\\d{1,2}(?![\\p{N}]|[.,]\\p{N})`,
  "gu",
);

/** "Pesa 1.4 kg" -> "1,4 kg", "9,349.5" -> "9.349,5": the Spanish decimal comma. */
function decimalComma(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "es")) return [];
  const findings: RawFinding[] = [];
  for (const pattern of [ENGLISH_GROUPS, DECIMAL_POINT]) {
    const regex = new RegExp(pattern);
    regex.lastIndex = Math.max(0, ctx.from - 32);
    for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
      if (m.index < ctx.from || namedExampleBefore(ctx.text, m.index)) continue;
      findings.push({
        ruleId: "spanishTypographyStyle",
        messageKey: "review_msg_spanish_decimal",
        range: { start: m.index, end: m.index + m[0].length },
        alternatives: [m[0].replace(/[.,]/gu, (c) => (c === "." ? "," : "."))],
      });
    }
  }
  // "30 km2", "por m3": a unit's exponent is a superscript.
  const power = new RegExp(EXPONENT);
  power.lastIndex = Math.max(0, ctx.from - 8);
  for (let m = power.exec(ctx.scanText); m && m.index < ctx.to; m = power.exec(ctx.scanText)) {
    if (m.index < ctx.from || namedExampleBefore(ctx.text, m.index)) continue;
    const start = m.index + m[0].length - 1;
    findings.push({
      ruleId: "spanishTypographyStyle",
      messageKey: "review_msg_typographic_symbol",
      range: { start, end: start + 1 },
      alternatives: [m[0].endsWith("2") ? "²" : "³"],
    });
  }
  return findings;
}
const EXPONENT = /(?<=(?:\d[ \t\u00a0]?|\bpor[ \t]|\/))(?:km|cm|mm|dm|m)[23](?![\p{L}\p{N}])/gu;

// Words that open a Spanish sentence and never a dotted name's next part ("frase.Y otra").
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
// "frase.Y otra", "así?Siempre", "Ven.¿Como…?", "así…siempre", and "así .Siempre" with the
// space on the wrong side. Lowercase only after "…": "archivo .txt" and "web?id" are not prose.
const MISSING_SPACE = new RegExp(
  `(?<=\\p{L}\\p{Ll})(?:\\.(?=(?:${STARTERS})(?![\\p{L}\\p{N}])|[¿¡])|[?!](?=[¿¡]|\\p{Lu}\\p{Ll})|…(?=[¿¡]|\\p{L}))|(?<=\\p{L})[ \\t]+(?:[.?!]|…)(?=[¿¡]|\\p{Lu}\\p{Ll})`,
  "gu",
);

/** A sentence mark glued to the next sentence: "frase.Y otra" -> "frase. Y otra". */
function missingSpace(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "es")) return [];
  const findings: RawFinding[] = [];
  const regex = new RegExp(MISSING_SPACE);
  regex.lastIndex = ctx.from;
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    // "P.A.Čerenkov", "EE.UU.Hoy": initials and abbreviations stay glued.
    if (/\.\p{L}{1,3}$/u.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))) continue;
    if (namedExampleBefore(ctx.text, m.index)) continue;
    findings.push({
      ruleId: "commaPeriodSpacing",
      messageKey: "review_msg_space_after_mark",
      range: { start: m.index, end: m.index + m[0].length },
      alternatives: [`${m[0].trim()} `],
      context: { start: Math.max(0, m.index - 16), end: Math.min(ctx.text.length, m.index + 16) },
      bulkBlock: "context-dependent",
    });
  }
  // "dijo : ven" -> "dijo: ven", "vino;pero" -> "vino; pero": Spanish sets no space before a
  // colon or a semicolon, and one after a semicolon between words.
  const colon = new RegExp(COLON_SPACING);
  colon.lastIndex = ctx.from;
  for (let m = colon.exec(ctx.scanText); m && m.index < ctx.to; m = colon.exec(ctx.scanText)) {
    // "&nbsp;texto", "a;b" in code: an entity or a token with no space around it.
    const word = /\S*$/u.exec(ctx.text.slice(Math.max(0, m.index - 32), m.index))![0];
    if (namedExampleBefore(ctx.text, m.index) || /[&#=/]/u.test(word)) continue;
    const mark = m[0].trim();
    findings.push({
      ruleId: "commaPeriodSpacing",
      messageKey: m[0].startsWith(";")
        ? "review_msg_space_after_mark"
        : "review_msg_space_before_mark",
      range: { start: m.index, end: m.index + m[0].length },
      alternatives: [m[0].startsWith(";") ? "; " : mark],
      context: { start: Math.max(0, m.index - 16), end: Math.min(ctx.text.length, m.index + 16) },
      bulkBlock: "context-dependent",
    });
  }
  return findings;
}
const COLON_SPACING = /(?<=\p{L})[ \t]+[:;](?=[ \t]|$)|(?<=\p{L}\p{Ll});(?=\p{Ll}{2})/gmu;

/**
 * "¿Qué es lo que pasa aquí." -> "aquí?", "¡Qué bonito" -> "bonito!": an opening mark whose
 * sentence ends without a closing one. Either closing mark answers either opening one.
 */
function closingMarks(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const text = ctx.text;
  const opening = /[¿¡]/gu;
  opening.lastIndex = ctx.from;
  for (let m = opening.exec(text); m && m.index < ctx.to; m = opening.exec(text)) {
    const close = m[0] === "¿" ? "?" : "!";
    let end = -1;
    let found = false;
    for (let k = m.index + 1; k < Math.min(text.length, m.index + 400); k++) {
      const c = text[k];
      if (c === "?" || c === "!") {
        found = true;
        break;
      }
      if (c === "¿" || c === "¡" || c === "\n" || c === "\uFFFC" || c === "«" || c === '"') {
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
    if (found || end < 0 || namedExampleBefore(text, m.index)) continue;
    if (end === text.length || text[end] === "\n") {
      // The line ends without a mark: add the closing one after its last word.
      let last = end - 1;
      while (last > m.index && /\s/u.test(text[last])) last--;
      if (!/[\p{L}\p{N}]/u.test(text[last] ?? "")) continue;
      findings.push(
        finding(RULE, "review_msg_spanish_closing_mark", last, last + 1, [`${text[last]}${close}`]),
      );
    } else if (text[end] === ".") {
      findings.push(finding(RULE, "review_msg_spanish_closing_mark", end, end + 1, [close]));
    }
  }
  return findings;
}

// "los años 1930s", "los 80's": a decade takes no plural ending in Spanish.
const DECADE =
  /(?<=(?<![\p{L}])(?:años|los)[ \t]{1,4})((?:1[0-9]|20)?[0-9]0)(?:['’]s|s)(?:[ \t]+y[ \t]+((?:1[0-9]|20)?[0-9]0)(?:['’]s|s))?(?![\p{L}\p{N}])/giu;

/** "en los años 1930s" -> "1930", "los 80's" -> "80": the decade written invariable. */
function decades(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const regex = new RegExp(DECADE);
  regex.lastIndex = Math.max(0, ctx.from - 8);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    if (m.index < ctx.from || namedExampleBefore(ctx.text, m.index)) continue;
    // "los años 20s y 30s": both decades of a pair.
    const second = m[2] ? m.index + m[0].lastIndexOf(m[2]) : -1;
    const first = /^\d+['’]?s/u.exec(m[0])![0];
    for (const [start, typed, fixed] of [
      [m.index, first, m[1]],
      ...(m[2] ? [[second, m[0].slice(second - m.index), m[2]] as const] : []),
    ] as const)
      findings.push(
        finding(RULE, "review_msg_spanish_decade", start, start + typed.length, [fixed]),
      );
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [RULE],
    detect: (ctx) =>
      isLang(ctx, "es")
        ? [...typography(ctx), ...marks(ctx), ...closingMarks(ctx), ...decades(ctx)]
        : [],
  },
  { rules: ["commaPeriodSpacing"], detect: missingSpace },
  { rules: ["emdashShortcut"], detect: (ctx) => [...dialogueDash(ctx), ...rangeDash(ctx)] },
  { rules: ["spanishTypographyStyle"], detect: decimalComma },
];
