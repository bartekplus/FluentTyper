import { describe, expect, test } from "bun:test";
import { prepareReview } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import {
  REVIEW_LOCAL_AI_CHECK,
  type ProtectedRange,
  type ReviewDiagnostic,
  type TextRange,
} from "../../src/core/domain/grammar/review/types";
import { buildAiChunks } from "../../src/core/domain/grammar/review/ai/segments";
import type { AiChunk, ConcreteRewriteStyle } from "../../src/core/domain/grammar/review/ai/types";
import {
  correctionFindings,
  rewriteProposal,
} from "../../src/core/domain/grammar/review/ai/validate";

interface Extra {
  scope?: TextRange;
  protectedRanges?: ProtectedRange[];
  userDictionary?: string[];
  maxChunkChars?: number;
}

function prepared(text: string, extra: Extra = {}) {
  return prepareReview(
    {
      id: "snap",
      text,
      scope: extra.scope ?? { start: 0, end: text.length },
      protectedRanges: extra.protectedRanges ?? [],
    },
    {
      lang: "en_US",
      enabledRules: [],
      userDictionary: extra.userDictionary ?? [],
      insertSpaceAfterAutocomplete: true,
    },
  );
}

/**
 * Runs Correct mode with hand-written model output: `outputs` gives the
 * proposed text of every segment in document order (all chunks).
 */
function correct(text: string, outputs: string[], extra: Extra = {}) {
  const prep = prepared(text, extra);
  const { chunks } = buildAiChunks(prep, {
    mode: "correct",
    style: null,
    maxChunkChars: extra.maxChunkChars,
  });
  const segments = chunks.flatMap((chunk) => chunk.segments);
  expect(outputs).toHaveLength(segments.length);
  const queue = [...outputs];
  const diagnostics: ReviewDiagnostic[] = [];
  const rejected: Record<string, number> = {};
  for (const chunk of chunks) {
    const result = correctionFindings(
      prep,
      chunk,
      chunk.segments.map((segment) => ({ id: segment.id, text: queue.shift() ?? "" })),
    );
    diagnostics.push(...result.diagnostics);
    for (const [reason, count] of Object.entries(result.rejected)) {
      rejected[reason] = (rejected[reason] ?? 0) + (count ?? 0);
    }
  }
  const applied = applyEdits(
    text,
    diagnostics.flatMap((diagnostic) => diagnostic.alternatives[0].edits),
  );
  return { diagnostics, rejected, applied, segments: segments.map((s) => s.text) };
}

/** One-segment helper: the model's proposal for the only segment. */
const correctOne = (text: string, proposed: string, extra: Extra = {}) =>
  correct(text, [proposed], extra);

function expectRejected(text: string, proposed: string, reason: string, extra: Extra = {}) {
  const result = correctOne(text, proposed, extra);
  expect(result.diagnostics).toEqual([]);
  // Every change unit of the proposal was rejected, all for this reason.
  expect(Object.keys(result.rejected)).toEqual([reason]);
}

