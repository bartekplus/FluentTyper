import type { PhraseRow } from "../englishPhraseTables";
import type { LanguagePhraseTables } from "../languagePhraseTables";

/** One row per verb form: the typed frame and its fix. */
const forms = (pairs: ReadonlyArray<readonly [string, string]>, typed: string, fixed: string) =>
  pairs.map(([a, b]): PhraseRow => [typed.replace("%", a), fixed.replace("%", b)]);

// Blended idioms: a fixed expression with a word borrowed from a near synonym.
const PHRASES: readonly PhraseRow[] = [
  // "bruka" takes a bare infinitive.
  ...["bruka", "brukar", "brukade", "brukat"].map((verb): PhraseRow => [`${verb} att`, verb]),
  // "ångra" takes its object directly.
  ...["ångra", "ångrar", "ångrade", "ångrat"].map((verb): PhraseRow => [
    `${verb} på att`,
    `${verb} att`,
  ]),
  // One commits suicide ("begå"); "ta" belongs to "ta sitt liv".
  ...forms(
    [
      ["ta", "begå"],
      ["tar", "begår"],
      ["tog", "begick"],
      ["tagit", "begått"],
    ],
    "% självmord",
    "% självmord",
  ),
  // A degree is high, not large.
  ["i stor grad", "i hög grad"],
  ["i större grad", "i högre grad"],
  ["i störst grad", "i högst grad"],
  ["i så stor grad", "i så hög grad"],
  ["i mycket stor grad", "i mycket hög grad"],
  // "måtto" (measure) survives only in these phrases.
  ["i möjligaste motto", "i möjligaste måtto"],
  ["i viss motto", "i viss måtto"],
  ["planer om att", "planer på att"],
];

// Titles of a person: "förre" is the traditional form before them.
const TITLES = [
  "chefen",
  "ordföranden",
  "statsministern",
  "presidenten",
  "kungen",
  "ministern",
  "utrikesministern",
  "finansministern",
  "partiledaren",
  "vd:n",
  "rektorn",
  "borgmästaren",
  "tränaren",
  "förbundskaptenen",
  "generalsekreteraren",
  "ärkebiskopen",
  "påven",
  "ambassadören",
  "landshövdingen",
  "direktören",
];

const STYLE: readonly PhraseRow[] = [
  ...TITLES.map((title): PhraseRow => [`förra ${title}`, `förre ${title}`]),
  ...["statsminister", "president", "ordförande", "minister", "vd"].map((title): PhraseRow => [
    `förra ${title}`,
    `förre ${title}`,
  ]),
  [["allt mer", "allt mera"], "alltmer"],
  ["efterhand", "efter hand"],
  ["planer om", ["planer på", "drömmar om"]],
  ["klagomål över", ["klagomål på", "klagomål mot"]],
  // Abbreviations keep their periods.
  ["t ex", "t.ex."],
  ["m fl", "m.fl."],
  ["bl a", "bl.a."],
  ["s k", "s.k."],
  ["t o m", "t.o.m."],
  ["o s v", "osv."],
  ["m m", "m.m."],
];

// Compounds written apart (särskrivning): the first part never stands alone before
// the second, so the split form is never correct. [first, second, second definite].
const SPLIT: ReadonlyArray<readonly [string, string, string]> = [
  ["dator", "skärm", "skärmen"],
  ["kyl", "skåp", "skåpet"],
  ["tand", "borste", "borsten"],
  ["tand", "läkare", "läkaren"],
  ["sov", "rum", "rummet"],
  ["vardags", "rum", "rummet"],
  ["bok", "hylla", "hyllan"],
  ["lunch", "rast", "rasten"],
  ["kaffe", "kopp", "koppen"],
  ["mjölk", "paket", "paketet"],
  ["post", "kontor", "kontoret"],
  ["sjuk", "hus", "huset"],
  ["flyg", "plats", "platsen"],
  ["järn", "väg", "vägen"],
  ["tåg", "station", "stationen"],
  ["buss", "hållplats", "hållplatsen"],
  ["arbets", "plats", "platsen"],
  ["barn", "vagn", "vagnen"],
  ["regn", "jacka", "jackan"],
  ["skol", "gård", "gården"],
  ["fot", "boll", "bollen"],
  ["hand", "boll", "bollen"],
  ["köks", "bord", "bordet"],
  ["student", "lägenhet", "lägenheten"],
  ["kund", "tjänst", "tjänsten"],
  ["lösen", "ord", "ordet"],
  ["glass", "bil", "bilen"],
];
const COMPOUNDS: readonly PhraseRow[] = SPLIT.flatMap(([first, second, definite]) => [
  [`${first} ${second}`, first + second] as PhraseRow,
  [`${first} ${definite}`, first + definite] as PhraseRow,
]);

export const TABLES: LanguagePhraseTables = {
  words: [
    ["igentligen", "egentligen"],
    ["antligen", "äntligen"],
    ["alldrig", "aldrig"],
    ["intresant", "intressant"],
    ["komunikation", "kommunikation"],
    ["sammarbete", "samarbete"],
    ["tillsamans", "tillsammans"],
    ["definitift", "definitivt"],
    ["skilnad", "skillnad"],
    ["sjävklart", "självklart"],
    ["anorlunda", "annorlunda"],
    ["rekomendera", "rekommendera"],
    ["resturang", "restaurang"],
    ["tex", "t.ex."],
  ],
  phrases: PHRASES,
  compounds: COMPOUNDS,
  style: STYLE,
};
