import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { buildGermanLexicon, GERMAN_LEXICON_SOURCES } from "../../scripts/generate-german-lexicon";
import {
  germanNounReading,
  germanVerbLike,
} from "../../src/core/domain/grammar/review/german/germanLexicon";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  detectReviewDiagnostics,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

// German-only Review checks (src/core/domain/grammar/review/german/).

function findings(ruleId: CatalogRuleId, text: string, lang = "de_DE", userDictionary = []) {
  return detectReviewDiagnostics(
    { id: "de", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules: [ruleId], lang, userDictionary, insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

function fixed(ruleId: CatalogRuleId, text: string): string {
  const found = findings(ruleId, text);
  return applyEdits(
    text,
    found.flatMap((d) => d.alternatives[0].edits),
  );
}

type Fixture = { pos: Array<[string, string]>; neg: string[] };

const RULES: Array<[CatalogRuleId, Fixture]> = [
  [
    "germanNounCasing",
    {
      pos: [
        [
          "Wir haben gestern den vertrag unterschrieben.",
          "Wir haben gestern den Vertrag unterschrieben.",
        ],
        ["Ich habe heute keine zeit für so etwas.", "Ich habe heute keine Zeit für so etwas."],
        ["Die kosten sind dieses Jahr gestiegen.", "Die Kosten sind dieses Jahr gestiegen."],
        ["Er kam nach drei tagen zurück.", "Er kam nach drei Tagen zurück."],
        ["Beim laufen höre ich gern Musik.", "Beim Laufen höre ich gern Musik."],
        ["Sie hat mit großer mühe gewonnen.", "Sie hat mit großer Mühe gewonnen."],
        ["Der griff ist locker.", "Der Griff ist locker."],
        ["Wir rechnen mit hohen kosten.", "Wir rechnen mit hohen Kosten."],
        ["Das passiert in vielen fällen.", "Das passiert in vielen Fällen."],
        ["Die Post kam 2 tage später.", "Die Post kam 2 Tage später."],
      ],
      neg: [
        "Die kosten viel zu viel.",
        "Das stelle ich mir anders vor.",
        "Kannst du das ändern?",
        "Schuhe, die passen, sind selten.",
        "Von der leben sie seit Jahren.",
        "Die meisten kommen später.",
        "Wir versuchen, das zu ändern.",
        "Das tat weh.",
        "Es geht um die deutsche Sprache.",
        "Ich möchte das öffnen können.",
        "Er hat den Vertrag unterschrieben.",
        "Alle liefen kreuz und quer.",
        "Wenn man eine stellen darf, ist es gut.",
        "Er fragt, ob ich mit komme.",
      ],
    },
  ],
  [
    "germanPrepositionCase",
    {
      pos: [
        ["Ich fahre mit eine Kollegin nach Hause.", "Ich fahre mit einer Kollegin nach Hause."],
        ["Wir sprechen später mit diesen Mann.", "Wir sprechen später mit diesem Mann."],
        ["Das Paket kam von das Amt.", "Das Paket kam von dem Amt."],
        ["Wegen dem Regen bleiben wir drinnen.", "Wegen des Regens bleiben wir drinnen."],
        ["Trotz einem Fehler hat er gewonnen.", "Trotz eines Fehlers hat er gewonnen."],
        ["Der Brief ist für deiner Tante.", "Der Brief ist für deine Tante."],
        ["Komm doch zu mich rüber.", "Komm doch zu mir rüber."],
        ["Wir warten seit den letzten Monat.", "Wir warten seit dem letzten Monat."],
        ["Er wohnt bei seine alte Oma.", "Er wohnt bei seiner alten Oma."],
        ["Das gilt gemäß des Vertrages.", "Das gilt gemäß dem Vertrag."],
      ],
      neg: [
        "Das ist mit die beste Idee.",
        "Er ist der Sache wegen dem Bruder begegnet.",
        "Er half, ohne dem Nachbarn etwas zu sagen.",
        "Seit seine Mutter krank ist, kocht er.",
        "Während die Kinder schlafen, lesen wir.",
        "Was für einer Arbeit gehst du nach?",
        "Sie sah ab und zu einen Hund.",
        "Meiner Meinung nach keinen Grund zur Sorge.",
        "Wir rechnen mit keinen Problemen.",
        "Er spricht mit ihr Deutsch.",
        "Das ist der Grund, wegen dem Anna geht.",
      ],
    },
  ],
];

describe.each(RULES)("%s", (ruleId, { pos, neg }) => {
  test.each(pos)("repairs %p", (input, output) => {
    expect(findings(ruleId, input)).toHaveLength(1);
    expect(fixed(ruleId, input)).toBe(output);
    expect(findings(ruleId, output)).toHaveLength(0);
  });
  test.each(neg)("leaves %p alone", (input) => {
    expect(findings(ruleId, input)).toEqual([]);
  });
  test("runs in German only", () => {
    const [input] = pos[0];
    for (const lang of ["en_US", "fr_FR", "auto_detect"]) {
      expect(findings(ruleId, input, lang)).toEqual([]);
    }
  });
});

test("a word in the user's dictionary keeps its casing", () => {
  expect(
    findings("germanNounCasing", "Wir haben den vertrag.", "de_DE", ["vertrag"] as never),
  ).toEqual([]);
});

test("the committed lexicon matches de_DE.dic/.aff (bun run generate:german-lexicon)", async () => {
  const [dic, aff, committed] = await Promise.all(
    [GERMAN_LEXICON_SOURCES.dic, GERMAN_LEXICON_SOURCES.aff, GERMAN_LEXICON_SOURCES.out].map(
      (path) => readFile(path, "utf8"),
    ),
  );
  expect(buildGermanLexicon(dic, aff)).toBe(committed);
});

test.each([
  ["zugriff", "finite"],
  ["kosten", "infinitive"],
  ["vertrag", "finite"],
  ["zeit", "noun"],
  ["gute", null],
  ["morgen", null],
  ["schnell", null],
])("%s reads as %p", (word, reading) => {
  expect(germanNounReading(word)).toBe(reading as never);
});

test.each([
  ["arbeiten", true],
  ["gebe", true],
  ["machte", true],
  ["schönen", false],
])("%s may be a verb: %p", (word, verb) => {
  expect(germanVerbLike(word)).toBe(verb);
});

test("no German chunk stalls on repeated determiners and lowercase nouns", () => {
  const slowest = (text: string) => {
    const prepared = prepareReview(
      { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      {
        lang: "de_DE",
        enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
        userDictionary: [],
        insertSpaceAfterAutocomplete: true,
      },
    );
    let ms = 0;
    for (const chunk of reviewChunks(prepared)) {
      const start = performance.now();
      scanReviewChunk(prepared, chunk);
      ms = Math.max(ms, performance.now() - start);
    }
    return ms;
  };
  const inputs = [
    "die kosten die kosten ".repeat(400),
    "mit den schönen hohen ".repeat(400),
    `der ${"\t ".repeat(3_000)}vertrag`,
  ];
  slowest(inputs.join("\n"));
  for (const text of inputs) expect(slowest(text)).toBeLessThan(100);
});
