import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  buildSwedishLexicon,
  SWEDISH_LEXICON_SOURCES,
} from "../../scripts/generate-swedish-lexicon";
import { adjectiveForm, nounGender } from "../../src/core/domain/grammar/review/swedish/lexicon";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";
import { scan, slowestChunkMs } from "./reviewHarness";

function findings(ruleId: CatalogRuleId, text: string, lang = "sv_SE") {
  return scan(text, { enabledRules: [ruleId], lang }).filter((d) => d.ruleId === ruleId);
}

type Fixture = { pos: Array<[string, string]>; neg: string[] };

const FIXTURES: Array<[CatalogRuleId, Fixture]> = [
  [
    "swedishAgreement",
    {
      pos: [
        ["Vi bodde i ett liten stuga.", "Vi bodde i en liten stuga."],
        ["Hon köpte en nytt hus.", "Hon köpte ett nytt hus."],
        ["Det var en kallt vinter.", "Det var en kall vinter."],
        ["Han har ett stor bil.", "Han har en stor bil."],
        ["Vi såg ett röd äpple.", "Vi såg ett rött äpple."],
        ["De bor i ett gammal hus.", "De bor i ett gammalt hus."],
        ["Ett vacker kvinna kom in.", "En vacker kvinna kom in."],
      ],
      neg: [
        "Hon har en ovanligt stor bil.",
        "Det är ett mycket fint rum.",
        "Det var en betydligt mörkare kväll.",
        "Hon gjorde ett otroligt bra jobb.",
        "Det finns en annan väg och ett annat sätt.",
        "Vi bor i ett hyrt hus med en stor trädgård.",
        "Hon bar en blå klänning och ett vitt halsband.",
        "Han har en stark vilja och ett gott hjärta.",
        "Det var en kall och mörk natt.",
      ],
    },
  ],
  [
    "swedishTypography",
    {
      pos: [
        ["Hon kom på 2a plats.", "Hon kom på 2:a plats."],
        ["Han fyller år den 21a maj.", "Han fyller år den 21:a maj."],
        ["Laget slutade 11e i serien.", "Laget slutade 11:e i serien."],
        ["Vi läste SVTs nyheter.", "Vi läste SVT:s nyheter."],
        ["Mötet hålls på Onsdag.", "Mötet hålls på onsdag."],
        ["Vi reser i Augusti.", "Vi reser i augusti."],
        ["Han kom den 3 Mars.", "Han kom den 3 mars."],
      ],
      neg: [
        "Vi bor på Storgatan 2a i Lund.",
        "Hon kom på 2:a plats.",
        "Han köpte två PCs till kontoret.",
        "Måndag är en tung dag.",
        "Robotar har landat på Mars.",
        "Maj Andersson kom hem.",
        "Vi läste EU:s förslag.",
        "Kursen 3e ges inte i år.",
      ],
    },
  ],
  [
    "englishPhraseCorrections",
    {
      pos: [
        ["Mötet varar mellan klockan tio till tolv.", "Mötet varar mellan klockan tio och tolv."],
        ["Tåget går mellan Malmö till Lund.", "Tåget går mellan Malmö och Lund."],
        ["Butiken är öppen mellan 9 till 17.", "Butiken är öppen mellan 9 och 17."],
        ["Han brukade att cykla till jobbet.", "Han brukade cykla till jobbet."],
        ["Vi ångrar på att vi sålde huset.", "Vi ångrar att vi sålde huset."],
        ["Kunderna är i stor grad nöjda.", "Kunderna är i hög grad nöjda."],
        ["Dem är redan på plats.", "De är redan på plats."],
        ["Jag tror att dem kommer i morgon.", "Jag tror att de kommer i morgon."],
        ["Vi åt middag, dem var trötta.", "Vi åt middag, de var trötta."],
        ["Jag pratade länge med de.", "Jag pratade länge med dem."],
        ["Paketet är till de, inte till oss.", "Paketet är till dem, inte till oss."],
      ],
      neg: [
        "Mötet varar mellan klockan tio och tolv.",
        "Det kom till bråk mellan oss till slut.",
        "Från Malmö till Lund tar det en kvart.",
        "Han brukade cykla till jobbet.",
        "Kunderna är i hög grad nöjda.",
        "Det som hände dem var hemskt.",
        "Jag pratade med de andra.",
        "Ge dem boken.",
        "De är redan på plats.",
        "Hon frågade dem var de bodde.",
      ],
    },
  ],
  [
    "englishClosedCompounds",
    {
      pos: [
        ["Vi köpte en ny dator skärm.", "Vi köpte en ny datorskärm."],
        ["Han jobbar på sjuk huset.", "Han jobbar på sjukhuset."],
        ["Tåget stannar vid tåg stationen.", "Tåget stannar vid tågstationen."],
        ["Glöm inte din tand borste.", "Glöm inte din tandborste."],
        ["Vi spelar fot boll på lördag.", "Vi spelar fotboll på lördag."],
      ],
      neg: [
        "Vi köpte en ny datorskärm.",
        "Han är sjuk och stannar hemma.",
        "Hon har en fot i gips.",
        "Datorn och skärmen är nya.",
        "Vi bor på landet.",
      ],
    },
  ],
  [
    "stylePhrasing",
    {
      pos: [
        ["Kan jag få en till kaka?", "Kan jag få en kaka till?"],
        ["Vi beställer ett till glas.", "Vi beställer ett glas till."],
        ["Det var en fin dag sa Johan.", "Det var en fin dag, sa Johan."],
        ["Jag har inte tid svarade hon.", "Jag har inte tid, svarade hon."],
        ["Han tog en till bulle.", "Han tog en bulle till."],
      ],
      neg: [
        "Hon gav en till mamma.",
        "Vi räknade från en till tio.",
        "Det sa Johan.",
        "Efter en stund svarade Johan.",
        "Det var bra, sa hon.",
        "När han kom hem frågade hon.",
      ],
    },
  ],
];

