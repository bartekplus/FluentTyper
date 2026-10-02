import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { buildPolishLexicon, POLISH_LEXICON_SOURCES } from "../../scripts/generate-polish-lexicon";
import {
  adjectiveOf,
  cases,
  nounTags,
  onlyNoun,
} from "../../src/core/domain/grammar/review/polish/lexicon";
import {
  REVIEW_SUPPORTED_RULE_IDS,
  runsInReviewLanguage,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  detectReviewDiagnostics,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

const RULE = "polishCaseAgreement";

function findings(text: string, lang = "pl_PL", rules: string[] = [RULE]) {
  return detectReviewDiagnostics(
    { id: "pl", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules: rules as never, lang, userDictionary: [], insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => rules.includes(d.ruleId));
}

/** [text, the flagged words, one of the fixes applied (null: a warning without a fix)]. */
const POSITIVES: Array<[string, string, string | null]> = [
  // Nouns of a fixed gender.
  ["Kupiłam sobie nowy perfum.", "nowy perfum", "Kupiłam sobie nowe perfumy."],
  [
    "Taki słodki pomarańcz kosztuje złotówkę.",
    "Taki słodki pomarańcz",
    "Taka słodka pomarańcza kosztuje złotówkę.",
  ],
  ["Ten menu jest za długie.", "Ten menu", "To menu jest za długie."],
  ["Dałem mu jeden euro.", "jeden euro", "Dałem mu jedno euro."],
  ["Mój ulubiony kakao stygnie.", "Mój ulubiony kakao", "Moje ulubione kakao stygnie."],
  // A negated verb takes the genitive.
  ["Dziś nie mam czas na kino.", "czas", "Dziś nie mam czasu na kino."],
  ["Nie widzę różnicę między nimi.", "różnicę", "Nie widzę różnicy między nimi."],
  ["Nie lubię ją od dawna.", "ją", "Nie lubię jej od dawna."],
  ["Wczoraj nie kupiłem gazetę.", "gazetę", "Wczoraj nie kupiłem gazety."],
  ["Nie pij zimną wodę.", "zimną wodę", "Nie pij zimnej wody."],
  ["Czemu nie znasz odpowiedź?", "odpowiedź", "Czemu nie znasz odpowiedzi?"],
  ["Nie mamy nowy samochód.", "nowy samochód", "Nie mamy nowego samochodu."],
  // A noun in a case the preposition does not govern.
  ["Czekałem przed sklepie na autobus.", "sklepie", "Czekałem przed sklepem na autobus."],
  ["Schowaj klucze pod wycieraczką albo pod kamieniach.", "kamieniach", null],
  ["Napisała list do mamie.", "mamie", "Napisała list do mamy."],
  ["Dostałem prezent od siostrą.", "siostrą", "Dostałem prezent od siostry."],
  ["Wszystko to przez pogodą.", "pogodą", "Wszystko to przez pogodę."],
  ["Byliśmy przy grobem dziadka.", "grobem", "Byliśmy przy grobie dziadka."],
  ["Poszedł tam wraz z kolegi.", "kolegi", "Poszedł tam wraz z kolegą."],
  // The person ending on the verb instead of "żeby"/"gdyby".
  ["Prosiła, żeby szybko wróciłem.", "żeby szybko wróciłem", "Prosiła, żebym szybko wrócił."],
  ["Chcą, aby to zrobiliście.", "aby to zrobiliście", "Chcą, abyście to zrobili."],
  ["Gdybyś wiedziałaś, nie pytałabyś.", "Gdybyś wiedziałaś", "Gdybyś wiedziała, nie pytałabyś."],
  // A verb that takes the genitive with an accusative object.
  ["Na budowie używamy młotek.", "młotek", null],
  ["Kierowcy muszą przestrzegać przepisy.", "przepisy", "Kierowcy muszą przestrzegać przepisów."],
  ["Potrzebuję szybką pomoc.", "pomoc", null],
  // A demonstrative that does not agree with its noun.
  ["Kupiłem tą książkę wczoraj.", "tą", "Kupiłem tę książkę wczoraj."],
  ["Przeczytaj tą krótką notatkę.", "tą", "Przeczytaj tę krótką notatkę."],
  ["Te dziecko ciągle płacze.", "Te", "To dziecko ciągle płacze."],
  ["Lubię te miejsce nad rzeką.", "te", "Lubię to miejsce nad rzeką."],
  ["Jedne jabłko spadło z drzewa.", "Jedne", "Jedno jabłko spadło z drzewa."],
  ["Znam ten dziewczynę ze szkoły.", "ten", "Znam tę dziewczynę ze szkoły."],
  // A numeral from five up with a nominative noun.
  ["Mam w torbie kilka książka.", "książka", "Mam w torbie kilka książek."],
  ["Na półce stało pięć kubki.", "kubki", "Na półce stało pięć kubków."],
  ["Zamówiłem 15 pierogi z mięsem.", "pierogi", "Zamówiłem 15 pierogów z mięsem."],
  ["Na przystanku czekało 37 osoby.", "osoby", "Na przystanku czekało 37 osób."],
  ["Przeczytałem pięć książki.", "książki", "Przeczytałem pięć książek."],
  // Two to four (and 22-24, 32-34…) take the nominative plural.
  ["Do finału awansowały 22 drużyn.", "drużyn", "Do finału awansowały 22 drużyny."],
  ["Zostały mi cztery minut.", "minut", "Zostały mi cztery minuty."],
  ["W koszyku leżą trzy jabłek.", "jabłek", "W koszyku leżą trzy jabłka."],
  ["Za bilet zapłaciłem 15 złoty.", "złoty", "Za bilet zapłaciłem 15 złotych."],
  ["Budżet wynosi 3 mln złoty.", "złoty", "Budżet wynosi 3 mln złotych."],
  // An adjective that does not agree with its noun.
  ["To była ciekawą wycieczka.", "ciekawą wycieczka", "To była ciekawa wycieczka."],
  ["Rozmawiałam z ważna osobą.", "ważna osobą", "Rozmawiałam z ważną osobą."],
  ["Musimy znaleźć odpowiednia osobę.", "odpowiednia osobę", "Musimy znaleźć odpowiednią osobę."],
  [
    "Mały dziecko bawiło się w piaskownicy.",
    "Mały dziecko",
    "Małe dziecko bawiło się w piaskownicy.",
  ],
  ["Kupiliśmy szybkie samochód.", "szybkie samochód", "Kupiliśmy szybki samochód."],
  [
    "Spotkałem się z dobrym przyjaciółką.",
    "dobrym przyjaciółką",
    "Spotkałem się z dobrą przyjaciółką.",
  ],
  ["Powołano komisje specjalną.", "komisje specjalną", "Powołano komisję specjalną."],
  ["Zamówiliśmy pizze dużą.", "pizze dużą", "Zamówiliśmy pizzę dużą."],
];

const NEGATIVES = [
  "Nie używam perfum.",
  "Kilo pomarańcz kosztuje dziś mniej.",
  "Moje hobby to sushi.",
  "Zapłacił w euro.",
  "Tego menu nie znam.",
  "Nie mam czasu na kino.",
  "Nie widział go cały dzień.",
  "Nie widzi pies kota.",
  "Nie mam dziś ochoty.",
  "Nie ma tu nikogo.",
  "Nie kupiłem nowego samochodu.",
  "Nie pije kawa, tylko herbata.",
  "Nie zna litość granic.",
  "Obok stoi stary dom.",
  "Wokół panowała zupełna cisza.",
  "W zamian za pomoc dostał obiad.",
  "Przed laty mieszkaliśmy na wsi.",
  "Wrócił do domu zmęczony.",
  "Opuściła salę zapłakana.",
  "Wśród zebranych prezes wygłosił przemówienie.",
  "Byłem tam pięć razy.",
  "Wzrost wyniósł kilka procent.",
  "Od 3 lat pracuję w tej firmie.",
  "Nie widziałem 2 osób z naszej grupy.",
  "Przeczytałem rozdział 5 książki.",
  "Zapłaciłem dwa procent prowizji.",
  "Zatrudnili 4 nauczycieli.",
  "W ciągu ostatnich 3 lat sporo się zmieniło.",
  "Grupa 3 osób czekała przed wejściem.",
  "Straciła większość z posiadanych wtedy 23 sklepów.",
  "W folderze są pliki i kilka zdjęć.",
  "Bez urazy, ale w zamian chcę spokoju.",
  "Bilet kosztował 1 złoty, a karnet 2 złote.",
  "W 2010 papież odwiedził nasze miasto.",
  "Matka była zajęta pracą.",
  "Dzbanek był pełen wody, a szklanka pełna mleka.",
  "Czytająca książkę dziewczyna nie zauważyła autobusu.",
  "Uczynił życie łatwiejszym.",
  "Ustąp miejsca starszemu.",
  "To jest algorytm obliczania średniej.",
  "Każdy kierowca powinien znać przepisy.",
  "Na różnego rodzaju imprezach spotykamy wielu ludzi.",
  "W górach wysokich pogoda szybko się zmienia.",
  "Kandydatury te każde państwo rozpatrzy osobno.",
  "Kup te mamie, bardzo je lubi.",
  "Te, które kupiłeś, są za małe.",
  "Wraz z por. Nowakiem przyszedł kapitan.",
  "Tej wysokiej nikt nie przegapi.",
  "Ta kobieta jest piękna urodą i silna wolą.",
  "Na budowie używamy młotka.",
  "Prosiła, żebym szybko wrócił.",
  "Poszedł tam, żeby przed stołem stanąć.",
  "Mówił, że wróciłem za późno.",
  "Szukam pracy od miesiąca.",
  "Potrzebuje opieki dziecko sąsiadów.",
];

describe("polishCaseAgreement", () => {
  test.each(POSITIVES)("flags %p", (text, original, fixed) => {
    const [d, ...rest] = findings(text);
    expect(rest).toEqual([]);
    expect(d?.original).toBe(original);
    if (fixed === null) expect(d.warningOnly).toBe(true);
    else {
      expect(d.alternatives.map((alt) => applyEdits(text, alt.edits))).toContain(fixed);
      expect(findings(fixed)).toEqual([]);
    }
  });
  test.each(NEGATIVES)("leaves %p", (text) => {
    expect(findings(text).map((d) => d.original)).toEqual([]);
  });
  test("offers both fixes when either word may be the typo", () => {
    const text = "Pływanie to męską dyscyplina.";
    const [d] = findings(text);
    expect(d.alternatives.map((alt) => applyEdits(text, alt.edits))).toEqual([
      "Pływanie to męska dyscyplina.",
      "Pływanie to męską dyscypliną.",
    ]);
    expect(d.requiresChoice).toBe(true);
  });
  test("runs only for Polish", () => {
    for (const [text] of POSITIVES) expect(findings(text, "en_US")).toEqual([]);
  });
  test("skips words the user added", () => {
    const text = "Czekałem przed sklepie.";
    const found = detectReviewDiagnostics(
      { id: "pl", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      {
        enabledRules: [RULE],
        lang: "pl_PL",
        userDictionary: ["sklepie"],
        insertSpaceAfterAutocomplete: true,
      },
    ).diagnostics;
    expect(found).toEqual([]);
  });
});

test("the lexicon reads cases, genders and other parts of speech", () => {
  expect(nounTags("sklepie") & cases("Ls")).toBeTruthy();
  expect(nounTags("sklepem") & cases("Is")).toBeTruthy();
  expect(nounTags("książkę") & cases("As")).toBeTruthy();
  expect(nounTags("pisaniem") & cases("Is")).toBeTruthy();
  expect(onlyNoun(nounTags("dobra"))).toBe(false); // also the adjective
  expect(onlyNoun(nounTags("jak"))).toBe(false); // the conjunction, not a yak
  expect(nounTags("zielony")).toBe(0);
  // Paradigm cells: "osoby" is no genitive plural ("osób"), "ulicy" no nominative plural
  // ("ulice"); "kości" is both. A rare homograph ("plika") does not add its cases to "pliki".
  expect(nounTags("osoby") & cases("Gp")).toBe(0);
  expect(nounTags("osoby") & cases("Gs Np")).toBe(cases("Gs Np"));
  expect(nounTags("ulicy") & cases("Np Gp")).toBe(0);
  expect(nounTags("kości") & cases("Np Gp")).toBe(cases("Np Gp"));
  expect(nounTags("pliki") & cases("Gs")).toBe(0);
  expect(nounTags("miesięcy") & cases("Np")).toBe(0);
  expect(adjectiveOf("polskiego")).toEqual({ lemma: "polski", ending: "ego" });
  expect(adjectiveOf("ostatnią")).toEqual({ lemma: "ostatni", ending: "ą" });
  expect(adjectiveOf("sklepie")).toBeNull();
});

test("the committed lexicon matches pl_PL.dic/.aff and the n-gram counts (bun run generate:polish-lexicon)", async () => {
  const S = POLISH_LEXICON_SOURCES;
  const [dic, aff, committed] = await Promise.all(
    [S.dic, S.aff, S.out].map((path) => readFile(path, "utf8")),
  );
  const [trie, counts] = await Promise.all([
    Bun.file(S.trie).arrayBuffer(),
    Bun.file(S.counts).arrayBuffer(),
  ]);
  expect(await buildPolishLexicon(dic, aff, trie, counts)).toBe(committed);
  // Expanding the whole dictionary takes a few seconds.
}, 60_000);

const POLISH_RULES = REVIEW_SUPPORTED_RULE_IDS.filter(
  (id) =>
    runsInReviewLanguage(id, "pl_PL") &&
    !["capitalizeSentenceStart", "capitalizeAfterLineBreak", "styleLongSentence"].includes(id),
);

test("the clean Polish corpus has no findings", () => {
  const text = readFileSync("tests/fixtures/native-review-corpus/polish-clean.txt", "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  const found = detectReviewDiagnostics(
    { id: "clean", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      enabledRules: POLISH_RULES,
      lang: "pl_PL",
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics;
  expect(found.map((d) => `${d.ruleId}: ${d.original} @ ${d.range.start}`)).toEqual([]);
});

function slowestChunkMs(text: string): number {
  const prepared = prepareReview(
    { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { lang: "pl_PL", enabledRules: [RULE], userDictionary: [], insertSpaceAfterAutocomplete: true },
  );
  let slowest = 0;
  for (const chunk of reviewChunks(prepared)) {
    const start = performance.now();
    scanReviewChunk(prepared, chunk);
    slowest = Math.max(slowest, performance.now() - start);
  }
  return slowest;
}

test("no chunk stalls on long runs of adjectives, nouns and prepositions", () => {
  slowestChunkMs("ważną sprawa ".repeat(50));
  const inputs = [
    "ważną sprawa ".repeat(400),
    "przed sklepie tą książkę pięć kubki ".repeat(150),
    "ostatnich obecnie 23 osób nie 98 osoby ".repeat(150),
    "najpiękniejszymi przedsiębiorstwami ".repeat(150),
    "w ".repeat(3_000),
  ];
  for (const text of inputs) expect(slowestChunkMs(text)).toBeLessThan(100);
});

describe("Polish degrees of comparison", () => {
  const degree = (text: string) =>
    findings(text, "pl_PL", ["englishDoubledDegree", "stylePhrasing"]).map((d) => [
      d.ruleId,
      applyEdits(text, d.alternatives[0].edits),
    ]);
  test.each([
    ["Ta książka jest bardziej ciekawsza.", "englishDoubledDegree", "Ta książka jest ciekawsza."],
    ["To był najbardziej najlepszy dzień.", "englishDoubledDegree", "To był najlepszy dzień."],
    ["Stań bardziej bliżej okna.", "englishDoubledDegree", "Stań bliżej okna."],
    [
      "Wybrano najbardziej optymalny wariant.",
      "englishDoubledDegree",
      "Wybrano optymalny wariant.",
    ],
    [
      "Rower jest coraz najbardziej modny.",
      "englishDoubledDegree",
      "Rower jest coraz bardziej modny.",
    ],
    ["To jest bardziej ważna sprawa.", "stylePhrasing", "To jest ważniejsza sprawa."],
    ["Wybierz najbardziej tani bilet.", "stylePhrasing", "Wybierz najtańszy bilet."],
    ["Pisz bardziej dokładnie.", "stylePhrasing", "Pisz dokładniej."],
    ["Dziś czuję się bardziej dobrze.", "stylePhrasing", "Dziś czuję się lepiej."],
  ])("%p", (text, ruleId, fixed) => {
    expect(degree(text)).toEqual([[ruleId, fixed]]);
  });
  test.each([
    "Tym bardziej lepiej, że przyszedłeś.",
    "Im bardziej się starał, tym gorzej mu szło.",
    "To jest bardziej znany pisarz.",
    "Jest bardziej zmęczony niż wczoraj.",
    "Najbardziej lubię wiosnę.",
  ])("leaves %p", (text) => {
    expect(degree(text)).toEqual([]);
  });
});
