import {
  checkAutoCapitalize,
  Capitalization,
} from "../src/adapters/chrome/background/CapitalizationHelper";

describe("checkAutoCapitalize", () => {
  const base = { wordCount: 2, newSentence: false, endsWithSpace: false, autoCapitalize: false };

  it.each([
    ["all-uppercase word", { lastWord: "XYZ" }, Capitalization.WholeWord],
    ["uppercase first letter", { lastWord: "Xyz" }, Capitalization.FirstLetter],
    [
      "first word of a new sentence",
      { lastWord: "hello", wordCount: 1, newSentence: true, autoCapitalize: true },
      Capitalization.FirstLetter,
    ],
    [
      "space at the start of a new sentence",
      { lastWord: "", wordCount: 0, newSentence: true, endsWithSpace: true, autoCapitalize: true },
      Capitalization.FirstLetter,
    ],
    ["lowercase word", { lastWord: "hello" }, Capitalization.None],
    ["empty word outside a new sentence", { lastWord: "", wordCount: 0 }, Capitalization.None],
  ])("returns the expected capitalization for %s", (_case, input, expected) => {
    expect(checkAutoCapitalize({ ...base, ...input })).toBe(expected);
  });

  it("should return None for caseless-script words (Arabic)", () => {
    expect(checkAutoCapitalize({ ...base, lastWord: "مرحبا" })).toBe(Capitalization.None);
    expect(checkAutoCapitalize({ ...base, lastWord: "ك" })).toBe(Capitalization.None);
  });

  it("should keep WholeWord only for cased uppercase words without lowercase", () => {
    expect(checkAutoCapitalize({ ...base, lastWord: "ΑΒΓ" })).toBe(Capitalization.WholeWord);
    expect(checkAutoCapitalize({ ...base, lastWord: "AB1" })).toBe(Capitalization.WholeWord);
    expect(checkAutoCapitalize({ ...base, lastWord: "ABc" })).toBe(Capitalization.FirstLetter);
    expect(checkAutoCapitalize({ ...base, lastWord: "A" })).toBe(Capitalization.FirstLetter);
    expect(checkAutoCapitalize({ ...base, lastWord: "12" })).toBe(Capitalization.None);
  });
});
