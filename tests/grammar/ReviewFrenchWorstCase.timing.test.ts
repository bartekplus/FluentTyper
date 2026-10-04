import { expect, test } from "bun:test";
import { chunkTimesWithoutJit, type TimingCase } from "./reviewHarness";

// French frames on long runs of spaces and tabs, scanned with JavaScriptCore's regex JIT off:
// its interpreter turns an unbounded quantifier inside a lookbehind, or two adjacent ones
// ("[ \t]*[ \t/-][ \t]*"), into quadratic work that the JIT hides. Times are compared with a
// blank text's, so a loaded machine slows both.
const pad = (n: number) => " ".repeat(n);
const inputs = [
  "le" + pad(3_500) + "31/04 ",
  ("né le" + pad(400) + "31.04 ").repeat(8),
  ("\n" + "\t".repeat(600) + "Les maisons est ").repeat(6),
  ("de 6" + pad(500) + "a" + pad(500) + "10, ").repeat(4),
  ("lundi" + pad(300) + "," + pad(300) + "12" + pad(300) + "mai ").repeat(4),
  ("trois" + pad(300) + "cent" + pad(300) + "un ").repeat(6),
  ("Les" + pad(300) + "12" + pad(300) + "candidats attend, ").repeat(6),
  ("la porte" + pad(200) + "," + pad(200) + "des voisins claquaient ").repeat(8),
  ("un" + pad(400) + "à" + pad(400) + "1 ").repeat(4),
  ("Les enfants que" + pad(300) + "je" + pad(300) + "garde arrive, ").repeat(6),
  (", Marie" + pad(400) + "et" + pad(400) + "Paul part ").repeat(4),
  ("La durée de" + pad(300) + "la pièce" + pad(300) + "est passé, ").repeat(6),
  ("Saint" + pad(8) + "Jean" + pad(8) + "de" + pad(600) + "Luz ").repeat(6),
  ("Beaucoup de" + pad(400) + "gens" + pad(400) + "pense, ").repeat(4),
  ("j'ai vu les" + pad(300) + "enfants" + pad(300) + "qui joue, ").repeat(5),
  ("La boîte" + pad(400) + "a" + pad(400) + "outils ").repeat(4),
  ("il ," + pad(400) + "arrive, le plus grand" + pad(400) + "c'est ").repeat(4),
  ("Il viendra" + pad(400) + "dit-elle" + pad(400) + "demain ").repeat(4),
  ("Les" + pad(400) + "as-tu" + pad(400) + "lu ").repeat(4),
  ("il est" + pad(400) + "20" + pad(400) + "ans j'ai" + pad(400) + "allé ").repeat(3),
  ("arrivé à" + pad(400) + "la" + pad(400) + "Belgique au" + pad(400) + "France ").repeat(3),
  ("Personne" + pad(400) + "lui" + pad(400) + "parle, il parle à" + pad(400) + "personne ").repeat(
    3,
  ),
  ("Elle rit" + pad(400) + "et" + pad(400) + "est" + pad(400) + "content. ").repeat(3),
  ("La petite" + pad(300) + "salle" + pad(300) + "12" + pad(300) + "est fermé, ").repeat(3),
  ("les" + pad(400) + "plus" + pad(400) + "beau" + pad(400) + "garçon ").repeat(3),
  ("Ne" + pad(400) + "prend" + pad(400) + "pas ! Nous" + pad(400) + "eu ").repeat(3),
  ("Que mange-tu" + pad(400) + "qu'il" + pad(400) + "ai, et" + pad(400) + "ça vont ").repeat(3),
  ("une" + pad(400) + "très" + pad(400) + "petit" + pad(400) + "maison ").repeat(3),
  ("en" + pad(400) + "1 000 000" + pad(400) + "partie ").repeat(4),
  "j'ai 12" + " 345".repeat(600) + " enfant ",
];
const blank = "x" + pad(3_900);

test("no French chunk stalls on long blank runs with the regex JIT off", () => {
  const [first, second, ...times] = chunkTimesWithoutJit(
    [blank, blank, ...inputs].map((text): TimingCase => ["fr_FR", text]),
  );
  expect(Math.max(...times)).toBeLessThan(Math.max(60, 3 * Math.max(first, second)));
}, 60_000);
