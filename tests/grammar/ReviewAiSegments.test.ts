import { describe, expect, test } from "bun:test";
import {
  aiRequestForChunk,
  buildAiChunks,
  type AiChunkOptions,
} from "../../src/core/domain/grammar/review/ai/segments";
import type { AiChunk } from "../../src/core/domain/grammar/review/ai/types";
import type { ReviewSourceSnapshot } from "../../src/core/domain/grammar/review/types";
import { prepared as prepare } from "./grammarTestUtils";

const prepared = (text: string, extra: Partial<ReviewSourceSnapshot> = {}) =>
  prepare(text, extra, { enabledRules: [] });

const CORRECT: AiChunkOptions = { mode: "correct" };
// Rewrite packs several sentences per chunk; Correct packs at most two.
const PACKED: AiChunkOptions = { mode: "rewrite" };

function plan(text: string, extra: Parameters<typeof prepared>[1] = {}, options = PACKED) {
  return buildAiChunks(prepared(text, extra), options);
}

const texts = (chunks: AiChunk[]) => chunks.flatMap((chunk) => chunk.segments.map((s) => s.text));

/** Every segment's text equals its snapshot slice with placeholders substituted. */
function expectExactMapping(text: string, chunks: AiChunk[]) {
  for (const chunk of chunks) {
    for (const segment of chunk.segments) {
      let rebuilt = text.slice(segment.range.start, segment.range.end);
      for (const holder of [...segment.placeholders].reverse()) {
        const from = holder.range.start - segment.range.start;
        const to = holder.range.end - segment.range.start;
        rebuilt = `${rebuilt.slice(0, from)}${holder.token}${rebuilt.slice(to)}`;
      }
      expect(rebuilt).toBe(segment.text);
    }
  }
}

