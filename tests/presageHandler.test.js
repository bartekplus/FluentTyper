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
  describe.each(Object.keys(SUPPORTED_LANGUAGES))("Lang: %s", (lang) => {
    test("#3 In French, it should consider a single quote as a word separator", () => {
      mod.PresageCallback.predictions = [""];

      testContext.ph.runPrediction("L'agglo", "", lang);
      const expectedPastStream = lang === "fr" ? "L agglo" : "L'agglo";
      expect(testContext.ph.libPresageCallback[lang].pastStream).toBe(
        expectedPastStream
      );
    });

    test("#5 #6 - letter case after a single quote", () => {
      mod.PresageCallback.predictions = ["avent"];

      let result = testContext.ph.runPrediction("L'avent", "", lang);
      let expectedPredictions = lang === "fr" ? "avent" : "Avent";
      expect(result.predictions[0]).toBe(expectedPredictions);

      result = testContext.ph.runPrediction("l'Avent", "", lang);
      expectedPredictions = lang === "fr" ? "Avent" : "avent";
      expect(result.predictions[0]).toBe(expectedPredictions);
    });

    test("#7 - Special signs should not be taken into account for the letter count", () => {
      mod.PresageCallback.predictions = ["avent"];
      testContext.minWordLengthToPredict = 5;
      setConfig();

      let result = testContext.ph.runPrediction("L'ave", "", lang);
      let expectedPredictionsCount = lang === "fr" ? 0 : 1;
      expect(result.predictions.length).toBe(expectedPredictionsCount);

      result = testContext.ph.runPrediction("l'Avent", "", lang);
      expectedPredictionsCount = 1;

      expect(result.predictions.length).toBe(expectedPredictionsCount);
    });

    test.each([
      ["[wha", 4, false],
      ["[to+bb", 3, false],
      ["aa=bb", 3, false],
      ["xyz{bb", 3, false],
      ["poi*bb", 3, false],
      ["fh*bb{o", 2, false],
      ["aaa*tb/a", 2, false],
      ["xx*bb-xy", 3, false],
      ["aaa*bb{*dea", 4, false],
      ["aaabb=cc", 3, false],
      ["this[should=work", 4, true],
    ])(
      "#11 - don't take non-letter character into word length; intput %s",
      (input, minWordLengthToPredict, predict) => {
        mod.PresageCallback.predictions = ["ble"];
        testContext.minWordLengthToPredict = minWordLengthToPredict;
        setConfig();

        const result = testContext.ph.runPrediction(input, "", lang);
        const expectedPredictionsCount = predict ? 1 : 0;
        expect(result.predictions.length).toBe(expectedPredictionsCount);
      }
    );
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
      "input: '%s', autoCapitalize: %s, expected: '%s'",
      (input, autoCapitalize, expected) => {
        test(`returns ${expected}`, () => {
          mod.PresageCallback.predictions = [expected.toLowerCase()];
          testContext.autoCapitalize = autoCapitalize;
          setConfig();

          const result = testContext.ph.runPrediction(input, "", lang);
          const expectedPrediction = expected;

          expect(result.predictions[0]).toBe(expectedPrediction);
        });
      }
    );

    test.each([
      "[abc",
      "(abc",
      "{abc",
      "<abc",
      "/abc",
      "-abc",
      "*abc",
      "+abc",
      "=abc",
      '"abc',
    ])("#11 - Check keepPredCharRegEx functionality intput '%s'", (input) => {
      mod.PresageCallback.predictions = ["ble"];
      setConfig();

      const result = testContext.ph.runPrediction(input, "", lang);
      const expectedPredictionsCount = 1;
      expect(result.predictions.length).toBe(expectedPredictionsCount);
    });
  });
});
