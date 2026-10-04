import { describe, expect, test } from "bun:test";
import { slowestChunkMs } from "./reviewHarness";

// Time budgets (thread CPU time). bun run test runs *.timing.test.ts files serially,
// after the parallel run, so the load of other test workers does not inflate the times.

// Polish frames with clause lookbehinds must not reread long runs at every position.
const POLISH_TRIGGERS =
  "na prawdę za razem za pewne po woli z resztą co raz dla tego dla czego w prawdzie " +
  "tam ten widzi mi się zrobił by zrobili śmy za zwyczaj co miesięcznie wciągu bezsensu " +
  "zarówno ojciec, jak pełni ona istotną rolę dwie lub więcej godzin Oto co Tak jak tak i " +
  "nie jest twoja tylko Po zakończeniu prac, biuro do czekać ile warzy około pięć który, która " +
  "w przeciągu dwóch lat odnośnie tego tak długo a a a dopóki tam pisało że kliknij na link " +
  "do Krakowa i z potworem coraz lepie coraz ładnej, nie tylko a, a, a, alei zarzuty x y przestawił " +
  "zrobił si bał czele wespół ludźmi się wahał się na pływać cale życie ośrodek zdrowa rożnych lat " +
  "O ile a o tyle o tyle innymi słowy w miarę jak to a mianowicie tym bardziej, że uwagi, co do " +
  "w od godziny bynajmniej dla nie tyle a, ale zarówno a b jak również rozumie pod tym o wym " +
  "wiodącym destynacji opisał to w terminach na odcinku na okoliczność Generalnie Dokładnie. " +
  "genezy powstania cofnął się trochę do tyłu i/lub z Nami zwodniczym mirażem akwenów wodnych " +
  "wzdłuż polnej drużki kilku wierz do podług ciszej nisz był oby naważyli sobie " +
  "prze piękny prze siebie prze ze mnie 1990-1995 12-14 3 maja 20015 r. w maju 20155 roku ";

const slowest = (text: string) => slowestChunkMs(text, "pl_PL");

test("no Polish chunk stalls on long runs or repeated trigger words", () => {
  slowest(POLISH_TRIGGERS.repeat(40));
  const inputs = [
    "\t ".repeat(6_000),
    `x${" ".repeat(3_800)}${POLISH_TRIGGERS}`.repeat(3),
    POLISH_TRIGGERS.repeat(60),
    "ała ".repeat(3_000),
    "słowo ".repeat(700),
    // Clause starts after a line break look back over a bounded run of spaces only.
    `\n${" \t".repeat(1_950)}Mi się boje chodź to`.repeat(2),
  ];
  for (const text of inputs) expect(slowest(text)).toBeLessThan(100);
});

const slowestAgreement = (text: string) => slowestChunkMs(text, "pl_PL", ["polishCaseAgreement"]);

test("no chunk stalls on long runs of adjectives, nouns and prepositions", () => {
  slowestAgreement("ważną sprawa ".repeat(50));
  const inputs = [
    "ważną sprawa ".repeat(400),
    "przed sklepie tą książkę pięć kubki ".repeat(150),
    "ostatnich obecnie 23 osób nie 98 osoby ".repeat(150),
    "najpiękniejszymi przedsiębiorstwami ".repeat(150),
    "w ".repeat(3_000),
  ];
  for (const text of inputs) expect(slowestAgreement(text)).toBeLessThan(100);
});

describe("Polish clause boundaries", () => {
  test("no chunk stalls on long comma-free runs", () => {
    const slowest = (text: string) => slowestChunkMs(text, "pl_PL", ["polishMissingComma"]);
    slowest("kupiłem idąc był ".repeat(50));
    for (const text of [
      "kupiłem idąc był ".repeat(600),
      "zrobiwszy który powiedział a mając ".repeat(300),
      "słowo ".repeat(3_000),
    ])
      expect(slowest(text)).toBeLessThan(100);
  });
});
