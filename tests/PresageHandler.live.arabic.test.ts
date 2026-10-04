import { createLiveConfig, createLiveHandler } from "./support/presageLive";

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
