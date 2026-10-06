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

// Regression: a click (or an arrow key) that only moved the caret opened the menu. The
// dismiss on pointerdown forgot the snapshot, so the next poll read looked like an edit.
test("a caret move without an edit asks for no suggestions; an edit does", async () => {
  const frame = document.createElement("iframe");
  frame.className = "docs-texteventtarget-iframe";
  frame.tabIndex = 0;
  document.body.append(frame);
  frame.contentDocument!.body.innerHTML = '<div contenteditable="true"></div>';
  frame.focus();

  const adapter = new GoogleDocsAdapter({
    lang: "en_US",
    minWordLengthToPredict: 1,
    getPrediction: () => undefined,
    enabledGrammarRules: [],
  } as unknown as SuggestionManagerOptions);
  const internals = adapter as unknown as {
    snapshot: unknown;
    bridge: { read: () => Promise<unknown> };
    prediction: { schedule: (...args: unknown[]) => void };
    navigationListener: (event: Event) => void;
    queueEdit: (action: string, triggers: string[]) => void;
    refresh: () => Promise<void>;
  };
  const at = (caret: number) => ({
    scope: "s",
    text: "hello world",
    windowStart: 0,
    documentLength: 11,
    caret,
    anchor: caret,
    focus: caret,
    token: `t${caret}`,
  });
  internals.snapshot = at(11);
  internals.bridge.read = async () => ({ status: "ready", snapshot: at(3) });
  const schedule = jest.fn();
  internals.prediction.schedule = schedule;

  internals.navigationListener(new Event("pointerdown"));
  await internals.refresh();
  expect(schedule).not.toHaveBeenCalled();

  internals.queueEdit("insert", ["insertChar"]);
  internals.bridge.read = async () => ({ status: "ready", snapshot: at(4) });
  await internals.refresh();
  expect(schedule).toHaveBeenCalledTimes(1);
  adapter.dispose();
});
