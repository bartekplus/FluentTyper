import { afterEach, describe, expect, test } from "bun:test";
import { GoogleDocsView } from "../src/adapters/chrome/content-script/google-docs/GoogleDocsView";
import { InlineSuggestionView } from "../src/adapters/chrome/content-script/suggestions/InlineSuggestionView";
import { createRect } from "./suggestionTestUtils";

function mountCaret(): HTMLElement {
  // Other suites in the same run may leave ghosts behind.
  InlineSuggestionView.removeAll(document);
  const caret = document.createElement("div");
  caret.className = "kix-cursor-caret";
  caret.style.borderLeftColor = "rgb(0, 0, 0)";
  caret.getBoundingClientRect = () => createRect(100, 100, 1, 18);
  document.body.appendChild(caret);
  return caret;
}

function renderDocs(typed: string, candidate: string): GoogleDocsView {
  const view = new GoogleDocsView({
    inline: true,
    digits: false,
    langHeader: false,
    findToken: () => ({ token: typed }),
    accept: () => undefined,
  });
  view.render(
    [candidate],
    0,
    {
      token: typed,
      scope: "",
      text: typed,
      windowStart: 0,
      documentLength: typed.length,
      anchor: typed.length,
      focus: typed.length,
    },
    "ar_SA",
  );
  return view;
}

describe("GoogleDocsView inline ghost guard", () => {
  let caret: HTMLElement | null = null;
  let view: GoogleDocsView | null = null;
  afterEach(() => {
    view?.dispose();
    caret?.remove();
    view = null;
    caret = null;
  });

  test("ghosts a Latin completion on the canvas", () => {
    caret = mountCaret();
    view = renderDocs("hel", "hello");
    expect(document.querySelector(`.${InlineSuggestionView.CLASS_NAME}`)).not.toBeNull();
  });

  test("ghosts a text expansion as an annotation after the typed shortcut", () => {
    caret = mountCaret();
    view = renderDocs("brb", "be right back ");
    expect(document.querySelector(`.${InlineSuggestionView.CLASS_NAME}`)?.textContent).toBe(
      " → be right back",
    );
  });

  test("falls back to the menu for a multi-line text expansion", () => {
    caret = mountCaret();
    view = renderDocs("sig", "Best,\nBart");
    expect(document.querySelector(`.${InlineSuggestionView.CLASS_NAME}`)).toBeNull();
  });

  test("falls back to the menu for RTL text even when the Docs UI is LTR", () => {
    caret = mountCaret();
    view = renderDocs("الي", "اليوم");
    expect(document.querySelector(`.${InlineSuggestionView.CLASS_NAME}`)).toBeNull();
  });
});
