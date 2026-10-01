import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  buildSpanishLexicon,
  SPANISH_LEXICON_SOURCES,
} from "../../scripts/generate-spanish-lexicon";
import {
  REVIEW_SUPPORTED_RULE_IDS,
  reviewRuleIds,
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

const SPANISH_RULES: CatalogRuleId[] = ["spanishAccents", "spanishConfusions"];
const SPANISH_ON = REVIEW_SUPPORTED_RULE_IDS.filter(
  (id) =>
    runsInReviewLanguage(id, "es_ES") &&
    !["capitalizeSentenceStart", "capitalizeAfterLineBreak", "styleLongSentence"].includes(id),
);

function findings(ruleId: CatalogRuleId, text: string, userDictionary: string[] = []) {
  return detectReviewDiagnostics(
    { id: "es", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { enabledRules: [ruleId], lang: "es_ES", userDictionary, insertSpaceAfterAutocomplete: true },
  ).diagnostics.filter((d) => d.ruleId === ruleId);
}

type Fixture = { pos: Array<[string, string]>; neg: string[] };

const FIXTURES: Array<[CatalogRuleId, string, Fixture]> = [
  [
    "spanishAccents",
    "esta/está, estas/estás, este/esté",
    {
      pos: [
        ["Mi hermano esta en casa.", "Mi hermano está en casa."],
        ["La sopa esta muy caliente.", "La sopa está muy caliente."],
        ["El perro esta durmiendo.", "El perro está durmiendo."],
        ["¿Dónde esta el baño?", "¿Dónde está el baño?"],
        ["Ella esta cansada de esperar.", "Ella está cansada de esperar."],
        ["Esta claro que miente.", "Está claro que miente."],
        ["Creo que no se lo esta tomando en serio.", "Creo que no se lo está tomando en serio."],
        ["La puerta esta abierta.", "La puerta está abierta."],
        ["¿Ya estas listo?", "¿Ya estás listo?"],
        ["Si estas cansado, descansa.", "Si estás cansado, descansa."],
        ["¿Cómo estas?", "¿Cómo estás?"],
        ["Avísame cuando este listo.", "Avísame cuando esté listo."],
        ["Ojalá que este bien.", "Ojalá que esté bien."],
        ["Quiero que este en casa a las diez.", "Quiero que esté en casa a las diez."],
        ["Vivo con está chica desde hace un año.", "Vivo con esta chica desde hace un año."],
        ["Para está ocasión me pondré traje.", "Para esta ocasión me pondré traje."],
        ["Está misma tarde te llamo.", "Esta misma tarde te llamo."],
      ],
      neg: [
        "Esta mañana llovió mucho.",
        "Me gusta esta camisa.",
        "De todas, esta es la mejor.",
        "Combina esta falda con la chaqueta.",
        "Esta llamada duró una hora.",
        "Esta preciosa casa es de mi tía.",
        "Aunque esta en concreto no me gusta.",
        "Estas a su vez se dividen en dos.",
        "Creo que este cambio llega tarde.",
        "Lo que este informe refleja es grave.",
        "Una casa como esta no se encuentra.",
        "Según está escrito, nadie puede entrar.",
        "La moto esta no arranca.",
        "Ella está cansada.",
      ],
    },
  ],
  [
    "spanishConfusions",
    "homophones in fixed frames",
    {
      pos: [
        ["Nos vimos el ano pasado en Sevilla.", "Nos vimos el año pasado en Sevilla."],
        ["Viajo a Roma dos veces al ano.", "Viajo a Roma dos veces al año."],
        ["La música de los anos ochenta.", "La música de los años ochenta."],
        ["Ya lo he echo todo.", "Ya lo he hecho todo."],
        ["Le hecho sal a la sopa.", "Le echo sal a la sopa."],
        ["No hay podido venir.", "No ha podido venir."],
        ["¿Ya haz terminado?", "¿Ya has terminado?"],
        ["Espero que no halla llegado tarde.", "Espero que no haya llegado tarde."],
        ["El museo se haya en el centro.", "El museo se halla en el centro."],
        ["Estaba apunto de salir.", "Estaba a punto de salir."],
        ["Debería a ver estudiado más.", "Debería haber estudiado más."],
        ["Haber si nos vemos pronto.", "A ver si nos vemos pronto."],
        ["Cuando vallas a la tienda, compra pan.", "Cuando vayas a la tienda, compra pan."],
        ["Se reunieron entorno a la mesa.", "Se reunieron en torno a la mesa."],
        ["Vivo en una cuidad pequeña.", "Vivo en una ciudad pequeña."],
        ["Aún que llueva, iremos.", "Aunque llueva, iremos."],
        ["Necesito el menos dos horas.", "Necesito al menos dos horas."],
      ],
      neg: [
        "¿No la ves desde ahí?",
        "Te echo de menos.",
        "Las hechas a mano duran más.",
        "No hay pescado fresco.",
        "El pueblo se halla situado junto al río.",
        "No creo que se haya ido.",
        "Lo apunto en mi agenda.",
        "Su mérito fue haber llegado el primero.",
        "Espero que no se vuelva a ver afectado.",
        "El haz de luz atravesaba la niebla.",
        "La valla del jardín está rota.",
        "Vivimos en un entorno rural.",
        "Es más difícil aún que el anterior.",
        "Hace dos años que no lo veo.",
      ],
    },
  ],
];

describe.each(FIXTURES)("%s: %s", (ruleId, _family, fixture) => {
  test("at least 5 positives and 5 negatives", () => {
    expect(fixture.pos.length).toBeGreaterThanOrEqual(5);
    expect(fixture.neg.length).toBeGreaterThanOrEqual(5);
  });
  test.each(fixture.pos)("repairs %p", (input, expected) => {
    const found = findings(ruleId, input);
    expect(found).toHaveLength(1);
    expect(found[0].bulk.eligible).toBe(false);
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(findings(ruleId, expected)).toEqual([]);
  });
  test.each(fixture.neg)("keeps %p", (input) => {
    expect(findings(ruleId, input).map((d) => d.original)).toEqual([]);
  });
});

test("Spanish checks run only on Spanish text and are on by default", () => {
  for (const ruleId of SPANISH_RULES) {
    expect(runsInReviewLanguage(ruleId, "es_ES")).toBe(true);
    for (const lang of ["en_US", "fr_FR", "pt_BR", "auto_detect", "ar_SA"])
      expect(runsInReviewLanguage(ruleId, lang)).toBe(false);
    expect(reviewRuleIds({ codeMode: false, overrides: {} })).toContain(ruleId);
  }
});

test("a user-dictionary word and a cited example stay as typed", () => {
  expect(findings("spanishAccents", "Mi hermano esta en casa.", ["esta"])).toEqual([]);
  expect(findings("spanishAccents", "Escribe la palabra «esta en» con cuidado.")).toEqual([]);
});

test("the clean Spanish corpus has no findings", () => {
  const text = readFileSync("tests/fixtures/native-review-corpus/spanish-clean.txt", "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  const found = detectReviewDiagnostics(
    { id: "clean", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      enabledRules: SPANISH_ON,
      lang: "es_ES",
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics;
  expect(found.map((d) => `${d.ruleId}: ${d.original} @ ${d.range.start}`)).toEqual([]);
});

test("the committed Spanish lexicon matches es_ES.dic/.aff (bun run generate:spanish-lexicon)", async () => {
  const [dic, aff, committed] = await Promise.all(
    [SPANISH_LEXICON_SOURCES.dic, SPANISH_LEXICON_SOURCES.aff, SPANISH_LEXICON_SOURCES.out].map(
      (path) => readFile(path, "utf8"),
    ),
  );
  expect(buildSpanishLexicon(dic, aff)).toBe(committed);
});

test("no Spanish chunk stalls on repeated trigger words", () => {
  const options = {
    lang: "es_ES",
    enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
    userDictionary: [],
    insertSpaceAfterAutocomplete: true,
  };
  const slowest = (text: string) => {
    const prepared = prepareReview(
      { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      options,
    );
    let ms = 0;
    for (const chunk of reviewChunks(prepared)) {
      const start = performance.now();
      scanReviewChunk(prepared, chunk);
      ms = Math.max(ms, performance.now() - start);
    }
    return ms;
  };
  const triggers =
    "¿Que esta este estas el tu mi si se de aun mas? ¡Que bonito! No se si esta bien. ";
  slowest(triggers.repeat(50));
  for (const text of [
    triggers.repeat(60),
    "esta ".repeat(900),
    `x${" ".repeat(3_800)}${triggers}`.repeat(3),
    "¿".repeat(4_000),
  ])
    expect(slowest(text)).toBeLessThan(100);
});
