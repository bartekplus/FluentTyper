import { describe, expect, test } from "bun:test";
import { MessagingReviewEngine } from "../src/adapters/chrome/content-script/review/MessagingReviewEngine";
import { ReviewEngineHost } from "../src/adapters/chrome/background/ReviewEngineHost";
import { LocalReviewEngine } from "../src/core/application/review/LocalReviewEngine";
import { hydratePrepared } from "../src/core/application/review/ReviewEngine";
import { CMD_CONTENT_SCRIPT_REVIEW_ENGINE } from "../src/core/domain/constants";
import type {
  ReviewEngineRequest,
  ReviewScanRequest,
} from "../src/core/domain/contracts/reviewEngine";
import { findLiveGrammarProposals } from "../src/core/domain/grammar/review/liveProposals";
import {
  reviewExplanation,
  reviewExplanations,
} from "../src/core/domain/grammar/review/reviewExplanations";
import {
  detectReviewDiagnostics,
  prepareReview,
  stillDetectedAfter,
} from "../src/core/domain/grammar/review/reviewDiagnostics";
import type { ContentScriptReviewEngineMessage } from "../src/core/domain/messageTypes";

const OPTIONS = {
  lang: "en_US",
  enabledRules: ["englishTypoWhitelistCorrection", "capitalizeSentenceStart"],
  userDictionary: ["Acme"],
  insertSpaceAfterAutocomplete: true,
};

function scanRequest(text: string, id = "g1"): ReviewScanRequest {
  return {
    snapshot: {
      id,
      text,
      scope: { start: 0, end: text.length },
      protectedRanges: [{ start: 0, end: 4, reason: "code" }],
    },
    options: OPTIONS,
    cache: false,
    gaps: { "size-limit": 3 },
    uiLanguage: "fr-CA",
  };
}

/** A background that answers through a ReviewEngineHost, as chrome.runtime.sendMessage would. */
function wiredEngine(host = new ReviewEngineHost(), tabId = 1) {
  const sent: ReviewEngineRequest[] = [];
  const send = async (message: ContentScriptReviewEngineMessage) => {
    expect(message.command).toBe(CMD_CONTENT_SCRIPT_REVIEW_ENGINE);
    sent.push(message.context);
    // The runtime copies messages: nothing is shared by reference.
    const answer = await host.handle(structuredClone(message.context), { tabId, frameId: 0 });
    return structuredClone(answer);
  };
  return { engine: new MessagingReviewEngine(send), sent, host };
}

