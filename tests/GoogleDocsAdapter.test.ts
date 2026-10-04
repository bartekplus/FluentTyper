import { expect, jest, test } from "bun:test";
import { GoogleDocsAdapter } from "../src/adapters/chrome/content-script/google-docs/GoogleDocsAdapter";
import { DOCS_SESSION_ID } from "../src/adapters/chrome/content-script/google-docs/GoogleDocsModel";
import type { SuggestionManagerOptions } from "../src/adapters/chrome/content-script/suggestions/types";

// Regression: a scroll or resize rendered the menu again with the config language ("Auto detect").
test("the menu header keeps the predicted language when the layout renders it again", async () => {
  const frame = document.createElement("iframe");
  frame.className = "docs-texteventtarget-iframe";
  frame.tabIndex = 0;
  document.body.append(frame);
  frame.contentDocument!.body.innerHTML = '<div contenteditable="true"></div>';
  frame.focus();

  const adapter = new GoogleDocsAdapter({
    lang: "auto_detect",
    minWordLengthToPredict: 1,
    getPrediction: () => undefined,
    enabledGrammarRules: [],
  } as unknown as SuggestionManagerOptions);
  const internals = adapter as unknown as {
    snapshot: unknown;
    requested: unknown;
    state: { requestId: number };
    bridge: { read: () => Promise<unknown> };
    view: { render: (...args: unknown[]) => boolean };
    completion: () => object;
    layoutListener: () => void;
  };
  const snapshot = { text: "hel", caret: 3, anchor: 3, focus: 3, token: "t" };
  internals.snapshot = snapshot;
  internals.requested = { id: 1, snapshot };
  internals.state.requestId = 1;
  internals.bridge.read = async () => ({ status: "ready", snapshot });
  internals.completion = () => ({});
  const render = jest.fn(() => true);
  internals.view.render = render;

  await adapter.fulfillPrediction({
    suggestionId: DOCS_SESSION_ID,
    requestId: 1,
    predictions: ["hello"],
    lang: "de_DE",
  } as Parameters<GoogleDocsAdapter["fulfillPrediction"]>[0]);
  internals.layoutListener();

  expect(render.mock.calls.map((call) => (call as unknown[])[3])).toEqual(["de_DE", "de_DE"]);
});
