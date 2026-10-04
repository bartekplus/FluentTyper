import { REVIEW_SPELLING_BUDGET_MS } from "../src/adapters/chrome/background/PresageEngine";
import { rankSpellingSuggestions } from "../src/core/domain/grammar/review/reviewSpelling";
import { createLiveConfig, createLiveHandler } from "./support/presageLive";

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
