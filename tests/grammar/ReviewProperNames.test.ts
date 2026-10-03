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
    // Nouns after an adverb are not verbs: the brand is still recased.
    ["We often use skype.", "We often use Skype."],
    ["I still prefer facetime for calls.", "I still prefer FaceTime for calls."],
    ["I rarely open my skype account.", "I rarely open my Skype account."],
    // Noun contexts: a determiner or a preposition before the brand.
    ["We had a facetime call.", "We had a FaceTime call."],
    ["The skype update failed.", "The Skype update failed."],
    ["Send the file via whatsapp.", "Send the file via WhatsApp."],
    ["I would rather use paypal.", "I would rather use PayPal."],
    ["Her skype status is away.", "Her Skype status is away."],
    // A noun cue wins over an object pronoun after the brand.
    ["On skype you can share your screen.", "On Skype you can share your screen."],
    // "to" after a verb of motion or change is a preposition, not the infinitive.
    ["Switch to skype for the meeting.", "Switch to Skype for the meeting."],
    ["We moved to whatsapp last year.", "We moved to WhatsApp last year."],
    // A noun after the brand shows noun use.
    ["I made skype calls all day.", "I made Skype calls all day."],
    ["Is whatsapp video free?", "Is WhatsApp video free?"],
    // The brand list recases this inflected form, so it is not kept as a verb.
    ["He fedexed the contract.", "He FedExed the contract."],
    ["She bought a mac book.", "She bought a MacBook."],
    ["Bring your student id to the exam.", "Bring your student ID to the exam."],
    ["The valley is v-shaped.", "The valley is V-shaped."],
    // Super Bowls are numbered in Roman numerals, except the 50th.
    ["We hosted a party for Super Bowl 49.", "We hosted a party for Super Bowl XLIX."],
    ["Tickets for Super Bowl 61 sold out.", "Tickets for Super Bowl LXI sold out."],
  ])("fixes %p", (text, expected) => {
    expect(fixAll(text, scan(text, "englishCanonicalCasing"))).toBe(expected);
  });

  test.each([
    "Students who excel in math do well.",
    "Super Bowl 50 was played in Santa Clara.",
    "The Super Bowl LX halftime show was long.",
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
    "We skype every Sunday evening.",
    "They facetime with their parents on weekends.",
    // One or two adverbs between the subject and the brand verb.
    "We often skype every day.",
    "Paul regularly facetime his mother.",
    "They almost always facetime on Sundays.",
    "She usually skype with clients.",
    // A subject before the brand verb.
    "I whatsapp my sister daily.",
    // A modal or an auxiliary before the brand verb, also with adverbs between.
    "We can skype later.",
    "You should facetime more often.",
    "We must skype soon.",
    "She'll facetime after lunch.",
    "They won't whatsapp during work.",
    "I don't snapchat anymore.",
    "I didn't skype today.",
    "They'll probably skype later.",
    "I'll not skype during dinner.",
    // The infinitive "to" before the brand verb.
    "I want to skype later.",
    "Remember to quickly facetime before dinner.",
    "We are going to skype tonight.",
    // An object pronoun after the brand verb.
    "If possible, skype me tonight.",
    "When you land, facetime us.",
    "After work, paypal him the money.",
    "Tomorrow at noon, snapchat them the photo.",
    // A brand verb after a coordinating conjunction.
    "We can call or skype tomorrow.",
    "We can email and facetime tomorrow.",
    // Inflected forms of a brand verb.
    "We skyped for an hour.",
    "She is facetiming her parents.",
    "They whatsapped all night.",
    "My mom whatsapps me daily.",
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
