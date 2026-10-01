import { NativeReviewCache } from "../src/core/domain/grammar/review/nativeReviewCache";
import { REVIEW_DETECTORS } from "../src/core/domain/grammar/review/reviewDetectors";
import { detectReviewDiagnostics } from "../src/core/domain/grammar/review/reviewDiagnostics";
import { describe, expect, test, spyOn } from "bun:test";
import {
  ReviewSession,
  SPELLING_UNKNOWN_PER_PASS,
  SPELLING_WORDS_PER_PASS,
  type ReviewApplyResult,
  type ReviewCapabilities,
  type ReviewSpellingLookup,
  type ReviewTargetPort,
  type ReviewTargetRead,
  type ReviewViewState,
} from "../src/core/application/review/ReviewSession";
import { GRAMMAR_RULE_IDS } from "../src/core/domain/grammar/ruleCatalog";
import { LocalReviewEngine } from "../src/core/application/review/LocalReviewEngine";
import { reviewExplanation } from "../src/core/domain/grammar/review/reviewExplanations";
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
  unread = 0;
  applyCalls: Array<{ edits: ReviewEdit[]; before: string; after: string }> = [];
  /** Forces the next apply result. */
  nextResult: ReviewApplyResult | null = null;

  constructor(public text: string) {}

  read(): ReviewTargetRead {
    if (this.composing) return { ok: false, reason: "composing" };
    return {
      ok: true,
      text: this.text,
      unread: this.unread,
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
    disableReviewRule,
    spellingEnabled,
    rules = ["englishTypoWhitelistCorrection"],
    lookupSpelling,
    uiLanguage,
  }: {
    uiLanguage?: () => string;
    scope?: TextRange | null;
    dictionary?: (word: string) => Promise<boolean>;
    disableReviewRule?: (ruleId: string) => Promise<boolean>;
    spellingEnabled?: boolean;
    rules?: readonly string[];
    lookupSpelling?: ReviewSpellingLookup;
  } = {},
) {
  const editor = new FakeEditor(text);
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const states: ReviewViewState[] = [];
  // In-process detection whose chunk yields are this harness's timers.
  const engine = new LocalReviewEngine(
    () => new Promise<void>((resolve) => timers.push({ callback: resolve, delay: 0 })),
  );
  const session = new ReviewSession({
    target: editor,
    engine,
    options: {
      lang: "en_US",
      enabledRules: rules,
      spellingEnabled,
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
    initialScope: scope,
    uiLanguage,
    onChange: (state) => states.push(state),
    addToDictionary: dictionary,
    disableReviewRule,
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
  return { editor, session, settle, last, originals, states, timers, engine };
}

describe("ReviewSession", () => {
  test("explanations come with the scan, and again (once per key) after a language change", async () => {
    let language = "en";
    const h = harness("teh cat saw teh dog", { uiLanguage: () => language });
    const explain = spyOn(h.engine, "explanations");
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.originals()).toEqual(["teh", "teh"]);
    const typo = (lang: string) => ({
      review_msg_typo: reviewExplanation("review_msg_typo", lang),
    });
    expect(h.last().explanations).toEqual(typo("en"));
    await h.session.refreshExplanations();
    expect(explain).not.toHaveBeenCalled();

    language = "pl";
    await h.session.refreshExplanations();
    expect(explain).toHaveBeenCalledWith(["review_msg_typo"], "pl");
    expect(h.last().explanations).toEqual(typo("pl"));
    // No answer: the shown ones stay.
    language = "de";
    explain.mockImplementationOnce(() => Promise.reject(new Error("worker gone")));
    await h.session.refreshExplanations();
    expect(h.last().explanations).toEqual(typo("pl"));
  });

  test("a language change while a scan runs asks again for its explanations", async () => {
    let language = "en";
    const h = harness("teh cat", { uiLanguage: () => language });
    const scan = h.engine.scan.bind(h.engine);
    const asked: string[] = [];
    h.engine.scan = (request, signal) => {
      asked.push(request.uiLanguage);
      language = "fr";
      return scan(request, signal);
    };
    await Promise.all([h.session.start(), h.settle()]);
    expect(asked).toEqual(["en"]);
    expect(h.last().explanations).toEqual({
      review_msg_typo: reviewExplanation("review_msg_typo", "fr"),
    });
  });

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

  test("Fix all leaves ignored findings and hidden categories alone, and does not count them", async () => {
    // Moved from the planner: the session plans only what it shows.
    // Opt-in "ok" -> "okay" would be one more shown, individual-only finding.
    const rules = GRAMMAR_RULE_IDS.filter((id) => id !== "styleWordChoice");
    const h = harness("teh a teh b , ok", { rules });
    await Promise.all([h.session.start(), h.settle()]);
    const first = h.last().diagnostics.find((d) => d.original === "teh")!;
    h.session.ignore(first.id);
    h.session.setCategory("punctuation", false);
    h.session.setCategory("typography", false);
    expect(h.last().bulk).toMatchObject({ count: 1, deferred: 0 });
    const fixing = h.session.fixAll();
    await h.settle();
    await fixing;
    expect(h.editor.text).toBe("teh a the b , ok");
    expect(h.last().notice).toMatchObject({ kind: "applied", count: 1, deferred: 0 });
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

  test("a lost selection stays stale until closed; it never becomes a whole-field review", async () => {
    const text = "Outside teh selection. Inside teh selection.";
    const start = text.indexOf("Inside");
    const h = harness(text, { scope: { start, end: text.length } });
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.last().diagnostics.map((d) => d.range)).toEqual([{ start: 30, end: 33 }]);
    // Typing at the selection's edge: it can no longer be followed.
    h.editor.text = `${text}!`;
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.last().status).toBe("stale-scope");
    const stale = h.states.length - 1;
    // A composition (a read that fails), then more edits: still stale, nothing listed.
    h.editor.composing = true;
    h.session.notifySourceChanged();
    await h.settle();
    h.editor.composing = false;
    h.session.notifySourceChanged();
    await h.settle();
    h.editor.text = `${text}!!`;
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.last()).toMatchObject({ status: "stale-scope", scopeKind: "selection" });
    expect(h.states.slice(stale).every((state) => state.status === "stale-scope")).toBe(true);
    expect(h.states.some((state) => state.diagnostics.some((d) => d.range.start === 8))).toBe(
      false,
    );
    expect(h.last().bulk.count).toBe(0);
    expect(await h.session.fixAll()).toBeNull();
    expect(h.editor.applyCalls).toEqual([]);
  });

  test("an edit before the first scan finishes still moves the selection with the text", async () => {
    const filler = "Some words here.\n".repeat(300); // more than one scan chunk
    const tail = "Please fix teh typo.";
    const h = harness(filler + tail, {
      scope: { start: filler.length, end: filler.length + tail.length },
    });
    const started = h.session.start();
    // The first scan pauses after its first chunk; the user types at the start meanwhile.
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(h.last().status).toBe("loading");
    const prefix = "INSERTED PREFIX TEXT. ";
    h.editor.text = prefix + h.editor.text;
    h.session.notifySourceChanged();
    await h.settle();
    await started;
    expect(h.last()).toMatchObject({ status: "ready", scopeKind: "selection" });
    const at = prefix.length + filler.length + tail.indexOf("teh");
    expect(h.last().diagnostics.map((d) => d.range)).toEqual([{ start: at, end: at + 3 }]);
  });

  test("a proof that fails leaves its fixes for individual review; Fix all never waits forever", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const text = "yes i dont know. ".repeat(40);
      const h = harness(text, {
        rules: [
          "capitalizeSentenceStart",
          "englishPronounICapitalization",
          "englishContractionNormalization",
        ],
      });
      const started = h.session.start();
      for (let i = 0; i < 200 && h.last().status !== "ready"; i += 1) {
        await Promise.resolve();
        h.timers.shift()?.callback();
      }
      expect(h.last().bulk.pending).toBe(true);
      // The proof's next pause fails (any error, not a newer plan replacing it).
      (h.session as unknown as { pause: () => Promise<void> }).pause = () =>
        Promise.reject(new Error("proof failed"));
      await h.settle();
      await started;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.last().bulk.pending).toBe(false);
      expect(h.last().bulk.deferred).toBeGreaterThan(0);
      // Fix all answers at once, and writes only what was proven (here: nothing).
      const fixing = h.session.fixAll();
      await h.settle();
      expect(await fixing).toBeNull();
      expect(h.editor.text).toBe(text);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("a planner that fails mid-proof batches nothing and leaves every fix for review", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const text = "yes i dont know. ".repeat(40);
      const h = harness(text, {
        rules: [
          "capitalizeSentenceStart",
          "englishPronounICapitalization",
          "englishContractionNormalization",
        ],
      });
      // The planner itself throws when the next proof answer reaches it.
      type ProvePlan = (
        pending: unknown,
        steps: Generator<unknown, unknown, boolean[]>,
        first: unknown,
        prepared: unknown,
      ) => Promise<unknown>;
      const session = h.session as unknown as { provePlan: ProvePlan };
      const provePlan = session.provePlan.bind(h.session);
      session.provePlan = (pending, _steps, first, prepared) => {
        const failing = (function* (): Generator<unknown, unknown, boolean[]> {
          yield first;
          throw new Error("planner failed");
        })();
        failing.next();
        return provePlan(pending, failing, first, prepared);
      };
      await Promise.all([h.session.start(), h.settle()]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const state = h.last();
      expect(state.status).toBe("ready");
      expect(state.diagnostics.length).toBeGreaterThan(0);
      // Nothing was proven: Fix all batches nothing, and every finding is left.
      expect(state.bulk).toEqual({ count: 0, deferred: state.diagnostics.length, pending: false });
      const fixing = h.session.fixAll();
      await h.settle();
      expect(await fixing).toBeNull();
      expect(h.editor.text).toBe(text);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
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

  test("a known word typed with two initial capitals gets one casing fix; unknown ones are left alone", async () => {
    const fake = fakeLookup({ Oauth: ["auth"] });
    const h = harness("LEt’s go! Let us go! We use OAuth and IDs.", {
      lookupSpelling: fake.lookup,
    });
    await Promise.all([h.session.start(), h.settle()]);
    expect(fake.words()).toContain("Let's");
    expect(fake.words()).not.toContain("IDs");
    expect(
      h.last().diagnostics.map((d) => [d.original, d.alternatives.map((a) => a.preview)]),
    ).toEqual([["LEt’s", ["Let’s"]]]);
    expect(h.last().diagnostics[0].messageKey).toBe("review_msg_two_initial_capitals");
  });

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
    expect(finding.alternatives.map((a) => a.preview)).toEqual([
      "was",
      "way",
      "want",
      "water",
      "war",
    ]);
    expect(fake.calls[0]).toContainEqual({ word: "wa", before: "Where " });
    // Never batched, and nothing was written.
    expect(h.last().bulk).toMatchObject({ count: 0, deferred: 1 });
    expect(h.editor.applyCalls).toEqual([]);

    // The user picks the second suggestion.
    await Promise.all([h.session.apply(finding.id, 1), h.settle()]);
    expect(h.editor.text).toBe("Where way it?");
    expect(h.last().diagnostics).toEqual([]);
  });

  test("a known word stays out of review while an unknown word gets Presage's correction", async () => {
    const h = harness("This needed it. This needdeed it.", {
      lookupSpelling: (_lang, words) =>
        Promise.resolve(words.map(({ word }) => (word === "needdeed" ? ["needed"] : null))),
    });
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.last().diagnostics.map((d) => [d.original, d.alternatives[0].preview])).toEqual([
      ["needdeed", "needed"],
    ]);
  });

  test("an unknown regular form of an irregular word offers the irregular form first", async () => {
    const h = harness("They buyed two childs.", {
      lookupSpelling: (_lang, words) =>
        Promise.resolve(
          words.map(({ word }) =>
            word === "buyed" ? ["bayed", "busied"] : word === "childs" ? ["child's"] : null,
          ),
        ),
    });
    await Promise.all([h.session.start(), h.settle()]);
    expect(
      h
        .last()
        .diagnostics.map((d) => [
          d.original,
          d.requiresChoice,
          d.alternatives.map((a) => a.preview),
        ]),
    ).toEqual([
      ["buyed", true, ["bought", "bayed", "busied"]],
      ["childs", true, ["children", "child's"]],
    ]);
    expect(h.last().bulk).toMatchObject({ count: 0, deferred: 2 });
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

  /** `count` different lowercase words: "qba", "qbb", … (letters only, none in the fake dictionary). */
  function distinctWords(count: number, prefix = "q"): string[] {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    return Array.from(
      { length: count },
      (_, i) =>
        `${prefix}${letters[1 + Math.floor(i / 676)]}${letters[Math.floor(i / 26) % 26]}${letters[i % 26]}`,
    );
  }

  test("each different word is looked up once per pass, whatever its contexts", async () => {
    const fake = fakeLookup();
    const contexts = distinctWords(30);
    // "wa" after 30 different words: one lookup, 30 findings.
    const h = harness(contexts.map((word) => `${word} wa`).join(". "), {
      lookupSpelling: fake.lookup,
    });
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.last().spelling).toBe("done");
    expect(fake.words().filter((word) => word === "wa")).toEqual(["wa"]);
    expect(fake.words()).toHaveLength(31);
    expect(h.originals().filter((word) => word === "wa")).toHaveLength(30);
    // The first occurrence's context is the one asked about.
    expect(fake.calls.flat()).toContainEqual({ word: "wa", before: `${contexts[0]} ` });
  });

  test("the check stops at its per-pass limits and says so; a recheck continues", async () => {
    // Unknown words (each gets a close suggestion): the check stops soon after the limit.
    const unknown = distinctWords(SPELLING_UNKNOWN_PER_PASS + 60);
    const asked: string[] = [];
    // Short lines: too few words each to be taken for another language.
    const h = harness(unknown.join(" ").replace(/((?:\S+ ){4}\S+) /g, "$1\n"), {
      lookupSpelling: (_lang, words) => {
        asked.push(...words.map(({ word }) => word));
        return Promise.resolve(words.map(({ word }) => [`${word}s`]));
      },
    });
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.last().spelling).toBe("partial");
    expect(asked.length).toBeGreaterThanOrEqual(SPELLING_UNKNOWN_PER_PASS);
    expect(asked.length).toBeLessThan(SPELLING_UNKNOWN_PER_PASS + 25);
    // In document order: the first words are checked, the rest are not listed.
    expect(asked).toEqual(unknown.slice(0, asked.length));
    expect(h.originals()).toEqual(asked);
    // A recheck asks only for the words not answered yet.
    h.session.notifySourceChanged();
    await h.settle();
    expect(new Set(asked).size).toBe(asked.length);
    expect(asked).toEqual(unknown);
    expect(h.last().spelling).toBe("done");
    expect(h.originals()).toEqual(unknown);

    // Known words: at most SPELLING_WORDS_PER_PASS different ones per pass.
    const known = distinctWords(SPELLING_WORDS_PER_PASS + 30);
    const fake = fakeLookup();
    const many = harness(known.join(" "), { lookupSpelling: fake.lookup });
    await Promise.all([many.session.start(), many.settle()]);
    expect(fake.words()).toEqual(known.slice(0, SPELLING_WORDS_PER_PASS));
    expect(many.last().spelling).toBe("partial");
  });

  test("a shorter answer covers the first words; the rest are asked again", async () => {
    const words = distinctWords(40);
    const asked: string[] = [];
    const h = harness(`${words.join(" ")} wa`, {
      lookupSpelling: (_lang, batch) => {
        // A time-bounded background answers only the first two words of each request.
        const answered = batch.slice(0, 2);
        asked.push(...answered.map(({ word }) => word));
        return Promise.resolve(answered.map(({ word }) => (word === "wa" ? ["was"] : null)));
      },
    });
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.last().spelling).toBe("done");
    expect(asked).toEqual([...words, "wa"]);
    expect(h.originals()).toEqual(["wa"]);
  });

  test("findings are added as answers arrive: each word ranked once, earlier findings kept", async () => {
    // Counts how often the session ranks a word's candidates.
    let ranked = 0;
    class Candidates extends Array<string> {
      override forEach(
        callback: (value: string, index: number, array: string[]) => void,
        thisArg?: unknown,
      ): void {
        ranked += 1;
        super.forEach(callback, thisArg);
      }
    }
    const unknown = distinctWords(60, "z");
    const knownWords = distinctWords(60);
    const lookups: number[] = [];
    const h = harness(unknown.map((word, i) => `${knownWords[i]} ${word}`).join(" "), {
      lookupSpelling: (_lang, words) => {
        lookups.push(words.length);
        return Promise.resolve(
          words.map(({ word }) => (word.startsWith("z") ? Candidates.from([`${word}s`]) : null)),
        );
      },
    });
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.last().spelling).toBe("done");
    expect(h.originals()).toEqual(unknown);
    expect(lookups.length).toBeGreaterThan(3);
    expect(ranked).toBe(unknown.length);
    // A finding shown after an early batch is the same object at the end.
    const early = h.states.find(
      (state) => state.spelling === "checking" && state.diagnostics.length > 0,
    )!;
    expect(early.diagnostics.length).toBeLessThan(unknown.length);
    for (const finding of early.diagnostics) expect(h.last().diagnostics).toContain(finding);
    // Batches of known words alone change nothing and are not shown again.
    const quiet = fakeLookup();
    const plain = harness(distinctWords(120).join(" "), { lookupSpelling: quiet.lookup });
    await Promise.all([plain.session.start(), plain.settle()]);
    expect(quiet.calls.length).toBeGreaterThan(3);
    const spellingStates = plain.states.filter((state) => state.spelling !== "off");
    expect(spellingStates.map((state) => state.spelling)).toEqual(["checking", "done"]);
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

  test("a paragraph in another language gets no spelling findings and is reported; rules still run", async () => {
    const english = new Set(
      "thanks for the notes i will send my reply tonight we got this morning die".split(" "),
    );
    const german =
      "Wir haben die Unterlagen gestern bekommen, aber teh Adresse war leider falsch und wir warten.";
    const h = harness(
      `Thanks for the notes, I will send my reply tonight.\n${german}\nWe got the pakage this morning.`,
      {
        lookupSpelling: (_lang, words) =>
          Promise.resolve(
            words.map(({ word }) => (english.has(word.toLowerCase()) ? null : ["package"])),
          ),
      },
    );
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.last().spelling).toBe("done");
    // The rule finding inside the German paragraph stays; its unknown words are not typos.
    expect(h.originals()).toEqual(["teh", "pakage"]);
    expect(h.last().coverage?.skipped["other-language"]).toBe(german.length);
  });

  test("another language's unknown words do not use up the per-pass limit", async () => {
    const foreign = distinctWords(SPELLING_UNKNOWN_PER_PASS + 50);
    const h = harness(`${foreign.join(" ")}\nWhere wa it?`, {
      lookupSpelling: (_lang, words) =>
        Promise.resolve(
          words.map(({ word }) => (word.startsWith("q") || word === "wa" ? ["was"] : null)),
        ),
    });
    await Promise.all([h.session.start(), h.settle()]);
    expect(h.last().spelling).toBe("done");
    // Marked with the first answers: none of its words was ever listed.
    expect(h.states.flatMap((state) => state.diagnostics.map((d) => d.original))).not.toContain(
      foreign[0],
    );
    expect(h.originals()).toEqual(["wa"]);
    expect(h.last().coverage?.skipped["other-language"]).toBe(foreign.join(" ").length);
  });
});

