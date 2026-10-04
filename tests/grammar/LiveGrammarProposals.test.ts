import { describe, expect, test } from "bun:test";
import { findLiveGrammarProposals } from "../../src/core/domain/grammar/review/liveProposals";
import {
  LIVE_PROPOSAL_WINDOW_CHARS,
  nextLiveGrammarProposal,
  type SeenLiveProposals,
  type LiveProposalOptions,
} from "../../src/core/domain/grammar/review/liveProposalSelection";
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

  test("leaves style advice to Review, even when its switch is on", () => {
    expect(find("Use your PIN number at the ATM machine and ")).toEqual([]);
    const enabledRules = ["stylePhrasing", "styleWordChoice"];
    expect(find("We did it in order to win and it is very important ", { enabledRules })).toEqual(
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
  const next = (text: string, seen: SeenLiveProposals) =>
    nextLiveGrammarProposal(findLiveGrammarProposals(text, options), text, seen);

  test("offers each span once, wherever later text moves it", () => {
    const seen: SeenLiveProposals = { text: "", spans: [] };
    expect(next("We is ready. ", seen)?.original).toBe("is");
    // Typing on does not bring the same finding back.
    expect(next("We is ready. And so", seen)).toBeNull();
    // A new finding further on is offered; the older one stays dismissed.
    expect(next("We is ready. They has left. ", seen)?.original).toBe("has");
    expect(next("We is ready. They has left. ", seen)).toBeNull();
  });

  test("a dismissed span stays dismissed after an edit before it", () => {
    const seen: SeenLiveProposals = { text: "", spans: [] };
    expect(next("Yes. We is ready. ", seen)?.original).toBe("is");
    expect(next("Oh yes. We is ready. ", seen)).toBeNull();
  });

  test("the same fix at another span is still offered", () => {
    const seen: SeenLiveProposals = { text: "", spans: [] };
    expect(next("We is ready. ", seen)?.start).toBe(3);
    expect(next("We is ready. We is here. ", seen)?.start).toBe(16);
  });
});
