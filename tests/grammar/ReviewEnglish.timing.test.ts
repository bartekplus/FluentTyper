import { describe, expect, test } from "bun:test";
import { slowestChunkMs } from "./reviewHarness";

// Time budgets (thread CPU time). bun run test runs *.timing.test.ts files serially,
// after the parallel run, so the load of other test workers does not inflate the times.

describe("English wave 7", () => {
  // Worst cases for this wave's frames: every word opens one, or long space runs between.
  test("no chunk stalls on runs of this wave's frame words", () => {
    for (const text of [
      "Old cars is good. Maria live in Lisbon. ".repeat(500),
      "is good friend at airport such long song have experienced problem ".repeat(500),
      "a lot of car a few week ago is requires than went to out team ".repeat(500),
      `${"x".repeat(3)}${" ".repeat(20_000)}Monday, 7 October "quoted" organisation`,
      'Monday, 7 October "a" "b" energise '.repeat(800),
    ])
      // The first run compiles the frames; the second is the steady state.
      expect(Math.min(slowestChunkMs(text), slowestChunkMs(text))).toBeLessThan(100);
  });
});

describe("English wave 8", () => {
  test("no chunk stalls on runs of this wave's frame words", () => {
    for (const text of [
      "a nice a good a cheap luggage many few several wine ".repeat(500),
      "a lot of ball a bunch of guy is great runner ".repeat(500),
    ])
      expect(Math.min(slowestChunkMs(text), slowestChunkMs(text))).toBeLessThan(100);
  });
});

describe("English wave 9", () => {
  // Each chunk of a long run of this wave's frame words stays below 100 ms, the budget of the
  // other worst-case tests. Every regex is warmed first, as in ReviewWorstCase: the first scan also compiles the frames.
  test("no chunk stalls on runs of this wave's frame words", () => {
    const inputs = [
      "I complaint cause though bit apologies helped carrying used to goes ".repeat(500),
      "if is either nor want wanted greater that 10 there after be replaces ".repeat(500),
      "go went gone going goes ".repeat(800),
      // verbSlots, nounSlots and agreementFrames: long chains between "and" and an -s word,
      // "of" heads, "it", modals and "Here".
      "It reads files words lines and print does not means ".repeat(400),
      "the reports of the outage data is one of our client the worlds best ".repeat(300),
      "Here the specs of the phone of the case of the box ".repeat(300),
      "it make sense can someone wrote will based the US try this make no ".repeat(300),
      `${"a ".repeat(2000)}lot`,
      `there are ${"many ".repeat(1500)}computer`,
      // neighbourTypos: words that open many frames.
      "red nut white an see he company has out time has the be of tree ".repeat(300),
    ];
    for (const text of inputs) slowestChunkMs(text);
    for (const text of inputs)
      expect(Math.min(slowestChunkMs(text), slowestChunkMs(text))).toBeLessThan(100);
  });
});

describe("English wave 10", () => {
  // Each chunk of a long run of this wave's frame words stays below the budget. Every regex is
  // warmed first, as in ReviewWorstCase: the first scan also compiles the frames.
  test("no chunk stalls on runs of this wave's frame words", () => {
    const inputs = [
      "if you laptop is you and you family ".repeat(500),
      "Users sees cars runs dogs eats ".repeat(500),
      "this reports shows this allow us this guys works ".repeat(400),
      "I quickly the we slowly a they rarely the ".repeat(500),
      "it will he done the door will he locked ".repeat(500),
      "We'll happy it wouldn't cool you are not dismiss me I was believe that ".repeat(300),
      `${"you ".repeat(2000)}is`,
    ];
    for (const text of inputs) slowestChunkMs(text);
    for (const text of inputs)
      expect(Math.min(slowestChunkMs(text), slowestChunkMs(text))).toBeLessThan(100);
  });
});

describe("English wave 11", () => {
  test("no chunk stalls on runs of this wave's frame words", () => {
    const inputs = [
      "please send it and please ".repeat(600),
      "the reason we left is the reason we ".repeat(400),
      "I'm just haven't he was hasn't it's doesn't ".repeat(400),
      "that's we are what's I'm that's you're ".repeat(400),
      "more easy more clear more simple ".repeat(500),
      "my car needs fixed the walls need painted ".repeat(400),
      'We"ll Tom"s wasn"t "if"s '.repeat(600),
      "is 25 year old turned 7 month old ".repeat(400),
      "Why did you go How can we stay What is it ".repeat(400),
      "very very so so far far ".repeat(600),
      "“a.”.”b,”c ".repeat(800),
    ];
    for (const text of inputs)
      expect(Math.min(slowestChunkMs(text), slowestChunkMs(text))).toBeLessThan(100);
  });
});