test("disabling a Review rule invalidates its old batch and keeps unrelated findings", async () => {
  const saved: string[] = [];
  const h = harness("teh cat. I opened the the report.", {
    rules: ["englishTypoWhitelistCorrection", "englishRepeatedWords"],
    disableReviewRule: async (id) => {
      saved.push(id);
      return true;
    },
  });
  await Promise.all([h.session.start(), h.settle()]);
  const old = h.last().diagnostics.find((d) => d.ruleId === "englishTypoWhitelistCorrection")!;
  await h.session.disableReviewRule(old.id);
  expect(h.last().status).toBe("updating");
  await h.session.fixAll();
  expect(h.editor.applyCalls).toHaveLength(0);
  await h.settle();
  expect(saved).toEqual(["englishTypoWhitelistCorrection"]);
  expect(h.last().diagnostics.map((d) => d.ruleId)).toEqual(["englishRepeatedWords"]);
  await h.session.apply(old.id, 0);
  expect(h.editor.applyCalls).toHaveLength(0);
  expect(h.editor.text).toBe("teh cat. I opened the the report.");
  h.session.close();
});

test("a failed Review preference write retains findings and reports failure", async () => {
  const h = harness("teh cat", {
    disableReviewRule: async () => {
      throw new Error("storage unavailable");
    },
  });
  await Promise.all([h.session.start(), h.settle()]);
  await h.session.disableReviewRule(h.last().diagnostics[0].id);
  expect(h.originals()).toEqual(["teh"]);
  expect(h.last().notice).toEqual({ kind: "rule-setting-failed" });
  h.session.close();
});

