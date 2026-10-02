import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { SuggestionManagerRuntime } from "../src/adapters/chrome/content-script/suggestions/SuggestionManagerRuntime";
import type { SuggestionEntry } from "../src/adapters/chrome/content-script/suggestions/types";
import { reviewRuleIds } from "../src/core/domain/grammar/review/reviewCatalog";
import { LocalReviewEngine } from "../src/core/application/review/LocalReviewEngine";
import { reviewExplanation } from "../src/core/domain/grammar/review/reviewExplanations";
import { acquireDomGlobalLock } from "./support/domGlobalLock";

type SessionInternals = {
  runIdleGrammar(): void;
  acceptGrammarProposal(): boolean;
};

/** Proposals are detected asynchronously (in the background, in production): let them land. */
const answers = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeRuntime(
  grammarProposalRules: string[] = reviewRuleIds({ codeMode: false }),
  engine = new LocalReviewEngine(),
  uiLanguage?: string,
) {
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
    uiLanguage,
    findLiveProposals: (beforeCursor, options, language) =>
      engine.liveProposals(beforeCursor, options, language),
    userDictionaryList: [],
    getPrediction: jest.fn(),
  });
}

async function attach(
  runtime: SuggestionManagerRuntime,
  field: HTMLInputElement | HTMLTextAreaElement,
) {
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
  await answers();
  return { entry, session: internals.sessionRegistry.get(entry.id)! };
}

