import { describe, expect, test } from "bun:test";
import {
  ReviewSession,
  type ReviewApplyResult,
  type ReviewCapabilities,
  type ReviewSpellingLookup,
  type ReviewTargetPort,
  type ReviewTargetRead,
  type ReviewViewState,
} from "../src/core/application/review/ReviewSession";
import { GRAMMAR_RULE_IDS } from "../src/core/domain/grammar/ruleCatalog";
import { MAX_REVIEW_CHARS } from "../src/core/domain/grammar/review/reviewDiagnostics";
import { parseSpellingRequest } from "../src/core/domain/grammar/review/reviewSpelling";
import type {
  ProtectedRange,
  ReviewEdit,
  TextRange,
} from "../src/core/domain/grammar/review/types";

class FakeEditor implements ReviewTargetPort {
  capabilities: ReviewCapabilities = { inline: true, apply: true, bulk: true, undo: "single-step" };
  protectedRanges: ProtectedRange[] = [];
  composing = false;
  applyCalls: Array<{ edits: ReviewEdit[]; before: string; after: string }> = [];
  /** Forces the next apply result. */
  nextResult: ReviewApplyResult | null = null;

  constructor(public text: string) {}

  read(): ReviewTargetRead {
    if (this.composing) return { ok: false, reason: "composing" };
    return {
      ok: true,
      text: this.text,
      protectedRanges: this.protectedRanges,
      signature: JSON.stringify(this.protectedRanges),
    };
  }

  apply(request: { edits: ReviewEdit[]; before: string; after: string; signature: string }) {
    this.applyCalls.push(request);
    if (this.nextResult) {
      const result = this.nextResult;
      this.nextResult = null;
      return Promise.resolve(result);
    }
    if (this.text !== request.before) return Promise.resolve({ status: "stale" as const });
    let text = this.text;
    for (const edit of request.edits) {
      text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
    }
    this.text = text;
    return Promise.resolve(
      text === request.after ? { status: "applied" as const } : { status: "unverified" as const },
    );
  }
}

