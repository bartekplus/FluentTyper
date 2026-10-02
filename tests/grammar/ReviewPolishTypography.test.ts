import { describe, expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

function findings(ruleId: string, text: string, lang = "pl_PL") {
  return detectReviewDiagnostics(
    { id: "pl", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      enabledRules: [ruleId] as never,
      lang,
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

/** Applies every finding's first fix. */
function fixAll(ruleId: string, text: string): string {
  const edits = findings(ruleId, text).flatMap((d) => d.alternatives[0].edits);
  return applyEdits(text, edits);
}

const CASES: Record<string, { pos: Array<[string, string]>; neg: string[] }> = {
  polishTypography: {
    pos: [
      ["Wiem — dodała cicho – że się spóźnię.", "Wiem — dodała cicho — że się spóźnię."],
      ["Wynik: 2 + 3=5.", "Wynik: 2 + 3 = 5."],
      ["Monitor ma 1920x1080 pikseli.", "Monitor ma 1920 × 1080 pikseli."],
      ["Ceny wzrosły o 12 %.", "Ceny wzrosły o 12%."],
      ["Za bilet zapłaciłem 4.50 zł.", "Za bilet zapłaciłem 4,50 zł."],
      ["Copyright (C) 2021 Jan Kowalski", "Copyright © 2021 Jan Kowalski"],
      ["Używam systemu Linux(R) od lat.", "Używam systemu Linux® od lat."],
      ["Adres: ul. Polna 3, 61–245 Poznań.", "Adres: ul. Polna 3, 61-245 Poznań."],
      ["Traktat podpisano 3.V.1791 w Warszawie.", "Traktat podpisano 3 V 1791 w Warszawie."],
      ["Urlop trwa od 3 – 14 sierpnia.", "Urlop trwa od 3 do 14 sierpnia."],
      ["Kupiliśmy m. in. chleb.", "Kupiliśmy m.in. chleb."],
      ["Rzym założono w 753 p. n. e.", "Rzym założono w 753 p.n.e."],
      ["Spółka z o. o. ma siedzibę w Łodzi.", "Spółka z o.o. ma siedzibę w Łodzi."],
      ["Padało;wróciliśmy do domu.", "Padało; wróciliśmy do domu."],
      ["Był tam (jak zwykle)spóźniony.", "Był tam (jak zwykle) spóźniony."],
      ["Wrócił do domu ; nikt nie czekał.", "Wrócił do domu; nikt nie czekał."],
      ["Nie wiem, co dalej….", "Nie wiem, co dalej…"],
      ["Podał przykład., który znaliśmy.", "Podał przykład, który znaliśmy."],
    ],
    neg: [
      "Wiem — dodała cicho — że się spóźnię.",
      "Lata 1914–1918 to czas wojny – mówił – a potem pokój.",
      "Wynik: 2 + 3 = 5.",
      "Kod 0x1F zapisujemy szesnastkowo.",
      "Ceny wzrosły o 12%.",
      "Zainstaluj wersję 4.50 programu.",
      "Za bilet zapłaciłem 4,50 zł.",
      "Wybierz wariant (C) z listy.",
      "Mecz skończył się wynikiem 3–2 dla gości.",
      "Kupiliśmy m.in. chleb, masło itp., a potem wróciliśmy.",
      "Rzym założono w 753 p.n.e.",
      "Funkcja f(x)=y jest rosnąca.",
      "Pokój podpisano 12 X 1945 r.",
      "Senator Kay Hagan (R) zabrała głos.",
    ],
  },
  polishQuotes: {
    pos: [
      ['Powiedział "dobranoc" i wyszedł.', "Powiedział „dobranoc” i wyszedł."],
      ["Czytam “Lalkę” Prusa.", "Czytam „Lalkę” Prusa."],
      ["Czytam „Lalkę“ Prusa.", "Czytam „Lalkę” Prusa."],
      ["To był ‚żart’, nic więcej.", "To był „żart”, nic więcej."],
      ["Napisał: „to jest >>ładna<< rzecz”.", "Napisał: „to jest »ładna« rzecz”."],
    ],
    neg: [
      "Powiedział „dobranoc” i wyszedł.",
      'Ekran ma 15" przekątnej.',
      "Napisał: „to jest »ładna« rzecz”.",
    ],
  },
};

describe.each(Object.entries(CASES))("%s", (ruleId, { pos, neg }) => {
  test.each(pos)("fixes %p", (text, fixed) => {
    expect(findings(ruleId, text).length).toBeGreaterThan(0);
    expect(fixAll(ruleId, text)).toBe(fixed);
    expect(findings(ruleId, fixed)).toEqual([]);
  });
  test.each(neg)("leaves %p", (text) => {
    expect(findings(ruleId, text).map((d) => d.original)).toEqual([]);
  });
  test("runs only for Polish", () => {
    for (const [text] of pos) expect(findings(ruleId, text, "de_DE")).toEqual([]);
  });
});

test("a mixed dash pair offers both consistent styles", () => {
  const text = "Wiem – dodała cicho — że się spóźnię.";
  const [d] = findings("polishTypography", text);
  expect(d.alternatives.map((alt) => applyEdits(text, alt.edits))).toEqual([
    "Wiem – dodała cicho – że się spóźnię.",
    "Wiem — dodała cicho — że się spóźnię.",
  ]);
});
