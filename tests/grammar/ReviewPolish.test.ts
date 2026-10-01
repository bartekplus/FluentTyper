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
];

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
