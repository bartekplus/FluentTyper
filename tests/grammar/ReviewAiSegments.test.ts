import { describe, expect, test } from "bun:test";
import { prepareReview } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import {
  aiRequestForChunk,
  buildAiChunks,
  type AiChunkOptions,
} from "../../src/core/domain/grammar/review/ai/segments";
import type { AiChunk } from "../../src/core/domain/grammar/review/ai/types";
import type { ProtectedRange, TextRange } from "../../src/core/domain/grammar/review/types";

function prepared(
  text: string,
  extra: { scope?: TextRange; protectedRanges?: ProtectedRange[]; lang?: string } = {},
) {
  return prepareReview(
    {
      id: "snap",
      text,
      scope: extra.scope ?? { start: 0, end: text.length },
      protectedRanges: extra.protectedRanges ?? [],
    },
    {
      lang: extra.lang ?? "en_US",
      enabledRules: [],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  );
}

const CORRECT: AiChunkOptions = { mode: "correct", style: null };

function plan(text: string, extra: Parameters<typeof prepared>[1] = {}, options = CORRECT) {
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

    const bounded = buildAiChunks(prepared(text, { scope: { start, end } }), {
      ...CORRECT,
      contextChars: 20,
    });
    // The window starts mid-sentence: no whole sentence fits, so nothing is sent.
    expect(bounded.chunks[0].contextBefore).toBe("");
    expect(bounded.chunks[0].contextAfter).toBe("Delta is third.");
  });

  test("placeholders renumber per chunk; ids restart at s0", () => {
    const text = "See a.b.c here. Then x.y.z there. And more text.";
    const { chunks } = buildAiChunks(prepared(text), { ...CORRECT, maxChunkChars: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.segments[0].id).toBe("s0");
      const tokens = chunk.segments.flatMap((s) => s.placeholders.map((h) => h.token));
      expect(tokens).toEqual(tokens.map((_, index) => `⟦${index + 1}⟧`));
    }
    expectExactMapping(text, chunks);
  });

  test("correct mode stops at the size budget and reports the rest as limit", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const { chunks, skipped } = buildAiChunks(prepared(text), { ...CORRECT, maxTotalChars: 200 });
    const sent = chunks.flatMap((c) => c.segments).reduce((sum, s) => sum + s.text.length, 0);
    expect(sent).toBeLessThanOrEqual(200);
    expect(skipped.limit).toBeGreaterThan(0);
  });

  test("rewrite over its budget is all or nothing", () => {
    const text = Array.from({ length: 120 }, () => "This is a sentence.").join(" ");
    const { chunks, skipped } = plan(text, {}, { mode: "rewrite", style: "concise" });
    expect(chunks).toEqual([]);
    expect(skipped.limit).toBeGreaterThan(2000);
    expect(plan("Short one.", {}, { mode: "rewrite", style: "concise" }).chunks).toHaveLength(1);
  });

  test("prose containing placeholder brackets is not sent", () => {
    const { chunks, skipped } = plan("Keep ⟦1⟧ as is. Normal text.");
    expect(texts(chunks)).toEqual(["Normal text."]);
    expect(skipped.unsafe).toBe("Keep ⟦1⟧ as is.".length);
  });

  test("the cache key covers everything the model consumes", () => {
    const text = "Alpha is first. Beta is second.";
    const key = (options: AiChunkOptions, lang = "en_US", scope?: TextRange) =>
      buildAiChunks(prepared(text, { lang, scope }), options).chunks[0].key;
    const base = key(CORRECT);
    expect(key(CORRECT)).toBe(base);
    expect(key(CORRECT, "en_GB")).not.toBe(base);
    expect(key({ mode: "rewrite", style: "concise" })).not.toBe(base);
    expect(key({ mode: "rewrite", style: "concise" })).not.toBe(
      key({ mode: "rewrite", style: "friendly" }),
    );
    // Same segment, different read-only context.
    const start = text.indexOf("Beta");
    expect(key(CORRECT, "en_US", { start, end: text.length })).not.toBe(
      buildAiChunks(
        prepared(`Gamma is new. ${text.slice(start)}`, {
          scope: { start: 14, end: 14 + text.length - start },
        }),
        CORRECT,
      ).chunks[0].key,
    );
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