describe("buildAiChunks", () => {
  test("unchanged pairs survive sentence deletion without changing initial grouping", () => {
    const sentences = Array.from(
      { length: 30 },
      (_, i) => `Sentence number ${i} has enough context to review.`,
    );
    const text = sentences.join(" ");
    const original = plan(text, {}, CORRECT).chunks;
    const previous = { text, chunks: original };
    expect(plan(text, {}, { ...CORRECT, previous }).chunks).toEqual(original);
    const after = sentences.slice(1).join(" ");
    const next = plan(after, {}, { ...CORRECT, previous }).chunks;
    expect(next[0].segments.map((s) => s.text)).toEqual([sentences[1]]);
    expect(next.slice(1).map((c) => c.segments.map((s) => s.text))).toEqual(
      original.slice(1).map((c) => c.segments.map((s) => s.text)),
    );
    const request = (chunk: AiChunk) =>
      JSON.stringify(aiRequestForChunk(chunk, "en_US", "correct", null));
    const cached = new Set(original.map(request));
    expect(next.filter((chunk) => !cached.has(request(chunk))).length).toBeLessThanOrEqual(5);
    expectExactMapping(after, next);
    expect(
      plan(after, {}, { ...CORRECT, pairSentences: false, previous }).chunks.every(
        (c) => c.segments.length === 1,
      ),
    ).toBe(true);
    expect(plan(after, {}, { ...PACKED, previous })).toEqual(plan(after, {}, PACKED));
  });

  test("Correct pairs sentences, keeping separate ids, ranges and surrounding context", () => {
    const text = "One is here. Two is here. Three is here.";
    const { chunks } = plan(text, {}, CORRECT);
    expect(chunks.map((chunk) => texts([chunk]))).toEqual([
      ["One is here.", "Two is here."],
      ["Three is here."],
    ]);
    expect(chunks[0].segments.map((segment) => segment.id)).toEqual(["s0", "s1"]);
    expect(chunks[1].segments[0].id).toBe("s0");
    expect(chunks[0].contextAfter).toBe("Three is here.");
    expect(chunks[1].contextBefore).toBe("One is here. Two is here.");
    expectExactMapping(text, chunks);
  });

  test("Correct pairs respect the character cap and give protected tokens unique ids", () => {
    const text = "See https://one.example here. Then https://two.example there. Last sentence.";
    const { chunks } = plan(text, {}, CORRECT);
    expect(texts([chunks[0]])).toEqual(["See ⟦1⟧ here.", "Then ⟦2⟧ there."]);
    expectExactMapping(text, chunks);
    const bounded = plan(text, {}, { ...CORRECT, maxChunkChars: 20 });
    expect(bounded.chunks).toHaveLength(3);
    expectExactMapping(text, bounded.chunks);
  });

  test("Correct splits oversized pairs without splitting sentences or repacking neighbours", () => {
    const long = `This sentence ${"has more detail ".repeat(14)}at the end.`;
    const text = `${long} Next sentence. Third sentence. Last sentence.`;
    const { chunks, skipped } = plan(text, {}, CORRECT);
    expect(chunks.map((chunk) => texts([chunk]))).toEqual([
      [long],
      ["Next sentence."],
      ["Third sentence.", "Last sentence."],
    ]);
    expect(skipped).toEqual({ protected: 0, unsafe: 0, limit: 0 });
    expectExactMapping(text, chunks);
  });

  test("the 200-character cap preserves the evaluated greedy 400-character boundaries", () => {
    const first = `First ${"detail ".repeat(35)}ends.`;
    const second = `Second ${"detail ".repeat(23)}ends.`;
    const text = `${first} ${second} Third sentence. Last sentence.`;
    expect(first.length + second.length).toBeGreaterThan(400);
    const { chunks } = plan(text, {}, CORRECT);
    expect(chunks.map((chunk) => texts([chunk]))).toEqual([
      [first],
      [second, "Third sentence."],
      ["Last sentence."],
    ]);
    expectExactMapping(text, chunks);
  });

  test("splits sentences, keeps abbreviations, and turns a URL into a placeholder", () => {
    const text = "The results shows a problem. Visit https://example.com/a now. Mr. Smith is here.";
    const { chunks, skipped } = plan(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].segments.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
    expect(texts(chunks)).toEqual([
      "The results shows a problem.",
      "Visit ⟦1⟧ now.",
      "Mr. Smith is here.",
    ]);
    const holder = chunks[0].segments[1].placeholders[0];
    expect(text.slice(holder.range.start, holder.range.end)).toBe("https://example.com/a");
    expect(skipped.protected).toBe("https://example.com/a".length);
    expectExactMapping(text, chunks);
  });

  test("keeps short dotted abbreviations readable", () => {
    expect(texts(plan("Bring snacks, e.g. fruit.").chunks)).toEqual(["Bring snacks, e.g. fruit."]);
  });

  test("line breaks (LF and CRLF) are segment boundaries and never sent", () => {
    const text = "First line here\r\nsecond line here\nthird one.";
    const { chunks } = plan(text);
    expect(texts(chunks)).toEqual(["First line here", "second line here", "third one."]);
    for (const segment of texts(chunks)) expect(segment).not.toMatch(/[\r\n]/);
    expectExactMapping(text, chunks);
  });

  test("fenced code and structure ranges are boundaries, not sent", () => {
    const text = "Intro text.\n```\nconst x = 1;\n```\nOutro text.";
    const { chunks, skipped } = plan(text);
    expect(texts(chunks)).toEqual(["Intro text.", "Outro text."]);
    expect(skipped.protected).toBeGreaterThan(0);

    const island = "Hello there, see chip and go.";
    const start = island.indexOf("chip");
    const structured = plan(island, {
      protectedRanges: [{ start, end: start + 4, reason: "structure" }],
    });
    expect(texts(structured.chunks)).toEqual(["Hello there, see", "and go."]);
    expect(structured.skipped.protected).toBe(4);
  });

  test("inline code becomes a placeholder so the sentence stays readable", () => {
    const text = "Set `retries` to 3 in the config.";
    const { chunks } = plan(text);
    expect(texts(chunks)).toEqual(["Set ⟦1⟧ to 3 in the config."]);
    expectExactMapping(text, chunks);
  });

  test("a selection edge that cuts a word drops the fragment and counts it unsafe", () => {
    const text = "Hello wonderful world today";
    const start = text.indexOf("nderful");
    const { chunks, skipped } = plan(text, { scope: { start, end: text.length - 2 } });
    expect(texts(chunks)).toEqual(["world"]);
    expect(skipped.unsafe).toBe("nderful".length + "tod".length);
  });

  test("a selection edge inside a surrogate pair is never split", () => {
    const text = "Fine 👍🏽 thanks all";
    const cut = text.indexOf("👍") + 1;
    const { chunks, skipped } = plan(text, { scope: { start: cut, end: text.length } });
    expect(texts(chunks)).toEqual(["thanks all"]);
    expect(skipped.unsafe).toBeGreaterThan(0);
  });

  test("selection gets read-only context from the same snapshot, trimmed to sentences", () => {
    const text =
      "Alpha is first. Beta visits https://example.com today. Gamma is second. Delta is third. Epsilon is last.";
    const start = text.indexOf("Gamma");
    const end = text.indexOf(" Delta");
    const { chunks } = plan(text, { scope: { start, end } });
    expect(texts(chunks)).toEqual(["Gamma is second."]);
    expect(chunks[0].contextBefore).toBe("Alpha is first. Beta visits … today.");
    expect(chunks[0].contextAfter).toBe("Delta is third. Epsilon is last.");

    // A window starting mid-sentence keeps whole sentences only (here, none before).
    const long = `${"Filler words here ".repeat(20)}end. Gamma is second. Delta is third.${" and more".repeat(40)}`;
    const at = long.indexOf("Gamma");
    const [bounded] = plan(long, { scope: { start: at, end: long.indexOf(" Delta") } }).chunks;
    expect(bounded.contextBefore).toBe("");
    expect(bounded.contextAfter).toBe("Delta is third.");
  });

  test("placeholders renumber per chunk; ids restart at s0", () => {
    const text = "See a.b.c here. Then x.y.z there. And more text.";
    const { chunks } = buildAiChunks(prepared(text), { ...PACKED, maxChunkChars: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.segments[0].id).toBe("s0");
      const tokens = chunk.segments.flatMap((s) => s.placeholders.map((h) => h.token));
      expect(tokens).toEqual(tokens.map((_, index) => `⟦${index + 1}⟧`));
    }
    expectExactMapping(text, chunks);
  });

  test("correct mode stops at the size budget and reports the rest as limit", () => {
    const text = Array.from({ length: 600 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const { chunks, skipped } = plan(text, {}, CORRECT);
    const sent = chunks.flatMap((c) => c.segments).reduce((sum, s) => sum + s.text.length, 0);
    expect(sent).toBeLessThanOrEqual(12_000);
    expect(skipped.limit).toBeGreaterThan(0);
  });

  test("rewrite over its budget is all or nothing", () => {
    const text = Array.from({ length: 120 }, () => "This is a sentence.").join(" ");
    const { chunks, skipped } = plan(text, {}, PACKED);
    expect(chunks).toEqual([]);
    expect(skipped.limit).toBeGreaterThan(2000);
    expect(plan("Short one.", {}, PACKED).chunks).toHaveLength(1);
  });

  // A placeholder is protected text; the other skipped counts leave it out.
  test.each([
    ["Keep ⟦1⟧ at https://example.com/a now.", PACKED, { protected: 21, unsafe: 17, limit: 0 }],
    [
      `${"This is a sentence. ".repeat(110)}Visit https://example.com/a now.`,
      PACKED,
      { protected: 21, unsafe: 0, limit: 2101 },
    ],
    [
      `${"Sentence number is here. ".repeat(500)}Visit https://example.com/a now.`,
      CORRECT,
      { protected: 21, unsafe: 0, limit: 11 },
    ],
  ])("counts each skipped character one time: %#", (text, options, expected) => {
    expect(plan(text, {}, options).skipped).toEqual(expected);
  });

  test("prose containing placeholder brackets is not sent", () => {
    const { chunks, skipped } = plan("Keep ⟦1⟧ as is. Normal text.");
    expect(texts(chunks)).toEqual(["Normal text."]);
    expect(skipped.unsafe).toBe("Keep ⟦1⟧ as is.".length);
  });

  test("the wire request carries text only", () => {
    const { chunks } = plan("Visit https://example.com now.");
    const request = aiRequestForChunk(chunks[0], "en_US", "correct", "concise");
    expect(request).toEqual({
      mode: "correct",
      lang: "en_US",
      style: null,
      contextBefore: "",
      contextAfter: "",
      segments: [{ id: "s0", text: "Visit ⟦1⟧ now." }],
    });
  });

  test("text without letters is not sent and not counted", () => {
    const { chunks, skipped } = plan("123 456\n---");
    expect(chunks).toEqual([]);
    expect(skipped).toEqual({ protected: 0, unsafe: 0, limit: 0 });
  });
});
