import { afterEach, describe, expect, test } from "bun:test";
import { contextYear } from "../../src/core/domain/grammar/review/reviewClock";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";
import { restoreReviewDay } from "../reviewTestClock";
import { ALL_RULES, scan as reviewScan } from "./reviewHarness";

// One matrix of date edge cases for en, de, fr, es, pt, pl and ar. All sentences are our own.
// The test clock is 3 October 2026 (tests/reviewTestClock.ts).

afterEach(restoreReviewDay);

const scan = (text: string, lang: string): ReviewDiagnostic[] =>
  reviewScan(text, { lang, enabledRules: ALL_RULES });

interface Language {
  /** A sentence with a date cue word before the date. */
  cue: string;
  /** A sentence with no cue word: the date starts the sentence. */
  plain: string;
  /** A sentence with a version word before the value. */
  version: string;
  /** A date with a written month: April. */
  written: (day: string, year: string) => string;
  /** A date with a written month and no year: April. */
  noYear: (day: string) => string;
  /** The message of an impossible date. */
  impossible: string;
}

const LANGUAGES: Record<string, Language> = {
  en_US: {
    cue: "We met on {D}.",
    plain: "{D} was a long day.",
    version: "Install version {D} now.",
    written: (day, year) => `${day} April ${year}`,
    noYear: (day) => `${day} April`,
    impossible: "review_msg_impossible_date",
  },
  de_DE: {
    cue: "Wir trafen uns am {D}.",
    plain: "{D} war ein langer Tag.",
    version: "Installiere Version {D} jetzt.",
    written: (day, year) => `${day}. April ${year}`,
    noYear: (day) => `${day}. April`,
    impossible: "review_msg_german_invalid_date",
  },
  fr_FR: {
    cue: "On s'est vus le {D}.",
    plain: "{D} était une longue journée.",
    version: "Installez la version {D} ce soir.",
    written: (day, year) => `${day} avril ${year}`,
    noYear: (day) => `${day} avril`,
    impossible: "review_msg_fr_date",
  },
  es_ES: {
    cue: "Nos vimos el {D}.",
    plain: "{D} fue un día largo.",
    version: "Instale la versión {D} ahora.",
    written: (day, year) => `${day} de abril de ${year}`,
    noYear: (day) => `${day} de abril`,
    impossible: "review_msg_spanish_date",
  },
  pt_BR: {
    cue: "A data é {D}.",
    plain: "{D} foi um dia longo.",
    version: "Baixe a versão {D} agora.",
    written: (day, year) => `${day} de abril de ${year}`,
    noYear: (day) => `${day} de abril`,
    impossible: "review_msg_pt_invalid_date",
  },
  pl_PL: {
    cue: "Spotkaliśmy się dnia {D}.",
    plain: "{D} był długim dniem.",
    version: "Zainstaluj wersję {D} teraz.",
    written: (day, year) => `${day} kwietnia ${year}`,
    noYear: (day) => `${day} kwietnia`,
    impossible: "review_msg_pl_impossible_date",
  },
  ar_SA: {
    cue: "التقينا بتاريخ {D}.",
    plain: "{D} كان يوما طويلا.",
    version: "حمّل الإصدار {D} الآن.",
    written: (day, year) => `${day} أبريل ${year}`,
    noYear: (day) => `${day} أبريل`,
    impossible: "review_msg_arabic_impossible_date",
  },
};

type Expected = "flag" | "silent";
// [case id, the date, the result with a cue word and with no cue word]
const CASES: [string, (l: Language) => string, Expected][] = [
  // An impossible day (32).
  ["day 32, dotted", () => "32.04.2020", "flag"],
  ["day 32, slash", () => "32/04/2020", "flag"],
  ["day 32, written", (l) => l.written("32", "2020"), "flag"],
  // An impossible month (13).
  ["month 13, dotted", () => "15.13.2020", "flag"],
  ["month 13, slash", () => "15/13/2020", "flag"],
  // A zero day or month.
  ["day 0, dotted", () => "0.5.2020", "flag"],
  ["day 00, dotted", () => "00.05.2020", "flag"],
  ["day 0, slash", () => "0/5/2020", "flag"],
  ["day 0, written", (l) => l.written("0", "2020"), "flag"],
  ["month 0, dotted", () => "1.0.2020", "flag"],
  ["month 00, dotted", () => "01.00.2020", "flag"],
  ["month 0, slash", () => "1/0/2020", "flag"],
  // A real date.
  ["a real date, dotted", () => "30.04.2020", "silent"],
  ["a real date, slash", () => "30/04/2020", "silent"],
  ["a real date, written", (l) => l.written("30", "2020"), "silent"],
  // The years 0099, 1500 and 2200: April has 30 days in each of them.
  ["year 0099, dotted", () => "31.04.0099", "flag"],
  ["year 0099, slash", () => "31/04/0099", "flag"],
  ["year 0099, written", (l) => l.written("31", "0099"), "flag"],
  ["year 1500, dotted", () => "31.04.1500", "flag"],
  ["year 1500, slash", () => "31/04/1500", "flag"],
  ["year 1500, written", (l) => l.written("31", "1500"), "flag"],
  ["year 2200, dotted", () => "31.04.2200", "flag"],
  ["year 2200, slash", () => "31/04/2200", "flag"],
  ["year 2200, written", (l) => l.written("31", "2200"), "flag"],
  ["a real date in 2200, written", (l) => l.written("30", "2200"), "silent"],
  // A written month and no year.
  ["day 0, written, no year", (l) => l.noYear("0"), "flag"],
  ["day 31, written, no year", (l) => l.noYear("31"), "flag"],
  ["a real date, written, no year", (l) => l.noYear("30"), "silent"],
];