describe.each(FIXTURES)("%s", (ruleId, { pos, neg }) => {
  test.each(pos)("fixes %p", (input, output) => {
    const found = findings(ruleId, input);
    expect(found.length).toBe(1);
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(output);
    expect(findings(ruleId, output)).toEqual([]);
  });
  test.each(neg)("leaves %p alone", (input) => {
    expect(findings(ruleId, input).map((d) => d.original)).toEqual([]);
  });
  test("stays out of other languages", () => {
    for (const [input] of pos)
      for (const lang of ["en_US", "de_DE", "el_GR", "ar_SA"])
        expect(findings(ruleId, input, lang).map((d) => d.original)).toEqual([]);
  });
});

test("a range offers both Swedish forms", () => {
  const [d] = findings("englishPhraseCorrections", "Mellan Stockholm till Skara är det långt.");
  expect(d.alternatives.map((a) => a.preview)).toEqual([
    "Mellan Stockholm och",
    "Från Stockholm till",
  ]);
  expect(d.requiresChoice).toBe(true);
});

test("the committed lexicon matches sv_SE.dic/.aff (bun run generate:lexicons swedish)", async () => {
  const [dic, aff, committed] = await Promise.all(
    [SWEDISH_LEXICON_SOURCES.dic, SWEDISH_LEXICON_SOURCES.aff, SWEDISH_LEXICON_SOURCES.out].map(
      (path) => readFile(path, "utf8"),
    ),
  );
  expect(buildSwedishLexicon(dic, aff)).toBe(committed);
});

test("lexicon lookups: genders by word, last part or ending; adjective -t forms", () => {
  expect(
    ["kväll", "stuga", "kvällsmat", "fängelse", "rum", "uppvaknande", "lag"].map(nounGender),
  ).toEqual(["en", "en", "en", "ett", "ett", "ett", undefined]);
  expect(adjectiveForm("mörk")).toEqual({ form: "common", other: "mörkt" });
  expect(adjectiveForm("rött")).toEqual({ form: "neuter", other: "röd" });
  expect(adjectiveForm("urholkat")).toEqual({ form: "neuter", other: "urholkad" });
  expect(adjectiveForm("svart")).toEqual({ form: "both" });
  expect(adjectiveForm("bord")).toBeUndefined();
});

test("a Swedish chunk with many candidates scans quickly", () => {
  const slowest = (text: string) => slowestChunkMs(text, "sv_SE");
  const inputs = [
    "en ett en ett ".repeat(900),
    "ett mörk kväll ".repeat(300),
    "mellan två ".repeat(800) + "till fyra",
    "2a 3e APIs Måndag ".repeat(250),
    "dem är med de. en till kaka ".repeat(250),
    `Det var bra ${"och ".repeat(900)}sa Johan.`,
  ];
  slowest(inputs.join("\n"));
  for (const text of inputs) expect(slowest(text)).toBeLessThan(100);
});