describe("correctionFindings", () => {
  test("a negating prefix is never a spelling fix (review finding)", () => {
    const likely = correctOne(
      "This bug is likely to reappear.",
      "This bug is unlikely to reappear.",
    );
    expect(likely.diagnostics).toEqual([]);
    const needed = correctOne("That step is necessary here.", "That step is unnecessary here.");
    expect(needed.diagnostics).toEqual([]);
    const agree = correctOne("I agree with the plan.", "I disagree with the plan.");
    expect(agree.diagnostics).toEqual([]);
  });

  test("a unit next to a number is never changed (review finding)", () => {
    expectRejected("We measured 300 kb of data.", "We measured 300 mb of data.", "number");
    expectRejected("Add 5 ml of water.", "Add 5 mg of water.", "number");
  });

  test("code-like punctuation and bracket balance are left alone (real-GPU eval: tech-04)", () => {
    // "user.save(" is the placeholder; the model dropped the ")" glued to it.
    expect(correctOne("Call user.save() after validation.", "x").segments).toEqual([
      "Call ⟦1⟧) after validation.",
    ]);
    expectRejected(
      "Call user.save() after validation.",
      "Call ⟦1⟧ after validation.",
      "technical-token",
    );
    expectRejected("Wrap it (like this) today.", "Wrap it (like this today.", "technical-token");
    expectRejected("Run it (twice.", "Run it (twice).", "technical-token");
  });

  test("British and American spellings are both correct (real-GPU eval: ambiguous-10/11)", () => {
    expectRejected(
      "The colour looks different in daylight.",
      "The color looks different in daylight.",
      "drift",
    );
    expectRejected(
      "We realised the organisation had changed.",
      "We realized the organization had changed.",
      "drift",
    );
    expectRejected("Meet at the centre today.", "Meet at the center today.", "drift");
    expectRejected("We travelled far.", "We traveled far.", "drift");
    expectRejected("Check the catalogue first.", "Check the catalog first.", "drift");
    expectRejected("Renew the licence soon.", "Renew the license soon.", "drift");
    expectRejected("They analysed it.", "They analyzed it.", "drift");
    // Not a dialect pair: noun/verb confusion stays a correction.
    expect(correctOne("I need your advise.", "I need your advice.").applied).toBe(
      "I need your advice.",
    );
  });

  test("whitespace at segment edges never changes (real-GPU eval: pl-06)", () => {
    expectRejected("Dzięki, wygląda dobrze!", "Dzięki, wygląda dobrze! ", "shape");
    expectRejected("It is fine.", " It is fine.", "shape");
  });

  test("a determiner's noun keeps its number (real-GPU eval: fix-07/08)", () => {
    expectRejected("My friends is coming over.", "My friend is coming over.", "drift");
    expectRejected("The results is late.", "The result is late.", "drift");
    // "This results" may mean one result or several: the author's noun keeps its number.
    expectRejected("This results look promising.", "This result looks promising.", "drift");
    // Agreement with a number-marking determiner is a correction.
    expect(
      correctOne("We found several issue today.", "We found several issues today.").applied,
    ).toBe("We found several issues today.");
    expect(correctOne("We found two issue today.", "We found two issues today.").applied).toBe(
      "We found two issues today.",
    );
    expectRejected("We found several issues today.", "We found several issue today.", "drift");
    expectRejected("We saw each issue today.", "We saw each issues today.", "drift");
    expect(correctOne("My friends is coming over.", "My friends are coming over.").applied).toBe(
      "My friends are coming over.",
    );
    expect(
      correctOne("This results look promising.", "These results look promising.").applied,
    ).toBe("These results look promising.");
  });

  test("agreement fix becomes one Local AI finding", () => {
    const text = "The results shows a problem.";
    const { diagnostics, rejected, applied } = correctOne(text, "The results show a problem.");
    expect(rejected).toEqual({});
    expect(diagnostics).toHaveLength(1);
    const [finding] = diagnostics;
    expect(finding.ruleId).toBe(REVIEW_LOCAL_AI_CHECK);
    expect(finding.messageKey).toBe("review_msg_local_ai");
    expect(finding.bulk).toEqual({ eligible: false, reason: "local-ai" });
    expect(finding.category).toBe("grammar");
    expect(finding.lang).toBe("en_US");
    expect(finding.snapshotId).toBe("snap");
    expect(finding.id).toMatch(/^snap\/reviewLocalAi@12-17#\w+$/);
    expect(finding.original).toBe("shows");
    expect(finding.alternatives).toEqual([
      {
        edits: [{ start: 12, end: 17, original: "shows", replacement: "show" }],
        preview: "show",
      },
    ]);
    expect(finding.context).toEqual({ start: 0, end: text.length });
    expect(applied).toBe("The results show a problem.");
  });

  test("changes one word apart form one atomic unit; distant changes stay separate", () => {
    const text = "It fails when user paste a long text.";
    const { diagnostics, applied } = correctOne(text, "It fails when a user pastes a long text.");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].alternatives).toHaveLength(1);
    expect(diagnostics[0].alternatives[0].edits).toHaveLength(2);
    expect(diagnostics[0].original).toBe("user paste");
    expect(diagnostics[0].alternatives[0].preview).toBe("a user pastes");
    expect(applied).toBe("It fails when a user pastes a long text.");

    const apart = correctOne("He go home and she buy milk.", "He goes home and she buys milk.");
    expect(apart.diagnostics.map((d) => d.original)).toEqual(["go", "buy"]);
    expect(apart.applied).toBe("He goes home and she buys milk.");
  });

  test("a rejected unit is dropped without sinking the rest of the sentence", () => {
    const result = correctOne(
      "Me and my colleague discussed about this problem, and we decided to not change nothing for now.",
      "My colleague and I discussed this problem, and we decided not to change anything for now.",
    );
    expect(Object.keys(result.rejected).length).toBeGreaterThan(0);
    expect(result.applied).toContain("we decided not to change anything for now.");
    expect(result.applied).toContain("Me and my colleague");
  });

  test("dense text: per-unit bounds and the rewrite guard", () => {
    expectRejected(
      "The meeting went well and everyone agreed on the plan.",
      "Everyone agreed that the plan and the meeting were great.",
      "drift",
    );
    const long = correctOne(
      "We should deploy the new version on the staging cluster first today.",
      "We ought to roll out that fresh release onto the staging cluster first today.",
    );
    expect(long.diagnostics).toEqual([]);
    expectRejected(
      "The meeting went well and everyone agreed on the plan.",
      "The meeting was a big success because all agreed on the plan.",
      "too-many-edits",
    );
  });

  test("closed-class swaps and proofreader deletions", () => {
    const fixed = (text: string, proposed: string) => correctOne(text, proposed).applied;
    expect(fixed("She works here since three years.", "She works here for three years.")).toBe(
      "She works here for three years.",
    );
    expect(fixed("It is more slower then before.", "It is slower than before.")).toBe(
      "It is slower than before.",
    );
    expect(fixed("The results are more better now.", "The results are better now.")).toBe(
      "The results are better now.",
    );
    expect(fixed("We discussed about this problem.", "We discussed this problem.")).toBe(
      "We discussed this problem.",
    );
    expect(
      fixed("There is too many informations here.", "There is too much information here."),
    ).toBe("There is too much information here.");
    // "more" before a non-comparative is content, not a double comparative.
    expectRejected("We need more tests here.", "We need tests here.", "drift");
  });

  test("style and dialect choices are not corrections (Gemma 4 E4B full suite)", () => {
    // Comma after a sentence-initial interjection.
    expectRejected("Ok cool.", "Ok, cool.", "drift");
    expectRejected("Well I agree with that.", "Well, I agree with that.", "drift");
    // A required clause boundary before degree/quantifier "too" stays eligible.
    expect(
      correctOne(
        "If you go too many people will follow.",
        "If you go, too many people will follow.",
      ).applied,
    ).toBe("If you go, too many people will follow.");
    expectRejected("I too think this is wrong.", "I, too, think this is wrong.", "drift");
    // Optional comma before "too".
    expectRejected("This needs improvement too.", "This needs improvement, too.", "drift");
    expect(correctOne("However we left.", "However, we left.").applied).toBe("However, we left.");
    // Comma before an opening quotation mark.
    expectRejected("The sign said “Open 24 hours.”", "The sign said, “Open 24 hours.”", "drift");
    // Subjunctive "were" after "if"/"wish".
    expectRejected("If I was you, I would ask.", "If I were you, I would ask.", "drift");
    expectRejected("I wish it was sunny today.", "I wish it were sunny today.", "drift");
    expect(correctOne("They was late again.", "They were late again.").applied).toBe(
      "They were late again.",
    );
    // Case after a colon.
    expectRejected("Assistant: sure, here it is.", "Assistant: Sure, here it is.", "drift");
    // Verb number with nouns used both ways.
    expectRejected(
      "The data are stored locally and never leave the device.",
      "The data is stored locally and never leaves the device.",
      "drift",
    );
    expectRejected("Our staff is small this year.", "Our staff are small this year.", "drift");
    expect(
      correctOne(
        "Our team have reviewed it and we has questions.",
        "Our team has reviewed it and we have questions.",
      ).applied,
    ).toBe("Our team have reviewed it and we have questions.");
    expect(correctOne("They goes home early.", "They go home early.").applied).toBe(
      "They go home early.",
    );
  });

  test("uncountable nouns lose a wrong plural (held-out set)", () => {
    const fixed = (text: string, proposed: string) => correctOne(text, proposed).applied;
    expect(fixed("The informations here is old.", "The information here is old.")).toBe(
      "The information here is old.",
    );
    expect(fixed("Users never lose their datas.", "Users never lose their data.")).toBe(
      "Users never lose their data.",
    );
    expect(
      fixed(
        "We have many equipments in the old lab.",
        "We have a lot of equipment in the old lab.",
      ),
    ).toBe("We have a lot of equipment in the old lab.");
    // Countable nouns: still the author's choice, and "a lot of" is style there.
    expectRejected("The reports here are old.", "The report here are old.", "drift");
    expectRejected(
      "We have many tools in the old lab.",
      "We have a lot of tools in the old lab.",
      "drift",
    );
  });

  test("intensifier before a comparative (held-out set)", () => {
    expect(
      correctOne("It loads very more slowly now.", "It loads much more slowly now.").applied,
    ).toBe("It loads much more slowly now.");
    expectRejected("It looks very good now.", "It looks much good now.", "drift");
  });

  test("a second negative becomes its any-form (held-out set)", () => {
    expect(
      correctOne("We didnt received no reply today.", "We didn't receive any reply today.").applied,
    ).toBe("We didn't receive any reply today.");
    expectRejected("We got no reply today.", "We got any reply today.", "negation");
  });

  test("double negatives: a negative-polarity counterpart is not a polarity change", () => {
    const fixed = (text: string, proposed: string) => correctOne(text, proposed).applied;
    expect(fixed("We did not change nothing today.", "We did not change anything today.")).toBe(
      "We did not change anything today.",
    );
    expect(fixed("I don't know nobody here yet.", "I don't know anybody here yet.")).toBe(
      "I don't know anybody here yet.",
    );
    expect(fixed("We decided to not change it today.", "We decided not to change it today.")).toBe(
      "We decided not to change it today.",
    );
    // No other negation remains: the sentence became positive.
    expectRejected(
      "We changed nothing today at all.",
      "We changed anything today at all.",
      "negation",
    );
    expectRejected("We did not change nothing today.", "We did change anything today.", "negation");
  });

  test("categories follow the kind of change", () => {
    const category = (text: string, proposed: string) =>
      correctOne(text, proposed).diagnostics[0]?.category;
    expect(category("However we left.", "However, we left.")).toBe("punctuation");
    expect(category("see you on monday.", "See you on Monday.")).toBe("typography");
    expect(category("We recieved it.", "We received it.")).toBe("spelling");
    expect(category("I need a umbrella.", "I need an umbrella.")).toBe("grammar");
  });

  test("insertions, deletions and irregular forms", () => {
    const insertion = correctOne("I went store yesterday.", "I went to the store yesterday.");
    expect(insertion.applied).toBe("I went to the store yesterday.");
    expect(insertion.diagnostics[0].range.end).toBeGreaterThan(
      insertion.diagnostics[0].range.start,
    );
    expect(correctOne("The the report is ready.", "The report is ready.").applied).toBe(
      "The report is ready.",
    );
    expect(correctOne("We we need time.", "We need time.").applied).toBe("We need time.");
    expect(correctOne("We buyed chairs.", "We bought chairs.").applied).toBe("We bought chairs.");
    expect(correctOne("I think alot about it.", "I think a lot about it.").applied).toBe(
      "I think a lot about it.",
    );
    expect(correctOne("She dont know.", "She doesn't know.").applied).toBe("She doesn't know.");
  });

  test("synonym swaps and stylistic changes are drift, never grammar", () => {
    expectRejected("The big dog ran home.", "The large dog ran home.", "drift");
    expectRejected("Wanna grab lunch?", "Want to grab lunch?", "drift");
    expectRejected("Can't make it tonight, sorry.", "Cannot make it tonight, sorry.", "drift");
    expectRejected("I do not know.", "I don't know.", "drift");
    expectRejected("gonna be late", "Gonna be late.", "drift");
    expectRejected("lol same", "Lol, same.", "drift");
    expectRejected("A 16 rd chain was used.", "A 16 rd. chain was used.", "drift");
  });

  test("risk guards: numbers, negation, uncertainty, names, dictionary words", () => {
    expectRejected("We measured 63 GB there.", "We measured 36 GB there.", "number");
    expectRejected("We need two servers.", "We need three servers.", "number");
    expectRejected("Do not enable this.", "Do enable this.", "negation");
    expectRejected("It never fails.", "It always fails.", "negation");
    expectRejected("The cant of the roof is odd.", "The can't of the roof is odd.", "negation");
    expectRejected("It may break later.", "It will break later.", "uncertainty");
    expectRejected(
      "I think the new build works fine now.",
      "The new build works fine now.",
      "uncertainty",
    );
    expectRejected("Ask Priya about it.", "Ask Paula about it.", "name");
    expectRejected("It may rain in May.", "It may rain in may.", "name");
    expectRejected("I use Qwen daily.", "I use Owen daily.", "name");
    expectRejected("I use ftyper daily.", "I use typer daily.", "name", {
      userDictionary: ["ftyper"],
    });
  });

  test("technical tokens and code-like text are left alone", () => {
    expectRejected("Keep do-lost=true set.", "Keep do-lost = true set.", "technical-token");
    expectRejected(
      "Read the docs at https://example.com first.",
      "Read the docs at ⟦1⟧ or x.io first.",
      "technical-token",
    );
    expectRejected("Bring snacks, e.g. fruit.", "Bring snacks, e. g. fruit.", "technical-token");
    expectRejected("The iPhone are new.", "The iphone is new.", "technical-token");
  });

  test("placeholders must come back exactly once, unchanged and in order", () => {
    const text = "Compare core.utils with api.client please.";
    expect(correctOne(text, "Compare ⟦1⟧ with ⟦2⟧ please.").segments).toEqual([
      "Compare ⟦1⟧ with ⟦2⟧ please.",
    ]);
    for (const proposed of [
      "Compare ⟦1⟧ with ⟦1⟧ please.",
      "Compare with ⟦2⟧ please.",
      "Compare ⟦2⟧ with ⟦1⟧ please.",
      "Compare ⟦ 1⟧ with ⟦2⟧ please.",
      "Compare ⟦1⟧ with ⟦2⟧ and ⟦3⟧ please.",
      "Compare ⟦1⟧ with api.client please.",
    ]) {
      expectRejected(text, proposed, "placeholder");
    }
  });

  test("protected ranges are never touched", () => {
    // An edit glued to inline code (a placeholder) would change its formatting side.
    expectRejected("Set `retries` to three.", "Set `retries`, to three.", "placeholder");
    expectRejected("Set `retries` to three.", "Set ⟦1⟧, to three.", "protected");
  });

  test("quoted examples are not corrected", () => {
    expectRejected(
      'She wrote "their going" on purpose.',
      'She wrote "they\'re going" on purpose.',
      "quoted",
    );
    expectRejected("He said “I seen it” twice.", "He said “I saw it” twice.", "quoted");
    expectRejected("It is fine.", 'It is "fine".', "quoted");
  });

  test("line breaks cannot be added", () => {
    expectRejected("It is fine and good.", "It is fine\nand good.", "shape");
  });

  test("mismatched output ids reject the whole chunk", () => {
    const prep = prepared("One is here. Two is here.");
    const [chunk] = buildAiChunks(prep, { mode: "correct", style: null }).chunks;
    const result = correctionFindings(prep, chunk, [{ id: "s1", text: "x" }]);
    expect(result).toEqual({ diagnostics: [], rejected: { shape: 2 } });
  });

  test("a rejected segment in a Correct pair does not hide its neighbour's fix", () => {
    const text = "Visit https://one.example now. She go to https://two.example today.";
    const result = correct(text, ["Visit ⟦2⟧ now.", "She goes to ⟦2⟧ today."]);
    expect(result.rejected).toEqual({ placeholder: 1 });
    expect(result.applied).toBe(
      "Visit https://one.example now. She goes to https://two.example today.",
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].range.start).toBe(text.indexOf("go to"));
  });

  test("a chunk from another snapshot is refused", () => {
    const prep = prepared("One is here.");
    const [chunk] = buildAiChunks(prepared("Two is here."), {
      mode: "correct",
      style: null,
    }).chunks;
    const result = correctionFindings(prep, chunk, [{ id: "s0", text: "Two are here." }]);
    expect(result).toEqual({ diagnostics: [], rejected: { shape: 1 } });
  });

  test("Unicode: emoji, combining marks, RTL and CRLF map to exact offsets", () => {
    const emoji = "Great job 👍🏽 on teh release.";
    const fixed = correctOne(emoji, "Great job 👍🏽 on the release.");
    expect(fixed.applied).toBe("Great job 👍🏽 on the release.");
    expect(fixed.diagnostics[0].original).toBe("teh");

    const combining = "The café was closd today.";
    expect(correctOne(combining, "The café was closed today.").applied).toBe(
      "The café was closed today.",
    );

    const rtl = "The word שלום are common here.";
    expect(correctOne(rtl, "The word שלום is common here.").applied).toBe(
      "The word שלום is common here.",
    );

    const crlf = "First line is fine\r\nThe results shows it.";
    const lines = correct(crlf, ["First line is fine", "The results show it."]);
    expect(lines.applied).toBe("First line is fine\r\nThe results show it.");
  });

  test("repeated substrings map by position, never by search", () => {
    const text = "The results shows a problem. The results shows a problem.";
    const second = correct(text, ["The results shows a problem.", "The results show a problem."]);
    expect(second.diagnostics).toHaveLength(1);
    expect(second.diagnostics[0].range.start).toBe(text.lastIndexOf("shows"));
    expect(second.applied).toBe("The results shows a problem. The results show a problem.");

    const both = correct(text, ["The results show a problem.", "The results show a problem."]);
    expect(both.diagnostics.map((d) => d.range.start)).toEqual([
      text.indexOf("shows"),
      text.lastIndexOf("shows"),
    ]);
    expect(new Set(both.diagnostics.map((d) => d.id)).size).toBe(2);
  });

  test("repeated substrings across two chunks map to their own chunk", () => {
    const text = "Their going now. Their going now.";
    const result = correct(text, ["They're going now.", "They're going now."], {
      maxChunkChars: 20,
    });
    expect(result.applied).toBe("They're going now. They're going now.");
  });

  test("a selection that cuts a word only yields edits inside the selection", () => {
    const text = "Hello wonderful teh world";
    const scope = { start: text.indexOf("nderful"), end: text.length };
    const result = correct(text, ["the world"], { scope });
    expect(result.segments).toEqual(["teh world"]);
    const [edit] = result.diagnostics[0].alternatives[0].edits;
    expect(edit.start).toBeGreaterThanOrEqual(scope.start);
    expect(result.applied).toBe("Hello wonderful the world");
  });

  test("echo output produces nothing", () => {
    const text = "Maybe tomorrow. Not sure yet.";
    expect(correct(text, ["Maybe tomorrow.", "Not sure yet."])).toMatchObject({
      diagnostics: [],
      rejected: {},
    });
  });
});

