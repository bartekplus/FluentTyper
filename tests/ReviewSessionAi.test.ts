import { describe, expect, test } from "bun:test";
import { LocalReviewEngine } from "../src/core/application/review/LocalReviewEngine";
import {
  ReviewSession,
  type ReviewApplyResult,
  type ReviewSessionDependencies,
  type ReviewViewState,
} from "../src/core/application/review/ReviewSession";
import {
  conflictFreeFindings,
  reviewAiAvailability,
  type ReviewAiProvider,
} from "../src/core/application/review/reviewAi";
import type { LocalAiStatus } from "../src/core/domain/contracts/localAi";
import { readyStatus } from "./support/localAiFakes";
import { AI_PROMPT_VERSION } from "../src/core/domain/grammar/review/ai/prompts";
import type {
  AiGenerationOutcome,
  AiGenerationRequest,
} from "../src/core/domain/grammar/review/ai/types";
import {
  REVIEW_LOCAL_AI_CHECK,
  type ReviewDiagnostic,
  type ReviewEdit,
} from "../src/core/domain/grammar/review/types";
import { FakeEditor, manualTimers } from "./support/reviewFakes";

const AI_DELAY = 1500;

interface FakeRequest {
  request: AiGenerationRequest;
  signal: AbortSignal;
  answer(outcome?: AiGenerationOutcome): void;
}

