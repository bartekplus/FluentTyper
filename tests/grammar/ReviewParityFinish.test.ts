import { expect, test } from "bun:test";
import { englishWordInfo } from "../../src/core/domain/grammar/implementations/helpers/EnglishLexicon";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { ALL_RULES, scan } from "./reviewHarness";

// Small fixes that close the LanguageTool parity work. All sentences are our own.
const review = (text: string, lang = "en_US") =>
  scan(text, { lang, enabledRules: ALL_RULES }).filter((d) => d.category !== "style");

test("English and German direct questions share a neutral message key", () => {
  for (const [lang, text] of [
    ["en_US", "Where did you leave the car keys."],
    ["de_DE", "Wann fährt der letzte Bus."],
  ]) {
    const keys = review(text, lang).map((d) => d.messageKey);
    expect(keys).toContain("review_msg_question_mark");
  }
});

const fixes = (text: string, lang: string) =>
  review(text, lang).map((d) => d.alternatives.map((a) => applyEdits(text, a.edits)));

test.each([
  ["pl_PL", "Napisał m.im. dwie książki.", "Napisał m.in. dwie książki."],
  ["pl_PL", "M.in Nowak przyszedł.", "M.in. Nowak przyszedł."],
  ["pl_PL", "Komisja d.s budżetu obraduje.", "Komisja ds. budżetu obraduje."],
  ["pl_PL", "Rzym założono w 753 p.n.e? Nie.", "Rzym założono w 753 p.n.e.? Nie."],
  ["pl_PL", "Zob. dz.cyt., s. 12.", "Zob. dz. cyt., s. 12."],
  ["pt_BR", "Comprei pão, leite, e.t.c. e mais.", "Comprei pão, leite, etc. e mais."],
  ["pt_BR", "O forno gasta 3 kW/h por dia.", "O forno gasta 3 kWh por dia."],
  ["pt_BR", "O forno gasta 3 KW.h por dia.", "O forno gasta 3 kWh por dia."],
])("a %s prose slip in a dotted or slashed token: %s", (lang, text, fixed) => {
  expect(fixes(text, lang)).toEqual([[fixed]]);
});

test.each([
  ["pl_PL", "Kupiliśmy m.in. chleb i masło."],
  ["pl_PL", "Wszedł na wp.pl wczoraj."],
  ["pt_BR", "Visite o site www.e.t.c.com hoje."],
  ["pt_BR", "A velocidade é 80 km/h agora."],
  ["pt_BR", "O forno gasta 3 kW.h por dia."],
  ["en_US", "Bring a snack, e.g. an apple, i.e. something light."],
])("a %s technical or correct token stays clean: %s", (lang, text) => {
  expect(review(text, lang)).toEqual([]);
});

test("doubled comparatives and superlatives read as adjectives", () => {
  for (const word of ["hotter", "hottest", "bigger", "biggest", "wetter", "thinner", "sadder"])
    expect(englishWordInfo(word)?.adjective).toBe(true);
  // A doubled -er word whose base is no adjective stays as it was.
  for (const word of ["letter", "dinner", "summer"])
    expect(englishWordInfo(word)?.adjective).toBe(false);
});

test.each([
  ["يجب إِسْتِخْدَام الأدوات بحذر.", "يجب استخدام الأدوات بحذر."],
  ["انقطع الإتّصال فجأة.", "انقطع الاتصال فجأة."],
  ["وَإِسْتِخْدَامُ الأدوات مهم.", "وَاستخدام الأدوات مهم."],
])("an Arabic phrase row matches a word with harakat or a shadda: %s", (text, fixed) => {
  expect(fixes(text, "ar_SA")).toEqual([[fixed]]);
});

test("an Arabic word with harakat that no row lists stays clean", () => {
  expect(review("يجب اسْتِخْدَام الأدوات بحذر.", "ar_SA")).toEqual([]);
});

const dashes = (text: string, lang: string) =>
  scan(text, { lang, enabledRules: ["emdashShortcut"] }).map((d) =>
    d.alternatives.map((a) => applyEdits(text, a.edits)),
  );

test.each([
  ["de_DE", "Lies die Seiten 10-15 bis morgen.", "Lies die Seiten 10–15 bis morgen."],
  ["de_DE", "In den Jahren 1990-95 wuchs sie.", "In den Jahren 1990–95 wuchs sie."],
  ["fr_FR", "Lisez les pages 10-15 demain.", "Lisez les pages 10–15 demain."],
  ["pt_BR", "Leia as páginas 10-15 amanhã.", "Leia as páginas 10–15 amanhã."],
  ["es_ES", "Lea las páginas 10-15 mañana.", "Lea las páginas 10–15 mañana."],
  ["pl_PL", "Przeczytaj strony 10-15 jutro.", "Przeczytaj strony 10–15 jutro."],
])("a %s number range takes an en dash: %s", (lang, text, fixed) => {
  expect(dashes(text, lang)).toEqual([[fixed]]);
});

test.each([
  // Phones, postal codes, IDs, ISO dates, scores, references and laws.
  ["de_DE", "Ruf an: Tel. 12-34."],
  ["de_DE", "Das Spiel endete 3-1."],
  ["de_DE", "Bayern gewann gestern 2-3."],
  ["de_DE", "Vgl. § 3-5 BGB."],
  ["de_DE", "Das gilt von 10-15 Uhr."],
  ["de_DE", "Am 2024-05-01 kam er."],
  ["de_DE", "Die Nummer 0151-2345 ist neu."],
  ["fr_FR", "Appelez le tél. 12-34."],
  ["fr_FR", "Lyon a gagné 3-1 hier."],
  ["fr_FR", "Voir l'art. 3-5 du code."],
  ["fr_FR", "Le match nul 2-2 déçoit."],
  ["pt_BR", "Ligue: tel. 12-34."],
  ["pt_BR", "O time venceu por 3-1 ontem."],
  ["pt_BR", "Veja o art. 3-5 da lei."],
  ["pt_BR", "Mora no CEP 12345-678."],
  ["pt_BR", "O jogo terminou 2-2."],
  ["pl_PL", "Mieszka pod adresem 31-123 Kraków."],
])("a %s pair that is no range keeps its hyphen: %s", (lang, text) => {
  expect(dashes(text, lang)).toEqual([]);
});