test("Review settings broadcasts cancel in-progress scans in multiple sessions", async () => {
  const sessions = [harness("teh cat.\n".repeat(1200)), harness("teh dog.\n".repeat(1200))];
  const starts = sessions.map((h) => h.session.start());
  for (let i = 0; i < 5; i++) await Promise.resolve();
  for (const h of sessions) {
    expect(h.last().status).toBe("loading");
    h.session.updateOptions({
      lang: "en_US",
      enabledRules: [],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    });
  }
  await Promise.all(sessions.map((h) => h.settle()));
  await Promise.all(starts);
  for (const h of sessions) {
    expect(h.last().diagnostics).toEqual([]);
    expect(h.last().noRules).toBe(true);
    expect(h.editor.applyCalls).toHaveLength(0);
    h.session.close();
  }
});

test("disabling all native checks preserves explicit spelling and offers no AI or spelling disable action", async () => {
  const calls: string[] = [];
  const h = harness("wa", {
    rules: [],
    spellingEnabled: true,
    lookupSpelling: async (_lang, words) => words.map(() => ["was"]),
    disableReviewRule: async (id) => {
      calls.push(id);
      return true;
    },
  });
  await Promise.all([h.session.start(), h.settle()]);
  expect(h.last().noRules).toBe(false);
  expect(h.last().diagnostics[0].ruleId).toBe("reviewSpelling");
  await h.session.disableReviewRule(h.last().diagnostics[0].id);
  expect(calls).toEqual([]);
  expect(h.last().diagnostics).toHaveLength(1);
  h.session.close();
});

