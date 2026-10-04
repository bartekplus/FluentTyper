import {
  checkAutoCapitalize,
  Capitalization,
} from "../src/adapters/chrome/background/CapitalizationHelper";

describe("checkAutoCapitalize", () => {
  const base = {
    lastWord: "",
    wordCount: 2,
    newSentence: false,
    endsWithSpace: false,
    autoCapitalize: false,
  };

  test.each([
    [{ lastWord: "XYZ" }, Capitalization.WholeWord],
    [{ lastWord: "ΑΒΓ" }, Capitalization.WholeWord],
    [{ lastWord: "AB1" }, Capitalization.WholeWord],
    [{ lastWord: "Xyz" }, Capitalization.FirstLetter],
    [{ lastWord: "ABc" }, Capitalization.FirstLetter],
    [{ lastWord: "A" }, Capitalization.FirstLetter],
    [
      { lastWord: "hello", wordCount: 1, newSentence: true, autoCapitalize: true },
      Capitalization.FirstLetter,
    ],
    [
      { wordCount: 0, newSentence: true, endsWithSpace: true, autoCapitalize: true },
      Capitalization.FirstLetter,
    ],
    [{ lastWord: "hello" }, Capitalization.None],
    [{ wordCount: 0 }, Capitalization.None],
    [{ lastWord: "12" }, Capitalization.None],
    [{ lastWord: "مرحبا" }, Capitalization.None],
    [{ lastWord: "ك" }, Capitalization.None],
  ])("%o -> %s", (input, expected) => {
    expect(checkAutoCapitalize({ ...base, ...input })).toBe(expected);
  });
});
