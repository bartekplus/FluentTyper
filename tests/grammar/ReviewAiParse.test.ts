import { describe, expect, test } from "bun:test";
import {
  MAX_AI_CONTEXT_CHARS,
  MAX_AI_RAW_OUTPUT_CHARS,
  MAX_AI_REQUEST_TEXT_CHARS,
  MAX_AI_SEGMENTS,
  parseAiResponse,
  validateAiRequest,
} from "../../src/core/domain/grammar/review/ai/parse";
import type { AiGenerationRequest } from "../../src/core/domain/grammar/review/ai/types";

const REQUEST: AiGenerationRequest = {
  mode: "correct",
  lang: "en_US",
  style: null,
  contextBefore: "",
  contextAfter: "",
  segments: [
    { id: "s0", text: "She dont know." },
    { id: "s1", text: "It is fine." },
  ],
};

const good = JSON.stringify({
  segments: [
    { id: "s0", text: "She doesn't know." },
    { id: "s1", text: "It is fine." },
  ],
});

const parse = (raw: string) => parseAiResponse(raw, REQUEST);
const MALFORMED = { ok: false, error: "malformed" };

describe("parseAiResponse", () => {
  test("accepts the exact contract", () => {
    expect(parse(good)).toEqual({
      ok: true,
      segments: [
        { id: "s0", text: "She doesn't know." },
        { id: "s1", text: "It is fine." },
      ],
    });
  });

  test("tolerates whitespace, one json fence and an empty think block only", () => {
    expect(parse(`\n  ${good}  \n`).ok).toBe(true);
    expect(parse(`\`\`\`json\n${good}\n\`\`\``).ok).toBe(true);
    expect(parse(`\`\`\`\n${good}\n\`\`\``).ok).toBe(true);
    expect(parse(`<think>\n\n</think>\n\n${good}`).ok).toBe(true);
    expect(parse(`<think>\n</think>\n\`\`\`json\n${good}\n\`\`\``).ok).toBe(true);
  });

  test.each([
    ["non-empty thinking", `<think>fix dont</think>${good}`],
    ["unclosed thinking", `<think>${good}`],
    ["two fences", `\`\`\`json\n${good}\n\`\`\`\n\`\`\`json\n${good}\n\`\`\``],
    ["prose before", `Here you go: ${good}`],
    ["prose after", `${good} Done!`],
    ["trailing JSON", `${good}{}`],
    ["truncated", good.slice(0, -3)],
    ["empty", ""],
    ["array", `[${good}]`],
    ["string", JSON.stringify(good)],
    ["extra top-level key", JSON.stringify({ segments: [], note: "x" })],
    ["no segments key", JSON.stringify({ result: [] })],
    ["missing id", JSON.stringify({ segments: [{ id: "s0", text: "She doesn't know." }] })],
    [
      "extra id",
      JSON.stringify({
        segments: [
          { id: "s0", text: "a" },
          { id: "s1", text: "b" },
          { id: "s2", text: "c" },
        ],
      }),
    ],
    [
      "duplicate id",
      JSON.stringify({
        segments: [
          { id: "s0", text: "a" },
          { id: "s0", text: "b" },
        ],
      }),
    ],
    [
      "reordered ids",
      JSON.stringify({
        segments: [
          { id: "s1", text: "It is fine." },
          { id: "s0", text: "She doesn't know." },
        ],
      }),
    ],
    [
      "unknown id",
      JSON.stringify({
        segments: [
          { id: "s0", text: "a" },
          { id: "s9", text: "b" },
        ],
      }),
    ],
    [
      "extra item key (offsets)",
      JSON.stringify({
        segments: [
          { id: "s0", text: "a", start: 0, end: 3 },
          { id: "s1", text: "b" },
        ],
      }),
    ],
    [
      "non-string text",
      JSON.stringify({
        segments: [
          { id: "s0", text: 1 },
          { id: "s1", text: "b" },
        ],
      }),
    ],
    [
      "null text",
      JSON.stringify({
        segments: [
          { id: "s0", text: null },
          { id: "s1", text: "b" },
        ],
      }),
    ],
    [
      "numeric id",
      JSON.stringify({
        segments: [
          { id: 0, text: "a" },
          { id: "s1", text: "b" },
        ],
      }),
    ],
    [
      "__proto__ key",
      '{"segments":[{"id":"s0","text":"a","__proto__":{}},{"id":"s1","text":"b"}]}',
    ],
    [
      "oversize segment",
      JSON.stringify({
        segments: [
          { id: "s0", text: "x".repeat("She dont know.".length * 2 + 201) },
          { id: "s1", text: "b" },
        ],
      }),
    ],
    ["oversize raw", `${good}${" ".repeat(MAX_AI_RAW_OUTPUT_CHARS)}`],
  ])("rejects %s", (_name, raw) => {
    expect(parse(raw)).toEqual(MALFORMED);
  });

  test("HTML and script text is returned as plain data", () => {
    const html = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const raw = JSON.stringify({
      segments: [
        { id: "s0", text: html },
        { id: "s1", text: "It is fine." },
      ],
    });
    const outcome = parse(raw);
    expect(outcome.ok && outcome.segments[0].text).toBe(html);
  });

  test("rejects every truncation of a valid response", () => {
    for (let cut = 0; cut < good.length; cut += 1) {
      expect(parse(good.slice(0, cut)).ok).toBe(false);
    }
  });
});

