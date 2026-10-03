import { describe, expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";
import { ALL_RULES, scan as reviewScan } from "./reviewHarness";

// english/plainStyle.ts: set phrases, optional plain style, slang, intensifiers, dialect
// vocabulary and formal negative questions. All sentences are our own.
function scan(text: string, rule: string): ReviewDiagnostic[] {
  return reviewScan(text, { enabledRules: ALL_RULES }).filter((d) => d.ruleId === rule);
}
const fixAll = (text: string, ds: ReviewDiagnostic[]) =>
  applyEdits(
    text,
    ds.flatMap((d) => d.alternatives[0].edits),
  );

describe("set phrases (englishPhraseCorrections)", () => {
  test.each([
    ["Her plan makes since to me.", "Her plan makes sense to me."],
    ["All and all, we won.", "All in all, we won."],
    ["We go sailing ever so often.", "We go sailing every so often."],
    ["Prices rise now and days.", "Prices rise nowadays."],
  ])("fixes %p", (text, expected) => {
    expect(fixAll(text, scan(text, "englishPhraseCorrections"))).toBe(expected);
  });

  test.each(["One for all and all for one.", "It has grown since 2010 and makes sense."])(
    "keeps %p",
    (text) => {
      expect(scan(text, "englishPhraseCorrections")).toEqual([]);
    },
  );
});

describe("optional plain style", () => {
  test.each([
    ["The teams merged together last spring.", "The teams merged last spring."],
    ["He reverts back to old habits.", "He reverts to old habits."],
    ["We utilize three servers.", "We use three servers."],
    ["She facilitated the meeting.", "She helped the meeting."],
    ["They are able to swim.", "They can swim."],
    ["I wanna leave early.", "I want to leave early."],
    ["She wanna stay home.", "She wants to stay home."],
    ["Lemme check the list.", "Let me check the list."],
    ["Why do not you call her?", "Why don't you call her?"],
    ["Can not we stay longer?", "Can't we stay longer?"],
    ["With who you shared lunch?", "With whom you shared lunch?"],
    ["Ten guests came, most of who were late.", "Ten guests came, most of whom were late."],
    ["We always will remember it.", "We will always remember it."],
    ["Trains often are late here.", "Trains are often late here."],
    ["They walk often to school.", "They often walk to school."],
    ["The crate was huge in size.", "The crate was huge."],
    ["Our options are few in number.", "Our options are few."],
    ["The tickets cost $40 dollars.", "The tickets cost $40."],
    ["We served more than 500+ meals.", "We served more than 500 meals."],
    ["Insert the DVD disc first.", "Insert the DVD first."],
    ["I will return the drill back to Sam.", "I will return the drill to Sam."],
    ["Critics over-exaggerated the risk.", "Critics exaggerated the risk."],
    ["We agree with the fact that it helps.", "We agree that it helps."],
  ])("fixes %p", (text, expected) => {
    expect(fixAll(text, scan(text, "stylePhrasing"))).toBe(expected);
  });

  test.each([
    "Love me for who I am.",
    "Had not they left, we would stay.",
    "Tell me who you are.",
    "We merged the branches.",
    "That is not it.",
    "We will always remember it.",
    "They walk to school often.",
    "The rooms differ in size.",
    "It is long in the tooth.",
    "The pin number on the chip is 4.",
    "Return trips back to town are slow.",
  ])("keeps %p", (text) => {
    expect(scan(text, "stylePhrasing")).toEqual([]);
  });

  test("an intensified plain adjective suggests a stronger one", () => {
    expect(
      fixAll("We were extremely tired.", scan("We were extremely tired.", "styleWordChoice")),
    ).toBe("We were exhausted.");
  });

  test("regional vocabulary follows the chosen dialect", () => {
    const us = "We take a bath at night.";
    expect(fixAll(us, scan(us, "englishBritishSpelling"))).toBe("We have a bath at night.");
    const uk = "We meet at the weekend.";
    expect(fixAll(uk, scan(uk, "englishAmericanSpelling"))).toBe("We meet on the weekend.");
  });
});

describe("stylePassiveVoice (optional note)", () => {
  test.each([
    ["The window was broken by a ball.", "was broken"],
    ["He is said to be rich.", "is said"],
    ["It was announced that we won.", "was announced"],
    ["The report has not yet been finalized.", "been finalized"],
    ["The cake is being baked.", "is being baked"],
    ["Mistakes were made.", "were made"],
  ])("notes %p", (text, original) => {
    const [d] = scan(text, "stylePassiveVoice");
    expect(d.original).toBe(original);
    expect(d.warningOnly).toBe(true);
    expect(d.alternatives).toEqual([]);
  });

  test.each([
    "The door is closed.",
    "She was tired.",
    "I am used to it.",
    "We are supposed to go.",
    "He was born in May.",
    "They are interested in art.",
  ])("keeps %p", (text) => {
    expect(scan(text, "stylePassiveVoice")).toEqual([]);
  });
});
