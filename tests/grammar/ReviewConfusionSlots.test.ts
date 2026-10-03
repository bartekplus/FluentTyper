import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

const RULES = new Set(["englishConfusedWords", "englishThenThan", "englishWereWhere"]);

function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "confusions", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => RULES.has(d.ruleId));
}

test("sound-alike words are told apart by their slot", () => {
  for (const [input, expected] of [
    ["We should by another kettle.", "We should buy another kettle."],
    ["The jar cannot by opened by hand.", "The jar cannot be opened by hand."],
    ["She wants us to by careful.", "She wants us to be careful."],
    ["We usually by our coffee there.", "We usually buy our coffee there."],
    ["Did they by their tickets online?", "Did they buy their tickets online?"],
    ["I wouldn't by that blender.", "I wouldn't buy that blender."],
    ["We'll by you a drink.", "We'll buy you a drink."],
    [
      "The tram is far quicker at night then the bus.",
      "The tram is far quicker at night than the bus.",
    ],
    ["He reads more in a week then I do.", "He reads more in a week than I do."],
    ["We water the plants ever day.", "We water the plants every day."],
    ["Ever student got a badge.", "Every student got a badge."],
    ["I don't now what to say.", "I don't know what to say."],
    ["Please let us now.", "Please let us know."],
    ["We stopped an waited for the bus.", "We stopped and waited for the bus."],
    ["It was cold an we left early.", "It was cold and we left early."],
    ["Walk back to were you parked.", "Walk back to where you parked."],
    ["If she where taller, she could reach it.", "If she were taller, she could reach it."],
    ["The guests where dancing all night.", "The guests were dancing all night."],
    ["Where you ever told why?", "Were you ever told why?"],
  ]) {
    const found = scan(input);
    expect({ input, count: found.length }).toEqual({ input, count: 1 });
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(scan(expected)).toEqual([]);
  }
});

test("prepositions, sequences, articles and places stay silent", () => {
  for (const text of [
    "We can by no means accept it.",
    "The report will by then be ready.",
    "He won at will by the rules.",
    "You could by trying harder win.",
    "It will by a small margin pass.",
    "We will by this point know more.",
    "She would by her own account win.",
    "I usually by bus get there.",
    "Then I by the end of May left.",
    "If it gets warmer at noon then we swim.",
    "Eat more then sleep.",
    "It is better, then, to wait.",
    "It was the best ever season.",
    "Nobody is ever one hundred percent sure.",
    "The first blackout ever Monday hit us.",
    "We don't now and never will sell data.",
    "She is an educated woman.",
    "It took an estimated ten days.",
    "He wrote an connect add-on.",
    "We need an update to the docs.",
    "I know where they are.",
    "This is the place where running is allowed.",
    "Where you going?",
    "Next to were the boxes.",
  ]) {
    expect({ text, found: scan(text).map((d) => d.original) }).toEqual({ text, found: [] });
  }
});
