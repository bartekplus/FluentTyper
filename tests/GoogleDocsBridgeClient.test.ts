import { afterEach, describe, expect, test } from "bun:test";
import { GoogleDocsBridgeClient } from "../src/adapters/chrome/content-script/google-docs/GoogleDocsBridgeClient";
import {
  MAX_CONTEXT,
  REQUEST_EVENT,
  RESPONSE_EVENT,
  REVIEW_WINDOW,
  type DocsReply,
} from "../src/adapters/chrome/content-script/google-docs/GoogleDocsModel";

/** Answers each bridge request with a ready snapshot of `length` characters. */
function answerWith(length: number): () => void {
  const listener = (event: Event) => {
    const request = JSON.parse((event as CustomEvent<string>).detail) as { id: string };
    const text = "a".repeat(length);
    document.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, {
        detail: JSON.stringify({
          id: request.id,
          status: "ready",
          snapshot: {
            token: "t",
            scope: "d",
            text,
            windowStart: 0,
            documentLength: length,
            anchor: 0,
            focus: 0,
          },
        }),
      }),
    );
  };
  document.addEventListener(REQUEST_EVENT, listener);
  return () => document.removeEventListener(REQUEST_EVENT, listener);
}

describe("Google Docs bridge client bounds", () => {
  let cleanup: Array<() => void> = [];
  afterEach(() => {
    cleanup.forEach((dispose) => dispose());
    cleanup = [];
  });

  test("a review read accepts the review window; a typing read keeps the typing bounds", async () => {
    const client = new GoogleDocsBridgeClient();
    cleanup.push(() => client.dispose());
    cleanup.push(answerWith(REVIEW_WINDOW));
    const review = await client.read({ review: true });
    expect(review.status).toBe("ready");
    expect(review.snapshot?.text.length).toBe(REVIEW_WINDOW);

    // The same large reply to a typing read is ignored: the read stays pending.
    let typing: DocsReply | null = null;
    void client.read().then((reply) => (typing = reply));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(typing).toBeNull();
    client.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(typing).toEqual({ status: "cancelled" });
  });

  test("a typing-sized reply is accepted by a typing read", async () => {
    const client = new GoogleDocsBridgeClient();
    cleanup.push(() => client.dispose());
    cleanup.push(answerWith(MAX_CONTEXT * 2));
    const reply = await client.read();
    expect(reply.status).toBe("ready");
    expect(reply.snapshot?.text.length).toBe(MAX_CONTEXT * 2);
  });
});