function harness(
  text: string,
  {
    scope = null,
    dictionary,
    rules = ["englishTypoWhitelistCorrection"],
    lookupSpelling,
  }: {
    scope?: TextRange | null;
    dictionary?: (word: string) => Promise<boolean>;
    rules?: readonly string[];
    lookupSpelling?: ReviewSpellingLookup;
  } = {},
) {
  const editor = new FakeEditor(text);
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const states: ReviewViewState[] = [];
  const session = new ReviewSession({
    target: editor,
    options: {
      lang: "en_US",
      enabledRules: rules,
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
    initialScope: scope,
    onChange: (state) => states.push(state),
    addToDictionary: dictionary,
    lookupSpelling,
    setTimer: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      const index = timers.indexOf(handle as (typeof timers)[number]);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  /** Runs queued timers (scan yields and debounced rechecks) until idle. */
  const settle = async () => {
    for (let round = 0; round < 1000; round += 1) {
      await Promise.resolve();
      await Promise.resolve();
      const timer = timers.shift();
      if (!timer) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (timers.length === 0) return;
        continue;
      }
      timer.callback();
    }
  };
  const last = () => states.at(-1)!;
  const originals = () => last().diagnostics.map((d) => d.original);
  return { editor, session, settle, last, originals, states, timers };
}

describe("ReviewSession", () => {
  test("starting a review reads only and shows loading before results", async () => {
    const h = harness("teh cat saw teh dog");
    const started = h.session.start();
    expect(h.last().status).toBe("loading");
    await h.settle();
    await started;
    expect(h.last().status).toBe("ready");
    expect(h.originals()).toEqual(["teh", "teh"]);
    expect(h.editor.applyCalls).toEqual([]);
    expect(h.editor.text).toBe("teh cat saw teh dog");
    expect(h.last().scopeKind).toBe("field");
  });

  test("applying one fix changes only that occurrence and rechecks", async () => {
    const h = harness("teh cat saw teh dog");
    await Promise.all([h.session.start(), h.settle()]);
    const [, second] = h.last().diagnostics;
    const applying = h.session.apply(second.id);
    await h.settle();
    expect(await applying).toEqual({ status: "applied" });
    expect(h.editor.text).toBe("teh cat saw the dog");
    expect(h.editor.applyCalls[0].edits).toEqual([
      { start: 13, end: 15, original: "eh", replacement: "he" },
    ]);
    expect(h.last().status).toBe("ready");
    expect(h.last().resolvedCount).toBe(1);
    expect(h.last().diagnostics.map((d) => d.range)).toEqual([{ start: 0, end: 3 }]);
    expect(h.last().notice).toEqual({ kind: "applied", count: 1, deferred: 0 });
  });

  test("a user's own edit after a fix (an undo) drops the fix notice", async () => {
    const h = harness("teh cat");
    await Promise.all([h.session.start(), h.settle()]);
    const applying = h.session.apply(h.last().diagnostics[0].id);
    await h.settle();
    await applying;
    expect(h.last().notice).toEqual({ kind: "applied", count: 1, deferred: 0 });
    h.editor.text = "teh cat";
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.last().notice).toBeNull();
    expect(h.originals()).toEqual(["teh"]);
  });

  test("a failing read or scan shows the error state instead of loading forever", async () => {
    const h = harness("teh cat");
    const read = h.editor.read.bind(h.editor);
    // A malformed read makes the scan itself throw.
    h.editor.read = () => ({ ...read(), protectedRanges: null as unknown as [] });
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.last().status).toBe("error");
    // The next edit tries again.
    h.editor.read = read;
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.last().status).toBe("ready");
    expect(h.originals()).toEqual(["teh"]);
  });

  test("a plan with many proofs is finished in the background; Fix all waits for it", async () => {
    const text = "yes i dont know. ".repeat(40);
    const h = harness(text, {
      rules: [
        "capitalizeSentenceStart",
        "englishPronounICapitalization",
        "englishContractionNormalization",
      ],
    });
    const started = h.session.start();
    // Run the scan, stopping as soon as results are shown.
    for (let i = 0; i < 200 && h.last().status !== "ready"; i += 1) {
      await Promise.resolve();
      h.timers.shift()?.callback();
    }
    expect(h.last().status).toBe("ready");
    expect(h.last().bulk.pending).toBe(true);
    // Fix all now waits for the proofs, then applies the whole proven plan.
    const fixing = h.session.fixAll();
    await h.settle();
    await started;
    expect(await fixing).toEqual({ status: "applied" });
    expect(h.editor.text).toBe("Yes I don't know. ".repeat(40));
    expect(h.last().bulk.pending).toBe(false);
  });

  test("an edit made after the scan is detected before writing: no stale write", async () => {
    const h = harness("teh cat");
    await Promise.all([h.session.start(), h.settle()]);
    const [finding] = h.last().diagnostics;
    h.editor.text = "the teh cat";
    const applying = h.session.apply(finding.id);
    await h.settle();
    expect(await applying).toEqual({ status: "stale" });
    // Never located by searching for "teh": the new text was rechecked instead.
    expect(h.editor.text).toBe("the teh cat");
    expect(h.last().notice).toEqual({ kind: "stale" });
    expect(h.last().diagnostics.map((d) => d.range)).toEqual([{ start: 4, end: 7 }]);
  });

  test("user edits invalidate results at once, then recheck after a pause", async () => {
    const h = harness("teh cat");
    await Promise.all([h.session.start(), h.settle()]);
    h.editor.text = "teh cat and teh";
    h.session.notifySourceChanged();
    expect(h.last().status).toBe("updating");
    expect(h.last().diagnostics).toEqual([]);
    expect(h.timers.at(-1)!.delay).toBe(400);
    // Rapid edits restart the debounce instead of queueing scans.
    h.session.notifySourceChanged();
    expect(h.timers.filter((t) => t.delay === 400)).toHaveLength(1);
    await h.settle();
    expect(h.last().status).toBe("ready");
    expect(h.originals()).toEqual(["teh", "teh"]);
  });

  test("ignore is per occurrence and survives harmless rechecks", async () => {
    const h = harness("teh a teh b");
    await Promise.all([h.session.start(), h.settle()]);
    const [first] = h.last().diagnostics;
    h.session.ignore(first.id);
    expect(h.last().diagnostics.map((d) => d.range.start)).toEqual([6]);
    expect(h.last().ignoredCount).toBe(1);
    // An unrelated edit later in the text keeps the ignore on the same occurrence.
    h.editor.text = "teh a teh b c";
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.last().diagnostics.map((d) => d.range.start)).toEqual([6]);
    // Text inserted between them shifts the second; the first stays ignored.
    h.editor.text = "teh aa teh b c";
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.last().diagnostics.map((d) => d.range.start)).toEqual([7]);
    expect(h.last().ignoredCount).toBe(1);
  });

  test("editing the ignored occurrence itself drops the ignore", async () => {
    const h = harness("teh a");
    await Promise.all([h.session.start(), h.settle()]);
    h.session.ignore(h.last().diagnostics[0].id);
    h.editor.text = "tehx teh a";
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.originals()).toEqual(["teh"]);
    expect(h.last().ignoredCount).toBe(0);
  });

  test("Fix all applies every safe fix in one write and reports what is left", async () => {
    const h = harness("i think teh plan is ready , but their is a hour left. alot of work.", {
      rules: GRAMMAR_RULE_IDS,
    });
    await Promise.all([h.session.start(), h.settle()]);
    const before = h.last();
    expect(before.bulk.count).toBeGreaterThan(3);
    const fixing = h.session.fixAll();
    await h.settle();
    expect(await fixing).toEqual({ status: "applied" });
    expect(h.editor.applyCalls).toHaveLength(1);
    expect(h.editor.text).toBe(
      "I think the plan is ready, but there is a hour left. alot of work.",
    );
    expect(h.last().notice).toMatchObject({
      kind: "applied",
      count: before.bulk.count,
      deferred: 3,
    });
    // Left for individual review: the article rule is individual-only, and the
    // sentence-start capital and "a lot" change the same letter, so neither is
    // picked as a winner.
    expect(h.originals()).toEqual(["a hour", "a", "alot"]);
  });

  test("Fix all follows the shown categories", async () => {
    const h = harness("teh plan , ok", { rules: GRAMMAR_RULE_IDS });
    await Promise.all([h.session.start(), h.settle()]);
    h.session.setCategory("punctuation", false);
    h.session.setCategory("typography", false);
    expect(h.last().bulk.count).toBe(1);
    const fixing = h.session.fixAll();
    await h.settle();
    await fixing;
    expect(h.editor.text).toBe("the plan , ok");
  });

  test("partial and unverified host results are reported and reread, never retried", async () => {
    const h = harness("teh cat teh");
    await Promise.all([h.session.start(), h.settle()]);
    h.editor.nextResult = { status: "unverified" };
    const applying = h.session.fixAll();
    await h.settle();
    expect(await applying).toEqual({ status: "unverified" });
    expect(h.editor.applyCalls).toHaveLength(1);
    expect(h.last().notice).toEqual({ kind: "unverified" });
    expect(h.last().status).toBe("ready");
    h.editor.nextResult = { status: "partial", applied: 1 };
    const partial = h.session.fixAll();
    await h.settle();
    await partial;
    expect(h.last().notice).toEqual({ kind: "partial", applied: 1 });
  });

  test("selection scope: fixes and edits inside keep it; a boundary edit invalidates it", async () => {
    const text = "teh one. teh two. teh three";
    const h = harness(text, { scope: { start: 9, end: 17 } });
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.last().scopeKind).toBe("selection");
    expect(h.last().diagnostics.map((d) => d.range)).toEqual([{ start: 9, end: 12 }]);
    const applying = h.session.apply(h.last().diagnostics[0].id);
    await h.settle();
    await applying;
    expect(h.editor.text).toBe("teh one. the two. teh three");
    // Only in-scope text was changed; the rest of the field was not reviewed.
    expect(h.last().diagnostics).toEqual([]);
    // Typing inside the selection grows it.
    h.editor.text = "teh one. the tw teh o. teh three";
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.originals()).toEqual(["teh"]);
    // Typing exactly at its end is ambiguous: invalidate, don't guess.
    h.editor.text = "teh one. the tw teh o.X teh three";
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.last().status).toBe("stale-scope");
    expect(h.last().diagnostics).toEqual([]);
  });

  test("closing discards pending work and never writes", async () => {
    const h = harness("teh cat");
    const started = h.session.start();
    h.session.close();
    await h.settle();
    await started;
    expect(h.last().status).toBe("closed");
    expect(h.states.some((s) => s.status === "ready")).toBe(false);
    expect(h.editor.applyCalls).toEqual([]);
    expect(await h.session.apply("anything")).toBeNull();
  });

  test("composition makes the target unavailable until it ends", async () => {
    const h = harness("teh cat");
    await Promise.all([h.session.start(), h.settle()]);
    h.editor.composing = true;
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.last()).toMatchObject({ status: "unavailable", unavailable: "composing" });
    expect(await h.session.apply("x")).toBeNull();
    h.editor.composing = false;
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.last().status).toBe("ready");
  });

  test("formatting-only changes recompute findings for the same text", async () => {
    const h = harness("see teh cat");
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.originals()).toEqual(["teh"]);
    h.editor.protectedRanges = [{ start: 4, end: 7, reason: "code" }];
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.last().diagnostics).toEqual([]);
    expect(h.last().coverage?.skipped.code).toBe(3);
  });

  test("add to dictionary uses the injected path and rechecks", async () => {
    const added: string[] = [];
    const h = harness("teh cat", {
      dictionary: (word) => {
        added.push(word);
        return Promise.resolve(true);
      },
    });
    await Promise.all([h.session.start(), h.settle()]);
    const adding = h.session.addToDictionary(h.last().diagnostics[0].id);
    await h.settle();
    await adding;
    expect(added).toEqual(["teh"]);
    expect(h.last().diagnostics).toEqual([]);
    expect(h.last().notice).toEqual({ kind: "dictionary-added", word: "teh" });
    expect(h.editor.applyCalls).toEqual([]);
  });

  test("review-only targets never write", async () => {
    const h = harness("teh cat");
    h.editor.capabilities = { inline: false, apply: false, bulk: false, undo: "none" };
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.originals()).toEqual(["teh"]);
    expect(await h.session.apply(h.last().diagnostics[0].id)).toBeNull();
    expect(await h.session.fixAll()).toBeNull();
    expect(h.last().bulk.count).toBe(0);
  });

  test("a scope larger than the limit is cut and reported as partial", async () => {
    const line = "teh cat sat.\n";
    const text = line.repeat(Math.ceil((MAX_REVIEW_CHARS + 2000) / line.length));
    const h = harness(text);
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.last().truncated).toBeGreaterThan(0);
    expect(h.last().coverage?.skipped["size-limit"]).toBe(h.last().truncated);
  });

  test("text the editor did not hand over is reported as unreviewed", async () => {
    const h = harness("teh cat");
    const read = h.editor.read.bind(h.editor);
    h.editor.read = () => {
      const result = read();
      return result.ok ? { ...result, unread: 5000 } : result;
    };
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.last().unread).toBe(5000);
    expect(h.last().coverage?.skipped["outside-window"]).toBe(5000);
    expect(h.originals()).toEqual(["teh"]);
  });

  test("settings changes recheck with the new rules", async () => {
    const h = harness("teh cat");
    await Promise.all([h.session.start(), h.settle()]);
    h.session.updateOptions({
      lang: "en_US",
      enabledRules: [],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    });
    await h.settle();
    expect(h.last()).toMatchObject({ status: "ready", noRules: true, diagnostics: [] });
  });
});