describe("review engine over messaging", () => {
  test("a scan through the background finds what in-process detection finds", async () => {
    const text = "x(1) teh cat. teh dog";
    const request = scanRequest(text);
    const { engine, sent } = wiredEngine();
    const response = await engine.scan(request);
    const direct = detectReviewDiagnostics(request.snapshot, request.options);
    expect(response.result.diagnostics).toEqual(direct.diagnostics);
    expect(response.result.coverage.skipped["size-limit"]).toBe(3);
    // The prepared review comes back as plain data, without what the page sent.
    expect(response.prepared).not.toHaveProperty("snapshot");
    expect(hydratePrepared(response.prepared, request.snapshot, request.options)).toEqual(
      prepareReview(request.snapshot, request.options),
    );
    expect(sent).toEqual([{ op: "scan", session: expect.any(String), id: 1, request }]);
    // Each finding's explanation comes along once per key, in the UI language.
    const keys = new Set(direct.diagnostics.map((d) => d.messageKey));
    expect(Object.keys(response.explanations).sort()).toEqual([...keys].sort());
    expect(response.explanations).toEqual(reviewExplanations(keys, "fr"));
    expect(response.explanations.review_msg_unknown_word).toBeUndefined();
  });

  test("a proof round answers like stillDetectedAfter", async () => {
    const text = "teh cat saw teh dog";
    const request = {
      ...scanRequest(text),
      snapshot: { ...scanRequest(text).snapshot, protectedRanges: [] },
    };
    const { engine } = wiredEngine();
    const { result } = await engine.scan(request);
    const [first, second] = result.diagnostics;
    const proof = await engine.prove({
      snapshot: request.snapshot,
      options: request.options,
      checks: [second],
      otherEdits: first.alternatives[0].edits,
    });
    expect(proof).toEqual([true]);
    // A worker that restarted since the scan prepares the snapshot again, with the same answer.
    const fresh = await new LocalReviewEngine().prove({
      snapshot: request.snapshot,
      options: request.options,
      checks: result.diagnostics,
      otherEdits: [{ start: 12, end: 19, original: "teh dog", replacement: "a dog" }],
    });
    expect(fresh).toEqual(
      stillDetectedAfter(prepareReview(request.snapshot, request.options), result.diagnostics, [
        { start: 12, end: 19, original: "teh dog", replacement: "a dog" },
      ]),
    );
    expect(fresh).toContain(false);
  });

  test("live proposals carry only the window the check reads, with offsets mapped back", async () => {
    const { engine, sent } = wiredEngine();
    const beforeCursor = `${"Lorem ipsum dolor sit amet. ".repeat(40)}We is ready. `;
    const options = {
      ...OPTIONS,
      enabledRules: ["englishPronounVerbWhitelistAgreement"],
      liveRules: [],
    };
    const proposals = await engine.liveProposals(beforeCursor, options, "de");
    expect(proposals).toEqual(findLiveGrammarProposals(beforeCursor, options, "de"));
    expect(proposals.length).toBeGreaterThan(0);
    // The explanation comes resolved, in the UI language asked for.
    for (const p of proposals) expect(p.explanation).toBe(reviewExplanation(p.messageKey, "de"));
    expect(proposals[0].explanation).not.toBe(reviewExplanation(proposals[0].messageKey, "en"));
    const [live] = sent as Array<Extract<ReviewEngineRequest, { op: "live" }>>;
    expect(live.beforeCursor.length).toBe(501);
    expect(live.uiLanguage).toBe("de");
  });

  test("explanations in another UI language: known background keys only, once each", async () => {
    const { engine, sent } = wiredEngine();
    const keys = [
      "review_msg_pronoun_verb",
      "review_msg_pronoun_verb",
      "review_msg_unknown_word",
      "__proto__",
      "toString",
      "nope",
    ];
    expect(await engine.explanations(keys, "pl")).toEqual({
      review_msg_pronoun_verb: reviewExplanation("review_msg_pronoun_verb", "pl"),
    });
    expect(sent).toEqual([{ op: "explain", keys, uiLanguage: "pl" }]);
  });

  test("an abort cancels the request in the background and rejects at once", async () => {
    const host = new ReviewEngineHost();
    const sent: ReviewEngineRequest[] = [];
    let scanning: Promise<unknown> | null = null;
    const engine = new MessagingReviewEngine((message) => {
      sent.push(message.context);
      const answer = host.handle(message.context, { tabId: 1, frameId: 0 });
      if (message.context.op === "scan") scanning = answer;
      return answer;
    });
    const abort = new AbortController();
    const long = scanRequest("teh cat.\n".repeat(4000));
    const pending = engine.scan(long, abort.signal);
    abort.abort();
    expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(sent.map((request) => request.op)).toEqual(["scan", "cancel"]);
    // The background stops at its next yield.
    expect(await scanning).toEqual({ ok: false, error: "aborted" });
    await expect(engine.scan(long, abort.signal)).rejects.toThrow();
    expect(sent).toHaveLength(2);
  });

  test("no answer (worker unreachable or failing) rejects; release never throws", async () => {
    const unreachable = new MessagingReviewEngine(() =>
      Promise.reject(new Error("Could not establish connection. Receiving end does not exist.")),
    );
    await expect(unreachable.scan(scanRequest("teh"))).rejects.toThrow();
    expect(() => unreachable.release()).not.toThrow();
    const silent = new MessagingReviewEngine(async () => undefined);
    await expect(
      silent.liveProposals("We is ready. ", { ...OPTIONS, liveRules: [] }, "en"),
    ).rejects.toThrow("no answer");
    const failing = new MessagingReviewEngine(async () => ({ ok: false, error: "failed" }));
    await expect(failing.prove(scanRequest("teh") as never)).rejects.toThrow("failed");
    const throwing = new MessagingReviewEngine(() => {
      throw new Error("Extension context invalidated.");
    });
    expect(() => throwing.release()).not.toThrow();
  });
});

