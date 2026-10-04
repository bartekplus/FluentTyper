import { expect, test } from "bun:test";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";
import { chunkTimes, slowestChunkMs } from "./reviewHarness";

// Time budgets (thread CPU time). bun run test runs *.timing.test.ts files serially,
// after the parallel run, so the load of other test workers does not inflate the times.

test("no French chunk stalls on adversarial input", () => {
  const slowest = (text: string) => slowestChunkMs(text, "fr_FR");
  const triggers =
    "vous ne le lui avez pas encore demander pour vous aider à mangé de passé il faut lavé. ";
  const inputs = [
    triggers.repeat(60),
    "vous ".repeat(1_000),
    "de de de mangé ".repeat(400),
    `x${" ".repeat(3_800)}${triggers}`,
    "mangé ".repeat(800),
    "il à a ou où sa se ce la ma sont du ont ".repeat(150),
    "un maison la problème cette arbre du réunion ma vélo comme même que also ".repeat(150),
    "les rues était calmes et les dossiers triées que j'ai aidée nous avons mangés ".repeat(120),
    "c'est moi qui ceux qui le la les un une ".repeat(250),
    "ont peut quant la son on peux là ".repeat(250),
    "tout toute tous toutes les le la ceux ça ".repeat(250),
    "il faut que bien qu' si s'ils j'aurai aimé je viendrais demain ".repeat(150),
    "j'ai pas on sait jamais il y a rien c'est pas ".repeat(200),
    "il ni si sans mes dans leurs mêmes d'avantage quel que soit anti sur sous néo-x ".repeat(150),
    "une petit maison le belle saison les charmant villages un très jolie jardin ".repeat(150),
  ];
  // Warm-up: the first scan of a frame compiles it. That one-time cost is not a stall. The
  // start of each input holds all its words. Two chunks: the regex JIT compiles one time for the
  // masked (16-bit) scan text of a chunk with text after it and one time for the 8-bit last one.
  for (const text of inputs) slowest(text.slice(0, 6_000));
  for (const text of inputs) expect(slowest(text)).toBeLessThan(100);
});

// The rules these frames report under, timed alone after one warm-up scan (lexicon loading).
const TIMED_WAVE_14: CatalogRuleId[] = [
  "frenchNounGender",
  "frenchHomophones",
  "frenchElision",
  "frenchAdjectiveAgreement",
  "frenchSubjectVerbAgreement",
];

test("the wave 14 French frames stay fast on adversarial input", () => {
  slowestChunkMs("Il ferme porte.", "fr_FR", TIMED_WAVE_14);
  for (const text of [
    "il lui ferme porte, elle ouvre fenêtre, j'ai pris pain. ".repeat(70),
    "on prend on prend on prend café; ".repeat(120),
    "il ne te croît pas, croîs-moi, crût-il, crû que ".repeat(80),
    "prêts a te voir, va-t-il a la, Oui, a ce, faible a forte, qua la ".repeat(60),
    "il ait il ne l'y ait pas tout ait, ".repeat(100),
    "ce avion un vieux arbre tel que des villes tel est la sur lequel quelle viendra la plupart ".repeat(
      40,
    ),
  ])
    expect(slowestChunkMs(text, "fr_FR", TIMED_WAVE_14)).toBeLessThan(100);
});

// The rules these frames report under, timed alone after one warm-up scan (lexicon loading).
const TIMED_WAVE_15: CatalogRuleId[] = [
  "frenchTout",
  "frenchVerbForms",
  "frenchHomophones",
  "frenchSubjectVerbAgreement",
  "frenchAdjectiveAgreement",
];

test("the wave 15 French clause frames stay fast on adversarial input", () => {
  slowestChunkMs("Il la bien fait.", "fr_FR", TIMED_WAVE_15);
  for (const text of [
    "les clés de la voiture au fond du couloir sur la table pour les amis avec des ".repeat(50),
    "il la bien fait elle ta souvent parlé il sa trompé on ma déjà ".repeat(70),
    "toutes ses amies tous les jeunes seules les petites communes ".repeat(70),
    "la réunion au sein de la mairie est la liste des invités pour la fête est ".repeat(55),
    "il laisse son fils acheté le Marie regarde Léa préparé du il vient de sauté par ".repeat(55),
    "celles que tu m'as celui que j'ai perdue ceux que nous avons la lettre que tu lui as ".repeat(
      55,
    ),
  ])
    expect(slowestChunkMs(text, "fr_FR", TIMED_WAVE_15)).toBeLessThan(100);
});

test("French style frames stay fast on adversarial input", () => {
  // chunkTimes scans each case once before it times it: the one-time table and lexicon loads
  // stay out of the budget.
  const times = chunkTimes(
    [
      "il complète la le les un une des la fiche ".repeat(300),
      "un bon dix un bon vingt un bon minutes ".repeat(300),
      "va au va à la va aux coiffeur ".repeat(400),
      "me rappelle de du de ce merci pour me pour le ".repeat(250),
      "4MB 5 GB 6kB 7 TB ".repeat(500),
      "y a si y en a qu'y a c'est la valise à moi les clés à toi ".repeat(250),
    ].map((text) => ["fr_FR", text, ["stylePhrasing"]] as const),
  );
  for (const ms of times) expect(ms).toBeLessThan(100);
});
