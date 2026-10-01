import { describe, expect, test } from "bun:test";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  detectReviewDiagnostics,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

/** Polish-only Review checks: every positive gets its first fix, every negative stays clean. */
function findings(ruleId: CatalogRuleId, text: string, lang = "pl_PL") {
  return detectReviewDiagnostics(
    { id: "pl", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules: [ruleId], lang, userDictionary: [], insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

type Case = { pos: Array<[string, string]>; neg: string[] };

export const POLISH_CASES: Array<[CatalogRuleId, string, Case]> = [
  [
    "englishClosedCompounds",
    "guarded split words",
    {
      pos: [
        ["Ona na prawdę lubi pływać.", "Ona naprawdę lubi pływać."],
        ["Zrobiliśmy duży krok na przód.", "Zrobiliśmy duży krok naprzód."],
        ["Było śmiesznie i smutne za razem.", "Było śmiesznie i smutne zarazem."],
        ["Wróci za pewne jutro.", "Wróci zapewne jutro."],
        ["Stanął po środku sali.", "Stanął pośrodku sali."],
        ["Kolejka po woli się przesuwa.", "Kolejka powoli się przesuwa."],
        ["Ponad to dostał premię.", "Ponadto dostał premię."],
        ["Nikt z resztą nie pytał.", "Nikt zresztą nie pytał."],
        ["Jest co raz zimniej.", "Jest coraz zimniej."],
        ["Spóźnił się dla tego, że padało.", "Spóźnił się dlatego, że padało."],
        ["Dla czego nie dzwonisz?", "Dlaczego nie dzwonisz?"],
        ["W prawdzie padało, ale poszliśmy.", "Wprawdzie padało, ale poszliśmy."],
        ["Usiadł na tam tym krześle.", "Usiadł na tamtym krześle."],
        ["Nie rób tego dla swojego widzi mi się.", "Nie rób tego dla swojego widzimisię."],
        ["Wyjechała zagranicę na rok.", "Wyjechała za granicę na rok."],
        ["Nie był wstanie odpowiedzieć.", "Nie był w stanie odpowiedzieć."],
        ["Przyjdę jutro popołudniu.", "Przyjdę jutro po południu."],
        ["Krążył na około wieży.", "Krążył naokoło wieży."],
        ["Takie zachowanie jest kary godne.", "Takie zachowanie jest karygodne."],
        ["Tym nie mniej warto spróbować.", "Tym niemniej warto spróbować."],
        ["By najmniej nie żałuję.", "Bynajmniej nie żałuję."],
        ["Za zwyczaj wstaję wcześnie.", "Zazwyczaj wstaję wcześnie."],
        ["Gazeta wychodzi co tygodniowo.", "Gazeta wychodzi cotygodniowo."],
        ["Skończę wciągu tygodnia.", "Skończę w ciągu tygodnia."],
        ["To jest kompletnie bezsensu.", "To jest kompletnie bez sensu."],
        ["Zrobił by to bez wahania.", "Zrobiłby to bez wahania."],
        ["Nie mógł bym tak żyć.", "Nie mógłbym tak żyć."],
        ["Chętnie poszła by do kina.", "Chętnie poszłaby do kina."],
        ["Wczoraj zrobili śmy zakupy.", "Wczoraj zrobiliśmy zakupy."],
      ],
      neg: [
        "Czekamy na prawdę.",
        "Mamy dowód na prawdę tego twierdzenia.",
        "Przesunął się na przód autobusu.",
        "Strzelał raz za razem.",
        "Uznał to za pewne.",
        "Za pewne kwoty można wiele kupić.",
        "Zasnął po środku nasennym.",
        "Mieszkam po Woli i Mokotowie.",
        "Wyszło ponad to, co planowaliśmy.",
        "Wróciłem z resztą rodziny.",
        "To jest dla tego człowieka.",
        "Nie ma dla czego innego żyć.",
        "Żyli w prawdzie i miłości.",
        "Byłem tam tego dnia.",
        "Nie ma tam tych pieniędzy.",
        "Handel z zagranicą rośnie.",
        "Jutro wstanie wcześnie.",
        "W to popołudniu było cicho.",
        "Straty wyceniono na około pięć milionów.",
        "Wynik wyniósł w około połowie przypadków zero.",
        "Był najwyższej kary godny.",
        "W tym nie mniej niż siedem śledzi.",
        "Nie mniej jednak niż trzydzieści złotych.",
        "Staraj się, by najmniej zaszkodzić.",
        "Uważają łapówki za zwyczaj tak powszechny.",
        "Płacą za co miesięcznie trzydzieści franków?",
        "Morze bezsensu nas otacza.",
        "Ryba przykleiła się do wciągu filtra.",
        "Przyszedł by pomóc.",
        "Chciał bym przyszedł wcześniej.",
        "W tej chwili by się przydał.",
        "Krótko trwały te radości.",
      ],
    },
  ],
  [
    "englishPhraseCorrections",
    "look-alike words in context",
    {
      pos: [
        ["Mówiła, ze nic nie wie.", "Mówiła, że nic nie wie."],
        ["Myślę ze to dobry pomysł.", "Myślę że to dobry pomysł."],
        ["Kupiłem to bezcen.", "Kupiłem to za bezcen."],
        ["Mówi niemiecku bardzo dobrze.", "Mówi po niemiecku bardzo dobrze."],
        ["Szedł ciemku przez las.", "Szedł po ciemku przez las."],
        ["Nie boje się burzy.", "Nie boję się burzy."],
        ["Boje się ciemności.", "Boję się ciemności."],
        ["Padało, wiec zostaliśmy.", "Padało, więc zostaliśmy."],
        ["On tez przyjdzie.", "On też przyjdzie."],
        ["Zapłacił 20% mnie niż ja.", "Zapłacił 20% mniej niż ja."],
        ["Zostało mnie więcej pięć minut.", "Zostało mniej więcej pięć minut."],
        ["To była pierwsza cześć filmu.", "To była pierwsza część filmu."],
        ["Spłynęła na nas boża laska.", "Spłynęła na nas boża łaska."],
        ["Na górze znajduję się pokój gościnny.", "Na górze znajduje się pokój gościnny."],
        ["Musze już iść.", "Muszę już iść."],
        ["Uczniowie maja dziś wolne.", "Uczniowie mają dziś wolne."],
        ["Interesuje się głownie historią.", "Interesuje się głównie historią."],
        ["Stał miedzy nami.", "Stał między nami."],
        ["Problem nadaj występuje.", "Problem nadal występuje."],
        ["Było tam klika osób.", "Było tam kilka osób."],
        ["Był rządny władzy.", "Był żądny władzy."],
        ["Nie zwalniaj tępa pracy.", "Nie zwalniaj tempa pracy."],
        ["Mama karze mu sprzątać.", "Mama każe mu sprzątać."],
        ["Pokarz mi zdjęcia.", "Pokaż mi zdjęcia."],
        ["Nie wierze w to.", "Nie wierzę w to."],
        ["Wyszedł tuz przed północą.", "Wyszedł tuż przed północą."],
        ["Nie oto chodzi.", "Nie o to chodzi."],
        ["Moim zadaniem, to błąd.", "Moim zdaniem, to błąd."],
        ["Przyszedł wraz nim.", "Przyszedł wraz z nim."],
        ["Mimo różnić się dogadali.", "Mimo różnic się dogadali."],
        ["Nie jestem skłony do zmian.", "Nie jestem skłonny do zmian."],
        ["Spłacił koszty sadowe.", "Spłacił koszty sądowe."],
        ["Urodził się 3 litego 1990.", "Urodził się 3 lutego 1990."],
        ["Był to, rzecz można, wzór.", "Był to, rzec można, wzór."],
        ["Damy rade bez ciebie.", "Damy radę bez ciebie."],
        ["Jako widać, działa.", "Jak widać, działa."],
      ],
      neg: [
        "Wyszedł ze szkoły wcześnie.",
        "Rozmawiał ze mną długo.",
        "Wrócę ze dwa razy.",
        "Pochodzi ze Lwowa.",
        "Kupiłem to za bezcen.",
        "Mówi po polsku i angielsku.",
        "Toczyły się boje o miasto.",
        "Zorganizowano wiec poparcia.",
        "Napisał kilka tez programowych.",
        "Dostał ode mnie więcej niż ja od niego.",
        "I coraz mnie mniej.",
        "Cześć jego pamięci!",
        "Oparł się na lasce.",
        "Gdzie się znajduję?",
        "Znajduję się w trudnej sytuacji.",
        "Usiadła na musze.",
        "Wrócili pod koniec maja z urlopu.",
        "Mieszka w Głownie od lat.",
        "Szła wzdłuż miedzy.",
        "Nadaj ten list jutro.",
        "Rządzi nimi klika polityków.",
        "Rządna koalicja przetrwała.",
        "Patrzył tępo w ścianę.",
        "Sąd karze go grzywną.",
        "Pan Bóg nie rychliwy, ale sprawiedliwy, karze złych.",
        "Mieszkam w wierze i nadziei.",
        "Rozdał tuz pik.",
        "Oto chłopiec, o którym mówiłem.",
        "Moim zadaniem jest sprzątanie.",
        "Zgodnie twierdzą, że wygrali.",
        "Ćwiczy skłony do przodu.",
        "Ma sad i sadowe drzewa.",
        "Można rzecz kupić w sklepie.",
        "Sprawił, że się roześmiała.",
      ],
    },
  ],
  [
    "polishNumerals",
    "digits with endings, digit compounds, numeral and noun forms",
    {
      pos: [
        ["Wygrał już 3-ci raz.", "Wygrał już 3. raz."],
        ["Przyjechał 12-go czerwca.", "Przyjechał 12 czerwca."],
        ["Moda z lat 80-tych wraca.", "Moda z lat 80. wraca."],
        ["Zaprosiłem 7-miu gości.", "Zaprosiłem siedmiu gości."],
        ["Dostał 6-tkę z matematyki.", "Dostał szóstkę z matematyki."],
        ["Pamiętam XX-go wieku modę.", "Pamiętam XX wieku modę."],
        ["Mamy 8-mio osobowy stół.", "Mamy 8-osobowy stół."],
        ["Była 10 minutowa przerwa.", "Była 10-minutowa przerwa."],
        ["Został 4 krotnym mistrzem.", "Został 4-krotnym mistrzem."],
        ["Ten 15 latek jest zdolny.", "Ten 15-latek jest zdolny."],
        ["Mają trzy dzieci.", "Mają troje dzieci."],
        ["Bilet kosztował 3 złotych.", "Bilet kosztował 3 złote."],
        ["Reszta to 12 grosze.", "Reszta to 12 groszy."],
        ["Dodaj 200 gram mąki.", "Dodaj 200 gramów mąki."],
      ],
      neg: [
        "Wygrał już 3. raz.",
        "Przyjechał 12 czerwca.",
        "Ma 5kg nadwagi i 10km do domu.",
        "Pokój 2-osobowy jest wolny.",
        "Ten 15-latek jest zdolny.",
        "Obchodzimy 10-lecie firmy.",
        "Kupiłem 2 letnie sukienki.",
        "Porozmawiajmy w cztery oczy.",
        "Zdobył 2 złote medale.",
        "Bilet kosztował 3 złote.",
        "Gram w szachy od 5 lat, a 1 gram to mało.",
        "Wysłał CV-ki do 3 firm.",
        "Mam troje dzieci.",
      ],
    },
  ],
  [
    "polishDates",
    "impossible dates, weekdays and month forms",
    {
      pos: [
        ["Wyjazd 5 marzec 2021.", "Wyjazd 5 marca 2021."],
        ["Spotkanie 3. października.", "Spotkanie 3 października."],
        ["Wpis z 14 Lis 2019.", "Wpis z 14 XI 2019."],
        ["Pierwszy wrzesień był ciepły.", "Pierwszy września był ciepły."],
        ["Od 7 lipiec trwa remont.", "Od 7 lipca trwa remont."],
      ],
      neg: [
        "Urodził się 30 września 1990.",
        "Było to 29 lutego 2024.",
        "Dziś jest czwartek, 1 października 2026.",
        "Panował w latach 1814–1781 p.n.e.",
        "W roku 1962 – 272 000 osób.",
        "Rozdział 31 IX opisuje bitwę.",
        "Święto 1 Maj obchodzimy co roku.",
        "Obowiązuje od 2012-05-01.",
        "Zawody trwają od 1 do 10 lutego.",
      ],
    },
  ],
  [
    "polishMisplacedComma",
    "commas inside compound conjunctions and set phrases",
    {
      pos: [
        ["Mimo, że padało, wyszliśmy.", "Mimo że padało, wyszliśmy."],
        ["Zostałem w domu mimo, że chciałem iść.", "Zostałem w domu, mimo że chciałem iść."],
        ["Czytał gazetę podczas, gdy ona spała.", "Czytał gazetę, podczas gdy ona spała."],
        ["Przyjdę chyba, że zachoruję.", "Przyjdę, chyba że zachoruję."],
        ["Jest późno, a, więc idziemy.", "Jest późno, a więc idziemy."],
        ["Podaj numer o, ile go masz.", "Podaj numer, o ile go masz."],
        ["Chcąc, nie chcąc poszedł.", "Chcąc nie chcąc poszedł."],
        ["Kupił jabłka, gruszki, itd.", "Kupił jabłka, gruszki itd."],
      ],
      neg: [
        "Zostałem w domu, mimo że chciałem iść.",
        "Mówił wtedy nawet, gdy nikt nie słuchał.",
        "Czy tak, czy owak, idziemy.",
        "O, ile tu ludzi!",
        "Kupił jabłka itp., itd.",
        "Zjadł tyle, że pękł.",
      ],
    },
  ],
  [
    "polishMissingComma",
    "a comma before a subordinate clause",
    {
      pos: [
        ["Myślę że masz rację.", "Myślę, że masz rację."],
        ["Przyszedł żeby pomóc.", "Przyszedł, żeby pomóc."],
        ["Został w domu ponieważ padało.", "Został w domu, ponieważ padało."],
        ["To jest dom w którym mieszkam.", "To jest dom, w którym mieszkam."],
        ["Znam człowieka który to zrobił.", "Znam człowieka, który to zrobił."],
        ["Jest mały ale wygodny.", "Jest mały, ale wygodny."],
        ["Zadzwoń jeśli możesz.", "Zadzwoń, jeśli możesz."],
      ],
      neg: [
        "Myślę, że masz rację.",
        "Wyszedł, mimo że padało.",
        "Mówił tak że nikt nie rozumiał.",
        "A że padało, zostaliśmy.",
        "Wiem, że jeśli przyjdzie, to pomoże.",
        "To ustawa, na podstawie której go skazano.",
        "To młotek, za pomocą którego wbił gwóźdź.",
        "Mało który uczeń to wie.",
        "O której mogę przyjść?",
        "Poślij którego z nich.",
        "Nie ma żadnych ale.",
        "Właśnie że nie pójdę.",
        "Był w pokoju, w którym i w którego oknach paliło się światło.",
      ],
    },
  ],
  [
    "polishPrepositionForms",
    "w/we, z/ze, od/ode and the other vowel-extended prepositions",
    {
      pos: [
        ["Spotkajmy się w wtorek.", "Spotkajmy się we wtorek."],
        ["Byłem w Francji.", "Byłem we Francji."],
        ["Mieszka we Łodzi.", "Mieszka w Łodzi."],
        ["Wrócił z szkoły.", "Wrócił ze szkoły."],
        ["Pogadaj z wszystkimi.", "Pogadaj ze wszystkimi."],
        ["To prezent od mnie.", "To prezent ode mnie."],
        ["Nie dam rady bez mnie.", "Nie dam rady beze mnie."],
        ["Stał przed mną.", "Stał przede mną."],
        ["Wyszedł przede nim.", "Wyszedł przed nim."],
        ["Uciekł s domu.", "Uciekł z domu."],
      ],
      neg: [
        "Spotkajmy się we wtorek w Warszawie.",
        "Przede wszystkim spokój.",
        "Zbaw nas ode złego.",
        "Idziemy we dwoje.",
        "Wrócił ze Lwowa z wodą.",
        "Popatrzył spode łba.",
        "Byłem w wodzie i we mgle.",
        "Patrz na s. 12 w tekście.",
        "Wrócił z ZSRR i grał ze Sionem.",
        "Chodził w tę i we w tę.",
      ],
    },
  ],
  [
    "englishPhraseCorrections",
    "conventional forms: abbreviations, inflected names, na + regions, predicative -e",
    {
      pos: [
        ["Wyjechali do Węgier na urlop.", "Wyjechali na Węgry na urlop."],
        ["Polecimy do Islandii w maju.", "Polecimy na Islandię w maju."],
        ["Ważnym jest, aby odpocząć.", "Ważne jest, aby odpocząć."],
        ["Oczywistym było, że wygra.", "Oczywiste było, że wygra."],
        ["Ma 3 mln. długu.", "Ma 3 mln długu."],
        ["Lubię owoce, np jabłka.", "Lubię owoce, np. jabłka."],
        ["Zapłacił ok 50 zł.", "Zapłacił ok. 50 zł."],
        ["Widziałem Mark'a wczoraj.", "Widziałem Marka wczoraj."],
        ["Wysłał mi pięć SMSów.", "Wysłał mi pięć SMS-ów."],
      ],
      neg: [
        "Ta ziemia należała do Węgier.",
        "Z każdym jest tak, że się męczy.",
        "Mieszka pod nr. 5.",
        "Wymienił itd. i itp.",
        "Zajmuję się Joyce'em.",
        "To szansa dla Jacques'a.",
        "Biografia Kennedy'ego.",
        "Partia PiS wygrała.",
      ],
    },
  ],
];

/** Warnings without a fix: the range is flagged and nothing is offered. */
const POLISH_WARNINGS: Array<[CatalogRuleId, string, string]> = [
  ["polishDates", "Urodził się 31 kwietnia.", "31 kwietnia"],
  ["polishDates", "Termin to 30 II 2025.", "30 II 2025"],
  ["polishDates", "Rok 2023 miał dzień 29 lutego 2023.", "29 lutego 2023"],
  ["polishDates", "Było to w piątek, 1 października 2026.", "piątek, 1 października 2026"],
  ["polishDates", "Obóz trwa 20–3 lipca.", "20–3 lipca"],
  ["polishDates", "Wojna trwała w latach 1918–1914.", "1918–1914"],
];

test.each(POLISH_WARNINGS)("%s warns on %p", (ruleId, text, original) => {
  const found = findings(ruleId, text);
  expect(found.map((d) => [d.original, d.warningOnly])).toEqual([[original, true]]);
});

describe.each(POLISH_CASES)("%s: %s", (ruleId, _name, { pos, neg }) => {
  test.each(pos)("flags %p", (text, fixed) => {
    const [d, ...rest] = findings(ruleId, text);
    expect(rest).toEqual([]);
    expect(d).toBeDefined();
    expect(applyEdits(text, d.alternatives[0].edits)).toBe(fixed);
    expect(findings(ruleId, fixed)).toEqual([]);
  });
  test.each(neg)("leaves %p", (text) => {
    expect(findings(ruleId, text).map((d) => d.original)).toEqual([]);
  });
  test("runs only for Polish", () => {
    for (const [text] of pos) expect(findings(ruleId, text, "en_US")).toEqual([]);
  });
});

// Polish frames with clause lookbehinds must not reread long runs at every position.
const POLISH_TRIGGERS =
  "na prawdę za razem za pewne po woli z resztą co raz dla tego dla czego w prawdzie " +
  "tam ten widzi mi się zrobił by zrobili śmy za zwyczaj co miesięcznie wciągu bezsensu ";

function slowestChunkMs(text: string): number {
  const prepared = prepareReview(
    { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "pl_PL",
      enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  );
  let slowest = 0;
  for (const chunk of reviewChunks(prepared)) {
    const start = performance.now();
    scanReviewChunk(prepared, chunk);
    slowest = Math.max(slowest, performance.now() - start);
  }
  return slowest;
}

test("no Polish chunk stalls on long runs or repeated trigger words", () => {
  slowestChunkMs(POLISH_TRIGGERS.repeat(40));
  const inputs = [
    "\t ".repeat(6_000),
    `x${" ".repeat(3_800)}${POLISH_TRIGGERS}`.repeat(3),
    POLISH_TRIGGERS.repeat(60),
    "ała ".repeat(3_000),
    "słowo ".repeat(700),
  ];
  for (const text of inputs) expect(slowestChunkMs(text)).toBeLessThan(100);
});
