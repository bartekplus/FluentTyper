import libPresageMod from "../src/third_party/libpresage/libpresage.js";
import { PresageHandler } from "../src/adapters/chrome/background/PresageHandler";
import { REVIEW_SPELLING_BUDGET_MS } from "../src/adapters/chrome/background/PresageEngine";
import { predictionConfig, runPrediction } from "./support/predictionConfig";

function createLiveConfig(textExpansions: Array<[string, string]>) {
  return predictionConfig({
    insertSpaceAfterAutocomplete: true,
    textExpansions: textExpansions as unknown as Array<[string, object]>,
  });
}

async function createLiveHandler(
  options?: ConstructorParameters<typeof PresageHandler>[1],
): Promise<PresageHandler> {
  const root = process.cwd();
  const Module = await libPresageMod({
    locateFile: (name: string) =>
      name.endsWith(".wasm")
        ? `${root}/src/third_party/libpresage/${name}`
        : `${root}/public/third_party/libpresage/${name}`,
  });
  return new PresageHandler(Module, options);
}

describe("PresageHandler live user dictionary", () => {
  test("custom words appear in suggestions when userDictionaryList is set", async () => {
    // Regression: DefaultDictionaryPredictor was accidentally removed from presage.xml
    // causing custom words to be silently ignored (issue #341).
    const handler = await createLiveHandler();

    handler.setConfig({
      ...createLiveConfig([]),
      userDictionaryList: ["fluenttypertest"],
    });

    const result = await runPrediction(handler, "fluenttypert", "", "en_US");
    expect(result.predictions.map((p) => p.trim())).toContain("fluenttypertest");
  });
});

describe("PresageHandler live PREFIX_ONLY_MODE", () => {
  test("without prefix-only mode, predictions include non-prefix matches", async () => {
    const handler = await createLiveHandler();

    handler.setConfig({
      ...createLiveConfig([]),
      prefixOnlyMode: false,
      userDictionaryList: ["helicopter"],
      insertSpaceAfterAutocomplete: false,
    });

    const result = await runPrediction(handler, "heli", "", "en_US");
    const words = result.predictions.map((p) => p.trim().toLowerCase());
    // Without prefix-only, spell-correction can return words not starting with "heli"
    expect(words).toContain("helicopter");
    expect(words.some((w) => !w.startsWith("heli"))).toBe(true);
  });

  test("with prefix-only mode, all predictions start with the typed prefix", async () => {
    const handler = await createLiveHandler();

    handler.setConfig({
      ...createLiveConfig([]),
      prefixOnlyMode: true,
      userDictionaryList: ["helicopter"],
      insertSpaceAfterAutocomplete: false,
    });

    const result = await runPrediction(handler, "heli", "", "en_US");
    const words = result.predictions.map((p) => p.trim().toLowerCase());
    expect(words.length).toBeGreaterThan(0);
    expect(words).toContain("helicopter");
    for (const word of words) {
      expect(word.startsWith("heli")).toBe(true);
    }
  });

  test("prefix-only mode returns no results for a misspelled word with no prefix matches", async () => {
    const handler = await createLiveHandler();

    handler.setConfig({
      ...createLiveConfig([]),
      prefixOnlyMode: true,
      insertSpaceAfterAutocomplete: false,
    });

    const result = await runPrediction(handler, "speling", "", "en_US");
    expect(result.predictions).toEqual([]);
  });
});

describe("PresageHandler live text expansion config refresh", () => {
  test("refreshes duplicate text expansions after runtime config changes", async () => {
    const handler = await createLiveHandler();

    handler.setConfig(createLiveConfig([["asap", "as soon as possible"]]));
    await expect(runPrediction(handler, "asap", "", "textExpander")).resolves.toEqual({
      predictions: ["as soon as possible "],
    });

    handler.setConfig(
      createLiveConfig([
        ["asap", "as soon as possible"],
        ["asap", "at some available point"],
      ]),
    );

    const refreshed = await runPrediction(handler, "asap", "", "textExpander");

    expect(refreshed.predictions).toHaveLength(2);
    expect(refreshed.predictions).toEqual(
      expect.arrayContaining(["as soon as possible ", "at some available point "]),
    );
  });
});