describe("ReviewSession spelling", () => {
  /** A fake dictionary: "wa" and "teh" are unknown; every other word is known. */
  function fakeLookup(candidates: Record<string, string[]> = {}) {
    const calls: Array<Array<{ word: string; before: string }>> = [];
    const lookup: ReviewSpellingLookup = (lang, words) => {
      expect(lang).toBe("en_US");
      calls.push([...words]);
      return Promise.resolve(
        words.map(({ word }) =>
          word === "wa" ? ["was", "way", "want", "water", "war"] : (candidates[word] ?? null),
        ),
      );
    };
    return { lookup, calls, words: () => calls.flat().map((item) => item.word) };
  }

  test("an unknown word becomes a pick-one finding after the rule results; nothing is applied", async () => {
    const fake = fakeLookup();
    const h = harness("Where wa it?", { lookupSpelling: fake.lookup });
    await Promise.all([h.session.start(), h.settle()]);
    // Rule results first (none here), then the dictionary check.
    expect(
      h.states.some((state) => state.status === "ready" && state.spelling === "checking"),
    ).toBe(true);
    expect(h.last().spelling).toBe("done");
    const [finding] = h.last().diagnostics;
    expect(finding).toMatchObject({
      ruleId: "reviewSpelling",
      original: "wa",
      requiresChoice: true,
    });
    expect(finding.alternatives.map((a) => a.preview)).toEqual(["was", "way", "war"]);
    expect(fake.calls[0]).toContainEqual({ word: "wa", before: "Where " });
    // Never batched, and nothing was written.
    expect(h.last().bulk).toMatchObject({ count: 0, deferred: 1 });
    expect(h.editor.applyCalls).toEqual([]);

    // The user picks the second suggestion.
    await Promise.all([h.session.apply(finding.id, 1), h.settle()]);
    expect(h.editor.text).toBe("Where way it?");
    expect(h.last().diagnostics).toEqual([]);
  });

  test("a word with combining marks never makes the dictionary check unavailable", async () => {
    // Exactly what the background does: a request it refuses is answered with nothing.
    const lookup: ReviewSpellingLookup = (lang, words) => {
      const parsed = parseSpellingRequest({ lang, words });
      if (!parsed) return Promise.resolve(null);
      return Promise.resolve(
        parsed.words.map(({ word }) => (word === "wa" ? ["was", "way"] : null)),
      );
    };
    const h = harness("We visited the cafe\u0301 and read हिंदी. Where wa it?", {
      lookupSpelling: lookup,
    });
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.last().spelling).toBe("done");
    expect(h.last().diagnostics.map((d) => d.original)).toEqual(["wa"]);
  });

  test("answers are remembered: a recheck looks up only new words", async () => {
    const fake = fakeLookup();
    const h = harness("Where wa it?", { lookupSpelling: fake.lookup });
    await Promise.all([h.session.start(), h.settle()]);
    const first = fake.words().length;
    h.editor.text = "Where wa it? Found it.";
    h.session.notifySourceChanged();
    await h.settle();
    expect(fake.words().slice(first)).toEqual(["Found"]);
    expect(h.last().diagnostics.map((d) => d.original)).toEqual(["wa"]);
  });

  test("a language without a dictionary is reported once; rule results stay", async () => {
    let calls = 0;
    const h = harness("teh wa", {
      lookupSpelling: () => {
        calls += 1;
        return Promise.resolve(null);
      },
    });
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.last().spelling).toBe("unavailable");
    expect(h.originals()).toEqual(["teh"]);
    h.editor.text = "teh wa now";
    h.session.notifySourceChanged();
    await h.settle();
    expect(calls).toBe(1);
    expect(h.last().spelling).toBe("unavailable");
  });

  test("answers for text that has since changed are dropped", async () => {
    let answer: (value: Array<string[] | null>) => void = () => {};
    const h = harness("Where wa it?", {
      lookupSpelling: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    await Promise.all([h.session.start(), h.settle()]);
    h.session.notifySourceChanged();
    answer([null, ["was"], null]);
    await h.settle();
    // The old answer never produced a finding for the old text.
    expect(h.states.some((state) => state.diagnostics.some((d) => d.original === "wa"))).toBe(
      false,
    );
  });

  test("words other findings cover, and the user's dictionary, are not looked up; no rules, no check", async () => {
    const fake = fakeLookup();
    const h = harness("teh wa", { lookupSpelling: fake.lookup });
    await Promise.all([h.session.start(), h.settle()]);
    expect(fake.words()).toEqual(["wa"]);
    expect(h.originals()).toEqual(["teh", "wa"]);

    const off = fakeLookup();
    const none = harness("Where wa it?", { lookupSpelling: off.lookup, rules: [] });
    await Promise.all([none.session.start(), none.settle()]);
    expect(none.last().spelling).toBe("off");
    expect(off.calls).toEqual([]);
  });
});