/** Runs Rewrite with the proposed text of every segment in document order. */
function rewrite(
  text: string,
  outputs: string[],
  style: ConcreteRewriteStyle = "keep-voice",
  extra: Extra = {},
) {
  const prep = prepared(text, extra);
  const { chunks } = buildAiChunks(prep, {
    mode: "rewrite",
    style,
    maxChunkChars: extra.maxChunkChars,
  });
  const queue = [...outputs];
  const parsed = chunks.map((chunk: AiChunk) =>
    chunk.segments.map((segment) => ({ id: segment.id, text: queue.shift() ?? "" })),
  );
  return { proposal: rewriteProposal(prep, chunks, parsed, style), chunks };
}

const rejection = (text: string, outputs: string[], style: ConcreteRewriteStyle = "keep-voice") => {
  const { proposal } = rewrite(text, outputs, style);
  return proposal.ok ? null : proposal.reason;
};

describe("rewriteProposal", () => {
  test("a double negative may collapse to one negation; a logical one may not (user report)", () => {
    expect(
      rejection("We decided to not change nothing for now.", [
        "We decided to make no changes for now.",
      ]),
    ).toBeNull();
    expect(rejection("I don't not like it.", ["I don't like it."])).toBe("negation");
    expect(rejection("We decided to not change nothing.", ["We decided to change it."])).toBe(
      "negation",
    );
  });

  test("numbers must keep their order, not just their multiset (review finding)", () => {
    expect(rejection("Pay 3 now and 5 later.", ["Pay 5 now and 3 later."])).toBe("number");
  });

  const TEXT = "hey, can you check the logs from 3 pm? the deploy failed twice.";

  test("a rewrite may not translate (real-GPU eval: rw-pl-02)", () => {
    const text = "wrzuciłem fix na release/1.2, sprawdźcie proszę";
    expect(
      rejection(text, ["I have applied the fix to ⟦1⟧, please check it."], "professional"),
    ).toBe("drift");
    expect(
      rejection(text, ["Wrzuciłem fix na ⟦1⟧, sprawdźcie, proszę."], "professional"),
    ).toBeNull();
    expect(rejection("Send the log today.", ["Wyślij log dzisiaj."])).toBe("drift");
  });

  test("equivalent negation and hedges are not rejected (real-GPU eval: rw-26, rw-31)", () => {
    expect(
      rejection("nope, not happening this sprint", ["No, not happening this sprint"]),
    ).toBeNull();
    expect(rejection("nope, not happening this sprint", ["Yes, happening this sprint"])).toBe(
      "negation",
    );
    const text = "Not sure the numbers are right, can someone double check the Q3 sheet?";
    expect(
      rejection(
        text,
        ["Not sure the numbers are correct. Could someone double-check the Q3 sheet?"],
        "professional",
      ),
    ).toBeNull();
    expect(
      rejection("Maybe the numbers are wrong, can someone check the Q3 sheet?", [
        "The numbers are wrong. Could someone check the Q3 sheet?",
      ]),
    ).toBe("uncertainty");
    // Only "could" before a person is a request; "maybe we" still hedges.
    expect(
      rejection("Maybe we could try it, but I'm not sure it helps.", [
        "We could try it, though I'm not sure it will help.",
      ]),
    ).toBe("uncertainty");
    expect(rejection("The issue could be hardware.", ["The issue is hardware."])).toBe(
      "uncertainty",
    );
  });

  test("whitespace at segment edges never changes in a rewrite", () => {
    expect(rejection("The build is red.", ["The build is red. "])).toBe("shape");
  });

  test("a valid rewrite becomes one proposal of word hunks", () => {
    const { proposal } = rewrite(
      TEXT,
      ["Hey, could you check the logs from 3 pm? The deploy failed twice."],
      "professional",
    );
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.style).toBe("professional");
    expect(proposal.before).toBe(TEXT);
    expect(proposal.after).toBe(
      "Hey, could you check the logs from 3 pm? The deploy failed twice.",
    );
    expect(applyEdits(TEXT, proposal.edits)).toBe(proposal.after);
    // Untouched words stay untouched (their formatting survives).
    expect(proposal.edits.map((edit) => edit.original)).toEqual(["hey", "can", "the"]);
    expect(proposal.kept).toEqual({});
  });

  test("a failing sentence is kept as written; the rest of the rewrite stays (user report)", () => {
    const text = "the report is ready. Send it before Friday.";
    const { proposal } = rewrite(text, ["The report is ready now.", "Send it by Friday."]);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.kept).toEqual({ invented: 1 });
    expect(proposal.after).toBe("The report is ready now. Send it before Friday.");
    expect(applyEdits(text, proposal.edits)).toBe(proposal.after);
    const sendAt = text.indexOf("Send");
    expect(proposal.edits.every((edit) => edit.end <= sendAt)).toBe(true);
  });

  test("with no passing changed sentence, the most frequent reason rejects the rewrite", () => {
    const text = "The report is ready. Send it before Friday. We met Anna today.";
    expect(
      rejection(text, ["Sorry, the report is ready.", "Send it by Friday.", "We met Ann today."]),
    ).toBe("invented");
  });

  test("facts cannot move between sentences", () => {
    expect(rejection("Pay 3 now. Pay 5 later.", ["Pay 5 now.", "Pay 3 later."])).toBe("number");
    expect(
      rejection("Ask Priya today. Then call the team.", [
        "Ask the team today.",
        "Then call Priya.",
      ]),
    ).toBe("name");
    // Only the sentence that lost its number is kept.
    const { proposal } = rewrite("Pay 3 now. Pay 5 later.", ["Pay 3 right now.", "Pay later."]);
    expect(proposal.ok && proposal.kept).toEqual({ number: 1 });
    expect(proposal.ok && proposal.after).toBe("Pay 3 right now. Pay 5 later.");
  });

  test("structural problems still reject the whole rewrite", () => {
    expect(
      rejection("Visit https://example.com today. The build is red.", [
        "Visit today.",
        "The build is failing.",
      ]),
    ).toBe("placeholder");
  });

  test("facts, polarity and uncertainty are preserved", () => {
    const base = "Hey, could you check the logs from 3 pm? The deploy failed twice.";
    expect(rejection(TEXT, [base.replace("3 pm", "4 pm")])).toBe("number");
    expect(rejection("Do not merge before Friday.", ["Merge before Friday."])).toBe("negation");
    expect(rejection("It might fail on Windows.", ["It fails on Windows."])).toBe("uncertainty");
    expect(rejection("Ask Priya about the rollout.", ["Ask about the rollout."])).toBe("name");
    expect(rejection("Ask her about the rollout.", ["Ask Paula about the rollout."])).toBe("name");
    expect(rejection("Send the log.", ["Send the log to ops@example.com."])).toBe(
      "technical-token",
    );
  });

  test("no invented apologies, commitments, deadlines, greetings or sign-offs", () => {
    const text = "The report is attached.";
    for (const invented of [
      "Sorry, the report is attached.",
      "The report is attached, I promise.",
      "The report is attached; more tomorrow.",
      "Hello, the report is attached.",
      "The report is attached. Regards",
      "Thanks, the report is attached.",
    ]) {
      expect(rejection(text, [invented], "friendly")).toBe("invented");
    }
    // Keeping one that was there is fine.
    expect(
      rejection("Thanks, the report is attached.", ["Thank you, the report is attached."]),
    ).toBeNull();
  });

  test("placeholders, quotes and line structure hold", () => {
    expect(rejection("Visit https://example.com today.", ["Visit today."])).toBe("placeholder");
    expect(rejection("Visit https://example.com today.", ["Please visit ⟦1⟧ today."])).toBeNull();
    expect(rejection("He said “ship it” and left.", ["He said “ship this” and left."])).toBe(
      "quoted",
    );
    expect(rejection("It is fine and good.", ["It is fine.\nIt is good."])).toBe("shape");
  });

  test("style-aware length bounds", () => {
    const text = "We should probably look at the failing tests before the release on Friday.";
    expect(rejection(text, ["We should probably fix tests before Friday."], "concise")).toBeNull();
    expect(rejection(text, ["Probably Friday."], "concise")).toBe("length");
    expect(rejection(text, [`${text} ${"Then look again. ".repeat(6).trim()}`], "clearer")).toBe(
      "length",
    );
  });

  test("combines chunks and never touches protected text between them", () => {
    const text = "the build is red.\n```\nnpm test\n```\nthe deploy is blocked.";
    const { proposal, chunks } = rewrite(
      text,
      ["The build is red.", "The deploy is blocked."],
      "keep-voice",
      { maxChunkChars: 30 },
    );
    expect(chunks.length).toBe(2);
    expect(proposal.ok && proposal.after).toBe(
      "The build is red.\n```\nnpm test\n```\nThe deploy is blocked.",
    );
  });

  test("mismatched outputs and empty plans are shape failures", () => {
    const prep = prepared("One is here.");
    const { chunks } = buildAiChunks(prep, { mode: "rewrite", style: "concise" });
    expect(rewriteProposal(prep, chunks, [], "concise")).toEqual({ ok: false, reason: "shape" });
    expect(rewriteProposal(prep, chunks, [[{ id: "s9", text: "x" }]], "concise")).toEqual({
      ok: false,
      reason: "shape",
    });
    expect(rewriteProposal(prep, [], [], "concise")).toEqual({ ok: false, reason: "shape" });
  });

  test("a rewrite that changes nothing has nothing to apply", () => {
    const prep = prepared("One is here.");
    const { chunks } = buildAiChunks(prep, { mode: "rewrite", style: "concise" });
    const echo = chunks.map((chunk) => chunk.segments.map(({ id, text }) => ({ id, text })));
    expect(rewriteProposal(prep, chunks, echo, "concise")).toEqual({
      ok: false,
      reason: "unchanged",
    });
  });
});
