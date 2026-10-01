import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import {
  CLOSED_COMPOUNDS,
  PHRASE_CORRECTIONS,
  STYLE_PHRASES,
  type PhraseRow,
} from "../../src/core/domain/grammar/review/englishPhraseTables";
import {
  LANGUAGE_PHRASE_TABLES,
  type LanguagePhraseTables,
} from "../../src/core/domain/grammar/review/languagePhraseTables";
import {
  PHRASE_TABLE_KINDS,
  runsInReviewLanguage,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

const IDS: CatalogRuleId[] = [
  "englishPhraseCorrections",
  "englishClosedCompounds",
  "stylePhrasing",
];
const LANGS: Record<string, string> = {
  de: "de_DE",
  fr: "fr_FR",
  es: "es_ES",
  pt: "pt_BR",
  pl: "pl_PL",
  sv: "sv_SE",
  hr: "hr_HR",
  el: "el_GR",
};
const ALL_LANGS = ["en_US", ...Object.values(LANGS), "ar_SA", "auto_detect"];
/** A plain sentence in each language around the typed form. */
const FRAMES: Record<string, (form: string) => string> = {
  de: (form) => `Gestern hat er ${form} gesagt.`,
  fr: (form) => `Hier il a dit ${form} ici.`,
  es: (form) => `Ayer ella dijo ${form} aquí.`,
  pt: (form) => `Ontem ela disse ${form} aqui.`,
  pl: (form) => `Wczoraj powiedział ${form} tutaj.`,
  sv: (form) => `I går sa hon ${form} här.`,
  hr: (form) => `Jučer je rekla ${form} ovdje.`,
  el: (form) => `Χθες είπε ${form} εδώ.`,
};
const KINDS: Array<[keyof LanguagePhraseTables, CatalogRuleId]> = [
  ["words", "englishPhraseCorrections"],
  ["phrases", "englishPhraseCorrections"],
  ["compounds", "englishClosedCompounds"],
  ["style", "stylePhrasing"],
];

function scan(text: string, lang: string): ReviewDiagnostic[] {
  return detectReviewDiagnostics(
    { id: "phrases", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { lang, enabledRules: IDS, userDictionary: [], insertSpaceAfterAutocomplete: true },
  ).diagnostics;
}

const forms = (rows: readonly PhraseRow[] = []) =>
  rows.flatMap(([typed, replacement]) =>
    [typed].flat().map((form) => [form, [replacement].flat()] as const),
  );
const ROWS = Object.entries(LANGUAGE_PHRASE_TABLES).flatMap(([code, tables]) =>
  KINDS.flatMap(([kind, ruleId]) =>
    forms(tables[kind]).map(([form, replacements]) => [code, ruleId, form, replacements] as const),
  ),
);
const typedIn = new Map<string, Set<string>>([
  [
    "en",
    new Set(
      [PHRASE_CORRECTIONS, CLOSED_COMPOUNDS, STYLE_PHRASES].flatMap((rows) =>
        forms(rows).map(([form]) => form.toLowerCase()),
      ),
    ),
  ],
  ...Object.entries(LANGUAGE_PHRASE_TABLES).map(
    ([code, tables]) =>
      [
        code,
        new Set(KINDS.flatMap(([kind]) => forms(tables[kind]).map(([form]) => form.toLowerCase()))),
      ] as const,
  ),
]);

test("the catalog's restated table kinds match the authored tables", () => {
  const authored = Object.fromEntries(
    Object.entries(LANGUAGE_PHRASE_TABLES).map(([code, tables]) => [
      code,
      KINDS.map(([kind]) => kind).filter((kind) => (tables[kind]?.length ?? 0) > 0),
    ]),
  );
  expect(PHRASE_TABLE_KINDS).toEqual(authored);
});

test("every table language is a review language, and each rule runs where it has rows", () => {
  for (const [code, tables] of Object.entries(LANGUAGE_PHRASE_TABLES)) {
    expect(LANGS[code]).toBeDefined();
    for (const [kind, ruleId] of KINDS) {
      if (tables[kind]) expect(runsInReviewLanguage(ruleId, LANGS[code])).toBe(true);
    }
  }
});

// Every typed form of every row, in running text, gets exactly its replacements.
test.each(ROWS)("%s %s corrects %p", (code, ruleId, form, replacements) => {
  const lang = LANGS[code];
  const text = FRAMES[code](form);
  const found = scan(text, lang);
  expect(found.map((d) => [d.ruleId, d.original])).toEqual([[ruleId, form]]);
  const [d] = found;
  expect(d.alternatives.map((a) => a.preview)).toEqual(replacements);
  expect(d.requiresChoice ?? false).toBe(replacements.length > 1);
  expect(d.bulk.eligible).toBe(false);
  for (const [index, alternative] of d.alternatives.entries()) {
    const fixed = applyEdits(text, alternative.edits)!;
    expect(fixed).toBe(text.replace(form, replacements[index]));
    expect(scan(fixed, lang)).toEqual([]);
  }
});

// A row only runs in its own language: "language" is English, "Standart" is not French.
test.each(ROWS)("%s %s %p stays in its language", (code, _ruleId, form) => {
  for (const lang of ALL_LANGS) {
    const other = lang.slice(0, 2);
    if (other === code || typedIn.get(other)?.has(form.toLowerCase())) continue;
    expect(scan(FRAMES[code](form), lang).map((d) => d.original)).not.toContain(form);
  }
});

test("no typed form is listed twice in a language or equals its own replacement", () => {
  for (const tables of Object.values(LANGUAGE_PHRASE_TABLES)) {
    const all = KINDS.flatMap(([kind]) =>
      forms(tables[kind]).map(([form, replacements]) => {
        expect(replacements).not.toContain(form);
        return form.toLowerCase();
      }),
    );
    expect(new Set(all).size).toBe(all.length);
  }
});

test("French elided articles and pronouns stay attached", () => {
  const one = (text: string) =>
    scan(text, "fr_FR").map((d) => [d.original, d.alternatives[0].preview]);
  expect(one("J'ai perdu l'addresse du client.")).toEqual([["addresse", "adresse"]]);
  expect(one("Il faut l’apeller demain.")).toEqual([["apeller", "appeler"]]);
  expect(one("C'est à dire que non.")).toEqual([["C'est à dire", "C'est-à-dire"]]);
  expect(one("Il reste aujourd’hui, c’est à dire lundi.")).toEqual([
    ["c’est à dire", "c’est-à-dire"],
  ]);
  // Not an elision: an English contraction or a joined word.
  expect(one("Voir le document don'tlanguage.txt.")).toEqual([]);
});

test("casing follows the typed text", () => {
  const one = (text: string, lang: string) => scan(text, lang)[0].alternatives[0].preview;
  expect(one("Vorraus geht der Test.", "de_DE")).toBe("Voraus");
  expect(one("DER STANDART GILT.", "de_DE")).toBe("STANDARD");
  expect(one("Wir nutzen den standart heute.", "de_DE")).toBe("Standard");
  expect(one("Aufwiedersehen und danke.", "de_DE")).toBe("Auf Wiedersehen");
  expect(one("Meines Wissens nach stimmt das.", "de_DE")).toBe("Meines Wissens");
  expect(one("Quelque soit le prix, on achète.", "fr_FR")).toBe("Quel que soit");
});

test("user dictionary words, quoted mentions and code abstain", () => {
  const text = "Der Standart ist hoch.";
  expect(
    detectReviewDiagnostics(
      { id: "dict", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      {
        lang: "de_DE",
        enabledRules: IDS,
        userDictionary: ["standart"],
        insertSpaceAfterAutocomplete: true,
      },
    ).diagnostics,
  ).toEqual([]);
  expect(scan("Das Wort „Standart“ ist falsch.", "de_DE")).toEqual([]);
  expect(scan("Die Datei standart.txt fehlt.", "de_DE")).toEqual([]);
  expect(scan("Siehe https://example.com/Standart heute.", "de_DE")).toEqual([]);
  expect(scan("Le mot « parmis » est fautif.", "fr_FR")).toEqual([]);
});
