import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

// english/neighbourSlots.ts: real words typed for a neighbour. All sentences are our own.
const RULES = new Set(["englishPhraseCorrections", "englishConfusedWords"]);
function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "neighbours", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => RULES.has(d.ruleId));
}

test.each([
  ["Of cause, we will help.", "Of course, we will help."],
  ["It was a rally nice day.", "It was a really nice day."],
  ["Kids tent to forget things.", "Kids tend to forget things."],
  ["The plan sounds god.", "The plan sounds good."],
  ["We are tankful for the help.", "We are thankful for the help."],
  ["Send it today, pleas.", "Send it today, please."],
  ["It sees like a bug.", "It seems like a bug."],
  ["Your input would me appreciated.", "Your input would be appreciated."],
  ["Her we go again.", "Here we go again."],
  ["The tickets were really cheep.", "The tickets were really cheap."],
  ["We asses the risk first.", "We assess the risk first."],
  ["They well help us.", "They will help us."],
  ["We are waiting tor the bus.", "We are waiting for the bus."],
  ["We hired to designers.", "We hired two designers."],
  ["Banks shout not charge that.", "Banks should not charge that."],
  ["Cab you send it?", "Can you send it?"],
  ["She has sen us the file.", "She has sent us the file."],
  ["He posses a rare coin.", "He possesses a rare coin."],
  ["Text me wen you land.", "Text me when you land."],
  ["Did yo see that?", "Did you see that?"],
  ["It as been a long day.", "It has been a long day."],
  ["You forgot a coma there.", "You forgot a comma there."],
  ["Please turn of the radio.", "Please turn off the radio."],
  ["We shell see.", "We shall see."],
  ["Don't loose your keys.", "Don't lose your keys."],
  ["The screw came lose.", "The screw came loose."],
  ["Please don't chance the font.", "Please don't change the font."],
  ["We except your offer.", "We accept your offer."],
  ["It was painted buy my aunt.", "It was painted by my aunt."],
  ["Save time buy using templates.", "Save time by using templates."],
  ["What an exiting trip!", "What an exciting trip!"],
  ["Thanks for your quick replay.", "Thanks for your quick reply."],
  ["It doesn't see to work.", "It doesn't seem to work."],
  ["Two files have been adder.", "Two files have been added."],
  ["The king issued a degree.", "The king issued a decree."],
  ["The fee sometimes various by region.", "The fee sometimes varies by region."],
  ["Let me say you a secret.", "Let me tell you a secret."],
  ["They are wining the match.", "They are winning the match."],
  ["It was the worse possible time.", "It was the worst possible time."],
  ["Tell me hwy it stopped.", "Tell me why it stopped."],
  ["Try not to overdue it.", "Try not to overdo it."],
  ["My colleges and I agree.", "My colleagues and I agree."],
  ["We as for patience.", "We ask for patience."],
  ["Good lock tomorrow!", "Good luck tomorrow!"],
  ["We met two years ego.", "We met two years ago."],
  ["She it very tired.", "She is very tired."],
  ["It is really had to say.", "It is really hard to say."],
  ["We are in the final throws of the project.", "We are in the final throes of the project."],
  ["It is wort the wait.", "It is worth the wait."],
  ["It is lager than ours.", "It is larger than ours."],
])("repairs %s", (input, expected) => {
  const found = scan(input);
  expect({ input, count: found.length }).toEqual({ input, count: 1 });
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected)).toEqual([]);
});

test.each([
  "The law of cause and effect holds.",
  "The rally drew a big crowd.",
  "We pitched the tent to dry it.",
  "Thank god it worked.",
  "Their guilty pleas were heard.",
  "She sees that he left.",
  "Give it to me tomorrow.",
  "Her car is red.",
  "The chicks cheep loudly.",
  "We know it well.",
  "We have to leave.",
  "Fans shout at the referee.",
  "Take a cab to the hotel.",
  "Sheriffs formed posses.",
  "We went to the turn of the century fair.",
  "The bombs shell the city.",
  "We tied the loose ends.",
  "Take a chance on me.",
  "Everyone except my brother came.",
  "I want to buy a car.",
  "We are exiting the highway.",
  "Watch the replay tomorrow.",
  "I see to it daily.",
  "A puff adder bit him.",
  "She earned a degree in law.",
  "We had various options.",
  "The farther shore is rocky.",
  "Say you love me.",
  "They went wining and dining.",
  "Whet my appetite.",
  "It got worse for wear.",
  "Art is long.",
  "He went to college and left.",
  "As for permission, ask Tom.",
  "Lock the door.",
  "His ego is huge.",
  "This it is.",
  "I really had to go.",
  "We want to go.",
  "We won by passing the ball.",
  "The beer is a lager.",
  "Faulty parts stop working over time.",
  "The dog took a good lick at the bowl.",
  "Farther, near the hill, stood a tower.",
  "They are the closest things I have to parents.",
])("leaves %s", (text) => {
  expect(scan(text).map((d) => d.original)).toEqual([]);
});
