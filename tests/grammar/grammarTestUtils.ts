import { expect } from "bun:test";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import { applyGrammarEditToContext } from "../../src/core/domain/grammar/GrammarEditSequencing";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  detectReviewDiagnostics,
  prepareReview,
  scanReviewChunk,
  type PreparedReview,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { PreferredTerm } from "../../src/core/domain/grammar/review/preferredTerminology";
import type {
  ReviewDiagnostic,
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";
import type {
  GrammarContext,
  GrammarEventType,
  GrammarHints,
} from "../../src/core/domain/grammar/types";

export function reviewSnapshot(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
): ReviewSourceSnapshot {
  return { id: "snap", text, scope: { start: 0, end: text.length }, protectedRanges: [], ...extra };
}

/** The default rules are all Review rules outside code mode. */
export function reviewOptions(overrides: Partial<ReviewOptions> = {}): ReviewOptions {
  return {
    lang: "en_US",
    enabledRules: reviewRuleIds({ codeMode: false }),
    userDictionary: [],
    insertSpaceAfterAutocomplete: true,
    ...overrides,
  };
}

export function review(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  overrides: Partial<ReviewOptions> = {},
) {
  return detectReviewDiagnostics(reviewSnapshot(text, extra), reviewOptions(overrides));
}

export function prepared(
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  overrides: Partial<ReviewOptions> = {},
) {
  return prepareReview(reviewSnapshot(text, extra), reviewOptions(overrides));
}

/** Two chunks split at each position find the same ranges as one whole scan. */
export function expectChunkSplitParity(
  prepared: PreparedReview,
  text: string,
  expected: readonly ReviewDiagnostic[],
): void {
  for (let cut = 1; cut < text.length; cut++) {
    const raw = [
      ...scanReviewChunk(prepared, { start: 0, end: cut }).findings,
      ...scanReviewChunk(prepared, { start: cut, end: text.length }).findings,
    ].sort((a, b) => a.range.start - b.range.start);
    expect(raw.map((d) => [d.range, text.slice(d.range.start, d.range.end)])).toEqual(
      expected.map((d) => [d.range, d.original]),
    );
  }
}

/** One individual finding repairs `source` to `expected`, and a new scan of `expected` is empty. */
export function expectOneRepair(
  findings: readonly ReviewDiagnostic[],
  source: string,
  expected: string,
  rescan: (text: string) => readonly ReviewDiagnostic[],
): ReviewDiagnostic {
  expect(findings).toHaveLength(1);
  const d = findings[0];
  expect(d.original).toBe(source.slice(d.range.start, d.range.end));
  expect(d.bulk.eligible).toBe(false);
  expect(d.context.start).toBeLessThanOrEqual(d.range.start);
  expect(d.context.end).toBeGreaterThanOrEqual(d.range.end);
  expect(applyEdits(source, d.alternatives[0].edits)).toBe(expected);
  expect(rescan(expected)).toEqual([]);
  return d;
}

type Scan = (
  text: string,
  extra?: Partial<ReviewSourceSnapshot>,
  overrides?: Partial<ReviewOptions>,
) => readonly ReviewDiagnostic[];

/** Language, dictionary, protection and scope stop the finding `d`; a new snapshot gives a new ID. */
export function expectReviewGuards(
  scan: Scan,
  text: string,
  d: ReviewDiagnostic,
  {
    dictionaryWord = d.original,
    protectedReason,
  }: { dictionaryWord?: string; protectedReason: "code" | "structure" },
): void {
  expect(scan(text, {}, { lang: "fr_FR" })).toEqual([]);
  expect(scan(text, {}, { userDictionary: [dictionaryWord] })).toEqual([]);
  expect(scan(text, { protectedRanges: [{ ...d.range, reason: protectedReason }] })).toEqual([]);
  expect(scan(text, { scope: { start: d.range.start + 1, end: d.range.end } })).toEqual([]);
  expect(scan(text, { scope: d.range })).toHaveLength(1);
  expect(scan(text, { id: "next" })[0].id).not.toBe(d.id);
}

export function term(overrides: Partial<PreferredTerm> = {}): PreferredTerm {
  return {
    id: "acme",
    source: "Acme Suite",
    replacement: "Acme Workspace",
    casePolicy: "exact",
    explanation: "Our preferred product name.",
    language: "en_US",
    scope: "all-prose",
    enabled: true,
    ...overrides,
  };
}

export function context(beforeCursor: string, hints?: GrammarHints): GrammarContext {
  return { beforeCursor, afterCursor: "", ...(hints ? { hints } : {}) };
}

export function proseContext(
  beforeCursor: string,
  lang = "en_US",
  hints: GrammarHints = {},
): GrammarContext {
  return context(beforeCursor, {
    lang,
    inputAction: "insert",
    measurementContext: "prose",
    ...hints,
  });
}

/** The edit that deletes `deleteBackwards` characters before the cursor and inserts `replacement`. */
export function edit(replacement: string, deleteBackwards: number) {
  return { replacement, deleteBackwards, deleteForwards: 0 };
}

export interface TypingOptions {
  lang?: string;
  hints?: GrammarHints;
  /** Undefined runs every registered rule. */
  rules?: readonly string[];
  /** Use one processSequence edit per key, as the content script does. Otherwise apply all process edits. */
  sequence?: boolean;
  /** Characters that send wordBoundary instead of insertChar. */
  boundaries?: readonly string[];
  /** Also send wordBoundary after ".", "!" and "?". */
  sentenceEndBoundary?: boolean;
  insertSpaceAfterAutocomplete?: boolean;
  userDictionaryList?: string[];
}

/** Types `input` one character at a time through the typing rule runtime and returns the last context. */
export function typeText(input: string, options: TypingOptions = {}): GrammarContext {
  const engine = new GrammarRuleEngine();
  for (const rule of createGrammarRuleCatalogRuntime({
    insertSpaceAfterAutocomplete: options.insertSpaceAfterAutocomplete ?? true,
    userDictionaryList: options.userDictionaryList ?? [],
  }))
    engine.registerRule(rule);
  const rules = options.rules && [...options.rules];
  const boundaries = options.boundaries ?? [" ", "\n"];
  let state = proseContext("", options.lang, options.hints);
  for (const char of input) {
    state.beforeCursor += char;
    const events: GrammarEventType[] = [boundaries.includes(char) ? "wordBoundary" : "insertChar"];
    if (options.sentenceEndBoundary && /[.!?]/.test(char)) events.push("wordBoundary");
    if (options.sequence) {
      const result = engine.processSequence(events, state, rules);
      if (result) state = applyGrammarEditToContext(state, result);
    } else {
      for (const result of engine.process(events[0], state, rules))
        state = applyGrammarEditToContext(state, result);
    }
  }
  return state;
}
