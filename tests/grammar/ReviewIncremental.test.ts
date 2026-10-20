import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LocalReviewEngine } from "../../src/core/application/review/LocalReviewEngine";
import * as diagnostics from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { loadAllReviewData } from "../../src/core/domain/grammar/review/reviewLanguageSources";
import type { ReviewOptions } from "../../src/core/domain/grammar/review/types";

loadAllReviewData();

const corpus = (name: string) =>
  readFileSync(`tests/fixtures/native-review-corpus/${name}.txt`, "utf8");

// Text an edit can bring: errors, structure that is read text-wide, and plain prose.
const SNIPPETS = [
  " teh",
  " i dont know",
  " its a good day",
  " the the ",
  " Their going home.",
  "\n",
  "\n\n",
  "```\n",
  "`",
  '"',
  "'",
  "“",
  "”",
  "(",
  " e.g. ",
  " https://example.com/a ",
  " ACM machine ",
  ". ",
  ", ",
  "  ",
  " On monday 15 may we met.",
  "x",
];

/** Small deterministic generator (mulberry32). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function edit(text: string, next: () => number): string {
  const at = Math.floor(next() * (text.length + 1));
  const kind = next();
  if (kind < 0.45) {
    const snippet = SNIPPETS[Math.floor(next() * SNIPPETS.length)];
    return text.slice(0, at) + snippet + text.slice(at);
  }
  if (kind < 0.75) return text.slice(0, at) + text.slice(at + 1 + Math.floor(next() * 30));
  if (kind < 0.9) {
    // A paste of text from elsewhere in the field.
    const from = Math.floor(next() * text.length);
    return text.slice(0, at) + text.slice(from, from + 300) + text.slice(at);
  }
  // Retype one character.
  return `${text.slice(0, at)}${text[at] === " " ? "\n" : " "}${text.slice(at + 1)}`;
}

async function compare(text: string, options: ReviewOptions, seed: number, edits: number) {
  const pause = () => Promise.resolve();
  const incremental = new LocalReviewEngine(pause);
  const plan = spyOn(diagnostics, "incrementalScan");
  try {
    const next = random(seed);
    let reused = 0;
    for (let step = 0; step <= edits; step += 1) {
      if (step > 0) text = edit(text, next);
      const request = (cache: boolean) => ({
        snapshot: {
          id: `s${step}`,
          text,
          scope: { start: 0, end: text.length },
          protectedRanges: [],
        },
        options,
        cache,
        gaps: {},
        uiLanguage: "en",
      });
      const calls = plan.mock.results.length;
      const got = await incremental.scan(request(true));
      if (plan.mock.results.slice(calls).some((result) => result.value !== null)) reused += 1;
      const want = await new LocalReviewEngine(pause).scan(request(false));
      if (JSON.stringify(got.result) !== JSON.stringify(want.result)) {
        // The failing text and step, to reproduce the case.
        expect({ seed, step, text, result: got.result }).toEqual({
          seed,
          step,
          text,
          result: want.result,
        });
      }
    }
    return reused;
  } finally {
    plan.mockRestore();
  }
}

const ALL_RULES = (lang: string): ReviewOptions => ({
  lang,
  enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
  preferredTerminology: {
    version: 1,
    enabled: true,
    entries: [
      {
        id: "t1",
        source: "machine",
        replacement: "computer",
        casePolicy: "insensitive",
        explanation: "House style.",
        language: lang.slice(0, 2),
        scope: "all-prose",
        enabled: true,
      },
    ],
  },
});

describe("incremental Review scan", () => {
  test.each([
    ["broken", "en_US", 1],
    ["reference", "en_US", 2],
    ["french-clean", "fr_FR", 3],
    ["german-clean", "de_DE", 4],
    ["polish-clean", "pl_PL", 5],
  ])(
    "%s (%s): every edit gives the findings of a full scan",
    async (name, lang, seed) => {
      const reused = await compare(corpus(name).slice(0, 6_000), ALL_RULES(lang), seed, 60);
      // Many edits must take the incremental path, or this test proves nothing. (On a text
      // this short, a window over half of it is a full scan.)
      expect(reused).toBeGreaterThan(20);
    },
    120_000,
  );
});
