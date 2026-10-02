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
      ["Dodaj 250g mąki.", "Dodaj 250 g mąki."],
      ["Szkołę zbudowano w 1965r.", "Szkołę zbudowano w 1965 r."],
      ["Bezrobocie spadło o 2, 4 proc.", "Bezrobocie spadło o 2,4 proc."],
      [
        "Mamy związki dwu–, trzy- i czterowartościowe.",
        "Mamy związki dwu-, trzy- i czterowartościowe.",
      ],
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
      "Nowy telefon obsługuje 5G bez problemu.",
      "Ćwiczenia 1, 2, 3 proc. ocen dają ekstra punkty.",
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

describe("Polish commas set by fixed words", () => {
  const RULES = ["polishMissingComma", "polishMisplacedComma"];
  const fixed = (text: string) => {
    const found = detectReviewDiagnostics(
      { id: "pl", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      {
        enabledRules: RULES as never,
        lang: "pl_PL",
        userDictionary: [],
        insertSpaceAfterAutocomplete: true,
      },
    ).diagnostics;
    return applyEdits(
      text,
      found.flatMap((d) => d.alternatives[0].edits),
    );
  };
  test.each([
    ["Nie wiem co mam zrobić.", "Nie wiem, co mam zrobić."],
    ["Sprawdź czy drzwi są zamknięte.", "Sprawdź, czy drzwi są zamknięte."],
    ["Zastanawiam się dlaczego nie dzwoni.", "Zastanawiam się, dlaczego nie dzwoni."],
    ["Szukam kogoś kto zna niemiecki.", "Szukam kogoś kto zna niemiecki."],
    ["To jest ktoś kto zawsze pomoże.", "To jest ktoś, kto zawsze pomoże."],
    ["Zrobię wszystko czego potrzebujesz.", "Zrobię wszystko, czego potrzebujesz."],
    ["Tam gdzie rosną sosny, jest cień.", "Tam, gdzie rosną sosny, jest cień."],
    [
      "Im dłużej czekam tym bardziej się denerwuję.",
      "Im dłużej czekam, tym bardziej się denerwuję.",
    ],
    ["Nie lubił ani kawy ani herbaty.", "Nie lubił ani kawy, ani herbaty."],
    ["Krótko mówiąc nie mamy czasu.", "Krótko mówiąc, nie mamy czasu."],
    ["Jednak, nikt nie przyszedł.", "Jednak nikt nie przyszedł."],
    ["Ponadto, warto o tym pamiętać.", "Ponadto warto o tym pamiętać."],
    ["To był więc, sukces.", "To był więc sukces."],
    ["To pokój, w którym, śpi babcia.", "To pokój, w którym śpi babcia."],
    ["Nie mam czasu, ani pieniędzy.", "Nie mam czasu ani pieniędzy."],
  ])("%p", (text, expected) => {
    expect(fixed(text)).toBe(expected);
  });
  test.each([
    "Nie wiem, co mam zrobić.",
    "Zrób to jak najszybciej.",
    "Wiem co nieco o ogrodach.",
    "A to co?",
    "Dajcie mi coś co zjeść.",
    "Bądź co bądź to prawda.",
    "Ponadto, jak już wspomniałem, wyjeżdżamy.",
    "Nie jem ani mięsa, ani ryb.",
    "To dom, w którym, jak sądzę, mieszka.",
    "Wie, ale nie powie dlaczego.",
  ])("leaves %p", (text) => {
    expect(fixed(text)).toBe(text);
  });
});

describe("polishCapitalization", () => {
  test.each([
    ["Basen jest czynny w każdą Sobotę.", "Basen jest czynny w każdą sobotę."],
    ["Wyjeżdżamy 3 Sierpnia.", "Wyjeżdżamy 3 sierpnia."],
    ["Post obowiązuje w wielki piątek.", "Post obowiązuje w Wielki Piątek."],
    ["Popiół sypie się w środę popielcową.", "Popiół sypie się w Środę Popielcową."],
    ["Pływaliśmy w morzu Śródziemnym.", "Pływaliśmy w Morzu Śródziemnym."],
    ["Przepłynął ocean spokojny.", "Przepłynął Ocean Spokojny."],
    ["Ona świetnie mówi po Hiszpańsku.", "Ona świetnie mówi po hiszpańsku."],
    ["Uczę się języka Francuskiego.", "Uczę się języka francuskiego."],
    ["Mieszkam w województwie Pomorskim.", "Mieszkam w województwie pomorskim."],
    ["Głośnik ma moc 50 Wattów.", "Głośnik ma moc 50 watów."],
    ["Od razu przeszli na Ty.", "Od razu przeszli na ty."],
    ["Mieszka w Krakowie, Ul. Floriańska 3.", "Mieszka w Krakowie, ul. Floriańska 3."],
    ["Na weekend pojechaliśmy do gdyni.", "Na weekend pojechaliśmy do Gdyni."],
    ["Studiowała w toruniu i w gdańsku.", "Studiowała w Toruniu i w Gdańsku."],
    ["Wakacje spędzimy na mazurach.", "Wakacje spędzimy na Mazurach."],
    ["Paczka przyszła z niemiec.", "Paczka przyszła z Niemiec."],
    ["Sklep jest przy al. Racławickie 12.", "Sklep jest przy Al. Racławickie 12."],
    ["Szliśmy alejami Ujazdowskimi.", "Szliśmy Alejami Ujazdowskimi."],
    ["Mieszka przy Ulicy Lipowej.", "Mieszka przy ulicy Lipowej."],
  ])("fixes %p", (text, fixed) => {
    expect(fixAll("polishCapitalization", text)).toBe(fixed);
  });
  test.each([
    "Sobota była deszczowa.",
    "W Wielki Piątek pościmy.",
    "Tłusty Czwartek to dzień pączków.",
    "W Niedzielę Palmową idziemy do kościoła.",
    "Rozmawiałem z panem Środą o pracy.",
    "Spotkałem Lipca na rynku.",
    "Piątek: wolne od pracy.",
    "Nad Morzem Bałtyckim jest zimno.",
    "Mówi po polsku i po angielsku.",
    "Kocham Cię, Twoja Ania.",
    "Jestem z Kazimierza nad Wisłą.",
    "Mówi po gdańsku, jak jego dziadek.",
    "Łowili ryby w łodzi przy brzegu.",
    "Pracuje nad poznaniem świata i w poznaniu widzi sens.",
    "Do dania dodaj szczyptę soli.",
    "Mieszkam przy al. Mickiewicza.",
    "Ulica Lipowa jest wąska.",
  ])("leaves %p", (text) => {
    expect(findings("polishCapitalization", text)).toEqual([]);
  });
});