/** Scriptable provider: answers at once (`auto`) or when released; records aborts. */
class FakeAi implements ReviewAiProvider {
  current = readyStatus();
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
    this.current = readyStatus(next);
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
    deps = {} as Partial<
      Pick<
        ReviewSessionDependencies,
        "addToDictionary" | "lookupSpelling" | "detectLanguage" | "resolveAutoLanguage"
      >
    >,
    rules = ["englishTypoWhitelistCorrection"],
    lang = "en_US",
  } = {},
) {
  const editor = new FakeEditor(text);
  const { timers, yieldToTimers, setTimer, clearTimer } = manualTimers();
  const states: ReviewViewState[] = [];
  const session = new ReviewSession({
    target: editor,
    engine: new LocalReviewEngine(yieldToTimers),
    options: {
      lang,
      enabledRules: rules,
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
    initialScope: null,
    onChange: (state) => states.push(state),
    ai: ai ?? undefined,
    ...deps,
    setTimer,
    clearTimer,
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
  test("regular Review offers a dense AI correction for manual acceptance", async () => {
    const h = harness("I makes a much of mistake!");
    h.ai.fix = () => "I make many mistakes!";
    await h.start();
    expect(h.last().ai.coverage).toBe("complete");
    expect(h.last().diagnostics).toHaveLength(1);
    expect(h.aiFindings()).toHaveLength(1);
    expect(h.aiFindings()[0].alternatives[0].preview).toBe("make many mistakes");
    expect(h.editor.text).toBe("I makes a much of mistake!");
    expect(h.last().bulk.count).toBe(0);
  });

  test("rule findings are shown first; AI findings join when the model answers", async () => {
    const h = harness(`${TEXT} Everything is ready.`);
    h.ai.auto = false;
    await h.start();
    expect(h.last().status).toBe("ready");
    expect(h.last().diagnostics.map((d) => d.original)).toEqual(["teh"]);
    expect(h.last().ai.availability).toBe("ready");
    expect(h.last().ai.coverage).toBe("checking");
    expect(h.last().ai.progress).toBe(0);
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

    // Two separately editable sentences per request, one request at a time.
    expect(h.ai.requests[0].request.segments).toEqual([
      { id: "s0", text: "We saw teh cat." },
      { id: "s1", text: "She go home now." },
    ]);
    h.ai.requests[0].answer();
    await h.settle();
    expect(h.last().ai.coverage).toBe("checking");
    expect(h.aiFindings().map((d) => d.original)).toEqual(["go"]);
    expect(h.ai.requests).toHaveLength(2);
    expect(h.last().ai.progress).toBe(0.5);
    h.session.setAiPaused(true);
    expect(h.last().ai.progress).toBeUndefined();
    h.session.setAiPaused(false);
    await h.settle();
    expect(h.last().ai.progress).toBe(0.5); // Cached first pair still counts.
    h.ai.requests.at(-1)!.answer();
    await h.settle();
    expect(h.aiFindings().map((d) => d.original)).toEqual(["go"]);
    expect(h.last().diagnostics.map((d) => d.ruleId === REVIEW_LOCAL_AI_CHECK)).toEqual([
      false,
      true,
    ]);
    expect(h.last().ai.coverage).toBe("complete");
    expect(h.last().ai.progress).toBeUndefined();
    expect(h.editor.applyCalls).toEqual([]);
  });

  test("Compact keeps single-sentence requests; Gemma pairs them", async () => {
    const compact = harness(TEXT);
    compact.ai.current = readyStatus({ tier: "compact" });
    await compact.start();
    expect(compact.ai.requests.map(({ request }) => request.segments.map((s) => s.text))).toEqual([
      ["We saw teh cat."],
      ["She go home now."],
    ]);
    const gemma = harness(TEXT);
    await gemma.start();
    expect(gemma.ai.requests.map(({ request }) => request.segments.map((s) => s.text))).toEqual([
      ["We saw teh cat.", "She go home now."],
    ]);
    expect(compact.aiFindings().map((d) => d.alternatives[0].preview)).toEqual(
      gemma.aiFindings().map((d) => d.alternatives[0].preview),
    );
  });

  test("an AI failure keeps the rule findings and reports failed coverage", async () => {
    const h = harness(TEXT);
    h.ai.outcome = () => ({ ok: false, error: "engine-failed" });
    await h.start();
    expect(h.last().diagnostics.map((d) => d.original)).toEqual(["teh"]);
    expect(h.last().ai.coverage).toBe("failed");
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
    expect(h.last().ai.coverage).toBe("waiting");
    // The rule recheck runs; the model waits for its longer pause.
    await h.settle({ aiDelay: false });
    expect(stale.signal.aborted).toBe(true);
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
    expect(h.ai.requests).toHaveLength(2);
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
    const h = harness(`${TEXT} Everything is ready.`);
    await h.start();
    expect(h.ai.requests).toHaveLength(2);
    // Same text again (an unrelated mutation): the answers are reused, nothing is sent.
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.ai.requests).toHaveLength(2);
    expect(h.aiFindings().map((d) => d.original)).toEqual(["go"]);
    expect(h.last().ai.coverage).toBe("complete");
    // Changed text: asked again, for the changed pair and for the sentence whose
    // read-only context changed.
    h.editor.text = "We saw teh cat. She go home today. Everything is ready.";
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.ai.requests).toHaveLength(4);
    // Another model: its own answers.
    h.ai.push({ modelId: "model-b" });
    await h.settle();
    expect(h.ai.requests).toHaveLength(6);
  });

  test("deleting an early sentence reuses distant paired answers", async () => {
    const sentences = Array.from(
      { length: 30 },
      (_, i) => `Sentence number ${i} has enough context to review.`,
    );
    const h = harness(sentences.join(" "));
    await h.start();
    const count = h.ai.requests.length;
    h.editor.text = sentences.slice(1).join(" ");
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.ai.requests.length - count).toBeLessThanOrEqual(5);
    expect(h.last().ai.coverage).toBe("complete");
  });

  test("Apply keeps an identical later request running and maps its answer to the new text", async () => {
    const sentences = [
      "This is teh first sentence.",
      ...Array.from({ length: 18 }, (_, i) => `Sentence number ${i} has enough context to review.`),
      "She go home now.",
      "Everything else is ready.",
    ];
    const h = harness(sentences.join(" "));
    h.ai.auto = false;
    await h.start();
    while (!h.ai.requests.at(-1)!.request.segments.some((s) => s.text.includes("She go"))) {
      h.ai.requests.at(-1)!.answer();
      await h.settle();
    }
    const later = h.ai.requests.at(-1)!;
    const requestKey = JSON.stringify(later.request);
    const first = h.last().diagnostics.find((d) => d.original === "teh")!;
    const applying = h.session.apply(first.id);
    await h.settle({ aiDelay: false });
    expect(await applying).toEqual({ status: "applied" });
    expect(later.signal.aborted).toBe(false);
    expect(h.timers.some((timer) => timer.delay === AI_DELAY)).toBe(false);
    h.ai.auto = true;
    later.answer();
    await h.settle();
    expect(
      h.ai.requests.filter(({ request }) => JSON.stringify(request) === requestKey),
    ).toHaveLength(1);
    const finding = h.aiFindings().find((d) => d.original === "go")!;
    expect(finding.range.start).toBe(h.editor.text.indexOf("go home"));
    const applyingFinding = h.session.apply(finding.id);
    await h.settle();
    expect(await applyingFinding).toEqual({ status: "applied" });
    expect(h.editor.text).toContain("She goes home now.");
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
    h.ai.current = readyStatus({ consented: false, offerSetup: true, install: "none" });
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

  test("turning the preference on in an open review fetches status and starts AI", async () => {
    const h = harness(TEXT);
    h.ai.current = readyStatus({ enabled: false });
    h.session.setAiEnabled(false);
    await h.start();
    expect(h.last().ai.availability).toBe("off");
    expect(h.ai.requests).toHaveLength(0);
    h.ai.current = readyStatus();
    h.session.setAiEnabled(true);
    await h.settle();
    expect(h.last().ai.availability).toBe("ready");
    expect(h.aiFindings().length).toBeGreaterThan(0);
  });

  test("with auto-detect, rules resolve the language again after the text changes", async () => {
    let resolves = 0;
    const resolved = harness(TEXT, {
      ai: null,
      lang: "auto_detect",
      deps: {
        resolveAutoLanguage: async () => {
          resolves += 1;
          return "en_US";
        },
      },
    });
    await resolved.start();
    await resolved.settle();
    // An English-only rule applies: the review runs as en_US, not "auto_detect".
    expect(resolved.last().diagnostics.map((d) => d.original)).toEqual(["teh"]);
    resolved.editor.text = `${TEXT} More text, teh again.`;
    resolved.session.notifySourceChanged();
    await resolved.settle();
    expect(resolves).toBe(2);

    const unresolved = harness(TEXT, { ai: null, lang: "auto_detect" });
    await unresolved.start();
    await unresolved.settle();
    expect(unresolved.last().diagnostics).toEqual([]);
  });

  test("with auto-detect, a language resolved for text that changed meanwhile is not kept", async () => {
    const answers: Array<(lang: string) => void> = [];
    const h = harness("Nous avons vu teh chat.", {
      ai: null,
      lang: "auto_detect",
      deps: { resolveAutoLanguage: () => new Promise<string>((resolve) => answers.push(resolve)) },
    });
    const started = h.start();
    await h.settle({ aiDelay: false });
    h.editor.text = TEXT;
    h.session.notifySourceChanged();
    answers[0]("fr_FR");
    await h.settle({ aiDelay: false });
    // The new text resolves its own language.
    expect(answers).toHaveLength(2);
    answers[1]("en_US");
    await started;
    await h.settle();
    expect(h.last().diagnostics.map((d) => d.original)).toEqual(["teh"]);
  });

  test("with auto-detect, the text's identified language gates Local AI and names the request", async () => {
    const english = harness(TEXT, {
      lang: "auto_detect",
      deps: { detectLanguage: async () => "en" },
    });
    await english.start();
    await english.settle();
    expect(english.last().ai.availability).toBe("ready");
    expect(english.ai.requests.length).toBeGreaterThan(0);
    expect(english.ai.requests.every(({ request }) => request.lang === "en")).toBe(true);

    for (const detected of ["de", null]) {
      const other = harness(TEXT, {
        lang: "auto_detect",
        deps: { detectLanguage: async () => detected },
      });
      await other.start();
      await other.settle();
      expect(other.last().ai.availability).toBe("language");
      expect(other.ai.requests).toHaveLength(0);
    }
  });

  test("with auto-detect, the language is identified again when the text changes", async () => {
    const seen: string[] = [];
    const h = harness(TEXT, {
      lang: "auto_detect",
      deps: {
        detectLanguage: async (text) => {
          seen.push(text);
          return text.startsWith("Nous") ? "fr" : "en";
        },
      },
    });
    await h.start();
    await h.settle();
    expect(h.last().ai.availability).toBe("ready");
    const requests = h.ai.requests.length;
    h.editor.text = "Nous avons vu teh chat.";
    h.session.notifySourceChanged();
    await h.settle();
    expect(seen).toHaveLength(2);
    expect(h.last().ai.availability).toBe("language");
    expect(h.ai.requests).toHaveLength(requests);
  });

  test("a Generate queued behind identification is dropped when the text changes", async () => {
    const answers: Array<(lang: string) => void> = [];
    const h = harness(TEXT, {
      lang: "auto_detect",
      deps: {
        detectLanguage: () => new Promise<string | null>((resolve) => answers.push(resolve)),
      },
    });
    await h.start();
    answers[0]("en");
    await h.settle();
    h.session.setMode("rewrite");
    h.editor.text = "We saw teh cat. They goes out.";
    h.session.notifySourceChanged();
    await h.settle({ aiDelay: false });
    // Identification of this text is pending; Generate waits for it.
    h.session.generateRewrite();
    h.editor.text = "Something else entirely, teh end.";
    h.session.notifySourceChanged();
    await h.settle({ aiDelay: false });
    for (const answer of answers.slice(1)) answer("en");
    await h.settle();
    expect(h.ai.requests.filter(({ request }) => request.mode === "rewrite")).toHaveLength(0);
  });

  test("a language identified for text that has since changed is discarded", async () => {
    const answers: Array<(lang: string) => void> = [];
    const h = harness("Wir sahen teh Katze.", {
      lang: "auto_detect",
      deps: {
        detectLanguage: () => new Promise<string | null>((resolve) => answers.push(resolve)),
      },
    });
    await h.start();
    expect(answers).toHaveLength(1);
    h.editor.text = TEXT;
    h.session.notifySourceChanged();
    await h.settle({ aiDelay: false });
    // The answer for the old (German) text lands after the change: it is not used.
    answers[0]("de");
    await h.settle({ aiDelay: false });
    expect(answers).toHaveLength(2);
    answers[1]("en");
    await h.settle();
    expect(h.last().ai.availability).toBe("ready");
    expect(h.ai.requests.length).toBeGreaterThan(0);
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
    h.ai.push({ runtime: "unavailable", unavailable: "no-adapter" });
    expect(h.ai.requests[0].signal.aborted).toBe(true);
    expect(h.last().ai.availability).toBe("unsupported");
    expect(h.last().ai.coverage).toBe("cancelled");
  });
});

describe("ReviewSession with Local AI: disagreeing with a check", () => {
  test("AI corrections leave explicitly preferred wording unchanged", async () => {
    const h = harness("We saw teh cat.", { rules: ["preferredTerminology"] });
    h.session.updateOptions({
      lang: "en_US",
      enabledRules: ["preferredTerminology"],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
      preferredTerminology: {
        version: 1,
        enabled: true,
        entries: [
          {
            id: "literal",
            source: "the",
            replacement: "teh",
            casePolicy: "exact",
            explanation: "Deliberate wording.",
            language: "en_US",
            scope: "all-prose",
            enabled: true,
          },
        ],
      },
    });
    h.ai.fix = (text) => text.replace("teh", "the");
    await h.start();
    expect(h.ai.requests.length).toBeGreaterThan(0);
    expect(h.last().diagnostics).toEqual([]);
    expect(h.editor.applyCalls).toEqual([]);
    h.session.close();
  });

  test("AI corrections around unchanged preferred wording remain visible", async () => {
    const source = "She go with Acme Workspace and they goes home.";
    const h = harness(source, { rules: ["preferredTerminology"] });
    h.session.updateOptions({
      lang: "en_US",
      enabledRules: ["preferredTerminology"],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
      preferredTerminology: {
        version: 1,
        enabled: true,
        entries: [
          {
            id: "acme",
            source: "Acme Suite",
            replacement: "Acme Workspace",
            casePolicy: "exact",
            explanation: "Our name",
            language: "en_US",
            scope: "all-prose",
            enabled: true,
          },
        ],
      },
    });
    h.ai.fix = (text) => text.replace("She go ", "She goes ").replace("they goes ", "they go ");
    await h.start();
    expect(h.aiFindings().map((d) => d.original)).toEqual(["go", "goes"]);
    expect(h.editor.text).toBe(source);
    h.session.close();
  });

  test("style warnings do not suppress separately enabled AI corrections", async () => {
    const text =
      "The team reviewed every part of the detailed proposal and carefully considered all of the important information before making any decision about the next stage of the project because there were still several questions about teh final report.";
    const h = harness(text, { rules: ["styleLongSentence"] });
    h.ai.fix = (text) => text.replace("teh", "the");
    await h.start();
    expect(
      h.last().diagnostics.some((d) => d.ruleId === "styleLongSentence" && d.warningOnly),
    ).toBe(true);
    expect(h.last().diagnostics.some((d) => d.ruleId === REVIEW_LOCAL_AI_CHECK)).toBe(true);
    expect(h.editor.applyCalls).toEqual([]);
    h.session.close();
  });

  test("an apostrophe-only typography fix does not suppress an AI fix of the same word", async () => {
    const h = harness("Yesterday I odn't know the details.", { rules: ["typographicQuotes"] });
    h.ai.fix = (text) => text.replace("I odn't know", "I didn't know");
    await h.start();
    expect(h.aiFindings().map((d) => d.alternatives[0].preview)).toHaveLength(1);
    expect(h.last().diagnostics.some((d) => d.ruleId === "typographicQuotes")).toBe(true);
    // Fix all writes neither of them.
    expect(h.last().bulk.count).toBe(0);
    h.session.close();
  });

  test("AI alternatives never turn a native warning into a replacement card", async () => {
    const h = harness("He wrote, “The build is ready.", { rules: ["unclosedQuotation"] });
    h.ai.fix = (text) => text.replace("“", '"');
    await h.start();
    const warning = h.last().diagnostics.find((d) => d.warningOnly);
    expect(warning).toBeDefined();
    expect(warning!.alternatives).toEqual([]);
    expect(await h.session.apply(warning!.id)).toBeNull();
    expect(h.editor.applyCalls).toEqual([]);
    h.session.close();
  });

  test("a different AI fix for the same word is a labelled second option (user report)", async () => {
    const h = harness("Yesterday she still dont know the details.", {
      rules: ["englishContractionNormalization"],
    });
    h.ai.fix = (text) => text.replace("dont", "doesn't");
    await h.start();
    const findings = h.last().diagnostics;
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe("englishContractionNormalization");
    expect(findings[0].alternatives.map((a) => [a.preview, a.localAi ?? false])).toEqual([
      ["don't", false],
      ["doesn't", true],
    ]);
    // Fix all still plans the check's own proven fix only.
    expect(h.last().bulk.count).toBe(1);
    await Promise.all([h.session.apply(findings[0].id, 1), h.settle()]);
    expect(h.editor.text).toBe("Yesterday she still doesn't know the details.");
  });
});

describe("ReviewSession with Local AI: agreeing with a check", () => {
  test("an AI fix that includes a check's own fix is shown too (user report)", async () => {
    const h = harness("All changes is saved teh same way.", {
      rules: ["englishTypoWhitelistCorrection"],
    });
    h.ai.fix = (text) => text.replace("is saved teh", "are saved the");
    await h.start();
    const [check] = h.last().diagnostics.filter((d) => d.ruleId !== REVIEW_LOCAL_AI_CHECK);
    expect(check.original).toBe("teh");
    expect(h.aiFindings().map((d) => d.alternatives[0].preview)).toEqual(["are saved the"]);
  });

  test("an AI fix that contradicts a check's fix on part of its range is left out", async () => {
    const h = harness("All changes is saved teh same way.", {
      rules: ["englishTypoWhitelistCorrection"],
    });
    h.ai.fix = (text) => text.replace("is saved teh", "are saved ten");
    await h.start();
    expect(h.aiFindings()).toEqual([]);
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

  test("settings changes discard pending output and preserve separate checking scopes", async () => {
    const h = harness(TEXT, { rules: ["englishSubjectVerbAgreement"] });
    h.ai.auto = false;
    h.ai.honorAbort = false;
    await h.start();
    expect(h.last().nativeGrammarDisabled).toBe(false);
    const pending = h.ai.requests.at(-1)!;
    h.session.updateOptions({
      lang: "de_DE",
      enabledRules: [],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
      spellingEnabled: true,
    });
    pending.answer();
    await h.settle();
    expect(h.aiFindings()).toEqual([]);
    expect(h.last().nativeGrammarDisabled).toBe(true);
    expect(h.last().ai.availability).toBe("language");
    expect(h.editor.applyCalls).toEqual([]);
  });

  test("late Correct and Rewrite answers cannot survive a mode change", async () => {
    const h = harness(TEXT);
    h.ai.auto = false;
    h.ai.honorAbort = false;
    await h.start();
    const correct = h.ai.requests.at(-1)!;
    h.session.setMode("rewrite");
    correct.answer();
    await h.settle();
    expect(h.aiFindings()).toEqual([]);
    h.session.generateRewrite();
    await h.settle();
    const rewrite = h.ai.requests.at(-1)!;
    expect(rewrite.request.mode).toBe("rewrite");
    h.session.setMode("correct");
    rewrite.answer();
    await h.settle();
    expect(h.last().rewrite).toBeNull();
    expect(h.editor.applyCalls).toEqual([]);
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

  test("a sentence whose rewrite fails a check is kept; the rest applies (user report)", async () => {
    const h = harness("We saw teh cat before Friday. She go home now.");
    h.ai.fix = (text, request) =>
      request.mode !== "rewrite"
        ? text
        : text.replace("before Friday", "by Friday").replace("She go ", "She goes ");
    await h.start();
    h.session.setMode("rewrite");
    h.session.generateRewrite();
    await h.settle();
    expect(h.last().rewrite).toMatchObject({ status: "ready", kept: { invented: 1 } });
    expect(h.last().rewrite!.after).toBe("We saw teh cat before Friday. She goes home now.");
  });

  test("a review-only editor previews a rewrite but never applies it", async () => {
    const h = harness(TEXT);
    h.ai.fix = rewriteFix;
    h.editor.capabilities = { apply: false, bulk: false };
    await h.start();
    h.session.setMode("rewrite");
    h.session.generateRewrite();
    await h.settle();
    expect(h.last().rewrite).toMatchObject({ status: "ready", previewOnly: true, canApply: false });
    expect(await h.session.applyRewrite()).toBeNull();
    expect(h.editor.applyCalls).toEqual([]);
  });

  test("an editor without a batch transaction offers a copy-only rewrite", async () => {
    const h = harness(TEXT);
    h.ai.fix = rewriteFix;
    h.editor.capabilities = { apply: true, bulk: false };
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
    h.ai.auto = false;
    h.session.generateRewrite();
    // The host reports its own work on this request; that must not end it.
    h.ai.push({ runtime: "generating" });
    expect(h.ai.aborted).toBe(0);
    h.ai.requests.at(-1)!.answer();
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
    expect(h.last().rewrite).toMatchObject({ status: "failed" });
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
    expect(preview.excluded).toBe(0);
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
    h.session.previewAiBatch();
    expect(h.last().aiBatch!.diagnosticIds).toHaveLength(2);
    const aiCount = h.aiFindings().length;
    h.session.ignoreMatching(h.aiFindings()[0].id);
    expect(h.aiFindings()).toHaveLength(aiCount);
    expect(h.last().ignoredCount).toBe(0);
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
    expect(reviewAiAvailability(readyStatus({ enabled: false }), true, false)).toBe("off");
    expect(reviewAiAvailability(readyStatus(), false, false)).toBe("off");
    expect(reviewAiAvailability(readyStatus({ runtime: "unavailable" }), true, false)).toBe(
      "unsupported",
    );
    // A browser or build without the runtime keeps today's Review: no AI UI at all (e2e finding).
    for (const reason of ["host-unsupported", "not-in-build"] as const) {
      expect(
        reviewAiAvailability(
          readyStatus({ runtime: "unavailable", unavailable: reason, consented: false }),
          true,
          false,
        ),
      ).toBe("off");
    }
    expect(
      reviewAiAvailability(
        readyStatus({ runtime: "unavailable", unavailable: "no-webgpu" }),
        true,
        false,
      ),
    ).toBe("unsupported");
    // Only languages the selected model was evaluated for (English): no setup offer, no run.
    expect(reviewAiAvailability(readyStatus({ consented: false }), true, false, "pl_PL")).toBe(
      "language",
    );
    expect(reviewAiAvailability(readyStatus(), true, false, "pl_PL")).toBe("language");
    expect(reviewAiAvailability(readyStatus(), true, false, "en_GB")).toBe("ready");
    expect(reviewAiAvailability(readyStatus({ consented: false }), true, false)).toBe(
      "setup-needed",
    );
    expect(reviewAiAvailability(readyStatus({ install: "partial" }), true, false)).toBe(
      "install-needed",
    );
    expect(reviewAiAvailability(readyStatus({ runtime: "downloading" }), true, false)).toBe(
      "installing",
    );
    expect(reviewAiAvailability(readyStatus({ runtime: "loading" }), true, false)).toBe("ready");
    expect(reviewAiAvailability(readyStatus(), true, true)).toBe("paused");
    // The host gave up after repeated engine failures: nothing to pause or generate.
    expect(reviewAiAvailability(readyStatus({ runtime: "error" }), true, true)).toBe("failed");
  });

  test("overlapping selected findings are left out, both of them", () => {
    const text = "abcdefghij";
    const included = conflictFreeFindings(text, [
      finding("a", 0, 2, "X"),
      finding("b", 1, 3, "Y"),
      finding("c", 5, 6, "Z"),
    ]);
    expect(included.map((d) => d.id)).toEqual(["c"]);
  });
});

describe("FT-INV-4 accepted Review correction stability", () => {
  test("AI cannot reverse an accepted correction until the user changes its context", async () => {
    const h = harness("She go home now.");
    h.ai.fix = (text) =>
      text.includes("goes") ? text.replace("goes", "go") : text.replace("go", "goes");
    await h.start();
    expect(h.aiFindings()).toHaveLength(1);
    const applying = h.session.apply(h.aiFindings()[0].id);
    await h.settle();
    expect((await applying)?.status).toBe("applied");
    expect(h.editor.text).toBe("She goes home now.");
    expect(h.aiFindings()).toHaveLength(0);
    h.editor.text = "She goes to school now.";
    h.session.notifySourceChanged();
    await h.settle();
    expect(h.aiFindings()).toHaveLength(1);
    h.session.close();
  });

  test("a three-form spelling cycle stops before returning to an accepted form", async () => {
    const h = harness("Please recieve the package.", { rules: [] });
    h.ai.fix = (text) =>
      text.replace(/recieve|receive|receeve/, (word) =>
        word === "recieve" ? "receive" : word === "receive" ? "receeve" : "receive",
      );
    await h.start();
    for (const expected of ["Please receive the package.", "Please receeve the package."]) {
      expect(h.aiFindings()).toHaveLength(1);
      const applying = h.session.apply(h.aiFindings()[0].id);
      await h.settle();
      expect((await applying)?.status).toBe("applied");
      expect(h.editor.text).toBe(expected);
    }
    expect(h.aiFindings()).toHaveLength(0);
    h.session.close();
  });
});

test("FT-INV-4 an accepted insertion cannot immediately be deleted again", async () => {
  const h = harness("We need fix this bug.", { rules: [] });
  h.ai.fix = (text) =>
    text.includes("need to") ? text.replace("need to", "need") : text.replace("need", "need to");
  await h.start();
  expect(h.aiFindings()).toHaveLength(1);
  const applying = h.session.apply(h.aiFindings()[0].id);
  await h.settle();
  expect((await applying)?.status).toBe("applied");
  expect(h.editor.text).toBe("We need to fix this bug.");
  expect(h.aiFindings()).toHaveLength(0);
  h.session.close();
});

test("FT-INV-4 a broader rewrite cannot erase an accepted grammar correction", async () => {
  const h = harness("She go home now.", { rules: [] });
  h.ai.fix = (text) => (text.includes("goes") ? "Today she go home." : text.replace("go", "goes"));
  await h.start();
  const applying = h.session.apply(h.aiFindings()[0].id);
  await h.settle();
  expect((await applying)?.status).toBe("applied");
  expect(h.editor.text).toBe("She goes home now.");
  expect(h.aiFindings()).toHaveLength(0);
  h.session.close();
});

test("FT-INV-4 consecutive boundary insertions cannot cycle by deleting the latest punctuation", async () => {
  const h = harness("Hi", { rules: [] });
  await h.start();
  // Exercise the shared write boundary directly: AI intentionally rejects some
  // punctuation-only proposals before this point; native/rewrite callers share it.
  const write = (
    h.session as unknown as {
      write(edits: ReviewEdit[], count: number, deferred: number): Promise<ReviewApplyResult>;
    }
  ).write.bind(h.session);
  for (const [offset, replacement, expected] of [
    [2, ".", "Hi."],
    [3, ",", "Hi.,"],
  ] as const) {
    const applying = write([{ start: offset, end: offset, original: "", replacement }], 1, 0);
    await h.settle();
    expect((await applying).status).toBe("applied");
    expect(h.editor.text).toBe(expected);
  }
  expect((await write([{ start: 3, end: 4, original: ",", replacement: "" }], 1, 0)).status).toBe(
    "rejected",
  );
  expect(h.editor.text).toBe("Hi.,");
  h.session.close();
});

test("FT-INV-4 eight remembered forms stop further churn without evicting history", async () => {
  const forms = [
    "recieve",
    "receive",
    "receeve",
    "receave",
    "receuve",
    "receove",
    "receyve",
    "receivve",
    "receivee",
  ];
  const h = harness("Please recieve the package.", { rules: [] });
  h.ai.fix = (text) => {
    const word = text.split(" ")[1];
    return text.replace(word, forms[(forms.indexOf(word) + 1) % forms.length]);
  };
  await h.start();
  for (const word of forms.slice(1, 8)) {
    expect(h.aiFindings()).toHaveLength(1);
    const applying = h.session.apply(h.aiFindings()[0].id);
    await h.settle();
    expect((await applying)?.status).toBe("applied");
    expect(h.editor.text).toBe(`Please ${word} the package.`);
  }
  expect(h.aiFindings()).toHaveLength(0);
  h.session.close();
});

test.each(["inside", "adjacent"] as const)(
  "FT-INV-4 verified browser %s edge-space normalization retains accepted choice history",
  async (edge) => {
    const h = harness("We need fix this bug.", { rules: [] });
    const apply = h.editor.apply.bind(h.editor);
    h.editor.apply = async (request) => {
      const result = await apply(request);
      if (result.status !== "applied") return result;
      h.editor.text =
        edge === "inside"
          ? h.editor.text.replace("to fix", "to\u00a0fix")
          : h.editor.text.replace("need to", "need\u00a0to");
      return { status: "applied" as const, text: h.editor.text };
    };
    h.ai.fix = (text) =>
      /to\s+fix/.test(text) ? text.replace(/to\s+/, "") : text.replace("need", "need to");
    await h.start();
    expect(h.aiFindings()).toHaveLength(1);
    const applying = h.session.apply(h.aiFindings()[0].id);
    await h.settle();
    expect((await applying)?.status).toBe("applied");
    expect(h.editor.text).toBe(
      edge === "inside" ? "We need to\u00a0fix this bug." : "We need\u00a0to fix this bug.",
    );
    expect(h.aiFindings()).toHaveLength(0);
    h.session.close();
  },
);