describe("PresageHandler live personalized ranking", () => {
  test("promotes an existing tenth Presage candidate before the visible cutoff", async () => {
    const handler = await createLiveHandler({
      getPersonalizationSnapshot: () => ({
        en_US: {
          through: { display: "through", score: 3, updatedAtMs: 1_000 },
        },
      }),
      now: () => 1_000,
    });
    handler.setConfig({
      ...createLiveConfig([]),
      numSuggestions: 3,
      insertSpaceAfterAutocomplete: false,
      personalizationEnabled: true,
    });

    const result = await runPrediction(handler, "th", "", "en_US");

    expect(result.predictions).toEqual(["through", "the", "that"]);
  });
});

describe("PresageHandler live Arabic (ar_SA)", () => {
  test("ar_SA engine creates and returns Arabic predictions", async () => {
    const handler = await createLiveHandler();
    handler.setConfig({ ...createLiveConfig([]) });

    // The ar_SA n-gram corpus (OSCAR 2024-38) contains common words; "الي"
    // should complete to "اليوم" (today) and "في ال" should yield
    // definite-article completions. This locks in the Arabic engine + data
    // pipeline end-to-end.
    const result = await runPrediction(handler, "الي", "", "ar_SA");
    expect(result.predictions.map((p) => p.trim())).toContain("اليوم");

    const phrase = await runPrediction(handler, "في ال", "", "ar_SA");
    expect(phrase.predictions.map((p) => p.trim())).toContain("العالم");
  });

  test("ar_SA n-gram predictions carry no tatweel or harakat", async () => {
    const handler = await createLiveHandler();
    handler.setConfig({ ...createLiveConfig([]), insertSpaceAfterAutocomplete: false });

    // gen_ngram.py strips tatweel/harakat from Arabic keys because the
    // runtime strips tatweel from typed input. Data built before that fix
    // suggested "علماً" for "علم" instead of the bare "علما".
    const marks = /[ـً-ْٰ]/;
    const ilm = await runPrediction(handler, "علم", "", "ar_SA");
    expect(ilm.predictions).toContain("علما");
    for (const prefix of ["علم", "الم", "الت", "وال", "مست", "است"]) {
      const { predictions } = await runPrediction(handler, prefix, "", "ar_SA");
      expect(predictions.filter((p) => marks.test(p))).toEqual([]);
    }
  });

  test("ar_SA hunspell corrects a final ha/taa-marbuta misspelling", async () => {
    const handler = await createLiveHandler();
    handler.setConfig({ ...createLiveConfig([]), insertSpaceAfterAutocomplete: false });

    // "ه" typed for "ة" is a very common Arabic spelling slip; the spelling
    // predictor must offer the corrected form.
    const government = await runPrediction(handler, "الحكومه", "", "ar_SA");
    expect(government.predictions.map((p) => p.trim())).toContain("الحكومة");

    const university = await runPrediction(handler, "الجامعه", "", "ar_SA");
    expect(university.predictions.map((p) => p.trim())).toContain("الجامعة");
  });

  test("the other engines still initialize alongside ar_SA", async () => {
    const handler = await createLiveHandler();
    handler.setConfig({ ...createLiveConfig([]) });

    // PresageHandler builds one engine per language at startup, so adding
    // ar_SA must not disturb the engines that were already working.
    const english = await runPrediction(handler, "th", "", "en_US");
    expect(english.predictions.map((p) => p.trim())).toContain("the");

    const french = await runPrediction(handler, "champig", "", "fr_FR");
    expect(french.predictions.map((p) => p.trim())).toContain("champignon");
  });
});

