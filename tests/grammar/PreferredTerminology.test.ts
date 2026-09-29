import { expect, test } from "bun:test";
import {
  emptyTerminology,
  importTerminology,
  validateTerminology,
  MAX_TERMINOLOGY_ENTRIES,
  MAX_TERMINOLOGY_IMPORT_BYTES,
  type PreferredTerm,
} from "../../src/core/domain/grammar/review/preferredTerminology";
const entry = (overrides: Partial<PreferredTerm> = {}): PreferredTerm => ({
  id: "acme-suite",
  source: "Acme Suite",
  replacement: "Acme Workspace",
  casePolicy: "exact",
  explanation: "Our preferred product name.",
  language: "en_US",
  scope: "all-prose",
  enabled: true,
  ...overrides,
});
const config = (entries = [entry()]) => ({ version: 1, enabled: true, entries });

test("terminology defaults are empty and off; explicit settings round-trip without generating IDs", () => {
  expect(emptyTerminology()).toEqual({ version: 1, enabled: false, entries: [] });
  const input = config();
  const result = importTerminology(JSON.stringify(input));
  expect(result).toEqual({ ok: true, value: input });
  if (!result.ok) throw Error("invalid fixture");
  result.value.entries[0].source = "changed";
  expect(input.entries[0].source).toBe("Acme Suite");
});

test.each(
  [
    null,
    [],
    {},
    { version: 2, enabled: true, entries: [] },
    { version: 1, enabled: "true", entries: [] },
    { ...config(), script: "run()" },
  ].map((value) => ({ value })),
)("invalid terminology schema fails closed: %j", ({ value }) =>
  expect(validateTerminology(value).ok).toBe(false),
);

test.each([
  { source: "" },
  { source: " " },
  { source: ".*" },
  { source: " a" },
  { source: "a".repeat(81) },
  { source: "Cafe\u0301" },
  { source: "a\nb" },
  { replacement: "" },
  { replacement: "x".repeat(121) },
  { replacement: "Acme Suite" },
  { explanation: "" },
  { explanation: "x".repeat(241) },
  { explanation: "a\u0000b" },
  { id: "" },
  { id: "with spaces" },
  { id: "x".repeat(65) },
  { language: "auto_detect" },
  { language: "textExpander" },
  { language: "zz" },
  { language: "__proto__" },
  { scope: "website" },
  { casePolicy: "regex" },
  { enabled: 1 },
  { extra: "field" },
])("invalid preferred-term entry is rejected: %j", (overrides) => {
  expect(
    validateTerminology(config([{ ...entry(), ...overrides } as PreferredTerm])),
  ).toMatchObject({ ok: false, error: "entry", index: 0 });
});

test("terminology rejects duplicate sources and IDs without partial import", () => {
  for (const second of [
    entry(),
    entry({ id: "another" }),
    entry({ id: "another", source: "acme suite", casePolicy: "insensitive" }),
    entry({ source: "Other source" }),
  ]) {
    expect(validateTerminology(config([entry(), second]))).toMatchObject({
      ok: false,
      error: "duplicate",
    });
  }
  expect(
    validateTerminology(config([entry(), entry({ id: "french", language: "fr_FR" })])).ok,
  ).toBe(true);
  expect(
    validateTerminology(config([entry(), entry({ id: "lowercase", source: "acme suite" })])).ok,
  ).toBe(true);
});

test.each(
  [
    [
      ["A", "B"],
      ["B", "A"],
    ],
    [
      ["A", "B"],
      ["B", "C"],
      ["C", "A"],
    ],
    [
      ["A", "B"],
      ["B C", "A C"],
    ],
    [
      ["A B", "C"],
      ["C", "A B"],
    ],
    [["A", "A again"]],
    [
      ["old name", "new name"],
      ["new name", "old name"],
    ],
  ].map((pairs) => ({ pairs })),
)("terminology rejects direct and neighboring-phrase cycles: %j", ({ pairs }) => {
  const entries = pairs.map(([source, replacement], index) =>
    entry({ id: `term-${index}`, source, replacement }),
  );
  expect(validateTerminology(config(entries))).toMatchObject({ ok: false, error: "cycle" });
  expect(validateTerminology(config(entries.map((e) => ({ ...e, enabled: false }))))).toMatchObject(
    { ok: false, error: "cycle" },
  );
});

test("case repairs stabilize, acyclic chains and independent languages are allowed", () => {
  for (const casePolicy of ["exact", "insensitive"] as const)
    expect(
      validateTerminology(config([entry({ source: "github", replacement: "GitHub", casePolicy })]))
        .ok,
    ).toBe(true);
  expect(
    validateTerminology(
      config([
        entry({ id: "a", source: "A", replacement: "B" }),
        entry({ id: "b", source: "B", replacement: "C" }),
      ]),
    ).ok,
  ).toBe(true);
  expect(
    validateTerminology(
      config([
        entry({ id: "a", source: "A", replacement: "B", language: "en_US" }),
        entry({ id: "b", source: "B", replacement: "A", language: "fr_FR" }),
      ]),
    ).ok,
  ).toBe(true);
});

test("literal metacharacters and HTML are data in terminology JSON", () => {
  const value = config([
    entry({
      source: "Acme (old)",
      replacement: "<script>alert(1)</script>",
      explanation: '<img src=x onerror="alert(1)">',
    }),
  ]);
  expect(importTerminology(JSON.stringify(value))).toEqual({ ok: true, value });
});

test("terminology import and entry counts have hard bounds", () => {
  expect(importTerminology(" ".repeat(MAX_TERMINOLOGY_IMPORT_BYTES + 1))).toEqual({
    ok: false,
    error: "limit",
  });
  expect(importTerminology("😀".repeat(MAX_TERMINOLOGY_IMPORT_BYTES / 3))).toEqual({
    ok: false,
    error: "limit",
  });
  expect(importTerminology("not JSON")).toEqual({ ok: false, error: "schema" });
  const entries = Array.from({ length: MAX_TERMINOLOGY_ENTRIES }, (_, i) =>
    entry({ id: `id-${i}`, source: `old${i}`, replacement: `new${i}` }),
  );
  expect(validateTerminology(config(entries)).ok).toBe(true);
  expect(validateTerminology(config([...entries, entry()]))).toEqual({ ok: false, error: "limit" });
});

test("opposing exact-case preferences are a cycle even though each case repair is stable alone", () => {
  expect(
    validateTerminology(
      config([
        entry({ id: "lower", source: "github", replacement: "GitHub" }),
        entry({ id: "upper", source: "GitHub", replacement: "github" }),
      ]),
    ),
  ).toMatchObject({ ok: false, error: "cycle" });
});
