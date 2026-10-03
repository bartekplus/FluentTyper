import libPresageMod from "../src/third_party/libpresage/libpresage.js";
import { PresageHandler } from "../src/adapters/chrome/background/PresageHandler";
import { REVIEW_SPELLING_BUDGET_MS } from "../src/adapters/chrome/background/PresageEngine";
import { rankSpellingSuggestions } from "../src/core/domain/grammar/review/reviewSpelling";

function createLiveConfig(textExpansions: Array<[string, string]>) {
  return {
    numSuggestions: 5,
    engineNumSuggestions: 10,
    minWordLengthToPredict: 0,
    insertSpaceAfterAutocomplete: true,
    autoCapitalize: false,
    prefixOnlyMode: false,
    textExpansions,
    timeFormat: "",
    dateFormat: "",
    userDictionaryList: [],
  };
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

    const result = await handler.runPrediction("fluenttypert", "", "en_US");
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

    const result = await handler.runPrediction("heli", "", "en_US");
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

    const result = await handler.runPrediction("heli", "", "en_US");
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

    const result = await handler.runPrediction("speling", "", "en_US");
    expect(result.predictions).toEqual([]);
  });
});

describe("PresageHandler live text expansion config refresh", () => {
  test("refreshes duplicate text expansions after runtime config changes", async () => {
    const handler = await createLiveHandler();

    handler.setConfig(createLiveConfig([["asap", "as soon as possible"]]));
    await expect(handler.runPrediction("asap", "", "textExpander")).resolves.toEqual({
      predictions: ["as soon as possible "],
    });

    handler.setConfig(
      createLiveConfig([
        ["asap", "as soon as possible"],
        ["asap", "at some available point"],
      ]),
    );

    const refreshed = await handler.runPrediction("asap", "", "textExpander");

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
      engineNumSuggestions: 10,
      insertSpaceAfterAutocomplete: false,
      personalizationEnabled: true,
    });

    const result = await handler.runPrediction("th", "", "en_US");

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
    const result = await handler.runPrediction("الي", "", "ar_SA");
    expect(result.predictions.map((p) => p.trim())).toContain("اليوم");

    const phrase = await handler.runPrediction("في ال", "", "ar_SA");
    expect(phrase.predictions.map((p) => p.trim())).toContain("العالم");
  });

  test("ar_SA n-gram predictions carry no tatweel or harakat", async () => {
    const handler = await createLiveHandler();
    handler.setConfig({ ...createLiveConfig([]), insertSpaceAfterAutocomplete: false });

    // gen_ngram.py strips tatweel/harakat from Arabic keys because the
    // runtime strips tatweel from typed input. Data built before that fix
    // suggested "علماً" for "علم" instead of the bare "علما".
    const marks = /[ـً-ْٰ]/;
    const ilm = await handler.runPrediction("علم", "", "ar_SA");
    expect(ilm.predictions).toContain("علما");
    for (const prefix of ["علم", "الم", "الت", "وال", "مست", "است"]) {
      const { predictions } = await handler.runPrediction(prefix, "", "ar_SA");
      expect(predictions.filter((p) => marks.test(p))).toEqual([]);
    }
  });

  test("ar_SA hunspell corrects a final ha/taa-marbuta misspelling", async () => {
    const handler = await createLiveHandler();
    handler.setConfig({ ...createLiveConfig([]), insertSpaceAfterAutocomplete: false });

    // "ه" typed for "ة" is a very common Arabic spelling slip; the spelling
    // predictor must offer the corrected form.
    const government = await handler.runPrediction("الحكومه", "", "ar_SA");
    expect(government.predictions.map((p) => p.trim())).toContain("الحكومة");

    const university = await handler.runPrediction("الجامعه", "", "ar_SA");
    expect(university.predictions.map((p) => p.trim())).toContain("الجامعة");
  });

  test("the other engines still initialize alongside ar_SA", async () => {
    const handler = await createLiveHandler();
    handler.setConfig({ ...createLiveConfig([]) });

    // PresageHandler builds one engine per language at startup, so adding
    // ar_SA must not disturb the engines that were already working.
    const english = await handler.runPrediction("th", "", "en_US");
    expect(english.predictions.map((p) => p.trim())).toContain("the");

    const french = await handler.runPrediction("champig", "", "fr_FR");
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
    const typing = await handler.runPrediction("recie", "", "en_US");
    for (const word of typing.predictions.map((p) => p.trim().toLowerCase())) {
      expect(word.startsWith("recie")).toBe(true);
    }
    expect(handler.lookupSpelling("xx_XX", [{ word: "wa", before: "" }])).toBeNull();
  });

  test("short words with many longer completions and JSON-like words are known", async () => {
    const handler = await createLiveHandler();
    handler.setConfig(createLiveConfig([]));
    const words = ["app", "ad", "id", "true", "false", "null"];
    const results = handler.lookupSpelling(
      "en_US",
      words.map((word) => ({ word, before: "We said it was " })),
    )!;
    expect(results).toEqual(words.map(() => null));
    const typo = handler.lookupSpelling("en_US", [{ word: "becuase", before: "" }])!;
    // An unknown word still gets a bounded candidate list.
    expect(typo[0]).toContain("because");
    expect(typo[0]!.length).toBeLessThanOrEqual(20);
  });

  test("pt_BR accepts accented words and suggests clean UTF-8 candidates", async () => {
    // Regression: the VERO dictionary was Latin-1 (SET ISO8859-1) while Presage speaks
    // UTF-8, so every accented word was unknown and suggestions came back garbled.
    const handler = await createLiveHandler();
    handler.setConfig(createLiveConfig([]));
    const known = ["coração", "enviarão", "falávamos", "também", "pré"];
    const results = handler.lookupSpelling(
      "pt_BR",
      [...known, "enviarao"].map((word) => ({ word, before: "" })),
    )!;
    expect(results.slice(0, known.length)).toEqual(known.map(() => null));
    expect(results[known.length]).toContain("enviarão");
    expect(results[known.length]!.join(" ")).not.toMatch(/[　-鿿�]/);
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
    const typing = await handler.runPrediction("recie", "", "en_US");
    for (const word of typing.predictions.map((p) => p.trim().toLowerCase())) {
      expect(word.startsWith("recie")).toBe(true);
    }
  });

  test("common typos keep their first suggestion with the faster Hunspell settings", async () => {
    // The affix tuning (PresageFiles.tunedAffix) drops Hunspell's n-gram pass for the
    // large dictionaries and the empty compound passes; near-miss typos still rank
    // the intended word first.
    const handler = await createLiveHandler();
    handler.setConfig(createLiveConfig([]));
    const typos: Record<string, Array<[string, string]>> = {
      fr_FR: [
        ["maisson", "maison"],
        ["beaucop", "beaucoup"],
        ["travailons", "travaillons"],
        ["nesessaire", "nécessaire"],
        ["gouvernment", "gouvernement"],
        ["dificile", "difficile"],
      ],
      pt_BR: [
        ["rapidamete", "rapidamente"],
        ["trabalhamso", "trabalhamos"],
        ["previlégio", "privilégio"],
        ["infromação", "informação"],
        ["estrutra", "estrutura"],
        ["govreno", "governo"],
      ],
      pl_PL: [
        ["pracujmey", "pracujemy"],
        ["rzeczywiscie", "rzeczywiście"],
        ["dlatgo", "dlatego"],
        ["napisłem", "napisałem"],
        ["jesteśmi", "jesteśmy"],
        ["spotkaine", "spotkanie"],
      ],
      es_ES: [
        ["trabajamso", "trabajamos"],
        ["nesesario", "necesario"],
        ["exelente", "excelente"],
      ],
      de_DE: [
        ["wirklih", "wirklich"],
        ["vieleicht", "vielleicht"],
        ["Maschiene", "Maschine"],
      ],
      en_US: [
        ["becuase", "because"],
        ["definately", "definitely"],
        ["tommorow", "tomorrow"],
        ["publically", "publicly"],
      ],
    };
    for (const [lang, pairs] of Object.entries(typos)) {
      const results = handler.lookupSpelling(
        lang,
        pairs.map(([word]) => ({ word, before: "" })),
      )!;
      const first = pairs.map(
        ([word], i) => rankSpellingSuggestions(word, results[i] ?? [], lang)[0],
      );
      expect(first).toEqual(pairs.map(([, want]) => want));
    }
    // Known short words stay known under a pool full of longer completions.
    expect(handler.lookupSpelling("fr_FR", [{ word: "Re", before: "" }])).toEqual([null]);
    expect(handler.lookupSpelling("pl_PL", [{ word: "na", before: "" }])).toEqual([null]);
  }, 30_000);

  test("foreign words and stray letters are quick to look up in the large dictionaries", async () => {
    // Before the affix tuning and the single-round pool these took 300-700 ms each
    // (about 3 s in all), now mostly well under 100 ms. The bound is generous.
    const handler = await createLiveHandler();
    handler.setConfig(createLiveConfig([]));
    const words: Record<string, string[]> = {
      pt_BR: ["understanding", "maintenant", "essentiellement", "dd"],
      pl_PL: ["naj", "understanding", "dd", "ll"],
      el_GR: ["understanding", "maintenant"],
      fr_FR: ["understanding", "dd"],
    };
    let elapsed = 0;
    for (const [lang, list] of Object.entries(words)) {
      for (const word of list) {
        const started = performance.now();
        const [result] = handler.lookupSpelling(lang, [{ word, before: "" }])!;
        elapsed += performance.now() - started;
        expect(result).not.toBeNull();
      }
    }
    expect(elapsed).toBeLessThan(1500);
  }, 30_000);
});
