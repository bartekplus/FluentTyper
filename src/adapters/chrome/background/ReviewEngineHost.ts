import { LocalReviewEngine } from "@core/application/review/LocalReviewEngine";
import {
  parseReviewEngineRequest,
  type ReviewEngineResponse,
} from "@core/domain/contracts/reviewEngine";

/** Open review sessions kept at once; the least recently used is released first. */
const MAX_SESSIONS = 8;

interface HostedSession {
  engine: LocalReviewEngine;
  requests: Map<number, AbortController>;
}

/**
 * Review detection for content scripts (see contracts/reviewEngine.ts). Each
 * review session gets its own engine, keyed by sender tab, frame and session
 * id, so one tab can never cancel or read another's work. Sessions are released
 * by the page on close, or evicted when too many are open; a restarted worker
 * simply starts them again empty. Nothing is logged or stored.
 */
export class ReviewEngineHost {
  private readonly sessions = new Map<string, HostedSession>();
  private readonly live = new LocalReviewEngine();

  async handle(
    message: unknown,
    sender: { tabId: number; frameId: number },
  ): Promise<ReviewEngineResponse> {
    const request = parseReviewEngineRequest(message);
    if (!request) return { ok: false, error: "invalid" };
    if (request.op === "live") {
      return this.answer(() =>
        this.live.liveProposals(request.beforeCursor, request.options, request.uiLanguage),
      );
    }
    if (request.op === "explain") {
      return this.answer(() => this.live.explanations(request.keys, request.uiLanguage));
    }
    const key = `${sender.tabId}:${sender.frameId}:${request.session}`;
    if (request.op === "release") {
      this.release(key);
      return { ok: true, value: null };
    }
    if (request.op === "cancel") {
      this.sessions.get(key)?.requests.get(request.id)?.abort();
      return { ok: true, value: null };
    }
    const session = this.session(key);
    const abort = new AbortController();
    session.requests.set(request.id, abort);
    try {
      return await this.answer(() =>
        request.op === "scan"
          ? session.engine.scan(request.request, abort.signal)
          : session.engine.prove(request.request, abort.signal),
      );
    } finally {
      session.requests.delete(request.id);
    }
  }

  private session(key: string): HostedSession {
    let session = this.sessions.get(key);
    if (session) {
      // Most recently used last.
      this.sessions.delete(key);
    } else {
      session = { engine: new LocalReviewEngine(), requests: new Map() };
      while (this.sessions.size >= MAX_SESSIONS) {
        this.release(this.sessions.keys().next().value!);
      }
    }
    this.sessions.set(key, session);
    return session;
  }

  private release(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    for (const abort of session.requests.values()) abort.abort();
    session.engine.release();
  }

  private async answer(work: () => Promise<unknown>): Promise<ReviewEngineResponse> {
    try {
      return { ok: true, value: await work() };
    } catch (error) {
      // Never the error's text: it may quote what was reviewed.
      return {
        ok: false,
        error: error instanceof DOMException && error.name === "AbortError" ? "aborted" : "failed",
      };
    }
  }
}