describe("validateAiRequest", () => {
  const valid = { ...REQUEST, segments: REQUEST.segments.map((s) => ({ ...s })) };

  test("accepts a well-formed request and returns a copy", () => {
    const result = validateAiRequest(valid);
    expect(result).toEqual(REQUEST);
    expect(result).not.toBe(valid);
    expect(
      validateAiRequest({ ...valid, mode: "rewrite", style: "concise", lang: "pl" })?.style,
    ).toBe("concise");
  });

  test.each([
    ["not an object", "hello"],
    ["null", null],
    ["extra key", { ...valid, url: "https://example.com" }],
    ["missing key", { ...valid, contextAfter: undefined }],
    ["unknown mode", { ...valid, mode: "chat" }],
    ["correct with style", { ...valid, style: "concise" }],
    ["rewrite without style", { ...valid, mode: "rewrite", style: null }],
    ["rewrite context-aware", { ...valid, mode: "rewrite", style: "context-aware" }],
    ["bad lang", { ...valid, lang: "en US; drop" }],
    ["long context", { ...valid, contextBefore: "x".repeat(MAX_AI_CONTEXT_CHARS + 1) }],
    ["no segments", { ...valid, segments: [] }],
    [
      "too many segments",
      {
        ...valid,
        segments: Array.from({ length: MAX_AI_SEGMENTS + 1 }, (_, i) => ({
          id: `s${i}`,
          text: "a",
        })),
      },
    ],
    ["bad id", { ...valid, segments: [{ id: "x0", text: "a" }] }],
    ["long id", { ...valid, segments: [{ id: "s1234", text: "a" }] }],
    [
      "duplicate id",
      {
        ...valid,
        segments: [
          { id: "s0", text: "a" },
          { id: "s0", text: "b" },
        ],
      },
    ],
    ["empty text", { ...valid, segments: [{ id: "s0", text: "" }] }],
    ["segment extra key", { ...valid, segments: [{ id: "s0", text: "a", start: 1 }] }],
    [
      "total too large",
      {
        ...valid,
        segments: [0, 1, 2].map((i) => ({
          id: `s${i}`,
          text: "x".repeat(MAX_AI_REQUEST_TEXT_CHARS / 2),
        })),
      },
    ],
  ])("rejects %s", (_name, value) => {
    expect(validateAiRequest(value)).toBeNull();
  });
});
