import { describe, expect, test } from "bun:test";
import { chunkTimesWithoutJit, slowestChunkMs, type TimingCase } from "./reviewHarness";

// Time budgets (thread CPU time). bun run test runs *.timing.test.ts files serially,
// after the parallel run, so the load of other test workers does not inflate the times.

describe("clause reader", () => {
  test("long subjects and relative clauses stay fast", () => {
    const french = (
      "Les élèves de la classe de la ville du pays qui ont réussi depuis mai part demain, " +
      "le bruit des moteurs que les voisins entendent sont gênant, mes cadeaux pour toi arrive. "
    ).repeat(25);
    // The first scan loads the lexicons.
    slowestChunkMs(french.slice(0, 400), "fr_FR");
    expect(slowestChunkMs(french, "fr_FR")).toBeLessThan(100);
    const english = (
      "The drivers of the trucks in the city who ran the red light near the school usually " +
      "injures people. The list of items in the carts that the shoppers left by the door are " +
      "long, and the books of the men of the city of the state of the land is old. "
    ).repeat(20);
    slowestChunkMs(english.slice(0, 400));
    expect(slowestChunkMs(english)).toBeLessThan(100);
    for (const [lang, text] of [
      ["es_ES", "Los precios de la casa del pueblo que compré ayer en la plaza sube, "],
      ["pt_BR", "Os preços da casa do bairro que comprei ontem na praça aumenta, "],
    ]) {
      slowestChunkMs(text, lang);
      expect(slowestChunkMs(text.repeat(60), lang)).toBeLessThan(100);
    }
  });
  test("no chunk stalls on long blank runs inside a subject with the regex JIT off", () => {
    const pad = (n: number) => " ".repeat(n);
    const blank = "x" + pad(3_900);
    const [first, second, ...times] = chunkTimesWithoutJit([
      ["en_US", blank],
      ["en_US", blank],
      ["en_US", ("The maps of" + pad(300) + "the city who" + pad(300) + "ran is, ").repeat(6)],
      ["en_US", ("The lamps that" + pad(400) + "my aunt keeps" + pad(400) + "is ").repeat(4)],
      ["fr_FR", ("Les élèves de" + pad(300) + "la ville qui" + pad(300) + "part, ").repeat(6)],
      [
        "fr_FR",
        ("Les boîtes que" + pad(400) + "les enfants rangent" + pad(400) + "est ").repeat(4),
      ],
      ["es_ES", ("Los precios de" + pad(300) + "la casa que" + pad(300) + "sube, ").repeat(6)],
      ["pt_BR", ("Os preços da" + pad(300) + "casa que" + pad(300) + "aumenta, ").repeat(6)],
      ["pt_BR", ("O pai e" + pad(400) + "a mãe" + pad(400) + "chegou. ").repeat(4)],
    ] as TimingCase[]);
    expect(Math.max(...times)).toBeLessThan(Math.max(60, 3 * Math.max(first, second)));
  }, 60_000);
});
