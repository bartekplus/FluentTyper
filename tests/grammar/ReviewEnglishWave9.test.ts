import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { ALL_RULES, scan, slowestChunkMs } from "./reviewHarness";

// English checks added in the ninth LanguageTool parity wave: english/realWordFrames.ts and
// english/clauseGaps.ts. All sentences are our own. Every supported rule runs.
const review = (text: string) =>
  scan(text, { enabledRules: ALL_RULES }).filter(
    (d) => d.category !== "style" && d.category !== "typography",
  );

test.each([
  ["I complaint about the noise every night.", "I complain about the noise every night."],
  ["We life in a small town.", "We live in a small town."],
  ["He departures at noon each day.", "He departs at noon each day."],
  ["She deliveries the mail on foot.", "She delivers the mail on foot."],
  ["He threats me with a lawsuit.", "He threatens me with a lawsuit."],
  ["I left early cause I was tired.", "I left early because I was tired."],
  ["The bug was worse than I though.", "The bug was worse than I thought."],
  ["I'm bit tired today.", "I'm a bit tired today."],
  ["I apologies for the delay.", "I apologize for the delay."],
  ["We would priorities the backlog.", "We would prioritize the backlog."],
  ["I owe you an apologize.", "I owe you an apology."],
  ["He helped carrying the boxes.", "He helped to carry the boxes."],
  ["I'm used to run every morning.", "I'm used to running every morning."],
  ["She is accustomed to speak French.", "She is accustomed to speaking French."],
  ["She wants you to goes there.", "She wants you to go there."],
  ["The door must be replaces soon.", "The door must be replaced soon."],
  ["He will be have a party.", "He will have a party."],
  ["They buy this state of art equipment.", "They buy this state-of-the-art equipment."],
  ["We drove back and fourth all day.", "We drove back and forth all day."],
  ["We meet on a weekly base.", "We meet on a weekly basis."],
  ["Remove the line if is too long.", "Remove the line if it is too long."],
  ["The build broke since was merged late.", "The build broke since it was merged late."],
  ["Call me if should have questions.", "Call me if you should have questions."],
  ["Tell me if need anything else.", "Tell me if you need anything else."],
  ["It failed in either the client nor the proxy.", "It failed in either the client or the proxy."],
  ["I want wanted to thank you.", "I want to thank you."],
  ["She was going go home.", "She was going home."],
  ["The value must be greater that 10.", "The value must be greater than 10."],
  ["The price fell gradually there after.", "The price fell gradually thereafter."],
])("repairs %s", (input, expected) => {
  const found = review(input);
  expect({ input, count: found.length }).toEqual({ input, count: 1 });
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(review(expected)).toEqual([]);
});

test.each([
  "We developers need better tools.",
  "It is a good cause they support.",
  "Smoking can cause the problem.",
  "Things that cause our pain are many.",
  "I do though.",
  "He though is the best.",
  "Even though about half came, we won.",
  "The dog bit me yesterday.",
  "I got bit by a dog.",
  "Every bit as good as the old one.",
  "Bit rot slowly ruins old disks.",
  "I can't help laughing at it.",
  "I need help getting this to work.",
  "It helps knowing the answer.",
  "The tool is used to run tests.",
  "They are used to define the scope.",
  "We are used to hard work.",
  "The file it points to exists.",
  "Set the flag to disabled.",
  "It will be done soon.",
  "Should it be, please call me.",
  "Wear Type I life jackets.",
  "The state of art in the city is poor.",
  "Do it if need be.",
  "I stayed because will power is all I had.",
  "Neither the client nor the proxy works.",
  "It is not the case either that A holds nor that B holds.",
  "He had had enough.",
  "The test tested nothing.",
  "No one I know knows the way.",
  "We need to connect connected devices.",
  "He is locking locks.",
  "It is better that we leave now.",
  "We got there after lunch.",
])("leaves %s", (text) => {
  expect(review(text).map((d) => d.original)).toEqual([]);
});

test("no chunk stalls on runs of this wave's frame words", () => {
  for (const text of [
    "I complaint cause though bit apologies helped carrying used to goes ".repeat(500),
    "if is either nor want wanted greater that 10 there after be replaces ".repeat(500),
    "go went gone going goes ".repeat(800),
  ])
    expect(Math.min(slowestChunkMs(text), slowestChunkMs(text))).toBeLessThan(30);
});
