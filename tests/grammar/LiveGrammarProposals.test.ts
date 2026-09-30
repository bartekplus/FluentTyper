import { describe, expect, test } from "bun:test";
import {
  findLiveGrammarProposals,
  LIVE_PROPOSAL_WINDOW_CHARS,
  nextLiveGrammarProposal,
  type LiveProposalOptions,
} from "../../src/core/domain/grammar/review/liveProposals";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { DEFAULT_CURRENT_GRAMMAR_RULES } from "../../src/core/domain/grammar/ruleCatalog";

const options: LiveProposalOptions = {
  lang: "en_US",
  enabledRules: reviewRuleIds({ codeMode: false }),
  liveRules: DEFAULT_CURRENT_GRAMMAR_RULES,
  userDictionary: [],
  insertSpaceAfterAutocomplete: true,
};

function find(beforeCursor: string, extra: Partial<LiveProposalOptions> = {}) {
  return findLiveGrammarProposals(beforeCursor, { ...options, ...extra }).map(
    ({ original, replacement }) => `${original} → ${replacement}`,
  );
}

describe("findLiveGrammarProposals", () => {
  test("offers a one-at-a-time Review fix that ends before the caret", () => {
    expect(find("We is ready. ")).toEqual(["is → are"]);
    expect(find("I have went home")).toEqual(["went → gone"]);
    const [proposal] = findLiveGrammarProposals(
      "The report contains useful informations. ",
      options,
    );
    expect(proposal).toMatchObject({
      ruleId: "englishCountability",
      start: 27,
      end: 39,
      original: "informations",
      replacement: "information",
    });
  });

  test("waits while the finding still reaches the word at the caret", () => {
    expect(find("The report contains useful informations")).toEqual([]);
    expect(find("I have went")).toEqual([]);
  });

  test("leaves batch-safe fixes to the typing rules", () => {
    expect(find("Their is a cat here ")).toEqual([]);
    expect(find("I dont know ")).toEqual([]);
  });

  test("skips single-apply checks a typing rule already covers while that rule is on", () => {
    expect(find("I would like a apple ", { liveRules: [] })).toEqual(["a apple → an apple"]);
    expect(find("I would like a apple ", { liveRules: ["englishArticleAnCorrection"] })).toEqual(
      [],
    );
  });

  test("follows the Review switches, language and code mode", () => {
    expect(
      find("We is ready. ", {
        enabledRules: reviewRuleIds({
          codeMode: false,
          overrides: { englishPronounVerbWhitelistAgreement: false },
        }),
      }),
    ).toEqual([]);
    expect(find("We is ready. ", { lang: "de_DE" })).toEqual([]);
    expect(find("We is ready. ", { enabledRules: reviewRuleIds({ codeMode: true }) })).toEqual([]);
  });

  test("reads only a bounded window before the caret", () => {
    const filler = "Plain words keep going here. ".repeat(20);
    expect(filler.length).toBeGreaterThan(LIVE_PROPOSAL_WINDOW_CHARS);
    expect(find(`We is ready. ${filler}`)).toEqual([]);
    expect(find(`${filler}We is ready. `)).toEqual(["is → are"]);
    const [proposal] = findLiveGrammarProposals(`${filler}We is ready. `, options);
    expect(`${filler}We is ready. `.slice(proposal.start, proposal.end)).toBe("is");
  });

  test("never proposes warnings or empty text", () => {
    expect(find("")).toEqual([]);
    expect(find("   ")).toEqual([]);
    // An unclosed quotation is a warning with nothing to apply.
    expect(find('She said "hello there ')).toEqual([]);
  });
});

describe("nextLiveGrammarProposal", () => {
  test("offers each span once, keyed on its text rather than its offset", () => {
    const seen = new Set<string>();
    const first = nextLiveGrammarProposal(findLiveGrammarProposals("We is ready. ", options), seen);
    expect(first?.original).toBe("is");
    // Typing on does not bring the same finding back.
    expect(
      nextLiveGrammarProposal(findLiveGrammarProposals("We is ready. And so", options), seen),
    ).toBeNull();
    // A new finding further on is offered; the older one stays dismissed.
    const next = nextLiveGrammarProposal(
      findLiveGrammarProposals("We is ready. They has left. ", options),
      seen,
    );
    expect(next?.original).toBe("has");
    expect(
      nextLiveGrammarProposal(
        findLiveGrammarProposals("We is ready. They has left. ", options),
        seen,
      ),
    ).toBeNull();
  });

  test("keys differ when the text before the span differs", () => {
    const [a] = findLiveGrammarProposals("We is ready. ", options);
    const [b] = findLiveGrammarProposals("Yes. We is ready. ", options);
    expect(a.key).not.toBe(b.key);
  });
});