// The cases that intentionally stay silent, as "case id / cue" or "case id / plain", with
// the reason.
const SLASH_FORMS = [
  "day 32, slash",
  "month 13, slash",
  "day 0, slash",
  "month 0, slash",
  "year 0099, slash",
  "year 1500, slash",
  "year 2200, slash",
];
const OUT_OF_RANGE_DOTTED = [
  "day 32, dotted",
  "month 13, dotted",
  "day 0, dotted",
  "day 00, dotted",
  "month 0, dotted",
  "month 00, dotted",
];
const both = (ids: string[]) => ids.flatMap((id) => [`${id} / cue`, `${id} / plain`]);
const plain = (ids: string[]) => ids.map((id) => `${id} / plain`);
// In English, German, French and Spanish, day 0 with a written month and no year is a date
// only after a date cue ("on 0 April", "am 0. April", "le 0 avril", "el 0 de abril"). With no
// cue, "0 April" can be a count or a label.
const ZERO_DAY_NO_CUE = { "day 0, written, no year / plain": "day 0 with no year needs a cue" };
const KEPT: Record<string, Record<string, string>> = {
  en_US: ZERO_DAY_NO_CUE,
  // German and Polish write a numeric date with dots. Their date checks do not read a slash
  // form, and "32/04/2020" in German or Polish text is more often a code or a ratio.
  de_DE: {
    ...Object.fromEntries(both(SLASH_FORMS).map((key) => [key, "German dates use dots"])),
    ...ZERO_DAY_NO_CUE,
  },
  pl_PL: Object.fromEntries(both(SLASH_FORMS).map((key) => [key, "Polish dates use dots"])),
  // French and Spanish write a numeric date with slashes. With no "le", "du" or "au" ("el",
  // "del" or "al" in Spanish), a dotted value with a part out of range can be a version or a
  // code ("1.45.2020"). After the cue word, it gets the warning.
  fr_FR: {
    ...Object.fromEntries(
      plain(OUT_OF_RANGE_DOTTED).map((key) => [key, "a dotted value needs a cue word"]),
    ),
    ...ZERO_DAY_NO_CUE,
  },
  es_ES: {
    ...Object.fromEntries(
      plain(OUT_OF_RANGE_DOTTED).map((key) => [key, "a dotted value needs a cue word"]),
    ),
    ...ZERO_DAY_NO_CUE,
  },
  // A dotted value with a part above 31 and no date cue can be a version ("2.45.2020").
  // After a date cue ("A data é 32.04.2020"), it gets the warning.
  pt_BR: { "day 32, dotted / plain": "a part above 31 needs a date cue" },
};

/** True when a finding with the impossible-date message covers part of `date` in `text`. */
function flagged(text: string, date: string, lang: string): boolean {
  const start = text.indexOf(date);
  const end = start + date.length;
  return scan(text, lang).some(
    (d) =>
      d.messageKey === LANGUAGES[lang].impossible && d.range.start >= start && d.range.end <= end,
  );
}

const ROWS = Object.entries(LANGUAGES).flatMap(([lang, l]) =>
  CASES.flatMap(([id, date, expected]) =>
    (["cue", "plain"] as const).map((context): [string, string, string, string, Expected] => {
      const key = `${id} / ${context}`;
      const result = KEPT[lang]?.[key] ? "silent" : expected;
      return [lang, key, l[context].replace("{D}", date(l)), date(l), result];
    }),
  ),
);

describe("an impossible date in each language", () => {
  test.each(ROWS)("%s: %s", (lang, _, text, date, expected) => {
    expect(flagged(text, date, lang)).toBe(expected === "flag");
  });

  test("each intentionally silent case is in the matrix", () => {
    const keys = new Set(ROWS.map(([lang, key]) => `${lang}: ${key}`));
    for (const [lang, kept] of Object.entries(KEPT))
      for (const key of Object.keys(kept)) expect(keys.has(`${lang}: ${key}`)).toBe(true);
  });
});