test("missing-to insertion rechecks and leaves no stale verb-complement finding", async () => {
  const h = harness("We need fix this bug. I look forward to meet you.", {
    rules: ["englishVerbComplements"],
  });
  await Promise.all([h.session.start(), h.settle()]);
  const first = h.last().diagnostics[0];
  const pending = h.session.apply(first.id);
  await h.settle();
  expect(await pending).toEqual({ status: "applied" });
  expect(h.editor.text).toBe("We need to fix this bug. I look forward to meet you.");
  expect(h.editor.applyCalls[0].edits).toEqual([
    { start: 8, end: 9, original: "f", replacement: "to f" },
  ]);
  expect(h.originals()).toEqual(["meet"]);
  await h.session.apply(first.id);
  expect(h.editor.applyCalls).toHaveLength(1);
  expect(h.last().bulk.count).toBe(0);
});

test("degree deletion rechecks then-than and refuses the previous diagnostic id", async () => {
  const h = harness("The result is more better then the old result.", {
    rules: ["englishDoubledDegree", "englishThenThan"],
  });
  await Promise.all([h.session.start(), h.settle()]);
  expect(h.last().diagnostics).toHaveLength(1);
  const degree = h.last().diagnostics[0];
  expect(degree.ruleId).toBe("englishDoubledDegree");
  const applying = h.session.apply(degree.id);
  await h.settle();
  expect(await applying).toEqual({ status: "applied" });
  expect(h.editor.text).toBe("The result is better then the old result.");
  expect(h.last().diagnostics).toHaveLength(1);
  const than = h.last().diagnostics[0];
  expect(than.ruleId).toBe("englishThenThan");
  expect(than.original).toBe("then");
  expect(than.id).not.toBe(degree.id);
  await h.session.apply(degree.id);
  expect(h.editor.applyCalls).toHaveLength(1);
  expect(h.last().bulk.count).toBe(0);
  const second = h.session.apply(than.id);
  await h.settle();
  expect(await second).toEqual({ status: "applied" });
  expect(h.editor.text).toBe("The result is better than the old result.");
  expect(h.last().diagnostics).toEqual([]);
  h.session.close();
});

