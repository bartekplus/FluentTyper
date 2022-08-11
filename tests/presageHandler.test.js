import { mod } from "./fakeLibPresage.js";
import { PresageHandler } from "../src/third_party/libpresage/presageHandler.js";
import { SUPPORTED_LANGUAGES } from "../src/third_party/libpresage/lang.js";

const testContext = {
  ph: null,
  numSuggestions: 1,
  minWordLengthToPredict: 0,
  insertSpaceAfterAutocomplete: false,
  autoCapitalize: true,
  applySpacingRules: true,
  textExpansions: null,
};

function setConfig() {
  testContext.ph.setConfig(
    testContext.numSuggestions,
    testContext.minWordLengthToPredict,
    testContext.insertSpaceAfterAutocomplete,
    testContext.autoCapitalize,
    testContext.applySpacingRules,
    testContext.textExpansions
  );
}

beforeEach(() => {
  testContext.numSuggestions = 1;
  testContext.minWordLengthToPredict = 0;
  testContext.insertSpaceAfterAutocomplete = false;
  testContext.autoCapitalize = true;
  testContext.applySpacingRules = true;
  testContext.textExpansions = null;
  testContext.ph = new PresageHandler(mod);
  setConfig();
});

describe("bugs", () => {
  test("#3 In French, it should consider a single quote as a word separator", () => {
    mod.PresageCallback.predictions = [""];

    for (const [lang] of Object.entries(SUPPORTED_LANGUAGES)) {
      testContext.ph.runPrediction("L'agglo", "", lang);
      const expectedPastStream = lang === "fr" ? "L agglo" : "L'agglo";

      expect(testContext.ph.libPresageCallback[lang].pastStream).toBe(
        expectedPastStream
      );
    }
  });

  test("#5 #6 - letter case after a single quote", () => {
    mod.PresageCallback.predictions = ["avent"];

    for (const [lang] of Object.entries(SUPPORTED_LANGUAGES)) {
      const result = testContext.ph.runPrediction("L'avent", "", lang);
      const expectedPredictions = lang === "fr" ? "avent" : "Avent";

      expect(result.predictions[0]).toBe(expectedPredictions);
    }

    for (const [lang] of Object.entries(SUPPORTED_LANGUAGES)) {
      const result = testContext.ph.runPrediction("l'Avent", "", lang);
      const expectedPredictions = lang === "fr" ? "Avent" : "avent";

      expect(result.predictions[0]).toBe(expectedPredictions);
    }
  });

  test("#7 - Special signs should not be taken into account for the letter count", () => {
    mod.PresageCallback.predictions = ["avent"];
    testContext.minWordLengthToPredict = 5;
    setConfig();

    for (const [lang] of Object.entries(SUPPORTED_LANGUAGES)) {
      const result = testContext.ph.runPrediction("L'ave", "", lang);
      const expectedPredictionsCount = lang === "fr" ? 0 : 1;
      expect(result.predictions.length).toBe(expectedPredictionsCount);
    }

    for (const [lang] of Object.entries(SUPPORTED_LANGUAGES)) {
      const result = testContext.ph.runPrediction("l'Avent", "", lang);
      const expectedPredictionsCount = 1;

      expect(result.predictions.length).toBe(expectedPredictionsCount);
    }
  });
});

describe("features", () => {
  describe.each(Object.keys(SUPPORTED_LANGUAGES))("Lang: %s", (lang) => {
    describe.each(["test", "testword"])("input: %s", (input) => {
      describe.each([true, false])(
        "input ends with space: %s",
        (inputEndWithSpace) => {
          test.each([0, 3, 5])(
            "minWordLengthToPredict: %s",
            (minWordLengthToPredict) => {
              mod.PresageCallback.predictions = ["out"];
              testContext.minWordLengthToPredict = minWordLengthToPredict;
              setConfig();

              const result = testContext.ph.runPrediction(input, "", lang);
              const expectedPredictionsCount =
                input.length >= minWordLengthToPredict ||
                (inputEndWithSpace && minWordLengthToPredict === 0)
                  ? 1
                  : 0;

              expect(result.predictions.length).toBe(expectedPredictionsCount);
            }
          );

          test.each([true, false])(
            "insertSpaceAfterAutocomplete: %s",
            (insertSpaceAfterAutocomplete) => {
              const pred = "out";
              mod.PresageCallback.predictions = [pred];
              testContext.insertSpaceAfterAutocomplete =
                insertSpaceAfterAutocomplete;
              setConfig();

              const result = testContext.ph.runPrediction(input, "", lang);
              const expectedPrediction =
                pred + (insertSpaceAfterAutocomplete ? "\xA0" : "");

              expect(result.predictions[0]).toBe(expectedPrediction);
            }
          );
        }
      );
    });
    

    describe.each([
      [" XYZ", true, "OUT"],
      [" XYZ", false, "OUT"], // keep uppercase as requested by user
      [" Xyz", true, "Out"],
      [" Xyz", false, "Out"], // keep uppercase as requested by user
      [" xyz. xyz", true, "Out"],
      [" xyz. xyz", false, "out"],
      [" xyz. ", true, "Out"],
      [" xyz. ", false, "out"],
    ])(
      "input: '%s', autoCapitalize: %s, expected: %s",
      (input, autoCapitalize, expected) => {
        test(`returns ${expected}`, () => {
          console.log(expected);
          mod.PresageCallback.predictions = [expected.toLowerCase()];
          testContext.autoCapitalize = autoCapitalize;
          setConfig();

          const result = testContext.ph.runPrediction(input, "", lang);
          const expectedPrediction = expected;
          console.log(result);

          expect(result.predictions[0]).toBe(expectedPrediction);
        });
      }
    );
  });
});