// A version word before the value: it stays technical and gets no date finding.
const VERSION_ROWS = Object.entries(LANGUAGES).flatMap(([lang, l]) =>
  CASES.filter(([id]) => !id.includes("written")).map(([id, date]): [string, string, string] => [
    lang,
    id,
    l.version.replace("{D}", date(l)),
  ]),
);

describe("a version word before the date", () => {
  test.each(VERSION_ROWS)("%s: %s stays silent", (lang, _, text) => {
    expect(scan(text, lang).filter((d) => /date|weekday/.test(d.messageKey))).toEqual([]);
  });
});

// A year in an earlier sentence. 18 March was a Sunday in 1990. It is a Wednesday in 2026 and a
// Thursday in 2027. The earlier sentence ends with a short name or a number: the year does not
// count, so the weekday gets the no-year finding. A stop after an abbreviation does not end
// the sentence: the year counts, so the weekday is correct.
// [lang, ends with a short name, ends with a number, an abbreviation in the same sentence]
const NO_YEAR = "review_msg_weekday_no_year";
const EARLIER_SENTENCE: [string, string, string, string][] = [
  [
    "en_US",
    "The company began in 1990 with Tom. Sunday, March 18 is our next meeting.",
    "The company began in 1990 and employed 10. Sunday, March 18 is our next meeting.",
    "In 1990 Prof. Smith met us on Sunday, March 18.",
  ],
  [
    "de_DE",
    "Die Firma begann 1990 mit Udo. Das nächste Treffen ist am Sonntag, den 18. März.",
    "Die Firma begann 1990 mit 10. Das nächste Treffen ist am Sonntag, den 18. März.",
    "Im Jahr 1990 traf uns Prof. Weber am Sonntag, den 18. März.",
  ],
  [
    "fr_FR",
    "L'entreprise a ouvert en 1990 avec Léo. La réunion est le dimanche 18 mars.",
    "L'entreprise a ouvert en 1990 avec 10. La réunion est le dimanche 18 mars.",
    "En 1990, Mme. Martin nous a vus le dimanche 18 mars.",
  ],
  [
    "es_ES",
    "La empresa abrió en 1990 con Ana. La próxima reunión es el domingo 18 de marzo.",
    "La empresa abrió en 1990 con 10. La próxima reunión es el domingo 18 de marzo.",
    "En 1990, la Sra. García nos vio el domingo 18 de marzo.",
  ],
  [
    "pt_BR",
    "A empresa abriu em 1990 com Ana. A próxima reunião é no domingo, 18 de março.",
    "A empresa abriu em 1990 com 10. A próxima reunião é no domingo, 18 de março.",
    "Em 1990, o Prof. Silva nos viu no domingo, 18 de março.",
  ],
  [
    "pl_PL",
    "Firma powstała w 1990 roku z Olą. Następne spotkanie: niedziela, 18 marca.",
    "Firma powstała w 1990 roku i zatrudniała 10. Następne spotkanie: niedziela, 18 marca.",
    "W 1990 roku prof. Nowak był u nas w niedzielę, 18 marca.",
  ],
  [
    "ar_SA",
    "تأسست الشركة عام 1990 مع علي. الاجتماع القادم يوم الأحد 18 مارس.",
    "تأسست الشركة عام 1990 مع 10. الاجتماع القادم يوم الأحد 18 مارس.",
    // Arabic has no case. A one-letter abbreviation ("د." for doctor) does not end the sentence.
    "في عام 1990 زارنا د. أحمد يوم الأحد 18 مارس.",
  ],
];
const noYear = (text: string, lang: string) =>
  scan(text, lang).filter((d) => d.messageKey === NO_YEAR);

describe("a year in an earlier sentence", () => {
  test.each(EARLIER_SENTENCE)("%s: after a short name it does not count", (lang, text) => {
    expect(noYear(text, lang)).toHaveLength(1);
  });
  test.each(EARLIER_SENTENCE)("%s: after a number it does not count", (lang, _, text) => {
    expect(noYear(text, lang)).toHaveLength(1);
  });
  test.each(EARLIER_SENTENCE)("%s: after an abbreviation it counts", (lang, _, __, text) => {
    expect(noYear(text, lang)).toEqual([]);
  });
});

