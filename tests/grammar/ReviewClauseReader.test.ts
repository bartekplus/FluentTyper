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
  // An inverted subject after "où", "lorsque", "quand" and "que".
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Le village où se trouve les ruines est loin.",
    "Le village où se trouvent les ruines est loin.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Ils partent quand vient les beaux jours.",
    "Ils partent quand viennent les beaux jours.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "La route que prend les camions du port est longue.",
    "La route que prennent les camions du port est longue.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "La ville où a été construits les ponts.",
    "La ville où ont été construits les ponts.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Il sort lorsque s'arrêtent la pluie.",
    "Il sort lorsque s'arrête la pluie.",
  ],
  // An aside between commas, or a stressed pronoun that takes up the subject.
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Les ouvriers, selon le journal, prépare une grève.",
    "Les ouvriers, selon le journal, préparent une grève.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Le directeur, malgré la crise, refusent de partir.",
    "Le directeur, malgré la crise, refuse de partir.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Les élèves de la classe, souvent fatigués, arrive en retard.",
    "Les élèves de la classe, souvent fatigués, arrivent en retard.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Les élèves, eux, travaille dur.",
    "Les élèves, eux, travaillent dur.",
  ],
  [
    "frenchSubjectVerbAgreement",
    "fr_FR",
    "Ma fille, elle ne me crois pas.",
    "Ma fille, elle ne me croit pas.",
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
  // Spanish and Portuguese: past complements, a second noun phrase and a relative clause.
  [
    "spanishAgreement",
    "es_ES",
    "Los precios de la casa sube cada año.",
    "Los precios de la casa suben cada año.",
  ],
  [
    "spanishAgreement",
    "es_ES",
    "Las llaves que dejé en la mesa no está.",
    "Las llaves que dejé en la mesa no están.",
  ],
  [
    "spanishAgreement",
    "es_ES",
    "La madre y el hijo vive en Lima.",
    "La madre y el hijo viven en Lima.",
  ],
  [
    "spanishAgreement",
    "es_ES",
    "Las cartas enviadas por correo llegó tarde.",
    "Las cartas enviadas por correo llegaron tarde.",
  ],
  [
    "spanishAgreement",
    "es_ES",
    "La lista de los productos están vacía.",
    "La lista de los productos está vacía.",
  ],
  [
    "portugueseAgreement",
    "pt_BR",
    "Os preços da casa aumenta todo ano.",
    "Os preços da casa aumentam todo ano.",
  ],
  [
    "portugueseAgreement",
    "pt_BR",
    "O irmão dos meus amigos que mora em Lisboa trabalham muito.",
    "O irmão dos meus amigos que mora em Lisboa trabalha muito.",
  ],
  [
    "portugueseAgreement",
    "pt_BR",
    "As chaves que deixei na mesa não está aqui.",
    "As chaves que deixei na mesa não estão aqui.",
  ],
  ["portugueseAgreement", "pt_BR", "O pai e a mãe chegou cedo.", "O pai e a mãe chegaram cedo."],
  [
    "portugueseAgreement",
    "pt_BR",
    "Os livros que comprei ontem custou caro.",
    "Os livros que comprei ontem custaram caro.",
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
  ["frenchSubjectVerbAgreement", "fr_FR", "Le chemin que suivent les randonneurs est long."],
  ["frenchSubjectVerbAgreement", "fr_FR", "Le pays où vivent un ours et une louve."],
  ["frenchSubjectVerbAgreement", "fr_FR", "C'est là que naquirent la fille et son frère."],
  ["frenchSubjectVerbAgreement", "fr_FR", "Le jardin qu'ont vu naître certaines des plantes."],
  ["frenchSubjectVerbAgreement", "fr_FR", "Qu'importe les détails."],
  ["frenchSubjectVerbAgreement", "fr_FR", "Le soir où tu as vu les enfants."],
  ["frenchSubjectVerbAgreement", "fr_FR", "Les pommes que mange le chat chaque soir."],
  ["frenchSubjectVerbAgreement", "fr_FR", "Il ne reste que les miettes."],
  ["frenchSubjectVerbAgreement", "fr_FR", "Le directeur, comme les autres, sont partis."],
  ["frenchSubjectVerbAgreement", "fr_FR", "Le chat, malgré la pluie, le vent et la neige, sort."],
  ["frenchSubjectVerbAgreement", "fr_FR", "Les enfants, malgré tout, ils sont contents."],
  ["frenchSubjectVerbAgreement", "fr_FR", "Mes amis, malgré tout, venez avec nous."],
  ["frenchSubjectVerbAgreement", "fr_FR", "Ma mère, elle, ne veut pas."],
  ["frenchSubjectVerbAgreement", "fr_FR", "Le soir, parfois, passent des trains."],
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
  ["spanishAgreement", "es_ES", "La casa de mis padres tiene un jardín."],
  ["spanishAgreement", "es_ES", "Los coches del vecino que compró ayer son rojos."],
  ["spanishAgreement", "es_ES", "La mayoría de los alumnos aprobaron."],
  ["spanishAgreement", "es_ES", "El problema de los precios son los impuestos."],
  ["spanishAgreement", "es_ES", "La hija de los vecinos que trabaja en Lima llega hoy."],
  ["portugueseAgreement", "pt_BR", "A maioria das escolas estão fechadas."],
  ["portugueseAgreement", "pt_BR", "O problema dos preços são os impostos."],
  ["portugueseAgreement", "pt_BR", "Os alunos da escola que fica perto daqui estudam muito."],
  ["portugueseAgreement", "pt_BR", "A casa dos meus pais fica longe."],
  ["portugueseAgreement", "pt_BR", "Um milhão de pessoas falam inglês."],
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
