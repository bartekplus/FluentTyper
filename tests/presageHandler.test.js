import { mod } from "./fakeLibPresage.js";
import { PresageHandler } from "../src/adapters/chrome/background/PresageHandler.ts";
import { SUPPORTED_LANGUAGES } from "../src/core/domain/lang.ts";
import { MAX_NUM_SUGGESTIONS } from "../src/core/domain/constants.ts";

const testContext = {
  ph: null,
  numSuggestions: 1,
  minWordLengthToPredict: 0,
  insertSpaceAfterAutocomplete: false,
  autoCapitalize: true,
  enabledGrammarRules: ["spacingRule"],
  textExpansions: null,

  timeFormat: "",
  dateFormat: "",
  userDictionaryList: [],
};

function setConfig() {
  testContext.ph.setConfig({
    numSuggestions: testContext.numSuggestions,
    minWordLengthToPredict: testContext.minWordLengthToPredict,
    insertSpaceAfterAutocomplete: testContext.insertSpaceAfterAutocomplete,
    autoCapitalize: testContext.autoCapitalize,
    enabledGrammarRules: testContext.enabledGrammarRules,
    textExpansions: testContext.textExpansions,

    timeFormat: testContext.timeFormat,
    dateFormat: testContext.dateFormat,
    userDictionaryList: testContext.userDictionaryList,
  });
}

beforeEach(() => {
  testContext.numSuggestions = 1;
  testContext.minWordLengthToPredict = 0;
  testContext.insertSpaceAfterAutocomplete = false;
  testContext.autoCapitalize = true;
  testContext.enabledGrammarRules = ["spacingRule"];
  testContext.textExpansions = null;

  testContext.timeFormat = "";
  testContext.dateFormat = "";
  testContext.userDictionaryList = [];
  testContext.ph = new PresageHandler(mod);
  setConfig();
});

describe("site profile override behavior", () => {
  test("numSuggestions override increases returned predictions up to requested count", async () => {
    mod.PresageCallback.predictions = ["alpha", "beta", "gamma", "delta", "epsilon"];
    testContext.numSuggestions = 1;
    setConfig();

    const result = await testContext.ph.runPrediction("a", "", "en_US", {
      numSuggestions: 4,
    });
    expect(result.predictions.length).toBe(4);
  });

  test("numSuggestions override is clamped to engine max and supports zero", async () => {
    mod.PresageCallback.predictions = Array.from(
      { length: MAX_NUM_SUGGESTIONS + 5 },
      (_, idx) => `prediction_${idx}`,
    );
    testContext.numSuggestions = 3;
    setConfig();

    const capped = await testContext.ph.runPrediction("a", "", "en_US", {
      numSuggestions: 999,
    });
    expect(capped.predictions.length).toBe(MAX_NUM_SUGGESTIONS);

    const disabled = await testContext.ph.runPrediction("a", "", "en_US", {
      numSuggestions: 0,
    });
    expect(disabled.predictions.length).toBe(0);
  });
});

