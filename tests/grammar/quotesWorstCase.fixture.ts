import type { TimingCase } from "./reviewHarness";

// Adversarial inputs for typographicQuotes: one long line full of quote marks, so every chunk
// reads the line again from its start.
const RULES = ["typographicQuotes"];
export const QUOTES_WORST_CASES: TimingCase[] = [
  ["en_US", 'a "b" '.repeat(8_000), RULES],
  ["en_US", `"x 'y' z" don't `.repeat(4_000), RULES],
  ["en_US", '"a '.repeat(12_000), RULES],
  ["en_US", "'a ".repeat(12_000), RULES],
  ["en_US", '"'.repeat(30_000), RULES],
  ["de_DE", "„a „b „c ".repeat(5_000), RULES],
  ["fr_FR", '« a "b" » '.repeat(5_000), RULES],
  ["sv_SE", 'a ”b "c" d” '.repeat(4_000), RULES],
  ["pl_PL", `"a" 'b' it's 5'2" `.repeat(3_000), RULES],
];
