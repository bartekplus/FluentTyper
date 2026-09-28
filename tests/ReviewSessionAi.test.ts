import { describe, expect, test } from "bun:test";
import {
  ReviewSession,
  type ReviewApplyResult,
  type ReviewCapabilities,
  type ReviewSessionDependencies,
  type ReviewTargetPort,
  type ReviewTargetRead,
  type ReviewViewState,
} from "../src/core/application/review/ReviewSession";
import {
  conflictFreeFindings,
  reviewAiAvailability,
  sameChange,
  type ReviewAiProvider,
} from "../src/core/application/review/reviewAi";
import type { LocalAiStatus } from "../src/core/domain/contracts/localAi";
import { AI_PROMPT_VERSION } from "../src/core/domain/grammar/review/ai/prompts";
import type {
  AiGenerationOutcome,
  AiGenerationRequest,
} from "../src/core/domain/grammar/review/ai/types";
import {
  REVIEW_LOCAL_AI_CHECK,
  type ProtectedRange,
  type ReviewDiagnostic,
  type ReviewEdit,
} from "../src/core/domain/grammar/review/types";

const AI_DELAY = 1500;

class FakeEditor implements ReviewTargetPort {
  capabilities: ReviewCapabilities = { inline: true, apply: true, bulk: true, undo: "single-step" };
  protectedRanges: ProtectedRange[] = [];
  applyCalls: Array<{ edits: ReviewEdit[]; before: string; after: string }> = [];
  nextResult: ReviewApplyResult | null = null;

  constructor(public text: string) {}

  read(): ReviewTargetRead {
    return {
      ok: true,
      text: this.text,
      protectedRanges: this.protectedRanges,
      signature: JSON.stringify(this.protectedRanges),
    };
  }