// The examples of the review findings on PR #446.
describe("the review examples", () => {
  // A: a stop after a short name ends the sentence.
  test("A: a year before a short name in an earlier sentence", () => {
    expect(
      noYear("The company began in 1990 with Tom. Sunday, March 18 is our next meeting.", "en_US"),
    ).toHaveLength(1);
  });
  // D: a stop after a known abbreviation of any length does not end the sentence. 1 January
  // 2020 was a Wednesday.
  test("D: a year before a long abbreviation", () => {
    expect(noYear("In 2020 Prof. Smith met us on Wednesday, January 1.", "en_US")).toEqual([]);
  });
  // B: a dotted date after a date cue.
  test("B: a Portuguese dotted date with a day above 31", () => {
    expect(flagged("A data é 32.04.2020.", "32.04.2020", "pt_BR")).toBe(true);
  });
  // C: a German full date with a zero day or month; no year keeps the decimal exemption.
  test.each([
    ["Am 0.5.2020 begann es.", "0.5.2020", true],
    ["Am 1.0.2020 begann es.", "1.0.2020", true],
    ["Der Wert ist 0.5. Danach steigt er.", "0.5.", false],
  ] as const)("C: %p", (text, date, expected) => {
    expect(flagged(text, date, "de_DE")).toBe(expected);
  });
  // E: an English named date with day 0 and a four-digit year.
  test.each([
    ["The meeting is June 0, 2020.", "June 0, 2020"],
    ["The meeting is 0 June 2020.", "0 June 2020"],
    ["The meeting is 0/6/2020.", "0/6/2020"],
  ])("E: %p", (text, date) => {
    expect(flagged(text, date, "en_US")).toBe(true);
  });
  // H: a named date with day 0 and no year, after an article or a preposition.
  test.each([
    ["es_ES", "La reunión será el 0 de abril.", "0 de abril", true],
    ["es_ES", "Nos vimos el lunes 0 de abril.", "0 de abril", true],
    ["es_ES", "0 de abril fue un día largo.", "0 de abril", false],
    ["en_US", "The meeting is on April 0.", "April 0", true],
    ["en_US", "The meeting is by the 0th of April.", "0th of April", true],
    ["en_US", "April 0 was a long day.", "April 0", false],
    ["fr_FR", "La réunion aura lieu le 0 avril.", "0 avril", true],
    ["pt_BR", "A reunião será em 0 de abril.", "0 de abril", true],
    ["de_DE", "Das Treffen ist am 0. April.", "0. April", true],
    ["pl_PL", "Spotkanie będzie 0 kwietnia.", "0 kwietnia", true],
    ["ar_SA", "الاجتماع في 0 أبريل.", "0 أبريل", true],
  ] as const)("H: %s %p", (lang, text, date, expected) => {
    expect(flagged(text, date, lang)).toBe(expected);
  });
  // F: "May" before a day and a four-digit year is the month.
  test("F: May 32, 2020", () => {
    expect(flagged("The meeting is May 32, 2020.", "May 32, 2020", "en_US")).toBe(true);
    expect(scan("You may 32 times in a row.", "en_US")).toEqual([]);
  });
  // I: a stop ends the sentence also before a lowercase letter. Only a known abbreviation keeps
  // the sentence open. The English weekday check reads only a capital weekday ("sunday" gets the
  // proper-noun finding), so the reviewer's example tests the context year directly.
  test("I: the reviewer's example has no context year", () => {
    const text = "The company began in 1990. sunday, March 18 is our next meeting.";
    expect(contextYear(text, text.indexOf("sunday"), "en_US")).toBeUndefined();
  });
  test.each([
    ["en_US", "The company began in 1990. on Sunday, March 18 we meet again.", 1],
    ["en_US", "The company began in 1990 with Tom. on Sunday, March 18 we meet again.", 1],
    ["en_US", "In 1990 we met, e.g. on Sunday, March 18.", 0],
    ["de_DE", "Die Firma begann 1990. das nächste Treffen ist am Sonntag, den 18. März.", 1],
    [
      "de_DE",
      "Die Firma begann 1990 mit Udo. das nächste Treffen ist am Sonntag, den 18. März.",
      1,
    ],
    ["de_DE", "Im Jahr 1990 traf uns Prof. weber am Sonntag, den 18. März.", 0],
    ["fr_FR", "L'entreprise a ouvert en 1990. la réunion est le dimanche 18 mars.", 1],
    ["fr_FR", "L'entreprise a ouvert en 1990 avec Léo. la réunion est le dimanche 18 mars.", 1],
    ["fr_FR", "En 1990, Mme. martin nous a vus le dimanche 18 mars.", 0],
  ] as const)("I: %s %p", (lang, text, count) => {
    expect(noYear(text, lang)).toHaveLength(count);
  });
  // G: the sentence bounds the context-year search, not a count of 400 characters.
  test("G: a year more than 400 characters before the date in one sentence", () => {
    const middle = "the team, the staff, the guests, ".repeat(16);
    expect(noYear(`In 1990, ${middle}and we met on Sunday, March 18.`, "en_US")).toEqual([]);
  });
});
