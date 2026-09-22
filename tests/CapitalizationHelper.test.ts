import {
  checkAutoCapitalize,
  Capitalization,
} from "../src/adapters/chrome/background/CapitalizationHelper";

describe("checkAutoCapitalize", () => {
  it("should return WholeWord when lastWord is all uppercase and not ending with space", () => {
    expect(
      checkAutoCapitalize({
        lastWord: "XYZ",
        wordCount: 2,
        newSentence: false,
        endsWithSpace: false,
        autoCapitalize: false,
      }),
    ).toBe(Capitalization.WholeWord);
  });

  it("should return FirstLetter when first character is uppercase letter and not ending with space", () => {
    expect(
      checkAutoCapitalize({
        lastWord: "Xyz",
        wordCount: 2,
        newSentence: false,
        endsWithSpace: false,
        autoCapitalize: false,
      }),
    ).toBe(Capitalization.FirstLetter);
  });

  it("should return FirstLetter when autoCapitalize is true, newSentence is true, not ending with space, and wordCount is 1", () => {
    expect(
      checkAutoCapitalize({
        lastWord: "hello",
        wordCount: 1,
        newSentence: true,
        endsWithSpace: false,
        autoCapitalize: true,
      }),
    ).toBe(Capitalization.FirstLetter);
  });

  it("should return FirstLetter when autoCapitalize is true, newSentence is true, ending with space, and wordCount is 0", () => {
    expect(
      checkAutoCapitalize({
        lastWord: "",
        wordCount: 0,
        newSentence: true,
        endsWithSpace: true,
        autoCapitalize: true,
      }),
    ).toBe(Capitalization.FirstLetter);
  });

  it("should return None for lowercase word not matching any rule", () => {
    expect(
      checkAutoCapitalize({
        lastWord: "hello",
        wordCount: 2,
        newSentence: false,
        endsWithSpace: false,
        autoCapitalize: false,
      }),
    ).toBe(Capitalization.None);
  });

  it("should return None for empty lastWord and not a new sentence", () => {
    expect(
      checkAutoCapitalize({
        lastWord: "",
        wordCount: 0,
        newSentence: false,
        endsWithSpace: false,
        autoCapitalize: false,
      }),
    ).toBe(Capitalization.None);
  });

  const base = { wordCount: 2, newSentence: false, endsWithSpace: false, autoCapitalize: false };

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
