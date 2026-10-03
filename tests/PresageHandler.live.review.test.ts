import { REVIEW_SPELLING_BUDGET_MS } from "../src/adapters/chrome/background/PresageEngine";
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
