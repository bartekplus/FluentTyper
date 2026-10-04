import { expect, test } from "bun:test";
import { REVIEW_RULE_METADATA } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { review as runReview } from "./grammarTestUtils";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";

// Opt-in dialect and house-style rules of english/dialects.ts. All sentences are our own.
const US: CatalogRuleId = "englishAmericanSpelling";
const UK: CatalogRuleId = "englishBritishSpelling";

const review = (text: string, rules: CatalogRuleId[]) =>
  runReview(text, {}, { enabledRules: rules }).diagnostics;
/** Every finding's offered repairs, each applied to the whole text. */
const repaired = (text: string, rule: CatalogRuleId) =>
  review(text, [rule]).map((d) => d.alternatives.map((a) => applyEdits(text, a.edits)));

// [rule, typed, the repairs offered by its one finding]
const positives: [CatalogRuleId, string, string[]][] = [
  // Spellings, with their inflections and the typed casing.
  [US, "Pick a colour for the wall.", ["Pick a color for the wall."]],
  [UK, "Pick a color for the wall.", ["Pick a colour for the wall."]],
  [US, "The Colours faded.", ["The Colors faded."]],
  [US, "We finally realised it.", ["We finally realized it."]],
  [US, "Their defence held.", ["Their defense held."]],
  [UK, "Their defense held.", ["Their defence held."]],
  [US, "It is two centimetres long.", ["It is two centimeters long."]],
  [UK, "It is two centimeters long.", ["It is two centimetres long."]],
  [US, "The travellers rested.", ["The travelers rested."]],
  [UK, "She traveled alone.", ["She travelled alone."]],
  [US, "A grey sky loomed.", ["A gray sky loomed."]],
  [UK, "Save it in grayscale.", ["Save it in greyscale."]],
  [US, "I am sceptical of it.", ["I am skeptical of it."]],
  [UK, "I am skeptical of it.", ["I am sceptical of it."]],
  [US, "Cans are made of aluminium.", ["Cans are made of aluminum."]],
  [UK, "Cans are made of aluminum.", ["Cans are made of aluminium."]],
  [US, "We analysed the logs.", ["We analyzed the logs."]],
  [UK, "We analyzed the logs.", ["We analysed the logs."]],
  [US, "Add honey to the yogourt.", ["Add honey to the yogurt."]],
  [UK, "Add honey to the yogourt.", ["Add honey to the yoghurt."]],
  [US, "We ate on the verandah.", ["We ate on the veranda."]],
  [US, "Watch the TV programme.", ["Watch the TV program."]],
  // Words and idioms each dialect prefers.
  [UK, "Turn off the faucet.", ["Turn off the tap."]],
  [UK, "We bought gasoline.", ["We bought petrol."]],
  [UK, "Park the station wagon here.", ["Park the estate car here.", "Park the estate here."]],
  [UK, "Slice the brinjal.", ["Slice the aubergine."]],
  [US, "We had to prepone the call.", ["We had to move up the call."]],
  [UK, "We had to prepone the call.", ["We had to bring forward the call."]],
  [US, "A merger is on the cards.", ["A merger is in the cards."]],
  [UK, "A merger isn't in the cards.", ["A merger isn't on the cards."]],
  [UK, "Is that really in the cards?", ["Is that really on the cards?"]],
  [US, "Have a look at the draft.", ["Take a look at the draft."]],
  [US, "She has a look at it daily.", ["She takes a look at it daily."]],
  [US, "I had a look yesterday.", ["I took a look yesterday."]],
  [US, "Have you had a look yet?", ["Have you taken a look yet?"]],
  [UK, "Could you take a look?", ["Could you have a look?"]],
  [UK, "I took a look inside.", ["I had a look inside."]],
  [UK, "Has he taken a look?", ["Has he had a look?"]],
  [UK, "We are taking a look.", ["We are having a look."]],
  [US, "The plan went out of the window.", ["The plan went out the window."]],
  [UK, "The plan went out the window.", ["The plan went out of the window."]],
  [US, "It became a vicious circle.", ["It became a vicious cycle."]],
  [UK, "Vicious cycles repeat.", ["Vicious circles repeat."]],
  [UK, "A virtuous cycle began.", ["A virtuous circle began."]],
  [US, "The cat sneaked out.", ["The cat snuck out."]],
  [UK, "The cat snuck out.", ["The cat sneaked out."]],
  [US, "He pleaded guilty.", ["He pled guilty."]],
  [UK, "He pled guilty.", ["He pleaded guilty."]],
  // House style: full words and spelled-out counts.
  ["styleWordChoice", "That is ok with me.", ["That is okay with me."]],
  ["styleWordChoice", "Ok, we start.", ["Okay, we start."]],
  ["styleWordChoice", "Edit the config first.", ["Edit the configuration first."]],
  ["styleWordChoice", "Both configs load.", ["Both configurations load."]],
  ["styleWordChoice", "The food was very good.", ["The food was excellent."]],
  ["styleWordChoice", "It was a very good year.", ["It was an excellent year."]],
  ["styleSpelledNumbers", "We have 3 dogs.", ["We have three dogs."]],
  ["styleSpelledNumbers", "There are 7 lanes.", ["There are seven lanes."]],
  // Prose slashes are words, not paths.
  ["stylePhrasing", "I left w/o my keys.", ["I left without my keys."]],
  ["stylePhrasing", "Use the prev/next arrows.", ["Use the previous/next arrows."]],
  ["styleSpelledNumbers", "WE FEED THE 9 PIGS.", ["WE FEED THE NINE PIGS."]],
];
test.each(positives)("%s repairs %s", (rule, text, repairs) => {
  expect(repaired(text, rule)).toEqual([repairs]);
});

