import { describe, expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";
import { chunkTimesWithoutJit, scan, slowestChunkMs, type TimingCase } from "./reviewHarness";

// The shared clause reader (src/core/domain/grammar/review/clauseReader.ts): agreement past the
// complements and a relative clause of a subject.

const fixed = (ruleId: CatalogRuleId, text: string, lang: string) => {
  const found = scan(text, { lang, enabledRules: [ruleId] }).filter((d) => d.ruleId === ruleId);
  return found.length ? applyEdits(text, found[0].alternatives[0].edits) : text;
};

// [rule, language, text, the text with the first alternative applied]
const POSITIVES: Array<[CatalogRuleId, string, string, string]> = [
  // A relative clause after the complements: the numbers show what "qui" goes with.
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Les élèves de la classe qui ont réussi part demain.",
    "Les élèves de la classe qui ont réussi partent demain.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Les jardins du château qui entourent le parc est immense.",
    "Les jardins du château qui entourent le parc sont immense.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "La revue de cinéma qui paraît chaque mois depuis Lyon sont chère.",
    "La revue de cinéma qui paraît chaque mois depuis Lyon est chère.",
  ],
  // A relative clause with a noun phrase subject.
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Le bruit des moteurs que les voisins entendent sont gênant.",
    "Le bruit des moteurs que les voisins entendent est gênant.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Les lettres que la poste a perdues est arrivée.",
    "Les lettres que la poste a perdues sont arrivée.",
  ],
  [
    "frenchAdjectiveAgreement",
    "fr_FR",
    "Les boîtes que les enfants ont rangées sont lourde.",
    "Les boîtes que les enfants ont rangées sont lourdes.",
  ],
  [
    "frenchAdjectiveAgreement",
    "fr_FR",
    "La voiture que mon père a achetée est petit.",
    "La voiture que mon père a achetée est petite.",
  ],
  // A stressed pronoun closes a complement.
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Mes cadeaux pour toi arrive demain.",
    "Mes cadeaux pour toi arrivent demain.",
  ],
  [
    "frenchAdjectiveAgreement",
    "fr_FR",
    "Un morceau de moi était cassée.",
    "Un morceau de moi était cassé.",
  ],
  // English: a subject past its complements and a relative clause.
  [
    "englishSubjectVerbAgreement",
    "en_US",
    "The old maps in the drawers of the desk is torn.",
    "The old maps in the drawers of the desk are torn.",
  ],
  [
    "englishSubjectVerbAgreement",
    "en_US",
    "The paintings about storms and ships hangs in the hall.",
    "The paintings about storms and ships hang in the hall.",
  ],
  [
    "englishSubjectVerbAgreement",
    "en_US",
    "The nurses who treated the boy quickly leaves early.",
    "The nurses who treated the boy quickly leave early.",
  ],
  [
    "englishSubjectVerbAgreement",
    "en_US",
    "The pilot who flew the plane safely land in fog.",
    "The pilot who flew the plane safely lands in fog.",
  ],
  [
    "englishSubjectVerbAgreement",
    "en_US",
    "The lamp that my aunt bought in Rome are broken.",
    "The lamp that my aunt bought in Rome is broken.",
  ],
  [
    "englishSubjectVerbAgreement",
    "en_US",
    "The lamps that my aunt usually keeps in the attic is old.",
    "The lamps that my aunt usually keeps in the attic are old.",
  ],
];

// Correct text: the reader must stay silent.
const NEGATIVES: Array<[CatalogRuleId, string, string]> = [
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Le directeur des ventes qui travaille à Paris est absent.",
  ],
  ["frenchSubjectVerbAgreement", "fr_FR", "La liste des produits qui sont en stock est longue."],
  ["frenchSubjectVerbAgreement", "fr_FR", "La fille de mes voisins qui joue du piano chante bien."],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Les maisons du village qui donne sur la mer sont belles.",
  ],
  ["frenchSubjectVerbAgreement", "fr_FR", "Le fait que les prix montent inquiète les gens."],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Les choses que les parents disent aux enfants comptent.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Trois filles dont le voile sombre cache mal les écouteurs se lèvent.",
  ],
  ["frenchSubjectVerbAgreement", "fr_FR", "Les efforts pour lui plaire sont vains."],
  ["frenchAdjectiveAgreement", "fr_FR", "Les gens que le maire a invités sont venus."],
  ["frenchAdjectiveAgreement", "fr_FR", "La clé de la maison que j'ai vendue est perdue."],
  ["englishSubjectVerbAgreement", "en_US", "The parents of the child who was hurt are angry."],
  [
    "englishSubjectVerbAgreement",
    "en_US",
    "The friends of my sister who lives in Paris are coming.",
  ],
  ["englishSubjectVerbAgreement", "en_US", "The teacher of the students who study French is kind."],
  ["englishSubjectVerbAgreement", "en_US", "The quality of the products that we sell is high."],
  ["englishSubjectVerbAgreement", "en_US", "The people who said the plan works are here."],
  ["englishSubjectVerbAgreement", "en_US", "The solvents present in the adhesives are a medium."],
  ["englishSubjectVerbAgreement", "en_US", "The rest of the books on the shelf are mine."],
  ["englishSubjectVerbAgreement", "en_US", "The kind of people who like this are rare."],
  [
    "englishSubjectVerbAgreement",
    "en_US",
    "The book about cats and the movie about dogs are both new.",
  ],
  [
    "englishSubjectVerbAgreement",
    "en_US",
    "We ask that the owner of the cars in the lot move them.",
  ],
];

describe("clause reader", () => {
  test.each(POSITIVES)("%s finds %p in %p", (ruleId, lang, text, expected) => {
    expect(fixed(ruleId, text, lang)).toBe(expected);
  });
  test.each(NEGATIVES)("%s stays silent on %p: %p", (ruleId, lang, text) => {
    expect(fixed(ruleId, text, lang)).toBe(text);
  });
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
    ] as TimingCase[]);
    expect(Math.max(...times)).toBeLessThan(Math.max(60, 3 * Math.max(first, second)));
  }, 60_000);
});