/** Types `text` as one edit, then lets the pause after it pass and its proposals land. */
async function typeAndPause(
  field: HTMLInputElement | HTMLTextAreaElement,
  session: SessionInternals,
  text: string,
) {
  field.value = text;
  field.setSelectionRange(text.length, text.length);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  session.runIdleGrammar();
  await answers();
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

  test("shows a finding after a pause and applies it only when the user picks it", async () => {
    const runtime = makeRuntime();
    const field = document.createElement("textarea");
    const { entry, session } = await attach(runtime, field);

    await typeAndPause(field, session, "We is ready. ");
    expect(entry.grammarProposal?.original).toBe("is");
    expect(proposalRow(entry)?.textContent).toContain("is → are");
    expect(proposalRow(entry)?.getAttribute("aria-selected")).toBe("false");
    // Explained in the browser's language when no UI language is set.
    expect(proposalRow(entry)?.title).toBe(reviewExplanation("review_msg_pronoun_verb", "en"));

    // Not selected: Tab and Enter stay the page's, and nothing is written.
    expect(key(field, "Tab").defaultPrevented).toBe(false);
    expect(key(field, "Enter").defaultPrevented).toBe(false);
    expect(field.value).toBe("We is ready. ");

    expect(key(field, "ArrowDown").defaultPrevented).toBe(true);
    expect(proposalRow(entry)?.getAttribute("aria-selected")).toBe("true");
    expect(key(field, "Tab").defaultPrevented).toBe(true);
    // Found again (asynchronously) in the unchanged text, then written.
    await answers();
    expect(field.value).toBe("We are ready. ");
    expect(entry.grammarProposal ?? null).toBeNull();
    runtime.detachAllHelpers();
  });

  test("a slow focus baseline does not swallow a newly typed grammar finding", async () => {
    const engine = new LocalReviewEngine();
    const find = engine.liveProposals.bind(engine);
    let releaseBaseline!: () => void;
    const baseline = new Promise<void>((resolve) => {
      releaseBaseline = resolve;
    });
    engine.liveProposals = async (...args) => {
      if (args[0] === "") await baseline;
      return find(...args);
    };
    const runtime = makeRuntime(undefined, engine);
    const field = document.createElement("textarea");
    document.body.append(field);
    runtime.queryAndAttachHelper();
    field.focus();
    await answers();
    const internals = runtime as unknown as {
      entryRegistry: { getByElement: (element: Element) => SuggestionEntry };
      sessionRegistry: Map<number, SessionInternals>;
    };
    const entry = internals.entryRegistry.getByElement(field);
    const session = internals.sessionRegistry.get(entry.id)!;
    await typeAndPause(field, session, "We is ready. ");
    releaseBaseline();
    await answers();
    expect(entry.grammarProposal?.original).toBe("is");
    runtime.detachAllHelpers();
  });

  test("the row's explanation comes from the background in the popup's UI language", async () => {
    const engine = new LocalReviewEngine();
    const asked: string[] = [];
    const live = engine.liveProposals.bind(engine);
    engine.liveProposals = (beforeCursor, options, uiLanguage) => {
      asked.push(uiLanguage);
      return live(beforeCursor, options, uiLanguage);
    };
    const runtime = makeRuntime(undefined, engine, "pl");
    const field = document.createElement("textarea");
    const { entry, session } = await attach(runtime, field);

    await typeAndPause(field, session, "We is ready. ");
    expect(new Set(asked)).toEqual(new Set(["pl"]));
    expect(entry.grammarProposal?.explanation).toBe(
      reviewExplanation("review_msg_pronoun_verb", "pl"),
    );
    expect(proposalRow(entry)?.title).toBe(reviewExplanation("review_msg_pronoun_verb", "pl"));
    expect(proposalRow(entry)?.textContent).toContain(
      reviewExplanation("review_msg_pronoun_verb", "pl"),
    );
    runtime.detachAllHelpers();
  });

  test("a click on the row applies it", async () => {
    const runtime = makeRuntime();
    const field = document.createElement("textarea");
    const { entry, session } = await attach(runtime, field);

    await typeAndPause(field, session, "They has left early. ");
    proposalRow(entry)?.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, composed: true }),
    );
    await answers();
    expect(field.value).toBe("They have left early. ");
    runtime.detachAllHelpers();
  });

  test("typing on, or Esc, dismisses the proposal for good", async () => {
    const runtime = makeRuntime();
    const field = document.createElement("textarea");
    const { entry, session } = await attach(runtime, field);

    await typeAndPause(field, session, "We is ready. ");
    expect(entry.grammarProposal).not.toBeNull();
    field.value = "We is ready. S";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(entry.grammarProposal ?? null).toBeNull();
    expect(proposalRow(entry)).toBeNull();
    // The same span is not offered again after the next pause.
    await typeAndPause(field, session, "We is ready. So ");
    expect(entry.grammarProposal ?? null).toBeNull();

    await typeAndPause(field, session, "We is ready. They has left. ");
    expect(entry.grammarProposal?.original).toBe("has");
    key(field, "Escape");
    expect(entry.grammarProposal ?? null).toBeNull();
    await typeAndPause(field, session, "We is ready. They has left. Then ");
    expect(entry.grammarProposal ?? null).toBeNull();
    expect(field.value).toBe("We is ready. They has left. Then ");
    runtime.detachAllHelpers();
  });

  test("never writes when the text changed under the proposal", async () => {
    const runtime = makeRuntime();
    const field = document.createElement("textarea");
    const { entry, session } = await attach(runtime, field);

    await typeAndPause(field, session, "We is ready. ");
    expect(entry.grammarProposal).not.toBeNull();
    // The page rewrote the field without an input event.
    field.value = "You is ready. ";
    field.setSelectionRange(field.value.length, field.value.length);
    expect(session.acceptGrammarProposal()).toBe(false);
    await answers();
    expect(field.value).toBe("You is ready. ");
    runtime.detachAllHelpers();
  });

  test("text already in the field when it gains focus is not proposed", async () => {
    const runtime = makeRuntime();
    const field = document.createElement("textarea");
    field.value = "We is ready. ";
    field.setSelectionRange(field.value.length, field.value.length);
    const { entry, session } = await attach(runtime, field);

    await typeAndPause(field, session, "We is ready. Now ");
    expect(entry.grammarProposal ?? null).toBeNull();
    runtime.detachAllHelpers();
  });

  test("nothing is proposed in sensitive fields or when proposals are off", async () => {
    const sensitive = makeRuntime();
    const otp = document.createElement("input");
    otp.type = "text";
    otp.name = "otp";
    document.body.append(otp);
    sensitive.queryAndAttachHelper();
    expect(otp.hasAttribute("data-suggestion")).toBe(false);
    sensitive.detachAllHelpers();

    const off = makeRuntime([]);
    const field = document.createElement("textarea");
    const plain = await attach(off, field);
    await typeAndPause(field, plain.session, "We is ready. ");
    expect(plain.entry.grammarProposal ?? null).toBeNull();
    off.detachAllHelpers();
  });

  test("an answer for text that has changed since is not shown", async () => {
    const engine = new LocalReviewEngine();
    const runtime = makeRuntime(undefined, engine);
    const field = document.createElement("textarea");
    const { entry, session } = await attach(runtime, field);
    // The background answers late: after the user typed on.
    let release!: () => void;
    const late = new Promise<void>((resolve) => (release = resolve));
    const find = engine.liveProposals.bind(engine);
    engine.liveProposals = async (...args) => {
      await late;
      return find(...args);
    };
    await typeAndPause(field, session, "We is ready. ");
    field.value = "We is ready. N";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    release();
    await answers();
    expect(entry.grammarProposal ?? null).toBeNull();
    expect(proposalRow(entry)).toBeNull();
    runtime.detachAllHelpers();
  });

  test("without an answer from the background nothing is proposed or written", async () => {
    const engine = new LocalReviewEngine();
    const runtime = makeRuntime(undefined, engine);
    const field = document.createElement("textarea");
    const { entry, session } = await attach(runtime, field);
    engine.liveProposals = () => Promise.reject(new Error("no answer"));
    await typeAndPause(field, session, "We is ready. ");
    expect(entry.grammarProposal ?? null).toBeNull();
    expect(field.value).toBe("We is ready. ");
    runtime.detachAllHelpers();
  });

  test("an accept is written only if re-detection still finds it in unchanged text", async () => {
    const engine = new LocalReviewEngine();
    const runtime = makeRuntime(undefined, engine);
    const field = document.createElement("textarea");
    const { entry, session } = await attach(runtime, field);
    await typeAndPause(field, session, "We is ready. ");
    expect(entry.grammarProposal?.original).toBe("is");
    const calls: string[] = [];
    const find = engine.liveProposals.bind(engine);
    engine.liveProposals = (beforeCursor, options) => {
      calls.push(beforeCursor);
      return find(beforeCursor, options);
    };
    expect(session.acceptGrammarProposal()).toBe(true);
    // The page rewrote the field while re-detection was on its way: nothing is written.
    field.value = "We is ready now. ";
    field.setSelectionRange(field.value.length, field.value.length);
    await answers();
    expect(calls).toEqual(["We is ready. "]);
    expect(field.value).toBe("We is ready now. ");
    runtime.detachAllHelpers();
  });
});