const matchingPrefix = "Plain context. ".repeat(9);
const repeatedPair = `${matchingPrefix}the the cat. `;
async function matchingHarness() {
  const h = harness(repeatedPair + repeatedPair + `${matchingPrefix}a a cat.`, {
    rules: ["englishRepeatedWords"],
  });
  await Promise.all([h.session.start(), h.settle()]);
  return h;
}

test("matching ignores use evidence and alternatives, reset restores current occurrences", async () => {
  const h = await matchingHarness();
  expect(h.last().diagnostics).toHaveLength(3);
  h.session.ignoreMatching(h.last().diagnostics[0].id);
  expect(h.originals()).toEqual(["a a"]);
  expect(h.last().ignoredCount).toBe(2);
  expect(h.last().selectedId).toBeNull();
  expect(h.editor.applyCalls).toEqual([]);
  h.session.resetIgnores();
  expect(h.last().ignoredCount).toBe(0);
  expect(h.last().diagnostics).toHaveLength(3);
  h.session.close();
});

test("a matching ignore that races a settings recheck still applies", async () => {
  const h = await matchingHarness();
  const id = h.last().diagnostics[0].id;
  h.session.notifySourceChanged(); // a settings broadcast: same text, recheck pending
  h.session.ignoreMatching(id);
  expect(h.last().ignoredCount).toBe(2);
  await h.settle();
  expect(h.originals()).toEqual(["a a"]);
  expect(h.last().ignoredCount).toBe(2);
  h.session.resetIgnores();
  expect(h.last().ignoredCount).toBe(0);
  h.session.close();
});

test("a matching ignore is refused once the shown findings no longer match the text", async () => {
  const h = await matchingHarness();
  const id = h.last().diagnostics[0].id;
  h.editor.text = "New introduction. " + h.editor.text;
  h.session.notifySourceChanged();
  await h.settle();
  h.editor.text = "More. " + h.editor.text;
  h.session.notifySourceChanged();
  h.session.ignoreMatching(id); // stale id from an older text: nothing to ignore
  expect(h.last().ignoredCount).toBe(0);
  h.session.close();
});

test("matching ignores survive insertion before unchanged evidence", async () => {
  const h = await matchingHarness();
  h.session.ignoreMatching(h.last().diagnostics[0].id);
  h.editor.text = "New introduction. " + h.editor.text;
  h.session.notifySourceChanged();
  await h.settle();
  expect(h.originals()).toEqual(["a a"]);
  expect(h.last().ignoredCount).toBe(2);
  h.session.close();
});