describe("ReviewEngineHost", () => {
  test("refuses malformed requests and reports detection failures without their text", async () => {
    const host = new ReviewEngineHost();
    const sender = { tabId: 1, frameId: 0 };
    for (const bad of [
      null,
      { op: "scan" },
      { op: "scan", session: "s", id: 1, request: { ...scanRequest("a"), cache: "yes" } },
      { op: "scan", session: "s", id: 1, request: { ...scanRequest("a"), snapshot: { id: "g" } } },
      {
        op: "scan",
        session: "s",
        id: 1,
        request: {
          ...scanRequest("ab"),
          snapshot: { ...scanRequest("ab").snapshot, scope: { start: 0, end: 9 } },
        },
      },
      {
        op: "prove",
        session: "s",
        id: 1,
        request: { ...scanRequest("a"), checks: [{}], otherEdits: [] },
      },
      {
        op: "live",
        beforeCursor: "x".repeat(5000),
        options: { ...OPTIONS, liveRules: [] },
        uiLanguage: "en",
      },
      { op: "live", beforeCursor: "x", options: { ...OPTIONS, liveRules: [] } },
      { op: "scan", session: "s", id: 1, request: { ...scanRequest("a"), uiLanguage: 5 } },
      { op: "explain", keys: "review_msg_pronoun_verb", uiLanguage: "en" },
      { op: "explain", keys: [1], uiLanguage: "en" },
      { op: "explain", keys: ["x".repeat(65)], uiLanguage: "en" },
      { op: "explain", keys: Array(513).fill("x"), uiLanguage: "en" },
      { op: "explain", keys: [], uiLanguage: "x".repeat(36) },
      { op: "unknown", session: "s" },
    ]) {
      expect(await host.handle(bad, sender)).toEqual({ ok: false, error: "invalid" });
    }
    const failed = await host.handle(
      {
        op: "scan",
        session: "s",
        id: 1,
        request: {
          ...scanRequest("secret text"),
          options: { ...OPTIONS, preferredTerminology: { entries: 5 } },
        },
      },
      sender,
    );
    expect(JSON.stringify(failed)).not.toContain("secret");
  });

  test("sessions are per tab: another tab can neither cancel nor release them", async () => {
    const host = new ReviewEngineHost();
    const long = scanRequest("teh cat.\n".repeat(4000));
    const scanning = host.handle(
      { op: "scan", session: "s", id: 1, request: long },
      { tabId: 1, frameId: 0 },
    );
    await host.handle({ op: "cancel", session: "s", id: 1 }, { tabId: 2, frameId: 0 });
    await host.handle({ op: "release", session: "s" }, { tabId: 1, frameId: 3 });
    const answer = (await scanning) as { ok: boolean };
    expect(answer.ok).toBe(true);
    // Released by its own tab and frame: work in flight stops.
    const again = host.handle(
      { op: "scan", session: "s", id: 2, request: long },
      { tabId: 1, frameId: 0 },
    );
    await host.handle({ op: "release", session: "s" }, { tabId: 1, frameId: 0 });
    expect(await again).toEqual({ ok: false, error: "aborted" });
  });

  test("keeps a bounded number of sessions, releasing the least recently used", async () => {
    const host = new ReviewEngineHost();
    const released: string[] = [];
    const sessions = (host as unknown as { sessions: Map<string, { engine: LocalReviewEngine }> })
      .sessions;
    for (let tab = 1; tab <= 10; tab += 1) {
      await host.handle(
        { op: "scan", session: "s", id: 1, request: scanRequest("x(1) teh") },
        { tabId: tab, frameId: 0 },
      );
      const { engine } = sessions.get(`${tab}:0:s`)!;
      const release = engine.release.bind(engine);
      engine.release = () => {
        released.push(`${tab}`);
        release();
      };
    }
    expect(sessions.size).toBe(8);
    expect([...sessions.keys()][0]).toBe("3:0:s");
    expect(released).toEqual(["1", "2"]);
    await host.handle(
      { op: "scan", session: "s", id: 1, request: scanRequest("x(1) teh") },
      { tabId: 11, frameId: 0 },
    );
    expect(released).toEqual(["1", "2", "3"]);
  });
});