describe("PresageHandler live review spelling", () => {
  test("known words come back as known; unknown ones get candidates, even in prefix-only mode", async () => {
    const handler = await createLiveHandler();
    for (const prefixOnlyMode of [false, true]) {
      handler.setConfig({
        ...createLiveConfig([]),
        prefixOnlyMode,
        userDictionaryList: ["Bartek"],
      });
      const results = handler.lookupSpelling("en_US", [
        { word: "wa", before: "Where " },
        { word: "was", before: "Where " },
        { word: "recieve", before: "I " },
        { word: "don't", before: "" },
        { word: "Bartek", before: "" },
      ])!;
      expect(results[0]).toEqual(expect.arrayContaining(["was", "way"]));
      expect(results[1]).toBeNull();
      expect(results[2]).toContain("receive");
      expect(results[3]).toBeNull();
      // The user's dictionary counts as known.
      expect(results[4]).toBeNull();
    }
    // Typing predictions are unchanged afterwards: prefix-only mode is back on.
    const typing = await runPrediction(handler, "recie", "", "en_US");
    for (const word of typing.predictions.map((p) => p.trim().toLowerCase())) {
      expect(word.startsWith("recie")).toBe(true);
    }
    expect(handler.lookupSpelling("xx_XX", [{ word: "wa", before: "" }])).toBeNull();
  });

  test("a time-bounded lookup answers the first words exactly as an unbounded one", async () => {
    const handler = await createLiveHandler();
    handler.setConfig({ ...createLiveConfig([]), prefixOnlyMode: true });
    // Unknown words cost the engine tens of milliseconds each.
    const words = Array.from({ length: 25 }, (_, i) => ({
      word: `zq${"bcdfghjklmnpqrstvwxz"[i % 20]}vx${"bcdfg"[Math.floor(i / 5)]}`,
      before: "the big ",
    }));
    const full = handler.lookupSpelling("en_US", words)!;
    expect(full).toHaveLength(words.length);
    const bounded = handler.lookupSpelling("en_US", words, {
      budgetMs: REVIEW_SPELLING_BUDGET_MS,
    })!;
    expect(bounded.length).toBeGreaterThanOrEqual(1);
    expect(bounded.length).toBeLessThan(words.length);
    expect(bounded).toEqual(full.slice(0, bounded.length));
    // Typing predictions afterwards are unchanged: prefix-only mode is back on.
    const typing = await runPrediction(handler, "recie", "", "en_US");
    for (const word of typing.predictions.map((p) => p.trim().toLowerCase())) {
      expect(word.startsWith("recie")).toBe(true);
    }
  });
});

describe("Review dictionary compatibility with packaged resources", () => {
  test("every shipped dictionary is available offline and English fallback preserves dialect words", async () => {
    const handler = await createLiveHandler();
    handler.setConfig(createLiveConfig([]));
    const words: Record<string, string> = {
      en_US: "the",
      fr_FR: "bonjour",
      hr_HR: "dobro",
      es_ES: "hola",
      el_GR: "καλημέρα",
      sv_SE: "hej",
      de_DE: "gut",
      pl_PL: "dom",
      pt_BR: "bom",
      ar_SA: "كتاب",
    };
    for (const [lang, word] of Object.entries(words)) {
      expect(handler.lookupSpelling(lang, [{ word, before: "" }])).toHaveLength(1);
    }
    const lookup = (lang: string) =>
      handler.lookupSpelling(lang, [
        { word: "recieve", before: "I " },
        { word: "colour", before: "the " },
        { word: "center", before: "the " },
      ]);
    expect(lookup("en_US")![0]).toContain("receive");
    expect(lookup("en_GB")![0]).toEqual(["receive"]);
    // No general suggestions under a variant fallback: an unknown word can be a valid dialect form.
    expect(handler.lookupSpelling("en_GB", [{ word: "adress", before: "the " }])).toEqual([[]]);
    expect(handler.lookupSpelling("en_US", [{ word: "adress", before: "the " }])![0]).toContain(
      "address",
    );
    expect(lookup("en_GB")![0]).toContain("receive");
    expect(lookup("en_GB")!.slice(1)).toEqual([null, null]);
    expect(handler.lookupSpelling("ja", [{ word: "日本語", before: "" }])).toBeNull();
    expect(handler.lookupSpelling("pt_PT", [{ word: "bom", before: "" }])).toBeNull();
  });
});