describe("bugs", () => {
  describe.each(Object.keys(SUPPORTED_LANGUAGES))("Lang: %s", (lang) => {
    if (lang === "auto_detect") {
      return;
    }
    test("#3 In French, it should consider a single quote as a word separator", async () => {
      mod.PresageCallback.predictions = [""];

      await testContext.ph.runPrediction("L'agglo", "", lang);
      const expectedPastStream = (lang === "fr_FR" ? "L agglo" : "L'agglo").toLocaleLowerCase();
      expect(testContext.ph.getLastPredictionInput(lang)).toBe(expectedPastStream);
    });

    test("#5 #6 - letter case after a single quote", async () => {
      mod.PresageCallback.predictions = ["avent"];

      let result = await testContext.ph.runPrediction("L'avent", "", lang);
      let expectedPredictions = lang === "fr_FR" ? "avent" : "Avent";
      expect(result.predictions[0]).toBe(expectedPredictions);

      result = await testContext.ph.runPrediction("l'Avent", "", lang);
      expectedPredictions = lang === "fr_FR" ? "Avent" : "avent";
      expect(result.predictions[0]).toBe(expectedPredictions);
    });

    test("#7 - Special signs should not be taken into account for the letter count", async () => {
      mod.PresageCallback.predictions = ["avent"];
      testContext.minWordLengthToPredict = 5;
      setConfig();

      let result = await testContext.ph.runPrediction("L'ave", "", lang);
      let expectedPredictionsCount = lang === "fr_FR" ? 0 : 1;
      expect(result.predictions.length).toBe(expectedPredictionsCount);

      result = await testContext.ph.runPrediction("l'Avent", "", lang);
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
      async (input, minWordLengthToPredict, predict) => {
        mod.PresageCallback.predictions = ["ble"];
        testContext.minWordLengthToPredict = minWordLengthToPredict;
        setConfig();

        const result = await testContext.ph.runPrediction(input, "", lang);
        const expectedPredictionsCount = predict ? 1 : 0;
        expect(result.predictions.length).toBe(expectedPredictionsCount);
      },
    );
  });
});

describe("features", () => {
  describe.each(Object.keys(SUPPORTED_LANGUAGES))("Lang: %s", (lang) => {
    if (lang === "auto_detect") {
      return;
    }
    describe.each(["test", "testword"])("input: %s", (input) => {
      describe.each([true, false])("input ends with space: %s", (inputEndWithSpace) => {
        test.each([0, 3, 5])("minWordLengthToPredict: %s", async (minWordLengthToPredict) => {
          mod.PresageCallback.predictions = ["out"];
          testContext.minWordLengthToPredict = minWordLengthToPredict;
          setConfig();

          const result = await testContext.ph.runPrediction(input, "", lang);
          const expectedPredictionsCount =
            input.length >= minWordLengthToPredict ||
            (inputEndWithSpace && minWordLengthToPredict === 0)
              ? 1
              : 0;

          expect(result.predictions.length).toBe(expectedPredictionsCount);
        });

        test.each([true, false])(
          "insertSpaceAfterAutocomplete: %s",
          async (insertSpaceAfterAutocomplete) => {
            const pred = "out";
            mod.PresageCallback.predictions = [pred];
            testContext.insertSpaceAfterAutocomplete = insertSpaceAfterAutocomplete;
            setConfig();

            const result = await testContext.ph.runPrediction(input, "", lang);
            const expectedPrediction = pred + (insertSpaceAfterAutocomplete ? "\xA0" : "");

            expect(result.predictions[0]).toBe(expectedPrediction);
          },
        );
      });
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
      ['"Xyz', false, "Out"],
      ['"xyz', false, "out"],
      ['"Xyz', true, "Out"],
      ['"xyz', true, "out"],
    ])("input: '%s', autoCapitalize: %s, expected: '%s'", (input, autoCapitalize, expected) => {
      test(`returns ${expected}`, async () => {
        mod.PresageCallback.predictions = [expected.toLowerCase()];
        testContext.autoCapitalize = autoCapitalize;
        setConfig();

        const result = await testContext.ph.runPrediction(input, "", lang);
        const expectedPrediction = expected;

        expect(result.predictions[0]).toBe(expectedPrediction);
      });
    });

    test.each(["[abc", "(abc", "{abc", "<abc", "/abc", "-abc", "*abc", "+abc", "=abc", '"abc'])(
      "#11 - Check keepPredCharRegex functionality input '%s'",
      async (input) => {
        mod.PresageCallback.predictions = ["ble"];
        setConfig();

        const result = await testContext.ph.runPrediction(input, "", lang);
        const expectedPredictionsCount = 1;
        expect(result.predictions.length).toBe(expectedPredictionsCount);
      },
    );

    describe.each([
      ["test", "\n", true, "test\xA0"],
      ["test", "\n", false, "test"],
      ["test", "", true, "test\xA0"],
      ["test", "", false, "test"],
      ["test", " ", true, "test"],
      ["test", " ", false, "test"],
    ])(
      "input: '%s', nextChar: '%s', insertSpaceAfterAutocomplete: %s, expected: '%s'",
      async (input, nextChar, insertSpaceAfterAutocomplete, expected) => {
        test(`returns '${expected}'`, async () => {
          mod.PresageCallback.predictions = [input.toLowerCase()];
          testContext.insertSpaceAfterAutocomplete = insertSpaceAfterAutocomplete;
          setConfig();

          const result = await testContext.ph.runPrediction(input, nextChar, lang);
          const expectedPrediction = expected;

          expect(result.predictions[0]).toBe(expectedPrediction);
        });
      },
    );
  });
  describe("grammar rule forceReplace", () => {
    test("returns expectedSubstring and cursorToken", async () => {
      testContext.enabledGrammarRules = ["capitalizeFirstLetter"];
      setConfig();

      // capitalizeFirstLetterRule should trigger on ". a"
      const result = await testContext.ph.runPrediction("Hello. a", "", "en_US");
      expect(result.forceReplace).not.toBeNull();
      expect(result.forceReplace.text).toBe("A");
      expect(result.forceReplace.length).toBe(1);
      expect(result.forceReplace.originalTextLength).toBe("Hello. a".length);
      expect(result.forceReplace.expectedSubstring).toBe("a");
      expect(result.forceReplace.cursorToken).toBe("Hello. ");
    });

    test("emits forceReplace for decimal and time technical spacing compaction", async () => {
      testContext.enabledGrammarRules = ["spacingRule"];
      setConfig();

      const decimalResult = await testContext.ph.runPrediction("3.\xA01", "", "en_US");
      expect(decimalResult.forceReplace).not.toBeNull();
      expect(decimalResult.forceReplace.text).toBe(".1");
      expect(decimalResult.forceReplace.length).toBe(3);
      expect(decimalResult.forceReplace.originalTextLength).toBe("3.\xA01".length);
      expect(decimalResult.forceReplace.expectedSubstring).toBe(".\xA01");
      expect(decimalResult.forceReplace.cursorToken).toBe("3");

      const timeResult = await testContext.ph.runPrediction("12:\xA03", "", "en_US");
      expect(timeResult.forceReplace).not.toBeNull();
      expect(timeResult.forceReplace.text).toBe(":3");
      expect(timeResult.forceReplace.length).toBe(3);
      expect(timeResult.forceReplace.originalTextLength).toBe("12:\xA03".length);
      expect(timeResult.forceReplace.expectedSubstring).toBe(":\xA03");
      expect(timeResult.forceReplace.cursorToken).toBe("12");
    });

    test("handles slash forceReplace for protocol compaction and math operator contexts", async () => {
      testContext.enabledGrammarRules = ["spacingRule"];
      testContext.insertSpaceAfterAutocomplete = true;
      setConfig();

      const protocolResult = await testContext.ph.runPrediction("https:\xA0/", "", "en_US");
      expect(protocolResult.forceReplace).not.toBeNull();
      expect(protocolResult.forceReplace.text).toBe("/");
      expect(protocolResult.forceReplace.length).toBe(2);
      expect(protocolResult.forceReplace.expectedSubstring).toBe("\xA0/");
      expect(protocolResult.forceReplace.cursorToken).toBe("https:");

      const pathResult = await testContext.ph.runPrediction("src/components/", "", "en_US");
      expect(pathResult.forceReplace).toBeNull();

      const operatorResult = await testContext.ph.runPrediction("x /", "", "en_US");
      expect(operatorResult.forceReplace).not.toBeNull();
      expect(operatorResult.forceReplace.text).toBe("/\xA0");
      expect(operatorResult.forceReplace.length).toBe(1);
      expect(operatorResult.forceReplace.expectedSubstring).toBe("/");
    });

    test("emits forceReplace for compact equals and arithmetic expressions", async () => {
      testContext.enabledGrammarRules = ["spacingRule"];
      setConfig();

      const equalsResult = await testContext.ph.runPrediction("x=y", "", "en_US");
      expect(equalsResult.forceReplace).not.toBeNull();
      expect(equalsResult.forceReplace.text).toBe("x\xA0=\xA0y");
      expect(equalsResult.forceReplace.length).toBe(3);
      expect(equalsResult.forceReplace.originalTextLength).toBe("x=y".length);
      expect(equalsResult.forceReplace.expectedSubstring).toBe("x=y");
      expect(equalsResult.forceReplace.cursorToken).toBe("");

      const plusResult = await testContext.ph.runPrediction("y+1", "", "en_US");
      expect(plusResult.forceReplace).not.toBeNull();
      expect(plusResult.forceReplace.text).toBe("y\xA0+\xA01");
      expect(plusResult.forceReplace.length).toBe(3);
      expect(plusResult.forceReplace.originalTextLength).toBe("y+1".length);
      expect(plusResult.forceReplace.expectedSubstring).toBe("y+1");
      expect(plusResult.forceReplace.cursorToken).toBe("");
    });

    test("does not emit forceReplace for prose continuation without accessor code cues", async () => {
      testContext.enabledGrammarRules = ["spacingRule"];
      setConfig();

      const result = await testContext.ph.runPrediction("Hello.\xA0w", "", "en_US");
      expect(result.forceReplace).toBeNull();
    });

    test("does not emit forceReplace for code-like bracket contexts", async () => {
      testContext.enabledGrammarRules = ["spacingRule"];
      testContext.insertSpaceAfterAutocomplete = true;
      setConfig();

      const functionCall = await testContext.ph.runPrediction("console.log(", "", "en_US");
      expect(functionCall.forceReplace).toBeNull();

      const arrayAccess = await testContext.ph.runPrediction("myArray[", "", "en_US");
      expect(arrayAccess.forceReplace).toBeNull();

      const nestedCallClose = await testContext.ph.runPrediction("foo(bar())", "", "en_US");
      expect(nestedCallClose.forceReplace).toBeNull();
    });

    test("emits forceReplace for control opener and prose closer contexts", async () => {
      testContext.enabledGrammarRules = ["spacingRule"];
      testContext.insertSpaceAfterAutocomplete = true;
      setConfig();

      const controlOpen = await testContext.ph.runPrediction("if(", "", "en_US");
      expect(controlOpen.forceReplace).not.toBeNull();
      expect(controlOpen.forceReplace.text).toBe("\xA0(");
      expect(controlOpen.forceReplace.length).toBe(1);
      expect(controlOpen.forceReplace.expectedSubstring).toBe("(");

      const proseClose = await testContext.ph.runPrediction("Hello (world)", "", "en_US");
      expect(proseClose.forceReplace).not.toBeNull();
      expect(proseClose.forceReplace.text).toBe(")\xA0");
      expect(proseClose.forceReplace.length).toBe(1);
      expect(proseClose.forceReplace.expectedSubstring).toBe(")");
    });
  });
});
