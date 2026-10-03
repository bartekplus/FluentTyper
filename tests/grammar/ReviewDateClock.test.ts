import { afterEach, describe, expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";
import { restoreReviewDay, useReviewDay } from "../reviewTestClock";
import { ALL_RULES, scan as reviewScan } from "./reviewHarness";

// Date checks that read today's date from the Review clock: a weekday next to a date with no
// year, and a verb tense against a date in the future or in the past. All sentences are our
// own. The test clock is 3 October 2026 (tests/reviewTestClock.ts) unless a test sets another
// day. Calendar: 12 October 2026 is a Monday, 13 November 2026 a Friday, 31 October 2026 a
// Saturday, 28 December 2026 a Monday and 28 December 2027 a Tuesday.

const WEEKDAY_RULES: Record<string, string> = {
  en_US: "englishDateConsistency",
  de_DE: "germanDates",
  fr_FR: "frenchDates",
  es_ES: "spanishTypography",
  pt_BR: "portugueseDates",
  pl_PL: "polishDates",
  ar_SA: "arabicDates",
};

function scan(text: string, lang: string): ReviewDiagnostic[] {
  return reviewScan(text, { lang, enabledRules: ALL_RULES });
}
const noYear = (text: string, lang: string) =>
  scan(text, lang).filter((d) => d.messageKey === "review_msg_weekday_no_year");
const tense = (text: string, lang: string) =>
  scan(text, lang).filter(
    (d) =>
      d.messageKey === "review_msg_future_date_past" ||
      d.messageKey === "review_msg_past_date_future",
  );

afterEach(restoreReviewDay);

// [lang, text, flagged text, fix previews (the weekday of each year it can mean, then the
// nearest day on the typed weekday)]
const WEEKDAY_NO_YEAR: [string, string, string, string[]][] = [
  ["en_US", "The party is on Sunday, 12 October.", "Sunday, 12", ["Monday, 12", "Sunday, 11"]],
  [
    "en_US",
    "Can we meet on Tuesday, November 13th?",
    "Tuesday, November 13th",
    ["Friday, November 13th", "Tuesday, November 10th"],
  ],
  ["en_US", "Deadline: Monday, 31/10.", "Monday, 31", ["Saturday, 31", "Monday, 26"]],
  ["de_DE", "Treffen: Sonntag, 12.10.", "Sonntag, 12", ["Montag, 12", "Sonntag, 11"]],
  [
    "de_DE",
    "Wir sehen uns am Dienstag, den 13. November.",
    "Dienstag, den 13",
    ["Freitag, den 13", "Dienstag, den 10"],
  ],
  ["fr_FR", "Réunion le dimanche 12 octobre.", "dimanche 12", ["lundi 12", "dimanche 11"]],
  ["fr_FR", "Rendez-vous mardi 13 novembre à midi.", "mardi 13", ["vendredi 13", "mardi 10"]],
  ["es_ES", "Nos vemos el domingo 12 de octubre.", "domingo 12", ["lunes 12", "domingo 11"]],
  ["es_ES", "La cena es el martes, 13 de noviembre.", "martes, 13", ["viernes, 13", "martes, 10"]],
  [
    "pt_BR",
    "A reunião é no domingo, 12 de outubro.",
    "domingo, 12",
    ["segunda-feira, 12", "domingo, 11"],
  ],
  ["pt_BR", "Prova: terça, 13/11.", "terça, 13/11", ["sexta-feira, 13/11", "terça, 10/11"]],
  ["pl_PL", "Spotkanie: niedziela, 12 października.", "niedziela", ["poniedziałek"]],
  ["ar_SA", "الاجتماع يوم الأحد 12 أكتوبر في المكتب.", "الأحد", ["الإثنين"]],
  ["ar_SA", "الحفل يوم الثلاثاء 13 نوفمبر.", "الثلاثاء", ["الجمعة"]],
];

describe("a weekday next to a date with no year", () => {
  test.each(WEEKDAY_NO_YEAR)("%s: %p", (lang, text, original, previews) => {
    const [finding, ...rest] = noYear(text, lang);
    expect(rest).toEqual([]);
    expect(finding.ruleId).toBe(WEEKDAY_RULES[lang]);
    expect(finding.original).toBe(original);
    expect(finding.alternatives.map((a) => a.preview)).toEqual(previews);
    // The day can be the slip instead of the weekday: nothing is preselected.
    expect(finding.requiresChoice).toBe(true);
    const fixed = applyEdits(text, finding.alternatives[0].edits);
    expect(noYear(fixed, lang)).toEqual([]);
  });

  test("Polish after a preposition only warns: the case changes the weekday's form", () => {
    const [finding] = noYear("Zapraszamy we wtorek, 13 listopada.", "pl_PL");
    expect(finding.original).toBe("wtorek, 13 listopada");
    expect(finding.warningOnly).toBe(true);
  });

  test.each([
    ["en_US", "The party is on Monday, 12 October."],
    ["en_US", "See you on Friday, November 13th."],
    ["en_US", "Deadline: Saturday, 31/10."],
    // Day and month order is open: 03/04 can be either.
    ["en_US", "Filed Monday, 03/04."],
    // A year in the paragraph is one more year the date can mean: 31 October 2014 was a Friday.
    ["en_US", "In 2014 the fair opened on Friday, 31 October."],
    ["de_DE", "Treffen: Montag, 12.10."],
    ["de_DE", "Wir sehen uns am Freitag, den 13. November."],
    ["de_DE", "Treffen: Sa, 31.10."],
    ["fr_FR", "Réunion le lundi 12 octobre."],
    ["fr_FR", "Rendez-vous vendredi 13 novembre à midi."],
    ["es_ES", "Nos vemos el lunes 12 de octubre."],
    ["es_ES", "La cena es el viernes, 13 de noviembre."],
    ["pt_BR", "A reunião é na segunda-feira, 12 de outubro."],
    ["pt_BR", "Prova: sexta, 13/11."],
    ["pl_PL", "Spotkanie: poniedziałek, 12 października."],
    ["pl_PL", "Zapraszamy w piątek, 13 listopada."],
    ["ar_SA", "الاجتماع يوم الإثنين 12 أكتوبر في المكتب."],
    ["ar_SA", "الحفل يوم الجمعة 13 نوفمبر."],
  ])("%s: a weekday that fits is not flagged: %p", (lang, text) => {
    expect(noYear(text, lang)).toEqual([]);
  });

  test("a date that has gone by this year can also mean next year", () => {
    // 12 March is a Thursday in 2026 (gone by) and a Friday in 2027.
    expect(noYear("Our next review is on Friday, 12 March.", "en_US")).toEqual([]);
    expect(noYear("We met on Thursday, 12 March.", "en_US")).toEqual([]);
    expect(noYear("We met on Monday, 12 March.", "en_US")).toHaveLength(1);
  });

  test("near the turn of the year, a December date can mean last year", () => {
    expect(noYear("We met on Tuesday, 28 December.", "en_US")).toHaveLength(1);
    useReviewDay("2027-01-10");
    // 28 December 2026 was a Monday, 28 December 2027 is a Tuesday.
    expect(noYear("We met on Monday, 28 December.", "en_US")).toEqual([]);
    expect(noYear("We met on Tuesday, 28 December.", "en_US")).toEqual([]);
    expect(noYear("Am Montag, den 28.12. haben wir gefeiert.", "de_DE")).toEqual([]);
    const [finding] = noYear("We met on Sunday, 28 December.", "en_US");
    expect(finding.alternatives.map((a) => a.preview)).toEqual([
      "Monday, 28",
      "Tuesday, 28",
      "Sunday, 27",
    ]);
  });
});

// 18 March was a Sunday in 1990. It is a Wednesday in 2026 and a Thursday in 2027.
// [lang, a year in an earlier sentence, the same year in the date's sentence]
const SENTENCE_YEAR: [string, string, string][] = [
  [
    "en_US",
    "The company began in 1990. Sunday, March 18 is our next meeting.",
    "In 1990, Sunday, March 18 was a holiday.",
  ],
  [
    "de_DE",
    "Die Firma gibt es seit 1990. Das nächste Treffen ist am Sonntag, den 18. März.",
    "Im Jahr 1990 war am Sonntag, den 18. März, ein Fest.",
  ],
  [
    "fr_FR",
    "L'entreprise a ouvert en 1990. La prochaine réunion est le dimanche 18 mars.",
    "En 1990, la fête a eu lieu le dimanche 18 mars.",
  ],
  [
    "es_ES",
    "La empresa abrió en 1990. La próxima reunión es el domingo 18 de marzo.",
    "En 1990, la fiesta fue el domingo 18 de marzo.",
  ],
  [
    "pt_BR",
    "A empresa abriu em 1990. A próxima reunião é no domingo, 18 de março.",
    "Em 1990, a festa foi no domingo, 18 de março.",
  ],
  [
    "pl_PL",
    "Firma powstała w 1990 roku. Następne spotkanie: niedziela, 18 marca.",
    "W 1990 roku spotkanie było w niedzielę, 18 marca.",
  ],
  [
    "ar_SA",
    "تأسست الشركة عام 1990. الاجتماع القادم يوم الأحد 18 مارس.",
    "في عام 1990 كان الحفل يوم الأحد 18 مارس.",
  ],
];

describe("the year of a date with no year comes only from the date's own sentence", () => {
  test.each(SENTENCE_YEAR)("%s: a year in an earlier sentence does not count", (lang, text) => {
    expect(noYear(text, lang)).toHaveLength(1);
  });

  test.each(SENTENCE_YEAR)("%s: a year in the same sentence counts", (lang, _, text) => {
    expect(noYear(text, lang)).toEqual([]);
  });

  test("a year at the end of a date list in the same sentence counts", () => {
    expect(noYear("We met on Sunday, March 18 or Monday, March 19, 1990.", "en_US")).toEqual([]);
    expect(noYear("We met on Sunday, March 18 and Monday, March 19.", "en_US")).toHaveLength(2);
    // The year is in the next sentence.
    expect(
      noYear("We met on Sunday, March 18 at noon. Monday, March 19, 1990 was quiet.", "en_US"),
    ).toHaveLength(1);
  });

  test("a stop after a day number or an abbreviation does not end the sentence", () => {
    expect(noYear("In 1990, Mr. Smith came on Sunday, March 18.", "en_US")).toEqual([]);
    expect(
      noYear("Am Sonntag, den 18. März und am Montag, den 19. März 1990 war ein Fest.", "de_DE"),
    ).toEqual([]);
  });
});

// [lang, text, flagged date, message]
const FUTURE = "review_msg_future_date_past";
const PAST = "review_msg_past_date_future";
const TENSE: [string, string, string, string][] = [
  ["en_US", "We visited the plant on 12 March 2028.", "12 March 2028", FUTURE],
  ["en_US", "We will visit the plant on 12 March 2026.", "12 March 2026", PAST],
  ["en_US", "On 12 March 2026, we will visit the plant.", "12 March 2026", PAST],
  ["de_DE", "Wir haben am 12.03.2028 den Vertrag abgeschickt.", "12.03.2028", FUTURE],
  ["de_DE", "Am 12. März 2028 sind wir nach Wien gefahren.", "12. März 2028", FUTURE],
  ["de_DE", "Ich war am 12. März 2028 in Wien.", "12. März 2028", FUTURE],
  ["de_DE", "Wir werden am 12. März 2026 nach Wien reisen.", "12. März 2026", PAST],
  ["fr_FR", "Nous avons envoyé le contrat le 12 mars 2028.", "12 mars 2028", FUTURE],
  ["fr_FR", "Elle est arrivée le 12/03/2028.", "12/03/2028", FUTURE],
  ["fr_FR", "Nous enverrons le contrat le 12 mars 2026.", "12 mars 2026", PAST],
  ["es_ES", "Hemos enviado el contrato el 12 de marzo de 2028.", "12 de marzo de 2028", FUTURE],
  ["es_ES", "Visité a mi abuela el 12 de marzo de 2028.", "12 de marzo de 2028", FUTURE],
  ["es_ES", "Enviaremos el contrato el 12 de marzo de 2026.", "12 de marzo de 2026", PAST],
  ["pt_BR", "Visitei o cliente em 12 de março de 2028.", "12 de março de 2028", FUTURE],
  ["pt_BR", "Estávamos a preparar o relatório a 12/03/2028.", "12/03/2028", FUTURE],
  ["pt_BR", "Enviaremos o contrato em 12 de março de 2026.", "12 de março de 2026", PAST],
  ["pl_PL", "Podpisaliśmy umowę 12 marca 2028 r.", "12 marca 2028", FUTURE],
  ["pl_PL", "Dnia 12 marca 2028 roku odbyła się konferencja.", "12 marca 2028", FUTURE],
  ["pl_PL", "Będziemy w Warszawie 12 marca 2026 r.", "12 marca 2026", PAST],
  ["ar_SA", "لقد زرنا العميل في 12 مارس 2028.", "12 مارس 2028", FUTURE],
  ["ar_SA", "سوف نزور العميل في 12 مارس 2026.", "12 مارس 2026", PAST],
];

describe("a verb tense that the date rules out", () => {
  test.each(TENSE)("%s: %p", (lang, text, original, messageKey) => {
    const [finding, ...rest] = tense(text, lang);
    expect(rest).toEqual([]);
    expect(finding.ruleId).toBe(
      lang === "en_US" ? "englishTenseConsistency" : "dateTenseConsistency",
    );
    expect(finding.original).toBe(original);
    expect(finding.messageKey).toBe(messageKey);
    // The date or the tense can be the slip: the finding only warns.
    expect(finding.warningOnly).toBe(true);
    expect(finding.alternatives).toEqual([]);
  });

  test.each([
    ["en_US", "We will visit the plant on 12 March 2028."],
    ["en_US", "She said we will meet them on 12 March 2026."],
    // More than three years back: history can use "will" for the future in the past.
    ["en_US", "We will visit the plant on 12 March 2020."],
    ["de_DE", "Wir haben am 12.03.2028 Geburtstag."],
    ["de_DE", "Die Messe ist am 12. März 2028 geschlossen."],
    ["de_DE", "Wir haben die Reise am 12. März 2028 gebucht."],
    ["de_DE", "Wir werden am 12. März 2028 nach Wien reisen."],
    ["de_DE", "Er sagte, dass wir am 12. März 2028 geflogen sind."],
    ["de_DE", "Am 12. März 2020 werden wir nach Wien reisen."],
    ["fr_FR", "Nous avons prévu la fête le 12 mars 2028."],
    ["fr_FR", "Il y a une réunion le 12 mars 2028."],
    ["fr_FR", "Nous enverrons le contrat le 12 mars 2028."],
    ["fr_FR", "Il aura oublié le rendez-vous le 12 mars 2026."],
    ["es_ES", "Hemos programado la reunión el 12 de marzo de 2028."],
    ["es_ES", "Íbamos a firmar el contrato el 12 de marzo de 2028."],
    ["es_ES", "Enviaremos el contrato el 12 de marzo de 2028."],
    ["pt_BR", "Marcamos a reunião para o dia 12 de março de 2028."],
    ["pt_BR", "Queríamos visitar o cliente em 12 de março de 2028."],
    ["pt_BR", "Enviaremos o contrato em 12 de março de 2028."],
    ["pl_PL", "Spotkanie miało się odbyć 12 marca 2028 r."],
    ["pl_PL", "Zaplanowaliśmy spotkanie na 12 marca 2028 r."],
    ["pl_PL", "Będziemy w Warszawie 12 marca 2028 r."],
    ["ar_SA", "كان من المقرر أن نزور العميل في 12 مارس 2028."],
    ["ar_SA", "سوف نزور العميل في 12 مارس 2028."],
    ["ar_SA", "إذا كان الطقس جيدا في 12 مارس 2028 سنخرج."],
  ])("%s: a tense that fits the date is not flagged: %p", (lang, text) => {
    expect(tense(text, lang)).toEqual([]);
  });

  test("the result follows the clock", () => {
    const text = "Wir haben am 12.03.2028 den Vertrag abgeschickt.";
    expect(tense(text, "de_DE")).toHaveLength(1);
    useReviewDay("2028-04-01");
    expect(tense(text, "de_DE")).toEqual([]);
    expect(tense("We visited the plant on 12 March 2028.", "en_US")).toEqual([]);
  });
});
