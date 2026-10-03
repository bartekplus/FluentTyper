import { expect, test } from "bun:test";

// French frames on long runs of spaces and tabs, scanned with JavaScriptCore's regex JIT off:
// its interpreter turns an unbounded quantifier inside a lookbehind, or two adjacent ones
// ("[ \t]*[ \t/-][ \t]*"), into quadratic work that the JIT hides. Times are compared with a
// blank text's, so a loaded machine slows both.
const SCRIPT = `
const { REVIEW_SUPPORTED_RULE_IDS } = await import("./src/core/domain/grammar/review/reviewCatalog");
const { prepareReview, reviewChunks, scanReviewChunk } = await import(
  "./src/core/domain/grammar/review/reviewDiagnostics"
);
const options = {
  lang: "fr_FR",
  enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
};
const pad = (n) => " ".repeat(n);
const slowest = (text) => {
  const prepared = prepareReview(
    { id: "worst", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    options,
  );
  let ms = 0;
  for (const chunk of reviewChunks(prepared)) {
    const start = performance.now();
    scanReviewChunk(prepared, chunk);
    ms = Math.max(ms, performance.now() - start);
  }
  return ms;
};
const inputs = [
  "le" + pad(3_500) + "31/04 ",
  ("né le" + pad(400) + "31.04 ").repeat(8),
  ("\\n" + "\\t".repeat(600) + "Les maisons est ").repeat(6),
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
];
const blank = "x" + pad(3_900);
for (const text of [blank, ...inputs]) slowest(text);
const baseline = Math.max(slowest(blank), slowest(blank));
console.log(JSON.stringify({ baseline, worst: Math.max(...inputs.map(slowest)) }));
`;

test("no French chunk stalls on long blank runs with the regex JIT off", () => {
  const run = Bun.spawnSync([process.execPath, "-e", SCRIPT], {
    cwd: `${import.meta.dir}/../..`,
    env: { ...process.env, BUN_JSC_useRegExpJIT: "0" },
  });
  expect(run.exitCode).toBe(0);
  const { baseline, worst } = JSON.parse(run.stdout.toString().trim().split("\n").at(-1)!);
  expect(worst).toBeLessThan(Math.max(60, 3 * baseline));
}, 60_000);