test("changes inside ignored evidence release only the changed occurrence", async () => {
  const h = await matchingHarness();
  h.session.ignoreMatching(h.last().diagnostics[0].id);
  const pos = matchingPrefix.length - 15;
  h.editor.text = h.editor.text.slice(0, pos) + "Fresh" + h.editor.text.slice(pos + 5);
  h.session.notifySourceChanged();
  await h.settle();
  expect(h.originals()).toEqual(["the the", "a a"]);
  expect(h.last().ignoredCount).toBe(1);
  h.session.close();
});

test("deletion and reinsertion do not resurrect a matching ignore", async () => {
  const h = await matchingHarness();
  const source = h.editor.text;
  const range = h.last().diagnostics[0].range;
  h.session.ignoreMatching(h.last().diagnostics[0].id);
  h.editor.text = source.slice(0, range.start) + source.slice(range.end);
  h.session.notifySourceChanged();
  await h.settle();
  h.editor.text = source;
  h.session.notifySourceChanged();
  await h.settle();
  expect(h.originals()).toEqual(["the the", "a a"]);
  expect(h.last().ignoredCount).toBe(1);
  h.session.close();
});

test("protection changes invalidate matching suppression permanently", async () => {
  const h = await matchingHarness();
  const range = h.last().diagnostics[0].range;
  h.session.ignoreMatching(h.last().diagnostics[0].id);
  h.editor.protectedRanges = [{ ...range, reason: "code" }];
  h.session.notifySourceChanged();
  await h.settle();
  expect(h.last().ignoredCount).toBe(1);
  h.editor.protectedRanges = [];
  h.session.notifySourceChanged();
  await h.settle();
  expect(h.originals()).toEqual(["the the", "a a"]);
  expect(h.last().ignoredCount).toBe(1);
  h.session.close();
});

test("matching ignores affect filters and batch plans without changing dictionary or settings", async () => {
  let dictionaryWrites = 0;
  let settingWrites = 0;
  const h = harness("teh cat and teh dog. recieve it.", {
    rules: ["englishTypoWhitelistCorrection"],
    dictionary: async () => {
      dictionaryWrites++;
      return true;
    },
    disableReviewRule: async () => {
      settingWrites++;
      return true;
    },
  });
  await Promise.all([h.session.start(), h.settle()]);
  expect(h.last().bulk.count).toBe(3);
  h.session.ignoreMatching(h.last().diagnostics[0].id);
  await h.settle();
  expect(h.originals()).toEqual(["recieve"]);
  expect(h.last().bulk.count).toBe(1);
  h.session.setCategory("spelling", false);
  expect(h.originals()).toEqual([]);
  expect(h.last().ignoredCount).toBe(2);
  h.session.resetIgnores();
  h.session.setCategory("spelling", true);
  await h.settle();
  expect(h.last().bulk.count).toBe(3);
  expect(dictionaryWrites).toBe(0);
  expect(settingWrites).toBe(0);
  h.session.close();
});

test("closing and another editor never retain matching exceptions", async () => {
  const h = await matchingHarness();
  h.session.ignoreMatching(h.last().diagnostics[0].id);
  const other = await matchingHarness();
  expect(other.last().diagnostics).toHaveLength(3);
  h.session.close();
  expect(h.last().ignoredCount).toBe(0);
  const reopened = await matchingHarness();
  expect(reopened.last().diagnostics).toHaveLength(3);
  other.session.close();
  reopened.session.close();
});

test("same source word in a different then-than context is not suppressed", async () => {
  const h = harness(
    "This is better then the old model. That was faster then the previous version. Then we left.",
    { rules: ["englishThenThan"] },
  );
  await Promise.all([h.session.start(), h.settle()]);
  expect(h.last().diagnostics).toHaveLength(2);
  h.session.ignoreMatching(h.last().diagnostics[0].id);
  expect(h.last().diagnostics).toHaveLength(1);
  expect(h.last().ignoredCount).toBe(1);
  h.session.close();
});

test("matching ignores remap through verified edits and do not learn new occurrences", async () => {
  const h = harness("teh introduction. " + repeatedPair + repeatedPair, {
    rules: ["englishRepeatedWords", "englishTypoWhitelistCorrection"],
  });
  await Promise.all([h.session.start(), h.settle()]);
  const repeated = h.last().diagnostics.find((d) => d.ruleId === "englishRepeatedWords")!;
  h.session.ignoreMatching(repeated.id);
  const fixing = h.session.apply(h.last().diagnostics[0].id);
  await h.settle();
  expect(await fixing).toEqual({ status: "applied" });
  expect(h.last().ignoredCount).toBe(2);
  expect(h.originals()).toEqual([]);
  // A distinct ending makes this insertion unambiguous to the native snapshot diff.
  h.editor.text += "\nNew section.\n" + repeatedPair + "New ending.";
  h.session.notifySourceChanged();
  await h.settle();
  expect(h.originals()).toEqual(["the the"]);
  expect(h.last().ignoredCount).toBe(2);
  h.session.close();
});

test("ignore once and matching ignores reset together without changing another rule", async () => {
  const h = await matchingHarness();
  h.session.ignore(h.last().diagnostics[2].id);
  h.session.ignoreMatching(h.last().diagnostics[0].id);
  expect(h.last().ignoredCount).toBe(3);
  h.session.resetIgnores();
  expect(h.last().diagnostics).toHaveLength(3);
  expect(h.last().ignoredCount).toBe(0);
  h.session.close();
});

