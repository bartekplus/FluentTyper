import { describe, expect, test } from "bun:test";
import { chunkTimesWithoutJit, slowestChunkMs, type TimingCase } from "./reviewHarness";

// Worst cases for the phase 2 readings of the shared clause reader: inverted subjects and
// asides between commas (French), relatives with an object head, "to" phrases
// and name pairs (English).

describe("clause reader phase 2 timing", () => {
  test("inverted subjects and asides stay fast", () => {
    const french = (
      "La route que prend les camions du port de la ville du pays est longue, où se trouve les " +
      "ruines du château. Les exercices des élèves de la classe, quoique longs et répétitifs, " +
      "était utiles, et mon enfant, lui, ne m'en veux pas. "
    ).repeat(16);
    // The first scan loads the lexicons.
    slowestChunkMs(french.slice(0, 400), "fr_FR");
    expect(slowestChunkMs(french, "fr_FR")).toBeLessThan(100);
    const english = (
      "To see them were a joy, and we have tools that works for the old lamps in the hall. " +
      "I hope Kayla and Jack has the keys that opens the door of the house by the lake. "
    ).repeat(24);
    slowestChunkMs(english.slice(0, 400));
    expect(slowestChunkMs(english)).toBeLessThan(100);
  });

  test("no chunk stalls on long blank runs with the regex JIT off", () => {
    const pad = (n: number) => " ".repeat(n);
    const blank = "x" + pad(3_900);
    const [first, second, ...times] = chunkTimesWithoutJit([
      ["en_US", blank],
      ["en_US", blank],
      ["fr_FR", ("où se" + pad(300) + "trouve les" + pad(300) + "ruines de" + pad(200)).repeat(5)],
      ["fr_FR", ("Les prix," + pad(300) + "selon" + pad(300) + "le journal," + pad(200)).repeat(5)],
      ["en_US", ("To" + pad(300) + "see" + pad(300) + "them" + pad(300) + "are, ").repeat(4)],
      ["en_US", ("tools" + pad(300) + "that" + pad(300) + "works" + pad(300) + "for ").repeat(4)],
      ["en_US", ("Kayla" + pad(300) + "and" + pad(300) + "Jack" + pad(300) + "has ").repeat(4)],
    ] as TimingCase[]);
    expect(Math.max(...times)).toBeLessThan(Math.max(60, 3 * Math.max(first, second)));
  }, 60_000);
});
