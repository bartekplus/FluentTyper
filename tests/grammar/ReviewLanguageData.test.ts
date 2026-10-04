import { describe, expect, spyOn, test } from "bun:test";
import { loadPackagedReviewData } from "../../src/adapters/chrome/background/ReviewEngineHost";
import { LocalReviewEngine } from "../../src/core/application/review/LocalReviewEngine";
import type { ReviewScanRequest } from "../../src/core/domain/contracts/reviewEngine";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  REVIEW_DATA_LANGUAGES,
  setReviewData,
} from "../../src/core/domain/grammar/review/reviewLanguageData";
import {
  REVIEW_LANGUAGE_SOURCES,
  mergedReviewData,
} from "../../src/core/domain/grammar/review/reviewLanguageSources";

const noPause = () => Promise.resolve();

function scanRequest(lang: string, text: string): ReviewScanRequest {
  return {
    snapshot: { id: lang, text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    options: {
      lang,
      enabledRules: REVIEW_SUPPORTED_RULE_IDS,
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
    cache: false,
    uiLanguage: "en",
  };
}

const fixes = (response: Awaited<ReturnType<LocalReviewEngine["scan"]>>) =>
  response.result.diagnostics.map(
    (d) => `${d.ruleId}: ${d.original} -> ${d.alternatives[0]?.preview}`,
  );

describe("generated Review data per language", () => {
  test("each language's modules merge into one file without a name clash", () => {
    expect(Object.keys(REVIEW_LANGUAGE_SOURCES).sort()).toEqual([...REVIEW_DATA_LANGUAGES]);
    for (const lang of REVIEW_DATA_LANGUAGES) {
      const names = REVIEW_LANGUAGE_SOURCES[lang].flatMap((module) => Object.keys(module));
      expect(Object.keys(mergedReviewData(lang))).toHaveLength(names.length);
    }
  });

  // One finding per language that needs the data. Each case runs in a process where that
  // language's detectors have not read the data yet (run-unit-tests isolates each file).
  test.each([
    ["ar_SA", "بقيت أربعة ساعات في المكتب.", "arabicAgreement: أربعة -> أربع"],
    ["de_DE", "Er hilft beim aufräumen der Küche.", "germanNounCasing: a -> A"],
    ["es_ES", "La puerta esta cerrada.", "spanishAccents: esta -> está"],
    ["fr_FR", "Les oiseaux chanter le matin.", "frenchVerbForms: chanter -> chantent"],
    ["pl_PL", "Ten menu ma dużo dań.", "polishCaseAgreement: Ten menu -> To menu"],
    ["pt_BR", "Tenho duvidas sobre o plano.", "portugueseAccentParonyms: duvidas -> dúvidas"],
    ["sv_SE", "Hon har ett röd bil.", "swedishAgreement: ett -> en"],
  ])(
    "%s: a failed load gives no finding that needs the data; the first load gives it",
    async (locale, text, fix) => {
      const lang = locale.slice(0, 2);
      const data = mergedReviewData(lang);
      setReviewData(lang, undefined);
      try {
        const offline = new LocalReviewEngine(noPause, undefined, () =>
          Promise.reject(new Error("no file")),
        );
        const failed = await offline.scan(scanRequest(locale, text));
        expect(fixes(failed)).not.toContain(fix);
        expect(failed.result.coverage.skipped["rule-error"]).toBeGreaterThan(0);

        const loads: string[] = [];
        const engine = new LocalReviewEngine(noPause, undefined, async (code) => {
          loads.push(code);
          // As fetched: review-data/<lang>.json.
          return JSON.parse(JSON.stringify(data));
        });
        const first = await engine.scan(scanRequest(locale, text));
        expect(fixes(first)).toContain(fix);
        expect(first.result.coverage.skipped["rule-error"]).toBeUndefined();
        await engine.scan(scanRequest(locale, text));
        expect(loads).toEqual([lang]);
      } finally {
        setReviewData(lang, data);
      }
    },
  );

  test("English and languages without generated data load nothing", async () => {
    const loads: string[] = [];
    const engine = new LocalReviewEngine(noPause, undefined, async (code) => {
      loads.push(code);
      return undefined;
    });
    await engine.scan(scanRequest("en_US", "This are a test."));
    await engine.scan(scanRequest("el_GR", "Αυτό είναι ένα τεστ."));
    await engine.liveProposals(
      "Er hilft beim aufräumen der Küche. ",
      { ...scanRequest("de_DE", "").options, liveRules: [] },
      "en",
    );
    expect(loads).toEqual([]);
  });

  test("the background reads a language's file from the package once", async () => {
    const globals = globalThis as unknown as { chrome?: unknown };
    const originalChrome = globals.chrome;
    globals.chrome = { runtime: { getURL: (file: string) => `ext:///${file}` } };
    const fetched: string[] = [];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      fetched.push(url);
      return url.endsWith("/sv.json")
        ? Response.json({ NEUTER: "x" })
        : new Response(null, { status: 404 });
    }) as unknown as typeof fetch);
    try {
      expect(await loadPackagedReviewData("sv")).toEqual({ NEUTER: "x" });
      expect(await loadPackagedReviewData("sv")).toEqual({ NEUTER: "x" });
      expect(await loadPackagedReviewData("xx")).toBeUndefined();
      expect(fetched).toEqual(["ext:///review-data/sv.json", "ext:///review-data/xx.json"]);
    } finally {
      fetchSpy.mockRestore();
      globals.chrome = originalChrome;
    }
  });
});
