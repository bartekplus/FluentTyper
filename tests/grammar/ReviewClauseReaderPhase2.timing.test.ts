import { describe, expect, test } from "bun:test";
import { chunkTimesWithoutJit, slowestChunkMs, type TimingCase } from "./reviewHarness";

// Worst cases for the phase 2 readings of the shared clause reader: inverted subjects and
// asides between commas (French).

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
  });

  test("no chunk stalls on long blank runs with the regex JIT off", () => {
    const pad = (n: number) => " ".repeat(n);
    const blank = "x" + pad(3_900);
    const [first, second, ...times] = chunkTimesWithoutJit([
      ["en_US", blank],
      ["en_US", blank],
      ["fr_FR", ("où se" + pad(300) + "trouve les" + pad(300) + "ruines de" + pad(200)).repeat(5)],
      ["fr_FR", ("Les prix," + pad(300) + "selon" + pad(300) + "le journal," + pad(200)).repeat(5)],
    ] as TimingCase[]);
    expect(Math.max(...times)).toBeLessThan(Math.max(60, 3 * Math.max(first, second)));
  }, 60_000);
});
