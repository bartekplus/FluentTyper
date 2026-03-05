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
            const expectedPrediction = pred + (insertSpaceAfterAutocomplete ? " " : "");

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
      ["test", "\n", true, "test "],
      ["test", "\n", false, "test"],
      ["test", "", true, "test "],
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
  describe("grammar rule textEdit", () => {
    test("returns expectedReplacedText and expectedPrefixToken", async () => {
      testContext.enabledGrammarRules = ["capitalizeFirstLetter"];
      setConfig();

      // capitalizeFirstLetterRule should trigger on ". a"
      const result = await testContext.ph.runPrediction("Hello. a", "", "en_US");
      expect(result.textEdit).not.toBeNull();
      expect(result.textEdit.replacementText).toBe("A");
      expect(result.textEdit.replaceBackwardCount).toBe(1);
      expect(result.textEdit.evaluatedTextLength).toBe("Hello. a".length);
      expect(result.textEdit.expectedReplacedText).toBe("a");
      expect(result.textEdit.expectedPrefixToken).toBe("Hello. ");
    });

    test("emits textEdit for decimal and time technical spacing compaction", async () => {
      testContext.enabledGrammarRules = ["spacingRule"];
      setConfig();

      const decimalResult = await testContext.ph.runPrediction("3. 1", "", "en_US");
      expect(decimalResult.textEdit).not.toBeNull();
      expect(decimalResult.textEdit.replacementText).toBe(".1");
      expect(decimalResult.textEdit.replaceBackwardCount).toBe(3);
      expect(decimalResult.textEdit.evaluatedTextLength).toBe("3. 1".length);
      expect(decimalResult.textEdit.expectedReplacedText).toBe(". 1");
      expect(decimalResult.textEdit.expectedPrefixToken).toBe("3");

      const timeResult = await testContext.ph.runPrediction("12: 3", "", "en_US");
      expect(timeResult.textEdit).not.toBeNull();
      expect(timeResult.textEdit.replacementText).toBe(":3");
      expect(timeResult.textEdit.replaceBackwardCount).toBe(3);
      expect(timeResult.textEdit.evaluatedTextLength).toBe("12: 3".length);
      expect(timeResult.textEdit.expectedReplacedText).toBe(": 3");
      expect(timeResult.textEdit.expectedPrefixToken).toBe("12");
    });

    test("handles slash textEdit for protocol compaction and math operator contexts", async () => {
      testContext.enabledGrammarRules = ["spacingRule"];
      testContext.insertSpaceAfterAutocomplete = true;
      setConfig();

      const protocolResult = await testContext.ph.runPrediction("https: /", "", "en_US");
      expect(protocolResult.textEdit).not.toBeNull();
      expect(protocolResult.textEdit.replacementText).toBe("/");
      expect(protocolResult.textEdit.replaceBackwardCount).toBe(2);
      expect(protocolResult.textEdit.expectedReplacedText).toBe(" /");
      expect(protocolResult.textEdit.expectedPrefixToken).toBe("https:");

      const pathResult = await testContext.ph.runPrediction("src/components/", "", "en_US");
      expect(pathResult.textEdit).toBeNull();

      const operatorResult = await testContext.ph.runPrediction("x /", "", "en_US");
      expect(operatorResult.textEdit).not.toBeNull();
      expect(operatorResult.textEdit.replacementText).toBe("/ ");
      expect(operatorResult.textEdit.replaceBackwardCount).toBe(1);
      expect(operatorResult.textEdit.expectedReplacedText).toBe("/");
    });

    test("emits textEdit for compact equals and arithmetic expressions", async () => {
      testContext.enabledGrammarRules = ["spacingRule"];
      setConfig();

      const equalsResult = await testContext.ph.runPrediction("x=y", "", "en_US");
      expect(equalsResult.textEdit).not.toBeNull();
      expect(equalsResult.textEdit.replacementText).toBe("x = y");
      expect(equalsResult.textEdit.replaceBackwardCount).toBe(3);
      expect(equalsResult.textEdit.evaluatedTextLength).toBe("x=y".length);
      expect(equalsResult.textEdit.expectedReplacedText).toBe("x=y");
      expect(equalsResult.textEdit.expectedPrefixToken).toBe("");

      const plusResult = await testContext.ph.runPrediction("y+1", "", "en_US");
      expect(plusResult.textEdit).not.toBeNull();
      expect(plusResult.textEdit.replacementText).toBe("y + 1");
      expect(plusResult.textEdit.replaceBackwardCount).toBe(3);
      expect(plusResult.textEdit.evaluatedTextLength).toBe("y+1".length);
      expect(plusResult.textEdit.expectedReplacedText).toBe("y+1");
      expect(plusResult.textEdit.expectedPrefixToken).toBe("");
    });

    test("does not emit textEdit for prose continuation without accessor code cues", async () => {
      testContext.enabledGrammarRules = ["spacingRule"];
      setConfig();

      const result = await testContext.ph.runPrediction("Hello. w", "", "en_US");
      expect(result.textEdit).toBeNull();
    });

    test("suppresses trailing punctuation-space reinsertion on delete inputAction", async () => {
      testContext.enabledGrammarRules = ["spacingRule"];
      testContext.insertSpaceAfterAutocomplete = true;
      setConfig();

      const deleteResult = await testContext.ph.runPrediction(
        "Hello.",
        "",
        "en_US",
        undefined,
        "delete",
      );
      expect(deleteResult.textEdit).toBeNull();

      const insertResult = await testContext.ph.runPrediction(
        "Hello.",
        "",
        "en_US",
        undefined,
        "insert",
      );
      expect(insertResult.textEdit).not.toBeNull();
      expect(insertResult.textEdit.replacementText).toBe(". ");
      expect(insertResult.textEdit.replaceBackwardCount).toBe(1);
    });

    test("does not emit textEdit for code-like bracket contexts", async () => {
      testContext.enabledGrammarRules = ["spacingRule"];
      testContext.insertSpaceAfterAutocomplete = true;
      setConfig();

      const functionCall = await testContext.ph.runPrediction("console.log(", "", "en_US");
      expect(functionCall.textEdit).toBeNull();

      const arrayAccess = await testContext.ph.runPrediction("myArray[", "", "en_US");
      expect(arrayAccess.textEdit).toBeNull();

      const nestedCallClose = await testContext.ph.runPrediction("foo(bar())", "", "en_US");
      expect(nestedCallClose.textEdit).toBeNull();
    });

    test("emits textEdit for duplicate punctuation runs and spaced duplicate tails", async () => {
      testContext.enabledGrammarRules = ["duplicatePunctuationCollapse"];
      setConfig();

      const trailingRunResult = await testContext.ph.runPrediction(
        "It do not work as expected,,, ",
        "",
        "en_US",
      );
      expect(trailingRunResult.textEdit).not.toBeNull();
      expect(trailingRunResult.textEdit.replacementText).toBe(", ");
      expect(trailingRunResult.textEdit.replaceBackwardCount).toBe(4);
      expect(trailingRunResult.textEdit.expectedReplacedText).toBe(",,, ");

      const spacedTailResult = await testContext.ph.runPrediction(
        "This is,,,,,,,,,,,, ,",
        "",
        "en_US",
      );
      expect(spacedTailResult.textEdit).not.toBeNull();
      expect(spacedTailResult.textEdit.replacementText).toBe(", ");
      expect(spacedTailResult.textEdit.replaceBackwardCount).toBe(14);
      expect(spacedTailResult.textEdit.expectedReplacedText).toBe(",,,,,,,,,,,, ,");

      const fillerTailResult = await testContext.ph.runPrediction(
        "It do not work as expected,,,\u200B ",
        "",
        "en_US",
      );
      expect(fillerTailResult.textEdit).not.toBeNull();
      expect(fillerTailResult.textEdit.replacementText).toBe(",\u200B ");
      expect(fillerTailResult.textEdit.replaceBackwardCount).toBe(5);
      expect(fillerTailResult.textEdit.expectedReplacedText).toBe(",,,\u200B ");

      const rapidBurstResult = await testContext.ph.runPrediction(
        "What the fewer ,,,,,,,,,, ",
        "",
        "en_US",
      );
      expect(rapidBurstResult.textEdit).not.toBeNull();
      expect(rapidBurstResult.textEdit.replacementText).toBe(", ");
      expect(rapidBurstResult.textEdit.replaceBackwardCount).toBe(12);
      expect(rapidBurstResult.textEdit.expectedReplacedText).toBe(" ,,,,,,,,,, ");
    });

    test("emits textEdit for control opener and prose closer contexts", async () => {
      testContext.enabledGrammarRules = ["spacingRule"];
      testContext.insertSpaceAfterAutocomplete = true;
      setConfig();

      const controlOpen = await testContext.ph.runPrediction("if(", "", "en_US");
      expect(controlOpen.textEdit).not.toBeNull();
      expect(controlOpen.textEdit.replacementText).toBe(" (");
      expect(controlOpen.textEdit.replaceBackwardCount).toBe(1);
      expect(controlOpen.textEdit.expectedReplacedText).toBe("(");

      const proseClose = await testContext.ph.runPrediction("Hello (world)", "", "en_US");
      expect(proseClose.textEdit).not.toBeNull();
      expect(proseClose.textEdit.replacementText).toBe(") ");
      expect(proseClose.textEdit.replaceBackwardCount).toBe(1);
      expect(proseClose.textEdit.expectedReplacedText).toBe(")");
    });
  });
});
