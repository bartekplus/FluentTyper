import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { SuggestionManagerRuntime } from "../src/adapters/chrome/content-script/suggestions/SuggestionManagerRuntime";
import type { SuggestionEntry } from "../src/adapters/chrome/content-script/suggestions/types";
import { reviewRuleIds } from "../src/core/domain/grammar/review/reviewCatalog";
import { acquireDomGlobalLock } from "./support/domGlobalLock";

type SessionInternals = {
  runIdleGrammar(): void;
  acceptGrammarProposal(): boolean;
};

function makeRuntime(grammarProposalRules: string[] = reviewRuleIds({ codeMode: false })) {
  return new SuggestionManagerRuntime({
    selectors: "textarea, input",
    minWordLengthToPredict: 1,
    autocomplete: false,
    autocompleteOnEnter: true,
    autocompleteOnTab: true,
    insertSpaceAfterAutocomplete: true,
    lang: "en_US",
    selectByDigit: false,
    horizontalSuggestions: false,
    showSuggestionFooter: false,
    inline_suggestion: false,
    preferNativeAutocomplete: false,
    enabledGrammarRules: [],
    grammarProposalRules,
    userDictionaryList: [],
    getPrediction: jest.fn(),
  });
}

function attach(runtime: SuggestionManagerRuntime, field: HTMLInputElement | HTMLTextAreaElement) {
  document.body.appendChild(field);
  runtime.queryAndAttachHelper();
  const internals = runtime as unknown as {
    entryRegistry: { getByElement(elem: Element): SuggestionEntry | undefined };
    sessionRegistry: Map<number, SessionInternals>;
  };
  const entry = internals.entryRegistry.getByElement(field);
  if (!entry) throw new Error("Expected an attached entry");
  field.focus();
  field.dispatchEvent(new Event("focus"));
  return { entry, session: internals.sessionRegistry.get(entry.id)! };
}

/** Types `text` as one edit, then lets the pause after it pass. */
function typeAndPause(
  field: HTMLInputElement | HTMLTextAreaElement,
  session: SessionInternals,
  text: string,
) {
  field.value = text;
  field.setSelectionRange(text.length, text.length);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  session.runIdleGrammar();
}

function key(field: HTMLElement, name: string): KeyboardEvent {
  const event = new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  field.dispatchEvent(event);
  return event;
}

function proposalRow(entry: SuggestionEntry): HTMLElement | null {
  return entry.list.querySelector<HTMLElement>("li[data-proposal]");
}

describe("grammar proposals while typing", () => {
  let release: (() => void) | null = null;

  beforeEach(async () => {
    release = await acquireDomGlobalLock();
    document.body.innerHTML = "";
    document.querySelectorAll('[id^="ft-menu-"]').forEach((node) => node.remove());
  });

  afterEach(() => {
    document.querySelectorAll('[id^="ft-menu-"]').forEach((node) => node.remove());
    release?.();
    release = null;
  });

  test("shows a finding after a pause and applies it only when the user picks it", () => {
    const runtime = makeRuntime();
    const field = document.createElement("textarea");
    const { entry, session } = attach(runtime, field);

    typeAndPause(field, session, "We is ready. ");
    expect(entry.grammarProposal?.original).toBe("is");
    expect(proposalRow(entry)?.textContent).toContain("is → are");
    expect(proposalRow(entry)?.getAttribute("aria-selected")).toBe("false");

    // Not selected: Tab and Enter stay the page's, and nothing is written.
    expect(key(field, "Tab").defaultPrevented).toBe(false);
    expect(key(field, "Enter").defaultPrevented).toBe(false);
    expect(field.value).toBe("We is ready. ");

    expect(key(field, "ArrowDown").defaultPrevented).toBe(true);
    expect(proposalRow(entry)?.getAttribute("aria-selected")).toBe("true");
    expect(key(field, "Tab").defaultPrevented).toBe(true);
    expect(field.value).toBe("We are ready. ");
    expect(entry.grammarProposal ?? null).toBeNull();
    runtime.detachAllHelpers();
  });

  test("a click on the row applies it", () => {
    const runtime = makeRuntime();
    const field = document.createElement("textarea");
    const { entry, session } = attach(runtime, field);

    typeAndPause(field, session, "They has left early. ");
    proposalRow(entry)?.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, composed: true }),
    );
    expect(field.value).toBe("They have left early. ");
    runtime.detachAllHelpers();
  });

  test("typing on, or Esc, dismisses the proposal for good", () => {
    const runtime = makeRuntime();
    const field = document.createElement("textarea");
    const { entry, session } = attach(runtime, field);

    typeAndPause(field, session, "We is ready. ");
    expect(entry.grammarProposal).not.toBeNull();
    field.value = "We is ready. S";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(entry.grammarProposal ?? null).toBeNull();
    expect(proposalRow(entry)).toBeNull();
    // The same span is not offered again after the next pause.
    typeAndPause(field, session, "We is ready. So ");
    expect(entry.grammarProposal ?? null).toBeNull();

    typeAndPause(field, session, "We is ready. They has left. ");
    expect(entry.grammarProposal?.original).toBe("has");
    key(field, "Escape");
    expect(entry.grammarProposal ?? null).toBeNull();
    typeAndPause(field, session, "We is ready. They has left. Then ");
    expect(entry.grammarProposal ?? null).toBeNull();
    expect(field.value).toBe("We is ready. They has left. Then ");
    runtime.detachAllHelpers();
  });

  test("never writes when the text changed under the proposal", () => {
    const runtime = makeRuntime();
    const field = document.createElement("textarea");
    const { entry, session } = attach(runtime, field);

    typeAndPause(field, session, "We is ready. ");
    expect(entry.grammarProposal).not.toBeNull();
    // The page rewrote the field without an input event.
    field.value = "You is ready. ";
    field.setSelectionRange(field.value.length, field.value.length);
    expect(session.acceptGrammarProposal()).toBe(false);
    expect(field.value).toBe("You is ready. ");
    runtime.detachAllHelpers();
  });

  test("text already in the field when it gains focus is not proposed", () => {
    const runtime = makeRuntime();
    const field = document.createElement("textarea");
    field.value = "We is ready. ";
    field.setSelectionRange(field.value.length, field.value.length);
    const { entry, session } = attach(runtime, field);

    typeAndPause(field, session, "We is ready. Now ");
    expect(entry.grammarProposal ?? null).toBeNull();
    runtime.detachAllHelpers();
  });

  test("nothing is proposed in sensitive fields or when proposals are off", () => {
    const sensitive = makeRuntime();
    const otp = document.createElement("input");
    otp.type = "text";
    otp.name = "otp";
    const guarded = attach(sensitive, otp);
    typeAndPause(otp, guarded.session, "We is ready. ");
    expect(guarded.entry.grammarProposal ?? null).toBeNull();
    sensitive.detachAllHelpers();

    const off = makeRuntime([]);
    const field = document.createElement("textarea");
    const plain = attach(off, field);
    typeAndPause(field, plain.session, "We is ready. ");
    expect(plain.entry.grammarProposal ?? null).toBeNull();
    off.detachAllHelpers();
  });
});