test("a decade before a slash takes a plain s", () => {
  const text = "Music of the late 1960's/early 1970's";
  const fixed = review(text, ["englishNounNumber"]).map((d) =>
    applyEdits(text, d.alternatives[0].edits),
  );
  expect(fixed).toEqual([
    "Music of the late 1960s/early 1970's",
    "Music of the late 1960's/early 1970s",
  ]);
});

// [rule, text that stays clean]
const negatives: [CatalogRuleId, string][] = [
  // The rule's own dialect, and words both dialects write alike.
  [US, "Pick a color for the wall."],
  [UK, "Pick a colour for the wall."],
  [UK, "We realize it now."],
  [UK, "Write a program in Rust."],
  [UK, "You need a license to fish."],
  [UK, "The gas meter is outside."],
  [UK, "Rigor mortis had set in."],
  [UK, "Run the analyses again."],
  [US, "Run the analyses again."],
  [US, "Advertise the glamour of it."],
  [US, "The color-coded map."],
  [US, "Our tour ends at four."],
  [UK, "We walked the footpath."],
  // Idioms in their other senses.
  [US, "Write your name on the cards."],
  [UK, "Shuffle what is in the cards box."],
  [US, "The house has a look of neglect."],
  [US, "The app has a look and feel of its own."],
  [US, "We have a lookout post."],
  [US, "She pleaded with him to stay."],
  [US, "The bird flew in through the window."],
  // Quoted examples and capitals.
  [US, 'He spells it "colour" on purpose.'],
  ["styleWordChoice", "OK, we start."],
  ["styleWordChoice", "Open config.json now."],
  ["styleWordChoice", "The food was good."],
  // Labels, other figures and non-count nouns.
  ["styleSpelledNumbers", "Python 3 users upgraded."],
  ["styleSpelledNumbers", "Read step 2 notes."],
  ["styleSpelledNumbers", "We have 3 dogs and 12 cats."],
  ["styleSpelledNumbers", "We have 3 of them."],
  ["styleSpelledNumbers", "It took 15 minutes."],
  ["styleSpelledNumbers", "We have 1 dog."],
  // Real paths keep their slashes.
  ["stylePhrasing", "Open src/w/o.ts now."],
];
test.each(negatives)("%s leaves %s", (rule, text) => {
  expect(review(text, [rule])).toEqual([]);
});

test("opposite dialects both fire when both are chosen, and stay off by default", () => {
  const text = "The colour and the color.";
  expect(review(text, [US, UK]).map((d) => [d.ruleId, d.original])).toEqual([
    [US, "colour"],
    [UK, "color"],
  ]);
  for (const id of [US, UK, "styleWordChoice", "styleSpelledNumbers"] as const) {
    expect(REVIEW_RULE_METADATA[id]).toMatchObject({
      review: "supported",
      defaultEnabled: false,
      bulk: "individual",
    });
  }
});