  apply(request: { edits: ReviewEdit[]; before: string; after: string; signature: string }) {
    this.applyCalls.push(request);
    if (this.nextResult) return Promise.resolve(this.nextResult);
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

function status(overrides: Partial<LocalAiStatus> = {}): LocalAiStatus {
  return {
    enabled: true,
    consented: true,
    tier: "standard",
    modelId: "model-a",
    displayName: "Standard",
    downloadBytes: 1,
    install: "complete",
    runtime: "ready",
    offerSetup: false,
    ...overrides,
  };
}

interface FakeRequest {
  request: AiGenerationRequest;
  signal: AbortSignal;
  answer(outcome?: AiGenerationOutcome): void;
}

/** Scriptable provider: answers at once (`auto`) or when released; records aborts. */
class FakeAi implements ReviewAiProvider {
  current = status();
  auto = true;
  /** Honours abort by answering "cancelled" (a real runtime settles after the cancel). */
  honorAbort = true;
  requests: FakeRequest[] = [];
  aborted = 0;
  setupOpened = 0;
  offerDismissed = 0;
  disposed = false;
  /** Per segment, the model's text: default fixes "She go" and "They goes" only. */
  fix = (text: string, _request: AiGenerationRequest) =>
    text.replace("She go ", "She goes ").replace("They goes ", "They go ");
  outcome: ((request: AiGenerationRequest, index: number) => AiGenerationOutcome) | null = null;
  private readonly listeners = new Set<(status: LocalAiStatus) => void>();

  status(): Promise<LocalAiStatus> {
    return Promise.resolve(this.current);
  }

  onStatus(listener: (status: LocalAiStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  push(next: Partial<LocalAiStatus>): void {
    this.current = status(next);
    for (const listener of this.listeners) listener(this.current);
  }

  answerFor(request: AiGenerationRequest, index: number): AiGenerationOutcome {
    return (
      this.outcome?.(request, index) ?? {
        ok: true,
        segments: request.segments.map(({ id, text }) => ({ id, text: this.fix(text, request) })),
      }
    );
  }

  generate(request: AiGenerationRequest, signal: AbortSignal) {
    const index = this.requests.length;
    return new Promise<{ outcome: AiGenerationOutcome; modelId: string; promptVersion: string }>(
      (resolve) => {
        let done = false;
        const answer = (outcome = this.answerFor(request, index)) => {
          if (done) return;
          done = true;
          resolve({ outcome, modelId: this.current.modelId, promptVersion: AI_PROMPT_VERSION });
        };
        signal.addEventListener("abort", () => {
          if (done) return;
          this.aborted += 1;
          if (this.honorAbort) answer({ ok: false, error: "cancelled" });
        });
        this.requests.push({ request, signal, answer });
        if (this.auto) answer();
      },
    );
  }

  openSetup(): void {
    this.setupOpened += 1;
  }

  dismissSetupOffer(): void {
    this.offerDismissed += 1;
  }

  dispose(): void {
    this.disposed = true;
  }
}

function harness(
  text: string,
  {
    ai = new FakeAi() as FakeAi | null,
    deps = {} as Partial<Pick<ReviewSessionDependencies, "addToDictionary" | "lookupSpelling">>,
  } = {},
) {
  const editor = new FakeEditor(text);
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const states: ReviewViewState[] = [];
  const session = new ReviewSession({
    target: editor,
    options: {
      lang: "en_US",
      enabledRules: ["englishTypoWhitelistCorrection"],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
    initialScope: null,
    onChange: (state) => states.push(state),
    ai: ai ?? undefined,
    aiRecheckDelayMs: AI_DELAY,
    ...deps,
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
  /** Runs queued timers until idle; the AI pause only when `ai` is set. */
  const settle = async ({ aiDelay = true } = {}) => {
    for (let round = 0; round < 1000; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const index = timers.findIndex((timer) => aiDelay || timer.delay !== AI_DELAY);
      if (index < 0) return;
      const [timer] = timers.splice(index, 1);
      timer.callback();
    }
  };
  const last = () => states.at(-1)!;
  const aiFindings = () => last().diagnostics.filter((d) => d.ruleId === REVIEW_LOCAL_AI_CHECK);
  const start = async () => {
    await Promise.all([session.start(), settle()]);
  };
  return { editor, session, settle, last, aiFindings, states, timers, start, ai: ai! };
}

const TEXT = "We saw teh cat. She go home now.";

describe("ReviewSession with Local AI: Correct", () => {
  test("rule findings are shown first; AI findings join when the model answers", async () => {
    const h = harness(TEXT);
    h.ai.auto = false;
    await h.start();
    expect(h.last().status).toBe("ready");
    expect(h.last().diagnostics.map((d) => d.original)).toEqual(["teh"]);
    expect(h.last().ai.availability).toBe("ready");
    expect(h.last().ai.coverage).toBe("checking");
    expect(h.ai.requests).toHaveLength(1);
    // Nothing identifying the page or offsets crosses the transport.
    expect(Object.keys(h.ai.requests[0].request).sort()).toEqual([
      "contextAfter",
      "contextBefore",
      "lang",
      "mode",
      "segments",
      "style",
    ]);

    h.ai.requests[0].answer();
    await h.settle();
    expect(h.aiFindings().map((d) => d.original)).toEqual(["go"]);
    expect(h.last().diagnostics.map((d) => d.ruleId === REVIEW_LOCAL_AI_CHECK)).toEqual([
      false,
      true,
    ]);
    expect(h.last().ai.coverage).toBe("complete");
    expect(h.last().ai.findings).toBe(1);
    expect(h.last().ai.checkedChars).toBe(h.last().ai.eligibleChars);
    expect(h.editor.applyCalls).toEqual([]);
  });

  test("an AI failure keeps the rule findings and reports failed coverage", async () => {
    const h = harness(TEXT);
    h.ai.outcome = () => ({ ok: false, error: "engine-failed" });
    await h.start();
    expect(h.last().diagnostics.map((d) => d.original)).toEqual(["teh"]);
    expect(h.last().ai.coverage).toBe("failed");
    expect(h.last().ai.failure).toBe("engine-failed");
    expect(h.last().bulk.count).toBe(1);
  });

  test("the same change as a rule finding is shown once, as the rule's", async () => {
    const h = harness(TEXT);
    h.ai.fix = (text) => text.replace("teh", "the");
    await h.start();
    expect(h.last().diagnostics).toHaveLength(1);
    expect(h.last().diagnostics[0].ruleId).toBe("englishTypoWhitelistCorrection");
    expect(h.last().ai.coverage).toBe("complete");
  });

  test("AI findings never enter Fix all, and are counted as left for review", async () => {
    const h = harness(TEXT);
    await h.start();
    expect(h.aiFindings()).toHaveLength(1);
    expect(h.last().bulk).toEqual({ count: 1, deferred: 1, pending: false });
    const fixing = h.session.fixAll();
    await h.settle();
    expect(await fixing).toEqual({ status: "applied" });
    expect(h.editor.text).toBe("We saw the cat. She go home now.");
    expect(h.last().notice).toEqual({ kind: "applied", count: 1, deferred: 1 });
  });

  test("an AI finding can be ignored and applied one at a time", async () => {
    const h = harness("We saw teh cat. She go home now. They goes there too.");
    await h.start();
    const [first, second] = h.aiFindings();
    h.session.ignore(first.id);
    expect(h.aiFindings().map((d) => d.id)).toEqual([second.id]);
    expect(h.last().ignoredCount).toBe(1);
    const applying = h.session.apply(second.id);
    await h.settle();
    expect(await applying).toEqual({ status: "applied" });
    expect(h.editor.text).toBe("We saw teh cat. She go home now. They go there too.");
  });

  test("typing during generation drops the answer; the pass restarts after the AI pause", async () => {
    const h = harness(TEXT);
    h.ai.auto = false;
    h.ai.honorAbort = false;
    await h.start();
    const stale = h.ai.requests[0];
    h.editor.text = "We saw teh cat. She go to school.";
    h.session.notifySourceChanged();
    expect(stale.signal.aborted).toBe(true);
    expect(h.last().ai.coverage).toBe("waiting");
    // The rule recheck runs; the model waits for its longer pause.
    await h.settle({ aiDelay: false });
    expect(h.last().diagnostics.map((d) => d.original)).toEqual(["teh"]);
    expect(h.last().ai.coverage).toBe("waiting");
    expect(h.ai.requests).toHaveLength(1);
    expect(h.timers.map((timer) => timer.delay)).toEqual([AI_DELAY]);
    // The late answer for the old text changes nothing.
    stale.answer();
    await h.settle({ aiDelay: false });
    expect(h.aiFindings()).toEqual([]);
    await h.settle();
    expect(h.ai.requests).toHaveLength(2);
    expect(h.ai.requests[1].request.segments.map((s) => s.text).join(" ")).toContain("school");
    h.ai.requests[1].answer();
    await h.settle();
    expect(h.aiFindings().map((d) => d.original)).toEqual(["go"]);
    expect(h.aiFindings()[0].range.start).toBe(TEXT.indexOf("go"));
  });

  test("a late answer after close emits nothing and resurrects nothing", async () => {
    const h = harness(TEXT);
    h.ai.auto = false;
    h.ai.honorAbort = false;
    await h.start();
    h.session.close();
    expect(h.ai.requests[0].signal.aborted).toBe(true);
    const emitted = h.states.length;
    h.ai.requests[0].answer();
    h.ai.push({ modelId: "model-b" });
    await h.settle();
    expect(h.states.length).toBe(emitted);
    expect(h.last().status).toBe("closed");
    expect(h.last().diagnostics).toEqual([]);
  });

  test("answers are reused only for identical requests", async () => {
    const h = harness(TEXT);
    await h.start();
    expect(h.ai.requests).toHaveLength(1);
    // Same text again (an unrelated mutation): the answer is reused, nothing is sent.
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.ai.requests).toHaveLength(1);
    expect(h.aiFindings().map((d) => d.original)).toEqual(["go"]);
    expect(h.last().ai.coverage).toBe("complete");
    // Changed text: asked again.
    h.editor.text = "We saw teh cat. She go home today.";
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.ai.requests).toHaveLength(2);
    // Another model: its own answers.
    h.ai.push({ modelId: "model-b" });
    await h.settle();
    expect(h.ai.requests).toHaveLength(3);
  });

  test("pause stops the pass and keeps what was shown; resume finishes it", async () => {
    const h = harness("She go home now.\n\nThey goes there too. " + "Fine words here. ".repeat(80));
    h.ai.auto = false;
    await h.start();
    expect(h.ai.requests.length).toBeGreaterThan(0);
    h.ai.requests[0].answer();
    await h.settle();
    const shown = h.aiFindings().length;
    h.session.setAiPaused(true);
    expect(h.last().ai.availability).toBe("paused");
    expect(h.ai.aborted).toBeGreaterThan(0);
    expect(h.aiFindings().length).toBe(shown);
    const coverage = h.last().ai.coverage;
    expect(coverage === "cancelled" || coverage === "complete").toBe(true);
    const sent = h.ai.requests.length;
    h.ai.auto = true;
    h.session.setAiPaused(false);
    await h.settle();
    expect(h.last().ai.availability).toBe("ready");
    expect(h.last().ai.coverage === "complete" || h.last().ai.coverage === "partial").toBe(true);
    // The answered chunk came from this review's cache; only the rest were sent again.
    expect(h.ai.requests.slice(sent).map((r) => r.request)).not.toContainEqual(
      h.ai.requests[0].request,
    );
  });

  test("setup, install and support states never send text; the offer can be declined", async () => {
    const h = harness(TEXT);
    h.ai.current = status({ consented: false, offerSetup: true, install: "none" });
    await h.start();
    expect(h.last().ai.availability).toBe("setup-needed");
    expect(h.last().ai.offerSetup).toBe(true);
    expect(h.last().diagnostics.map((d) => d.original)).toEqual(["teh"]);
    h.session.dismissAiSetup();
    expect(h.ai.offerDismissed).toBe(1);
    expect(h.last().ai.offerSetup).toBe(false);
    h.ai.push({ consented: true, install: "none" });
    expect(h.last().ai.availability).toBe("install-needed");
    h.ai.push({ runtime: "downloading", install: "partial" });
    expect(h.last().ai.availability).toBe("installing");
    h.ai.push({ runtime: "unavailable", unavailable: "no-webgpu" });
    expect(h.last().ai.availability).toBe("unsupported");
    expect(h.ai.requests).toEqual([]);
    // Setup completes while the review is open: the pass starts.
    h.ai.push({});
    await h.settle();
    expect(h.ai.requests).toHaveLength(1);
    expect(h.aiFindings()).toHaveLength(1);
  });

  test("the preference turned off ends AI work and findings; no provider means off", async () => {
    const h = harness(TEXT);
    h.ai.auto = false;
    await h.start();
    h.session.setAiEnabled(false);
    expect(h.ai.aborted).toBe(1);
    expect(h.last().ai.availability).toBe("off");
    expect(h.last().ai.coverage).toBe("idle");

    const plain = harness(TEXT, { ai: null });
    await plain.start();
    expect(plain.last().ai.availability).toBe("off");
    expect(plain.last().ai.status).toBeNull();
    expect(plain.last().diagnostics.map((d) => d.original)).toEqual(["teh"]);
  });

  test("coverage is partial when text was protected or a chunk failed", async () => {
    const h = harness(TEXT);
    h.editor.protectedRanges = [{ start: 3, end: 6, reason: "code" }];
    await h.start();
    expect(h.last().ai.skippedChars).toBeGreaterThan(0);
    expect(h.last().ai.coverage).toBe("partial");

    const long = harness(
      Array.from(
        { length: 6 },
        (_, i) => `She go home ${i}. ${"Nice words here. ".repeat(20)}`,
      ).join("\n\n"),
    );
    long.ai.outcome = (request, index) =>
      index === 1
        ? { ok: false, error: "malformed" }
        : { ok: true, segments: request.segments.map(({ id, text }) => ({ id, text })) };
    await long.start();
    expect(long.ai.requests.length).toBeGreaterThan(1);
    expect(long.last().ai.coverage).toBe("partial");
    expect(long.last().ai.failure).toBe("malformed");
    expect(long.last().ai.checkedChars).toBeLessThan(long.last().ai.eligibleChars);
  });

  test("two reviews of identical text in two editors are independent", async () => {
    const a = harness(TEXT);
    const b = harness(TEXT);
    await a.start();
    await b.start();
    expect(a.ai.requests).toHaveLength(1);
    expect(b.ai.requests).toHaveLength(1);
    a.session.close();
    await b.settle();
    expect(b.aiFindings().map((d) => d.original)).toEqual(["go"]);
  });

  test("a status push that leaves ready aborts the request in flight", async () => {
    const h = harness(TEXT);
    h.ai.auto = false;
    await h.start();
    h.ai.push({ runtime: "unavailable", unavailable: "host-unsupported" });
    expect(h.ai.requests[0].signal.aborted).toBe(true);
    expect(h.last().ai.availability).toBe("unsupported");
    expect(h.last().ai.coverage).toBe("cancelled");
  });
});

describe("ReviewSession with Local AI: Rewrite", () => {
  const rewriteFix = (text: string, request: AiGenerationRequest) =>
    request.mode === "rewrite" ? text.replace("teh", "the").replace("She go ", "She goes ") : text;

  test("a new review starts in Correct; Rewrite generates only when asked and writes only on Apply", async () => {
    const h = harness(TEXT);
    h.ai.fix = rewriteFix;
    await h.start();
    expect(h.last().mode).toBe("correct");
    expect(h.last().rewrite).toBeNull();
    const sent = h.ai.requests.length;
    h.session.setMode("rewrite");
    h.session.setRewriteStyle("concise");
    h.session.setRewriteContext("email");
    await h.settle();
    expect(h.last().rewrite).toMatchObject({ style: "concise", status: "idle", canApply: false });
    expect(h.ai.requests).toHaveLength(sent);

    h.session.setRewriteStyle("keep-voice");
    h.session.generateRewrite();
    await h.settle();
    const rewrite = h.last().rewrite!;
    expect(rewrite.status).toBe("ready");
    expect(rewrite.before).toBe(TEXT);
    expect(rewrite.after).toBe("We saw the cat. She goes home now.");
    expect(rewrite.canApply).toBe(true);
    expect(rewrite.previewOnly).toBe(false);
    expect(h.ai.requests.at(-1)!.request).toMatchObject({ mode: "rewrite", style: "keep-voice" });
    for (const hunk of rewrite.hunks) {
      expect(rewrite.before.slice(hunk.start, hunk.end)).toBe(hunk.original);
    }
    expect(h.editor.applyCalls).toEqual([]);

    const applying = h.session.applyRewrite();
    await h.settle();
    expect(await applying).toEqual({ status: "applied" });
    expect(h.editor.text).toBe("We saw the cat. She goes home now.");
    expect(h.editor.applyCalls).toHaveLength(1);
    expect(h.last().rewrite!.status).toBe("idle");

    // Reopening starts in Correct again.
    const reopened = harness(h.editor.text);
    await reopened.start();
    expect(reopened.last().mode).toBe("correct");
  });

  test("switching to Rewrite stops the correction pass but keeps its findings", async () => {
    const h = harness("She go home now.\n\n" + "Fine words here. ".repeat(100));
    h.ai.auto = false;
    await h.start();
    h.ai.requests[0].answer();
    await h.settle();
    h.session.setMode("rewrite");
    expect(h.ai.aborted).toBe(1);
    expect(h.last().ai.coverage).toBe("cancelled");
    expect(h.aiFindings()).toHaveLength(1);
  });

  test("a scope beyond the rewrite budget asks for a selection and sends nothing", async () => {
    const h = harness("She go home now. ".repeat(200));
    h.ai.auto = true;
    await h.start();
    const sent = h.ai.requests.length;
    h.session.setMode("rewrite");
    h.session.generateRewrite();
    await h.settle();
    expect(h.last().rewrite!.status).toBe("too-long");
    expect(h.ai.requests).toHaveLength(sent);
  });

  test("an edit after generation makes the proposal stale and not applicable", async () => {
    const h = harness(TEXT);
    h.ai.fix = rewriteFix;
    await h.start();
    h.session.setMode("rewrite");
    h.session.generateRewrite();
    await h.settle();
    expect(h.last().rewrite!.status).toBe("ready");
    h.editor.text = TEXT + " Bye.";
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.last().rewrite).toMatchObject({ status: "stale", canApply: false });
    expect(await h.session.applyRewrite()).toBeNull();
    expect(h.editor.applyCalls).toEqual([]);
  });

  test("adding a word to the dictionary marks a ready proposal stale (review finding)", async () => {
    const h = harness(`${TEXT} I like zorbs.`, {
      deps: {
        lookupSpelling: (_lang, words) =>
          Promise.resolve(words.map(({ word }) => (word === "zorbs" ? ["sorbs"] : null))),
        addToDictionary: () => Promise.resolve(true),
      },
    });
    h.ai.fix = rewriteFix;
    await h.start();
    const spelling = h.last().diagnostics.find((d) => d.dictionaryWord === "zorbs");
    expect(spelling).toBeDefined();
    h.session.setMode("rewrite");
    h.session.generateRewrite();
    await h.settle();
    expect(h.last().rewrite!.status).toBe("ready");
    await Promise.all([h.session.addToDictionary(spelling!.id), h.settle()]);
    expect(h.last().rewrite).toMatchObject({ status: "stale", canApply: false });
  });

  test("a review-only editor previews a rewrite but never applies it", async () => {
    const h = harness(TEXT);
    h.ai.fix = rewriteFix;
    h.editor.capabilities = { inline: false, apply: false, bulk: false, undo: "none" };
    await h.start();
    h.session.setMode("rewrite");
    h.session.generateRewrite();
    await h.settle();
    expect(h.last().rewrite).toMatchObject({ status: "ready", previewOnly: true, canApply: false });
    expect(await h.session.applyRewrite()).toBeNull();
    expect(h.editor.applyCalls).toEqual([]);
  });

  test("a proposal that changes a fact is rejected and cannot be applied", async () => {
    const h = harness("I have 3 cats at home.");
    h.ai.fix = (text, request) => (request.mode === "rewrite" ? text.replace("3", "4") : text);
    await h.start();
    h.session.setMode("rewrite");
    h.session.generateRewrite();
    await h.settle();
    expect(h.last().rewrite).toMatchObject({ status: "rejected", canApply: false, after: null });
    expect(h.last().rewrite!.rejection).toBe("number");
    expect(await h.session.applyRewrite()).toBeNull();
  });

  test("pausing stops automatic checking, but an explicit Generate still runs", async () => {
    const h = harness(TEXT);
    h.ai.fix = rewriteFix;
    await h.start();
    h.session.setAiPaused(true);
    h.session.setMode("rewrite");
    h.session.generateRewrite();
    await h.settle();
    expect(h.last().ai.availability).toBe("paused");
    expect(h.last().rewrite!.status).toBe("ready");
  });

  test("a failed or cancelled generation leaves nothing to apply", async () => {
    const h = harness(TEXT);
    await h.start();
    h.session.setMode("rewrite");
    h.ai.outcome = () => ({ ok: false, error: "truncated" });
    h.session.generateRewrite();
    await h.settle();
    expect(h.last().rewrite).toMatchObject({ status: "failed", failure: "truncated" });
    h.ai.outcome = null;
    h.ai.auto = false;
    h.session.generateRewrite();
    expect(h.last().rewrite!.status).toBe("generating");
    h.session.cancelRewrite();
    expect(h.ai.aborted).toBe(1);
    expect(h.last().rewrite!.status).toBe("idle");
  });
});

describe("ReviewSession with Local AI: Apply selected AI corrections", () => {
  test("previews the combined change, then applies it as one verified write", async () => {
    const text = "We saw teh cat. She go home now. They goes there too.";
    const h = harness(text);
    await h.start();
    expect(h.aiFindings()).toHaveLength(2);
    h.session.previewAiBatch();
    const preview = h.last().aiBatch!;
    expect(preview.diagnosticIds).toHaveLength(2);
    expect(preview.excluded).toEqual([]);
    expect(preview.before).toBe(text);
    expect(preview.after).toBe("We saw teh cat. She goes home now. They go there too.");
    expect(preview.canApply).toBe(true);
    expect(h.editor.applyCalls).toEqual([]);
    const applying = h.session.applyAiBatch();
    await h.settle();
    expect(await applying).toEqual({ status: "applied" });
    expect(h.editor.applyCalls).toHaveLength(1);
    // Fix all's rule finding was not touched.
    expect(h.editor.text).toBe("We saw teh cat. She goes home now. They go there too.");
    expect(h.last().aiBatch).toBeNull();
  });

  test("an ignore changes what is shown: the preview closes and cannot be applied", async () => {
    const h = harness("We saw teh cat. She go home now. They goes there too.");
    await h.start();
    h.session.previewAiBatch([h.aiFindings()[1].id]);
    expect(h.last().aiBatch!.diagnosticIds).toEqual([h.aiFindings()[1].id]);
    h.session.ignore(h.aiFindings()[0].id);
    expect(h.last().aiBatch).toBeNull();
    expect(await h.session.applyAiBatch()).toBeNull();
    expect(h.editor.applyCalls).toEqual([]);
  });

  test("an edit closes the preview; an editor without verified bulk writes cannot apply it", async () => {
    const h = harness(TEXT);
    await h.start();
    h.session.previewAiBatch();
    expect(h.last().aiBatch).not.toBeNull();
    h.editor.text = TEXT + " Ok.";
    h.session.notifySourceChanged();
    expect(h.last().aiBatch).toBeNull();

    const single = harness(TEXT);
    single.editor.capabilities = { ...single.editor.capabilities, bulk: false };
    await single.start();
    single.session.previewAiBatch();
    expect(single.last().aiBatch!.canApply).toBe(false);
    expect(await single.session.applyAiBatch()).toBeNull();
  });
});

describe("Local AI review helpers", () => {
  function finding(id: string, start: number, end: number, replacement: string): ReviewDiagnostic {
    const original = "abcdefghij".slice(start, end);
    return {
      id,
      snapshotId: "s",
      ruleId: REVIEW_LOCAL_AI_CHECK,
      category: "grammar",
      messageKey: "review_msg_local_ai",
      lang: "en_US",
      range: { start, end },
      original,
      alternatives: [{ edits: [{ start, end, original, replacement }], preview: replacement }],
      bulk: { eligible: false, reason: "local-ai" },
      context: { start, end },
    };
  }

  test("availability maps preference, support, consent, install and pause in that order", () => {
    expect(reviewAiAvailability(null, true, false)).toBe("off");
    expect(reviewAiAvailability(status({ enabled: false }), true, false)).toBe("off");
    expect(reviewAiAvailability(status(), false, false)).toBe("off");
    expect(reviewAiAvailability(status({ runtime: "unavailable" }), true, false)).toBe(
      "unsupported",
    );
    expect(reviewAiAvailability(status({ consented: false }), true, false)).toBe("setup-needed");
    expect(reviewAiAvailability(status({ install: "partial" }), true, false)).toBe(
      "install-needed",
    );
    expect(reviewAiAvailability(status({ runtime: "downloading" }), true, false)).toBe(
      "installing",
    );
    expect(reviewAiAvailability(status({ runtime: "loading" }), true, false)).toBe("ready");
    expect(reviewAiAvailability(status(), true, true)).toBe("paused");
  });

  test("overlapping selected findings are left out, both of them", () => {
    const text = "abcdefghij";
    const { included, excluded } = conflictFreeFindings(text, [
      finding("a", 0, 2, "X"),
      finding("b", 1, 3, "Y"),
      finding("c", 5, 6, "Z"),
    ]);
    expect(included.map((d) => d.id)).toEqual(["c"]);
    expect(excluded).toEqual([
      { id: "a", reason: "conflict" },
      { id: "b", reason: "conflict" },
    ]);
  });

  test("the same change is recognised across checks", () => {
    expect(sameChange(finding("a", 0, 2, "X"), finding("b", 0, 2, "X"))).toBe(true);
    expect(sameChange(finding("a", 0, 2, "X"), finding("b", 0, 2, "Y"))).toBe(false);
  });
});
