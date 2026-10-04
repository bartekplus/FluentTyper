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
