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
  expect(result.rejected).toEqual({ [reason]: 1 });
}

describe("correctionFindings", () => {
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

  test("dependent hunks of one sentence form one atomic finding", () => {
    const text = "He go home and she buy milk.";
    const { diagnostics, applied } = correctOne(text, "He goes home and she buys milk.");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].alternatives).toHaveLength(1);
    expect(diagnostics[0].alternatives[0].edits).toHaveLength(2);
    expect(diagnostics[0].original).toBe("go home and she buy");
    expect(diagnostics[0].alternatives[0].preview).toBe("goes home and she buys");
    expect(applied).toBe("He goes home and she buys milk.");
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

  test("a valid JSON rewrite of everything is rejected in Correct mode", () => {
    const { diagnostics, rejected } = correctOne(
      "The meeting went well and everyone agreed on the plan.",
      "Everyone agreed on the plan, so the meeting was a success.",
    );
    expect(diagnostics).toEqual([]);
    expect(Object.values(rejected)).toEqual([1]);
  });

  test("risk guards: numbers, negation, uncertainty, names, dictionary words", () => {
    expectRejected("We measured 63 GB there.", "We measured 36 GB there.", "number");
    expectRejected("We need two servers.", "We need three servers.", "number");
    expectRejected("Do not enable this.", "Do enable this.", "negation");
    expectRejected("It never fails.", "It always fails.", "negation");
    expectRejected("The cant of the roof is odd.", "The can't of the roof is odd.", "negation");
    expectRejected("It may break later.", "It will break later.", "uncertainty");
    expectRejected("I think it works.", "It works.", "uncertainty");
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
  const TEXT = "hey, can you check the logs from 3 pm? the deploy failed twice.";

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
    expect(rejection(text, [`${text} ${"Then look again. ".repeat(6)}`], "clearer")).toBe("length");
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
});