test("ambiguous duplicate insertion releases matching ignores rather than guessing positions", async () => {
  const h = harness(repeatedPair + repeatedPair, { rules: ["englishRepeatedWords"] });
  await Promise.all([h.session.start(), h.settle()]);
  h.session.ignoreMatching(h.last().diagnostics[0].id);
  h.editor.text += repeatedPair;
  h.session.notifySourceChanged();
  await h.settle();
  expect(h.last().ignoredCount).toBe(0);
  expect(h.last().diagnostics).toHaveLength(3);
  h.session.close();
});

test("quotation warnings filter, ignore and recheck without any write path", async () => {
  const h = harness("He wrote, “The build is ready.", { rules: ["unclosedQuotation"] });
  await Promise.all([h.session.start(), h.settle()]);
  const d = h.last().diagnostics[0];
  expect(d.warningOnly).toBe(true);
  expect(h.last().bulk.count).toBe(0);
  expect(await h.session.apply(d.id)).toBeNull();
  expect(await h.session.fixAll()).toBeNull();
  expect(h.editor.applyCalls).toEqual([]);
  h.session.setCategory("punctuation", false);
  expect(h.originals()).toEqual([]);
  h.session.setCategory("punctuation", true);
  expect(h.originals()).toEqual(["“"]);
  h.session.ignore(d.id);
  expect(h.originals()).toEqual([]);
  h.session.resetIgnores();
  await h.settle();
  expect(h.originals()).toEqual(["“"]);
  h.editor.text += "”";
  h.session.notifySourceChanged();
  await h.settle();
  expect(h.originals()).toEqual([]);
  expect(h.editor.applyCalls).toEqual([]);
  h.session.close();
});

test("unread adapter content suppresses quotation warnings", async () => {
  const h = harness("He wrote, “The build is ready.", { rules: ["unclosedQuotation"] });
  h.editor.unread = 100;
  await Promise.all([h.session.start(), h.settle()]);
  expect(h.last().unread).toBe(100);
  expect(h.originals()).toEqual([]);
  h.session.close();
});

test("preferred terminology config changes invalidate Review but identical broadcasts do not", async () => {
  const h = harness("Plain text.", { rules: [] });
  await Promise.all([h.session.start(), h.settle()]);
  const options = {
    lang: "en_US",
    enabledRules: [],
    userDictionary: [],
    insertSpaceAfterAutocomplete: true,
    preferredTerminology: { version: 1 as const, enabled: false, entries: [] },
  };
  h.session.updateOptions(options);
  await h.settle();
  const count = h.states.length;
  h.session.updateOptions(structuredClone(options));
  await h.settle();
  expect(h.states).toHaveLength(count);
  h.session.updateOptions({
    ...options,
    preferredTerminology: { ...options.preferredTerminology, enabled: true },
  });
  expect(h.states.length).toBeGreaterThan(count);
  await h.settle();
  expect(h.editor.applyCalls).toEqual([]);
  h.session.close();
});

test("removing a preferred term rechecks immediately and restores native ownership", async () => {
  const h = harness("We use Acme Suite.", { rules: ["preferredTerminology"] });
  const opts = {
    lang: "en_US",
    enabledRules: ["preferredTerminology"],
    userDictionary: [],
    insertSpaceAfterAutocomplete: true,
    preferredTerminology: {
      version: 1 as const,
      enabled: true,
      entries: [
        {
          id: "acme",
          source: "Acme Suite",
          replacement: "Acme Workspace",
          casePolicy: "exact" as const,
          explanation: "Our preferred name.",
          language: "en_US",
          scope: "all-prose" as const,
          enabled: true,
        },
      ],
    },
  };
  h.session.updateOptions(opts);
  await Promise.all([h.session.start(), h.settle()]);
  expect(h.last().diagnostics[0].terminology?.id).toBe("acme");
  expect(h.last().bulk.count).toBe(0);
  h.session.updateOptions({
    ...opts,
    preferredTerminology: { ...opts.preferredTerminology, entries: [] },
  });
  await h.settle();
  expect(h.last().diagnostics).toEqual([]);
  expect(h.editor.text).toBe("We use Acme Suite.");
  expect(h.editor.applyCalls).toEqual([]);
  h.session.close();
});

test("long Review rechecks reuse native phrases and invalidate structure, settings and fences", async () => {
  const text = Array.from(
    { length: 120 },
    (_, i) => `We discussed about the plan. They are one in the same. Record ${i}.\n\n`,
  ).join("");
  const rules = ["englishFixedPrepositions", "englishUsagePhrases"];
  const h = harness(text, { rules });
  const detector = REVIEW_DETECTORS.find((d) => d.rules[0] === rules[0])!;
  const spy = spyOn(detector, "detect");
  try {
    await Promise.all([h.session.start(), h.settle()]);
    const firstCalls = spy.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(1);
    spy.mockClear();
    h.editor.text = text.replace("Record 3.", "Record 4.");
    h.session.notifySourceChanged();
    await h.settle();
    const reusedCalls = spy.mock.calls.length;
    expect(reusedCalls).toBeLessThan(firstCalls);
    expect(reusedCalls).toBeGreaterThan(0);
    const id = h.last().diagnostics[0].id.split("/")[0];
    const full = detectReviewDiagnostics(
      {
        id,
        text: h.editor.text,
        scope: { start: 0, end: h.editor.text.length },
        protectedRanges: [],
      },
      {
        lang: "en_US",
        enabledRules: rules,
        userDictionary: [],
        insertSpaceAfterAutocomplete: true,
      },
    );
    expect(h.last().diagnostics).toEqual(full.diagnostics);
    const originalRead = h.editor.read.bind(h.editor);
    const readSpy = spyOn(h.editor, "read").mockImplementation(() => {
      const read = originalRead();
      return read.ok ? { ...read, signature: read.signature + "structure" } : read;
    });
    spy.mockClear();
    h.session.notifySourceChanged();
    await h.settle();
    expect(spy.mock.calls.length).toBe(firstCalls);
    readSpy.mockRestore();
    h.session.updateOptions({
      lang: "en_US",
      enabledRules: rules,
      userDictionary: ["discussed", "same"],
      insertSpaceAfterAutocomplete: true,
    });
    await h.settle();
    expect(h.last().diagnostics).toEqual([]);
    h.session.updateOptions({
      lang: "en_US",
      enabledRules: rules,
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    });
    await h.settle();
    expect(h.last().diagnostics.length).toBeGreaterThan(0);
    h.editor.text = "```\n" + h.editor.text;
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.last().diagnostics).toEqual([]);
  } finally {
    h.session.close();
    spy.mockRestore();
  }
});

