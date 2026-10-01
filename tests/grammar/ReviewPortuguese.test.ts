import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  buildPortugueseLexicon,
  PORTUGUESE_LEXICON_SOURCES,
} from "../../scripts/generate-portuguese-lexicon";
import { findLiveGrammarProposals } from "../../src/core/domain/grammar/review/liveProposals";
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
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

const LANG = "pt_BR";

function findings(ruleId: CatalogRuleId, text: string, lang = LANG, userDictionary: string[] = []) {
  return detectReviewDiagnostics(
    { id: "pt", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules: [ruleId], lang, userDictionary, insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

/** Every finding's first alternative applied at once. */
function repaired(ruleId: CatalogRuleId, text: string): string {
  const edits = findings(ruleId, text).flatMap((d) => d.alternatives[0]?.edits ?? []);
  return applyEdits(text, edits);
}

type Fixture = { pos: Array<[string, string]>; neg: string[] };

const RULES: Array<[CatalogRuleId, Fixture]> = [
  [
    "portugueseAccentParonyms",
    {
      pos: [
        ["Ele trabalha na fabrica de tecidos.", "Ele trabalha na fábrica de tecidos."],
        ["Tenho uma duvida sobre o contrato.", "Tenho uma dúvida sobre o contrato."],
        ["Vamos colocar o plano em pratica amanhã.", "Vamos colocar o plano em prática amanhã."],
        ["Ela gosta de musica clássica.", "Ela gosta de música clássica."],
        ["Saiu na ultima edição do jornal.", "Saiu na última edição do jornal."],
        ["Recebemos a visita do medico ontem.", "Recebemos a visita do médico ontem."],
        ["Ligaram para a policia às duas.", "Ligaram para a polícia às duas."],
        ["Sem duvida, foi o melhor dia.", "Sem dúvida, foi o melhor dia."],
        ["Cada critica ajudou o texto.", "Cada crítica ajudou o texto."],
        ["Ele mora em uma fabrica antiga.", "Ele mora em uma fábrica antiga."],
      ],
      neg: [
        "Ela pratica natação toda semana.",
        "Ele nos critica sempre que pode.",
        "O governo publica os dados hoje.",
        "Um critica, o outro elogia.",
        "A secretaria da escola fecha cedo.",
        "Ele a fabrica em casa.",
        "Fiquei na dúvida até o fim.",
        "Isso seria uma boa ideia.",
        "A palavra “duvida” é um verbo.",
        "Visitamos a Fabrica de Ideias.",
        "Ele sabia da verdade.",
        "Abra o arquivo da pratica.md agora.",
      ],
    },
  ],
];

describe.each(RULES)("%s", (ruleId, { pos, neg }) => {
  test("runs only for Portuguese", () => {
    expect(runsInReviewLanguage(ruleId, LANG)).toBe(true);
    for (const lang of ["en_US", "es_ES", "fr_FR", "auto_detect"])
      expect(runsInReviewLanguage(ruleId, lang)).toBe(false);
  });
  test.each(pos)("flags %p", (text, expected) => {
    expect(repaired(ruleId, text)).toBe(expected);
    expect(findings(ruleId, expected)).toEqual([]);
  });
  test.each(neg.map((text) => [text]))("leaves %p alone", (text) => {
    expect(findings(ruleId, text)).toEqual([]);
  });
  test("stays silent in other languages and for the user's own words", () => {
    const [text] = pos[0];
    expect(findings(ruleId, text, "es_ES")).toEqual([]);
    const typed = findings(ruleId, text)[0];
    const word = text.slice(typed.range.start, typed.range.end).toLowerCase();
    expect(findings(ruleId, text, LANG, [word])).toEqual([]);
  });
});

test("the committed paronym table matches pt_BR.dic/.aff (bun run generate:portuguese-lexicon)", async () => {
  const [dic, aff, committed] = await Promise.all([
    readFile(PORTUGUESE_LEXICON_SOURCES.dic),
    readFile(PORTUGUESE_LEXICON_SOURCES.aff),
    readFile(PORTUGUESE_LEXICON_SOURCES.out, "utf8"),
  ]);
  expect(buildPortugueseLexicon(dic, aff)).toBe(committed);
});

// Adversarial input in the worst-case style of ReviewWorstCase.test.ts, for pt_BR.
const options = {
  lang: LANG,
  enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
};
const TRIGGERS =
  "na fabrica da duvida em pratica de musica para a policia um critica uma duvida em a de o ";

function slowestChunkMs(text: string): number {
  const prepared = prepareReview(
    { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    options,
  );
  let slowest = 0;
  for (const chunk of reviewChunks(prepared)) {
    const start = performance.now();
    scanReviewChunk(prepared, chunk);
    slowest = Math.max(slowest, performance.now() - start);
  }
  return slowest;
}

test("Portuguese frames stay fast on long runs of trigger words and spaces", () => {
  slowestChunkMs(TRIGGERS.repeat(20));
  const inputs = [
    TRIGGERS.repeat(60),
    `x${" ".repeat(3_800)}${TRIGGERS}`.repeat(3),
    "da ".repeat(3_000),
    "em a ".repeat(1_500),
  ];
  for (const text of inputs) expect(slowestChunkMs(text)).toBeLessThan(100);
  const live = { ...options, liveRules: [] };
  findLiveGrammarProposals(TRIGGERS.repeat(5), live);
  const start = performance.now();
  findLiveGrammarProposals(TRIGGERS.repeat(5), live);
  expect(performance.now() - start).toBeLessThan(50);
});
