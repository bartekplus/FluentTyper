import { describe, expect, test } from "bun:test";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";

// english/properNames.ts and the brand casing rows: names in their owners' spelling and
// capitalized nationalities. All sentences are our own.
function scan(text: string, rule: string, lang = "en_US"): ReviewDiagnostic[] {
  return detectReviewDiagnostics(
    { id: "names", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang,
      enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === rule);
}
const fixAll = (text: string, ds: ReviewDiagnostic[]) =>
  applyEdits(
    text,
    ds.flatMap((d) => d.alternatives[0].edits),
  );

describe("brand and name casing", () => {
  test.each([
    ["I posted it on you tube.", "I posted it on YouTube."],
    ["Pay with pay pal today.", "Pay with PayPal today."],
    ["Send the excel file and the word document.", "Send the Excel file and the Word document."],
    ["Check your outlook inbox.", "Check your Outlook inbox."],
    ["Install the chrome extension.", "Install the Chrome extension."],
    ["The mac app froze.", "The Mac app froze."],
    ["We moved to windows 11 last year.", "We moved to Windows 11 last year."],
    ["They visited the eifel tower.", "They visited the Eiffel Tower."],
    ["I sent it by fed ex.", "I sent it by FedEx."],
    ["We use google analytics daily.", "We use Google Analytics daily."],
    ["Call me on skype.", "Call me on Skype."],
    ["She bought a mac book.", "She bought a MacBook."],
    ["Bring your student id to the exam.", "Bring your student ID to the exam."],
    ["The valley is v-shaped.", "The valley is V-shaped."],
  ])("fixes %p", (text, expected) => {
    expect(fixAll(text, scan(text, "englishCanonicalCasing"))).toBe(expected);
  });

  test.each([
    "Students who excel in math do well.",
    "Choose your word carefully.",
    "The outlook for next year is good.",
    "The chrome on the bumper shines.",
    "We went to the opera last night.",
    "Just google the error.",
    "Birds twitter at dawn.",
    "Cut him some slack today.",
    "Kindle the fire slowly.",
    "Plants react to light.",
    "Open the windows tonight.",
    "An apple a day is enough.",
    "Find the mac address of the router.",
    "They jumped into a black sea of people.",
    "Plug it into the power point.",
    "Store the user id in a cookie.",
  ])("keeps %p", (text) => {
    expect(scan(text, "englishCanonicalCasing")).toEqual([]);
  });
});

describe("nationalities, languages and religions", () => {
  test.each([
    ["He is learning french.", "He is learning French."],
    ["The dutch team won.", "The Dutch team won."],
    ["She speaks polish.", "She speaks Polish."],
    ["The polish border is near.", "The Polish border is near."],
    ["We have english and spanish classes.", "We have English and Spanish classes."],
    ["Her family is muslim.", "Her family is Muslim."],
  ])("fixes %p", (text, expected) => {
    expect(fixAll(text, scan(text, "englishProperNounCapitalization"))).toBe(expected);
  });

  test.each([
    "We ate french fries.",
    "Let's go dutch tonight.",
    "Polish your shoes first.",
    "Nail polish dries fast.",
    "We polish the table every week.",
    "The French team won.",
  ])("keeps %p", (text) => {
    expect(scan(text, "englishProperNounCapitalization")).toEqual([]);
  });

  test("is English only", () => {
    expect(scan("Il parle english.", "englishProperNounCapitalization", "fr_FR")).toEqual([]);
  });
});

describe("places and holidays named with ordinary words", () => {
  test.each([
    ["My aunt was born in china.", "My aunt was born in China."],
    ["We flew to japan last spring.", "We flew to Japan last spring."],
    ["He moved back to turkey in May.", "He moved back to Turkey in May."],
    ["They grew up in long island", "They grew up in Long Island"],
    ["Ships cross the black sea daily.", "Ships cross the Black Sea daily."],
    ["See you over thanksgiving!", "See you over Thanksgiving!"],
  ])("fixes %p", (text, expected) => {
    expect(fixAll(text, scan(text, "englishProperNounCapitalization"))).toBe(expected);
  });

  test.each([
    "Grandma keeps her china in a cabinet.",
    "We roasted a turkey from the farm.",
    "It is a long island with one road.",
    "A black sea of umbrellas filled the square.",
    "We gave thanksgiving after the harvest.",
    "She was born in China.",
  ])("keeps %p", (text) => {
    expect(scan(text, "englishProperNounCapitalization")).toEqual([]);
  });
});