test("closing a yielded native recheck releases cache and cancels remaining detector calls", async () => {
  const h = harness("We discussed about the plan.\n\n".repeat(400), {
    rules: ["englishFixedPrepositions"],
  });
  const detector = REVIEW_DETECTORS.find((d) => d.rules[0] === "englishFixedPrepositions")!;
  const spy = spyOn(detector, "detect");
  const clear = spyOn(NativeReviewCache.prototype, "clear");
  try {
    const started = h.session.start();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    const calls = spy.mock.calls.length;
    const cleared = clear.mock.calls.length;
    h.session.close();
    expect(clear.mock.calls.length).toBe(cleared + 1);
    await h.settle();
    await started;
    expect(spy.mock.calls.length).toBe(calls);
    expect(h.last().status).toBe("closed");
    expect(h.states.some((s) => s.status === "ready")).toBe(false);
  } finally {
    spy.mockRestore();
    clear.mockRestore();
  }
});

test("style Apply and ignores stay separate from resolved and ignored errors", async () => {
  const h = harness("Use your PIN number.", { rules: ["styleRedundancy"] });
  await Promise.all([h.session.start(), h.settle()]);
  h.session.ignore(h.last().diagnostics[0].id);
  expect(h.last().ignoredCount).toBe(0);
  expect(h.last().ignoredAdviceCount).toBe(1);
  h.session.resetIgnores();
  const applied = h.session.apply(h.last().diagnostics[0].id);
  await h.settle();
  await applied;
  expect(h.editor.text).toBe("Use your PIN.");
  expect(h.last().resolvedCount).toBe(0);
  expect(h.last().notice).toEqual({ kind: "advice-applied" });
  h.session.close();
});

test("readability advice does not hide spelling and cannot be applied", async () => {
  const words: string[] = [];
  const text =
    "The team reviewed every part of the detailed proposal and carefully considered all of the important information before making any decision about the next stage of the project because there were still several questions about the mispelt word.";
  const h = harness(text, {
    rules: ["styleLongSentence"],
    spellingEnabled: true,
    lookupSpelling: async (_lang, batch) => {
      words.push(...batch.map((item) => item.word));
      return batch.map((item) => (item.word === "mispelt" ? ["misspelt"] : null));
    },
  });
  await Promise.all([h.session.start(), h.settle()]);
  expect(words).toContain("mispelt");
  const warning = h.last().diagnostics.find((d) => d.ruleId === "styleLongSentence")!;
  expect(warning.warningOnly).toBe(true);
  expect(h.last().diagnostics.some((d) => d.ruleId === "reviewSpelling")).toBe(true);
  expect(await h.session.apply(warning.id)).toBeNull();
  expect(h.editor.applyCalls).toEqual([]);
  h.session.close();
});

test("an engine that does not answer shows the error state; the next edit asks again", async () => {
  const h = harness("teh cat");
  // The background worker could not be reached (or failed): no answer.
  const scan = spyOn(h.engine, "scan").mockImplementationOnce(() =>
    Promise.reject(new Error("Review engine request failed: no answer")),
  );
  await Promise.all([h.session.start(), h.settle()]);
  expect(h.last().status).toBe("error");
  h.session.notifySourceChanged();
  await h.settle();
  expect(h.last().status).toBe("ready");
  expect(h.originals()).toEqual(["teh"]);
  expect(scan).toHaveBeenCalledTimes(2);
  h.session.close();
});

test("an edit or close cancels the engine's scan in flight, and close releases the engine", async () => {
  const h = harness("We discussed about the plan.\n\n".repeat(400), {
    rules: ["englishFixedPrepositions"],
  });
  const signals: AbortSignal[] = [];
  const scan = h.engine.scan.bind(h.engine);
  spyOn(h.engine, "scan").mockImplementation((request, signal) => {
    signals.push(signal!);
    return scan(request, signal);
  });
  const release = spyOn(h.engine, "release");
  const started = h.session.start();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(signals).toHaveLength(1);
  h.session.notifySourceChanged();
  expect(signals[0].aborted).toBe(true);
  h.timers.find((timer) => timer.delay === 400)!.callback();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(signals).toHaveLength(2);
  h.session.close();
  expect(signals[1].aborted).toBe(true);
  expect(release).toHaveBeenCalledTimes(1);
  await h.settle();
  await started;
  expect(h.states.some((s) => s.status === "ready")).toBe(false);
});
