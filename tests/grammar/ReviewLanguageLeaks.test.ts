import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { REVIEW_DETECTORS } from "../../src/core/domain/grammar/review/reviewDetectors";
import { runsInReviewLanguage } from "../../src/core/domain/grammar/review/reviewCatalog";
import { EXTENSION_DETECTORS } from "../../src/core/domain/grammar/review/english";
import { GERMAN_DETECTORS } from "../../src/core/domain/grammar/review/german";
import { DETECTORS as GREEK } from "../../src/core/domain/grammar/review/greek/detectors";
import { DETECTORS as SWEDISH } from "../../src/core/domain/grammar/review/swedish/detectors";
import { DETECTORS as ARABIC } from "../../src/core/domain/grammar/review/arabic/detectors";
import { PORTUGUESE_DETECTORS } from "../../src/core/domain/grammar/review/portuguese";
import { POLISH_DETECTORS } from "../../src/core/domain/grammar/review/polish";
import { SPANISH_DETECTORS } from "../../src/core/domain/grammar/review/spanish";
import { FRENCH_DETECTORS } from "../../src/core/domain/grammar/review/french";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";
import { ALL_RULES, scan } from "./reviewHarness";

const LOCALES = ["en_US", "fr_FR", "de_DE", "es_ES", "pt_BR", "pl_PL", "sv_SE", "el_GR", "ar_SA"];

/** Plain correct sentences of our own in each Review language. */
const SENTENCES: Record<string, string> = {
  en_US:
    "No thanks, I already had lunch. It looks like rain, so take an umbrella. " +
    "She has been a superhero fan since she was little. We spent the summer on the Riviera.",
  fr_FR:
    "Non merci, j'ai déjà déjeuné. Mon fils adore ce super-héros depuis l'enfance. " +
    "Nous passons l'été sur la Côte d'Azur. Il fait beau, mais prends un parapluie.",
  de_DE:
    "Nein danke, ich habe schon gegessen. Wir verbringen den Sommer an der Ostsee. " +
    "Es sieht nach Regen aus, nimm also einen Schirm mit.",
  es_ES:
    "No, gracias, ya he comido. Pasamos el verano en la Costa Azul. " +
    "Parece que va a llover, así que lleva un paraguas.",
  pt_BR:
    "Não, obrigado, eu já almocei. Passamos o verão na Costa Azul. " +
    "Parece que vai chover, então leve um guarda-chuva.",
  pl_PL:
    "Nie, dziękuję, już jadłem obiad. Spędzamy lato nad morzem. " +
    "Wygląda na to, że będzie padać, więc weź parasol.",
  sv_SE:
    "Nej tack, jag har redan ätit lunch. Vi tillbringar sommaren vid havet. " +
    "Det ser ut att bli regn, så ta med ett paraply.",
  el_GR:
    "Όχι, ευχαριστώ, έχω ήδη φάει. Περνάμε το καλοκαίρι στη θάλασσα. " +
    "Φαίνεται ότι θα βρέξει, οπότε πάρε μια ομπρέλα.",
  ar_SA:
    "لا، شكرًا، لقد تناولت الغداء. نقضي الصيف على شاطئ البحر. " +
    "يبدو أنها ستمطر، لذلك خذ مظلة معك.",
};

/** Each clean corpus of tests/fixtures/native-review-corpus, by its language. */
const CORPORA: Record<string, string> = {
  en_US: "reference",
  fr_FR: "french-clean",
  de_DE: "german-clean",
  es_ES: "spanish-clean",
  pt_BR: "portuguese-clean",
  pl_PL: "polish-clean",
  ar_SA: "arabic-clean",
};
const corpus = (name: string) =>
  readFileSync(new URL(`../fixtures/native-review-corpus/${name}.txt`, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");

// Every language module's entry, by its detect function (the dispatcher holds tagged copies).
const MODULE_LANGUAGE = new Map<unknown, string>();
for (const [lang, entries] of Object.entries({
  en: EXTENSION_DETECTORS,
  de: GERMAN_DETECTORS,
  el: GREEK,
  sv: SWEDISH,
  ar: ARABIC,
  pt: PORTUGUESE_DETECTORS,
  pl: POLISH_DETECTORS,
  es: SPANISH_DETECTORS,
  fr: FRENCH_DETECTORS,
}))
  for (const entry of entries) MODULE_LANGUAGE.set(entry.detect, entry.lang ?? lang);

// A spy on each language entry: Review must not call it for text in another language.
const calls: string[] = [];
const originals = REVIEW_DETECTORS.map((entry) => entry.detect);
for (const [i, entry] of REVIEW_DETECTORS.entries()) {
  const lang = entry.lang;
  if (!lang) continue;
  const detect = entry.detect;
  (entry as { detect: typeof detect }).detect = (ctx) => {
    if (ctx.lang.slice(0, 2) !== lang) calls.push(`#${i} (${lang}) ran for ${ctx.lang}`);
    return detect(ctx);
  };
}
afterAll(() => {
  for (const [i, entry] of REVIEW_DETECTORS.entries())
    (entry as { detect: unknown }).detect = originals[i];
});

/** Findings whose rule the catalog does not run in `lang`, as "rule: text". */
function leaks(text: string, lang: string): string[] {
  return scan(text, { lang, enabledRules: ALL_RULES })
    .filter((d) => !runsInReviewLanguage(d.ruleId as CatalogRuleId, lang))
    .map((d) => `${d.ruleId}: ${d.original}`);
}

test("every language module's detector names its language", () => {
  const untagged = REVIEW_DETECTORS.filter(
    (entry) =>
      MODULE_LANGUAGE.has(entry.detect) && entry.lang !== MODULE_LANGUAGE.get(entry.detect),
  ).map((entry) => entry.rules.join(","));
  expect(untagged).toEqual([]);
  expect(MODULE_LANGUAGE.size).toBeGreaterThan(100);
});

test.each(LOCALES)("other languages' sentences stay inside the %s catalog", (lang) => {
  calls.length = 0;
  const found = Object.entries(SENTENCES)
    .filter(([other]) => other !== lang)
    .flatMap(([other, text]) => leaks(text, lang).map((leak) => `${other}: ${leak}`));
  expect(found).toEqual([]);
  expect(calls).toEqual([]);
});

test.each(Object.entries(CORPORA))("the clean %s corpus in other locales", (own, name) => {
  calls.length = 0;
  const text = corpus(name);
  const found = LOCALES.filter((lang) => lang !== own).flatMap((lang) =>
    leaks(text, lang).map((leak) => `${lang}: ${leak}`),
  );
  expect(found).toEqual([]);
  expect(calls).toEqual([]);
});
