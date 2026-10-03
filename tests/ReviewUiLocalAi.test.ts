import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  ReviewUi,
  type ReviewUiCallbacks,
} from "../src/adapters/chrome/content-script/review/ReviewUi";
import type { ReviewViewState } from "../src/core/application/review/ReviewSession";
import type {
  AiBatchPreview,
  ReviewAiViewState,
  RewriteViewState,
} from "../src/core/application/review/reviewAi";
import type { LocalAiStatus } from "../src/core/domain/contracts/localAi";
import {
  reviewExplanation,
  reviewExplanations,
} from "../src/core/domain/grammar/review/reviewExplanations";
import { reviewText } from "../src/core/domain/grammar/review/reviewMessages";
import { TEXT_EXPANDER_LANG } from "../src/core/domain/lang";
import {
  REVIEW_CATEGORIES,
  REVIEW_LOCAL_AI_CHECK,
  type ReviewDiagnostic,
} from "../src/core/domain/grammar/review/types";

type Listener = (event: Event) => void;

// jsdom events are never trusted and isTrusted cannot be redefined, so the
// listeners are recorded and called with a trusted-looking click instead.
const listeners = new WeakMap<EventTarget, Array<{ type: string; listener: Listener }>>();
const EventTargetProto = (window as unknown as { EventTarget: typeof EventTarget }).EventTarget
  .prototype;
const nativeAdd = EventTargetProto.addEventListener;

function trustedClick(target: Element): void {
  const event = { type: "click", isTrusted: true, detail: 1, target } as unknown as Event;
  for (const entry of listeners.get(target) ?? []) {
    if (entry.type === "click") entry.listener(event);
  }
}

function callbacks(): { [K in keyof ReviewUiCallbacks]: ReturnType<typeof jest.fn> } {
  const names: Array<keyof ReviewUiCallbacks> = [
    "close",
    "setLanguage",
    "retry",
    "select",
    "apply",
    "ignore",
    "ignoreMatching",
    "resetIgnores",
    "disableRule",
    "addToDictionary",
    "fixAll",
    "toggleCategory",
    "navigate",
    "setMode",
    "toggleAiPause",
    "aiSetup",
    "aiDismissSetup",
    "setRewriteStyle",
    "setRewriteContext",
    "generateRewrite",
    "cancelRewrite",
    "applyRewrite",
    "previewAiBatch",
    "applyAiBatch",
    "cancelAiBatch",
  ];
  return Object.fromEntries(names.map((name) => [name, jest.fn()])) as never;
}

function finding(id: string, overrides: Partial<ReviewDiagnostic> = {}): ReviewDiagnostic {
  return {
    id,
    snapshotId: "s1",
    ruleId: REVIEW_LOCAL_AI_CHECK,
    category: "grammar",
    messageKey: "review_msg_local_ai",
    lang: "en",
    range: { start: 4, end: 11 },
    original: "results",
    alternatives: [
      {
        edits: [{ start: 4, end: 11, original: "results", replacement: "result" }],
        preview: "result",
      },
    ],
    bulk: { eligible: false, reason: "local-ai" },
    context: { start: 0, end: 20 },
    ...overrides,
  };
}

const STATUS: LocalAiStatus = {
  enabled: true,
  consented: false,
  tier: "standard",
  modelId: "m",
  displayName: "Standard",
  downloadBytes: 970_000_000,
  install: "none",
  runtime: "unconfigured",
  offerSetup: true,
};

function ai(overrides: Partial<ReviewAiViewState> = {}): ReviewAiViewState {
  return {
    availability: "ready",
    coverage: "idle",
    status: STATUS,
    skippedChars: 0,
    offerSetup: false,
    ...overrides,
  };
}

function rewrite(overrides: Partial<RewriteViewState> = {}): RewriteViewState {
  return {
    style: "keep-voice",
    resolvedStyle: "keep-voice",
    contextHint: "general",
    status: "idle",
    before: "The results shows a problem.",
    after: null,
    hunks: [],
    rejection: null,
    kept: {},
    canApply: false,
    previewOnly: false,
    ...overrides,
  };
}

function state(overrides: Partial<ReviewViewState> = {}): ReviewViewState {
  return {
    status: "ready",
    language: { language: "en_US", source: "explicit", resource: "en_US" },
    checking: "checked",
    scopeKind: "field",
    capabilities: { inline: true, apply: true, bulk: true, undo: "single-step" },
    diagnostics: [],
    // What the engine sends with the findings.
    explanations: reviewExplanations(
      (overrides.diagnostics ?? []).map((d) => d.messageKey),
      "en",
    ),
    ignoredCount: 0,
    resolvedCount: 0,
    categories: new Set(REVIEW_CATEGORIES),
    selectedId: null,
    coverage: { checkedRules: [], failedRules: [], skipped: {} },
    truncated: 0,
    unread: 0,
    languageSkipped: 0,
    noRules: false,
    nativeGrammarDisabled: false,
    bulk: { count: 0, deferred: 0, pending: false },
    spelling: "done",
    notice: null,
    text: "The results shows a problem.",
    mode: "correct",
    ai: ai(),
    rewrite: null,
    aiBatch: null,
    ...overrides,
  };
}

describe("ReviewUi: Local AI", () => {
  let cb: ReturnType<typeof callbacks>;
  let ui: ReviewUi;
  const $ = <T extends Element = HTMLElement>(selector: string) =>
    ui.root.querySelector<T>(selector)!;
  const shown = (selector: string) => {
    const node = ui.root.querySelector<HTMLElement>(selector);
    return !!node && !node.closest("[hidden]");
  };

  beforeEach(() => {
    EventTargetProto.addEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (typeof listener === "function") {
        const list = listeners.get(this) ?? [];
        list.push({ type, listener: listener as Listener });
        listeners.set(this, list);
      }
      return nativeAdd.call(this, type, listener, options);
    };
    cb = callbacks();
    ui = new ReviewUi(document, "en", cb, []);
  });

  afterEach(() => {
    EventTargetProto.addEventListener = nativeAdd;
    ui.destroy();
  });

  test("empty results require a completed check before showing success", () => {
    for (const checking of [
      "inactive",
      "checking",
      "partial",
      "unsupported",
      "failed",
      "stale",
    ] as const) {
      ui.render(state({ checking }));
      expect(ui.root.textContent).not.toContain(reviewText("review_status_none", "en"));
      expect(ui.root.querySelector(".panel")?.getAttribute("data-checking")).toBe(checking);
      expect(ui.root.querySelector("[data-done]")).toBeNull();
    }
    ui.render(state({ checking: "checked" }));
    expect(ui.root.textContent).toContain(reviewText("review_status_none", "en"));
    ui.render(
      state({
        checking: "partial",
        language: { language: "en_GB", resource: "en_US", source: "explicit" },
      }),
    );
    expect(ui.root.textContent).toContain("Dictionary: en_US");
    expect(ui.root.querySelector<HTMLSelectElement>('[data-action="language"]')?.value).toBe(
      "en_GB",
    );
    expect(ui.root.querySelector('[data-action="retry"]')).not.toBeNull();
  });

  test("the language selector displays inherited Text Expander mode", () => {
    ui.render(
      state({
        checking: "unsupported",
        language: { language: TEXT_EXPANDER_LANG, resource: null, source: "explicit" },
      }),
    );
    const select = $<HTMLSelectElement>('[data-action="language"]');
    expect(select.value).toBe(TEXT_EXPANDER_LANG);
    expect(select.selectedOptions[0]?.textContent).toContain("Text Expander");
    expect(ui.root.querySelector("[data-done]")).toBeNull();
  });

  test("language and retry controls use session callbacks only for trusted events", () => {
    ui.render(state());
    const select = $<HTMLSelectElement>('[data-action="language"]');
    select.value = "pl_PL";
    select.dispatchEvent(new Event("change"));
    expect(cb.setLanguage).not.toHaveBeenCalled();
    for (const entry of listeners.get(select) ?? []) {
      if (entry.type === "change") entry.listener({ isTrusted: true } as Event);
    }
    expect(cb.setLanguage).toHaveBeenCalledWith("pl_PL");
    trustedClick($('[data-action="retry"]'));
    expect(cb.retry).toHaveBeenCalledTimes(1);
  });

  test("disabled native checks do not hide explicit AI findings", () => {
    ui.render(state({ noRules: true, nativeGrammarDisabled: true, diagnostics: [finding("ai")] }));
    expect(ui.root.textContent).not.toContain(reviewText("review_status_no_rules", "en"));
    expect(ui.root.textContent).toContain(reviewText("review_status_count", "en", { count: 1 }));
    ui.render(state({ noRules: true, nativeGrammarDisabled: true, checking: "inactive" }));
    expect(ui.root.textContent).toContain(reviewText("review_status_no_rules", "en"));
  });

  test("disabled native grammar has a visible scope note", () => {
    ui.render(state({ nativeGrammarDisabled: true, spelling: "done" }));
    expect(ui.root.textContent).toContain(reviewText("review_status_grammar_off", "en"));
    ui.render(state({ nativeGrammarDisabled: false }));
    expect(ui.root.textContent).not.toContain(reviewText("review_status_grammar_off", "en"));
  });

  test("a native Review-only finding copies only on a trusted click and never applies", async () => {
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      const diagnostic = finding("native", {
        ruleId: "englishContractionNormalization",
        messageKey: "review_msg_contraction",
      });
      ui.render(
        state({
          diagnostics: [diagnostic],
          capabilities: { inline: true, apply: false, bulk: false, undo: "none" },
        }),
      );
      ui.openCard(diagnostic, null);
      const copy = $<HTMLButtonElement>("[data-action=copy]");
      expect(copy).not.toBeNull();
      expect($<HTMLButtonElement>("[data-action=apply]").disabled).toBe(true);
      copy.click();
      expect(writeText).not.toHaveBeenCalled();
      trustedClick(copy);
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith("result");
      expect(cb.apply).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(window.navigator, "clipboard");
    }
  });

  test("Review-only choices select an alternative for Copy without applying it", async () => {
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      const diagnostic = finding("choice", {
        requiresChoice: true,
        alternatives: [
          { preview: "first", edits: [] },
          { preview: "second", edits: [] },
        ],
      });
      ui.render(
        state({
          diagnostics: [diagnostic],
          capabilities: { inline: true, apply: false, bulk: false, undo: "none" },
        }),
      );
      ui.openCard(diagnostic, null);
      const second = ui.root.querySelectorAll<HTMLButtonElement>(".card .alternatives button")[1];
      expect(second.disabled).toBe(false);
      second.click();
      expect(cb.apply).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
      trustedClick($(".card [data-action=copy]"));
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith("second");
      expect(cb.apply).not.toHaveBeenCalled();
      expect($<HTMLButtonElement>(".card [data-action=apply]").disabled).toBe(true);
    } finally {
      Reflect.deleteProperty(window.navigator, "clipboard");
    }
  });

  test("the mode switch is hidden while Local AI is off, unsupported or failed", () => {
    ui.render(state({ ai: ai({ availability: "off" }) }));
    expect(shown(".modes")).toBe(false);
    ui.render(state({ ai: ai({ availability: "unsupported" }) }));
    expect(shown(".modes")).toBe(false);
    expect($(".ai-line").textContent).toContain("isn't available");
    expect(shown("[data-action=ai-setup]")).toBe(false);
    ui.render(state({ ai: ai({ availability: "failed" }) }));
    expect(shown(".modes")).toBe(false);
    expect(shown("[data-action=ai-pause]")).toBe(false);
    expect($(".ai-line").textContent).toContain("did not finish");
    ui.render(state({ ai: ai({ availability: "language" }) }));
    expect(shown(".modes")).toBe(false);
    expect($(".ai-line").textContent).toContain("English text only");

    ui.render(state());
    const group = $(".modes");
    expect(shown(".modes")).toBe(true);
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("Review mode");
    expect($("[data-action=mode-correct]").getAttribute("aria-pressed")).toBe("true");
    expect($("[data-action=mode-rewrite]").getAttribute("aria-pressed")).toBe("false");
    $<HTMLButtonElement>("[data-action=mode-rewrite]").click();
    expect(cb.setMode).toHaveBeenCalledWith("rewrite");
  });

  test("the setup offer shows the download size and acts only on trusted clicks", () => {
    ui.render(state({ ai: ai({ availability: "setup-needed", offerSetup: true }) }));
    expect(shown(".setup")).toBe(true);
    expect($(".setup-size").textContent).toBe("One-time download: ≈ 0.97 GB");
    expect($(".setup").textContent).toContain("never uploaded");

    $<HTMLButtonElement>("[data-action=ai-setup]").click();
    $<HTMLButtonElement>("[data-action=ai-setup-later]").click();
    expect(cb.aiSetup).not.toHaveBeenCalled();
    expect(cb.aiDismissSetup).not.toHaveBeenCalled();

    trustedClick($("[data-action=ai-setup]"));
    expect(cb.aiSetup).toHaveBeenCalledTimes(1);
    trustedClick($("[data-action=ai-setup-later]"));
    expect(cb.aiDismissSetup).toHaveBeenCalledTimes(1);

    // Basic review stays usable around it.
    expect(shown(".list")).toBe(true);
    ui.render(state({ ai: ai({ availability: "setup-needed", offerSetup: false }) }));
    expect(shown(".setup")).toBe(false);
  });

  test("install-needed offers settings; installing reports progress", () => {
    ui.render(state({ ai: ai({ availability: "install-needed" }) }));
    expect(shown("[data-action=ai-settings]")).toBe(true);
    trustedClick($("[data-action=ai-settings]"));
    expect(cb.aiSetup).toHaveBeenCalledTimes(1);
    ui.render(
      state({ ai: ai({ availability: "installing", status: { ...STATUS, progress: 0.42 } }) }),
    );
    expect($(".ai-line").textContent).toBe("Local AI model is downloading: 42% (see settings).");
  });

  test("user-authored terminology explanations render only as text", () => {
    const diagnostic = finding("term", {
      ruleId: "preferredTerminology",
      messageKey: "review_msg_preferred_terminology",
      terminology: { id: "user-term", explanation: '<img src=x onerror="alert(1)">' },
    });
    ui.render(state({ diagnostics: [diagnostic] }));
    ui.openCard(diagnostic, null);
    expect($(".card").textContent).toContain('<img src=x onerror="alert(1)">');
    expect($(".card").textContent).toContain("user-authored advice");
    expect($(".card").querySelector("img")).toBeNull();
    expect($(".card").getAttribute("aria-label")).toContain("user-authored advice");
  });

  test("rule findings show the explanation sent with them; the page explains its own", () => {
    const rule = finding("rule", {
      ruleId: "englishRepeatedWords",
      messageKey: "review_msg_repeated_words",
    });
    ui.render(state({ diagnostics: [rule], explanations: { review_msg_repeated_words: "Sent." } }));
    ui.openCard(rule, null);
    expect($(".card p").textContent).toBe("Sent.");
    // The page has no table to fall back on.
    ui.render(state({ diagnostics: [rule], explanations: {} }));
    ui.openCard(rule, null);
    expect($(".card").textContent).not.toContain(
      reviewExplanation("review_msg_repeated_words", "en"),
    );
    const ai = finding("ai");
    ui.render(state({ diagnostics: [ai], explanations: {} }));
    ui.openCard(ai, null);
    expect($(".card").textContent).toContain(reviewText("review_msg_local_ai", "en"));
  });

  test("optional style advice has a separate count/filter and no default filter", () => {
    ui.render(state({ ai: ai({ availability: "off" }) }));
    expect(ui.root.querySelector('[data-category="style"]')).toBeNull();
    const advice = finding("style", {
      ruleId: "styleRedundancy",
      category: "style",
      messageKey: "review_msg_style_redundancy",
      bulk: { eligible: false, reason: "rule-not-batch-approved" },
    });
    ui.render(state({ diagnostics: [advice] }));
    expect($(".status").textContent).toContain("No issues found");
    expect($(".status").textContent).toContain("Style advice: 1.");
    expect($('.filter[data-category="style"]').getAttribute("aria-label")).toBe("Style advice (1)");
    trustedClick($('.filter[data-category="style"]'));
    expect(cb.toggleCategory).toHaveBeenCalledWith("style", false);
    ui.render(state({ diagnostics: [advice, finding("grammar")] }));
    expect($(".status").textContent).toContain("Issues: 1");
    expect($(".status").textContent).toContain("Style advice: 1.");
    ui.render(state({ ignoredAdviceCount: 1 }));
    expect($(".status").textContent).toContain("No issues found");
    expect($(".notes").textContent).toContain("Ignored style advice: 1.");
    expect(shown('[data-action="reset-ignores"]')).toBe(true);
  });

  test("paragraphs in another language are reported as a spelling gap", () => {
    const coverage = { checkedRules: [], failedRules: [], skipped: {} };
    ui.render(state({ coverage }));
    expect($(".notes").textContent).not.toContain("another language");
    ui.render(state({ coverage: { ...coverage, skipped: { "other-language": 84 } } }));
    expect($(".notes").textContent).toContain(
      "Spelling not checked in 84 characters that look like another language.",
    );
  });

  test("warning-only cards label the issue and offer no replacement action", () => {
    const diagnostic = finding("warning", {
      ruleId: "unclosedQuotation",
      messageKey: "review_msg_unclosed_quote",
      category: "punctuation",
      original: "“",
      warningOnly: true,
      alternatives: [],
      bulk: { eligible: false, reason: "warning-only" },
    });
    ui.render(state({ diagnostics: [diagnostic] }));
    expect(ui.root.textContent).toContain("Warning: “");
    ui.openCard(diagnostic, null);
    expect($(".card").getAttribute("aria-label")).toContain(
      "Punctuation & spacing · Punctuation marks, Warning:",
    );
    expect($(".card .category").textContent).toBe("Punctuation & spacing · Punctuation marks");
    expect($(".card").querySelector("[data-action=apply]")).toBeNull();
    expect($(".card").querySelector(".diff")).toBeNull();
    trustedClick($("[data-action=ignore]"));
    expect(cb.ignore).toHaveBeenCalledWith("warning");
    expect(cb.apply).not.toHaveBeenCalled();
  });

  test("matching ignores show session scope, stay separate from disable, and exclude AI", () => {
    const diagnostic = finding("native", {
      ruleId: "englishRepeatedWords",
      messageKey: "review_msg_repeated_words",
    });
    ui.render(state({ diagnostics: [diagnostic] }));
    ui.openCard(diagnostic, null);
    expect($("[data-action=ignore]").textContent).toBe("Ignore once");
    expect($("[data-action=ignore-matching]").textContent).toBe(
      "Ignore matching occurrences in this review",
    );
    expect($("#ft-review-ignore-matching-hint").textContent).toContain(
      "new occurrences are not ignored",
    );
    expect($("[data-action=disable-rule]")).toBeDefined();
    trustedClick($("[data-action=ignore-matching]"));
    expect(cb.ignoreMatching).toHaveBeenCalledWith("native");
    expect(cb.ignore).not.toHaveBeenCalled();
    expect(cb.disableRule).not.toHaveBeenCalled();
    ui.render(state({ ignoredCount: 2 }));
    expect(shown("[data-action=reset-ignores]")).toBe(true);
    trustedClick($("[data-action=reset-ignores]"));
    expect(cb.resetIgnores).toHaveBeenCalledTimes(1);
    ui.render(state({ ignoredCount: 0 }));
    expect(shown("[data-action=reset-ignores]")).toBe(false);
    ui.openCard(finding("ai"), null);
    expect($(".card").querySelector("[data-action=ignore-matching]")).toBeNull();
    expect($("[data-action=ignore]")).toBeDefined();
  });

  test("only native cards offer an accessible disable action and untrusted clicks do nothing", () => {
    for (const ruleId of [
      REVIEW_LOCAL_AI_CHECK,
      "reviewSpelling",
      "englishRepeatedWords",
    ] as const) {
      const diagnostic = finding("card", { ruleId });
      ui.render(state({ diagnostics: [diagnostic] }));
      ui.openCard(diagnostic, null);
      const button = $(".card").querySelector<HTMLButtonElement>('[data-action="disable-rule"]');
      if (ruleId !== "englishRepeatedWords") {
        expect(button).toBeNull();
        continue;
      }
      expect(button?.textContent).toBe("Disable this check in Review");
      expect(button?.disabled).toBe(false);
      button!.click();
      expect(cb.disableRule).not.toHaveBeenCalled();
      trustedClick(button!);
      expect(cb.disableRule).toHaveBeenCalledWith("card");
    }
  });

  test("AI findings carry a Local AI tag and keep their category badge", () => {
    const rule = finding("rule", { ruleId: "reviewSpelling", category: "spelling" });
    ui.render(state({ diagnostics: [finding("a"), rule] }));
    const item = $("[data-id=a]");
    expect(item.dataset.category).toBe("grammar");
    expect(item.querySelector(".badge")!.textContent).toBe("G");
    expect(item.querySelector(".tag")!.textContent).toBe("Local AI");
    expect(item.textContent).toContain("Local AI");
    expect($("[data-id=rule]").querySelector(".tag")).toBeNull();

    ui.openCard(finding("a"), null);
    const card = $(".card");
    expect(card.getAttribute("aria-label")).toBe(
      "Grammar, Local AI: Local AI correction. Check that the meaning is unchanged before applying.",
    );
    expect(card.querySelector(".tag")!.textContent).toBe("Local AI");
    expect(card.querySelector(".badge")!.textContent).toBe("G");
    expect(card.querySelector(".category")!.textContent).toBe("Grammar");
    expect(card.querySelector(".to")!.textContent).toBe("result");
    expect(card.textContent).toContain("Not included in Fix all");
    // The dictionary check has no kind: its category already says it.
    ui.openCard(rule, null);
    expect($(".card .category").textContent).toBe("Spelling");
  });

  test("a check's finding shows the Local AI option as labelled, not preselected", () => {
    const disputed = finding("rule", {
      ruleId: "englishContractionNormalization",
      category: "spelling",
      messageKey: "review_msg_contraction",
      original: "dont",
      range: { start: 4, end: 8 },
      alternatives: [
        { edits: [{ start: 4, end: 8, original: "dont", replacement: "don't" }], preview: "don't" },
        {
          edits: [{ start: 4, end: 8, original: "dont", replacement: "doesn't" }],
          preview: "doesn't",
          localAi: true,
        },
      ],
      bulk: { eligible: true, alternative: 0 },
    });
    ui.render(state({ diagnostics: [disputed] }));
    ui.openCard(disputed, null);
    const options = [...$(".card").querySelectorAll<HTMLButtonElement>(".alternatives button")];
    expect(options.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(options[0].querySelector(".tag")).toBeNull();
    expect(options[1].textContent).toContain("doesn't");
    expect(options[1].querySelector(".tag")!.textContent).toBe("Local AI");
  });

  test("coverage lines are distinct, and none claims AI completion when it did not", () => {
    const line = (
      coverage: ReviewAiViewState["coverage"],
      extra: Partial<ReviewAiViewState> = {},
    ) => {
      ui.render(state({ ai: ai({ coverage, ...extra }) }));
      return shown(".ai-line") ? $(".ai-line").textContent : null;
    };
    expect(line("idle")).toBeNull();
    expect(line("waiting")).toBe("Local AI: waiting for edits to settle…");
    expect(line("checking", { progress: 0.5 })).toBe("Checking context locally… 50%");
    expect(line("loading", { progress: 0 })).toBe("Local AI: loading model…");
    expect(line("loading")).toBe("Local AI: loading model…");
    expect(line("checking")).toBe("Checking context locally…");
    expect(line("complete")).toBe("Local AI check complete.");
    expect(line("partial", { skippedChars: 120 })).toBe(
      "Local AI checked part of the text; 120 characters were not checked.",
    );
    expect(line("partial")).toBe("Local AI checked only part of the text.");
    expect(line("failed")).toBe("Local AI did not finish; basic checks are shown.");
    // "No issues found" (basic checks) is its own statement.
    expect($(".status").textContent).toBe("No issues found by the review checks.");

    ui.render(state({ ai: ai({ availability: "paused", coverage: "cancelled" }) }));
    expect($(".ai-line").textContent).toBe("Local AI paused.");
    expect($("[data-action=ai-pause]").textContent).toBe("Resume local AI");
    $<HTMLButtonElement>("[data-action=ai-pause]").click();
    expect(cb.toggleAiPause).toHaveBeenCalledTimes(1);
  });

  test("only an AI pass ending is announced, once", () => {
    const announcer = () => $(".sr-only").textContent;
    ui.render(state({ ai: ai({ coverage: "checking", progress: 0 }) }));
    ui.render(state({ ai: ai({ coverage: "checking", progress: 0.5 }) }));
    expect(announcer()).toBe("");
    ui.render(state({ ai: ai({ coverage: "complete" }) }));
    expect(announcer()).toBe("Local AI check complete.");
    ui.render(state({ ai: ai({ coverage: "failed" }) }));
    expect(announcer()).toBe("Local AI did not finish; basic checks are shown.");
  });

  test("Fix all keeps its label; AI corrections have their own button", () => {
    const diagnostics = [
      finding("a"),
      finding("b", { range: { start: 12, end: 17 } }),
      finding("r", { ruleId: "reviewSpelling", bulk: { eligible: true, alternative: 0 } }),
    ];
    ui.render(state({ diagnostics, bulk: { count: 1, deferred: 0, pending: false } }));
    expect($("[data-action=fix-all]").textContent).toBe("Fix all safe (1)");
    const batch = $<HTMLButtonElement>("[data-action=ai-batch]");
    expect(shown("[data-action=ai-batch]")).toBe(true);
    expect(batch.textContent).toBe("Apply selected AI corrections (2)");
    expect(batch.classList.contains("primary")).toBe(false);
    batch.click();
    expect(cb.previewAiBatch).toHaveBeenCalledTimes(1);
    expect(cb.fixAll).not.toHaveBeenCalled();

    // One AI finding, or no bulk support: no batch button.
    ui.render(state({ diagnostics: [finding("a")] }));
    expect(shown("[data-action=ai-batch]")).toBe(false);
    ui.render(
      state({
        diagnostics,
        capabilities: { inline: true, apply: true, bulk: false, undo: "none" },
      }),
    );
    expect(shown("[data-action=ai-batch]")).toBe(false);
  });

  test("the batch preview lists the changes, explains exclusions, and Escape closes it first", () => {
    const diagnostics = [
      finding("a"),
      finding("b", {
        original: "shows",
        alternatives: [
          {
            edits: [{ start: 12, end: 17, original: "shows", replacement: "show" }],
            preview: "show",
          },
        ],
      }),
    ];
    const preview: AiBatchPreview = {
      diagnosticIds: ["a", "b"],
      excluded: 1,
      canApply: false,
    };
    ui.render(state({ diagnostics }));
    ui.openCard(diagnostics[0], null);
    ui.render(state({ diagnostics, aiBatch: preview }));
    expect(shown(".batch")).toBe(true);
    expect(Array.from(ui.root.querySelectorAll(".batch li")).map((li) => li.textContent)).toEqual([
      "results → result",
      "shows → show",
    ]);
    expect($(".batch").textContent).toContain("Left out: 1.");
    expect($<HTMLButtonElement>("[data-action=ai-batch-apply]").disabled).toBe(true);

    const escape = () =>
      $(".panel").dispatchEvent(
        new (window as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent(
          "keydown",
          { key: "Escape", bubbles: true, composed: true },
        ),
      );
    escape();
    expect(cb.cancelAiBatch).toHaveBeenCalledTimes(1);
    expect(ui.isCardOpen()).toBe(true);
    expect(cb.close).not.toHaveBeenCalled();

    ui.render(state({ diagnostics, aiBatch: { ...preview, canApply: true } }));
    const apply = $<HTMLButtonElement>("[data-action=ai-batch-apply]");
    expect(apply.disabled).toBe(false);
    apply.focus();
    // An equal preview in a new state object is not rebuilt out from under the focus.
    ui.render(state({ diagnostics, aiBatch: { ...preview, canApply: true } }));
    expect(ui.root.activeElement).toBe(apply);
    apply.click();
    expect(cb.applyAiBatch).toHaveBeenCalledTimes(1);

    ui.render(state({ diagnostics }));
    expect(shown(".batch")).toBe(false);
    escape();
    expect(ui.isCardOpen()).toBe(false);
    escape();
    expect(cb.close).toHaveBeenCalledTimes(1);
  });

  describe("Rewrite", () => {
    const rewriting = (r: Partial<RewriteViewState> = {}, extra: Partial<ReviewViewState> = {}) =>
      ui.render(state({ mode: "rewrite", rewrite: rewrite(r), ...extra }));

    test("replaces the findings view; choosing a style never generates", () => {
      rewriting();
      expect(shown(".rewrite")).toBe(true);
      for (const part of [".list", ".filters", "footer", ".status"]) {
        expect(shown(part)).toBe(false);
      }
      expect($("[data-action=mode-rewrite]").getAttribute("aria-pressed")).toBe("true");
      const style = $<HTMLSelectElement>("[data-action=rewrite-style]");
      expect(Array.from(style.options).map((o) => o.textContent)).toEqual([
        "Keep my voice",
        "Professional",
        "Friendly",
        "Concise",
        "Clearer",
        "Context-aware",
      ]);
      expect(style.value).toBe("keep-voice");
      expect(shown("[data-action=rewrite-context]")).toBe(false);
      style.value = "concise";
      style.dispatchEvent(new Event("change"));
      expect(cb.setRewriteStyle).toHaveBeenCalledWith("concise");
      expect(cb.generateRewrite).not.toHaveBeenCalled();
      $<HTMLButtonElement>("[data-action=rewrite-generate]").click();
      expect(cb.generateRewrite).toHaveBeenCalledTimes(1);
    });

    test("context-aware shows what it writes for and what it resolved to", () => {
      rewriting({ style: "context-aware", resolvedStyle: "friendly", contextHint: "chat" });
      expect(shown("[data-action=rewrite-context]")).toBe(true);
      const context = $<HTMLSelectElement>("[data-action=rewrite-context]");
      expect(context.value).toBe("chat");
      expect($(".using").textContent).toBe("Using: Friendly");
      context.value = "email";
      context.dispatchEvent(new Event("change"));
      expect(cb.setRewriteContext).toHaveBeenCalledWith("email");
    });

    test("generating offers Cancel, keeps focus in the panel, and never shows Apply", () => {
      rewriting();
      const generate = $<HTMLButtonElement>("[data-action=rewrite-generate]");
      generate.focus();
      rewriting({ status: "generating" });
      expect($(".rewrite-msg").textContent).toBe("Rewriting locally…");
      expect(shown("[data-action=rewrite-generate]")).toBe(false);
      expect(ui.root.activeElement).toBe($("[data-action=rewrite-cancel]"));
      $<HTMLButtonElement>("[data-action=rewrite-cancel]").click();
      expect(cb.cancelRewrite).toHaveBeenCalledTimes(1);
      expect(shown("[data-action=rewrite-apply]")).toBe(false);
    });

    test("a ready proposal shows a diff as text; Apply follows canApply", () => {
      const after = 'The result shows <img src=x onerror="alert(1)"> a problem.';
      const hunks = [
        { start: 4, end: 11, original: "results", replacement: "result" },
        { start: 17, end: 17, original: "", replacement: ' <img src=x onerror="alert(1)">' },
      ];
      rewriting({ status: "ready", after, hunks, canApply: false });
      expect(ui.root.querySelector("img")).toBeNull();
      expect($(".rewrite-diff .after").textContent).toBe(after);
      expect(
        Array.from(ui.root.querySelectorAll(".rewrite-diff ins")).map((n) => n.textContent),
      ).toEqual(["result", ' <img src=x onerror="alert(1)">']);
      expect($(".rewrite-diff .before del").textContent).toBe("results");
      expect($("[data-action=rewrite-generate]").textContent).toBe("Regenerate");
      const apply = $<HTMLButtonElement>("[data-action=rewrite-apply]");
      expect(shown("[data-action=rewrite-apply]")).toBe(true);
      expect(apply.disabled).toBe(true);
      expect($(".sr-only").textContent).toBe("Rewrite ready. Check the changes before applying.");

      rewriting({ status: "ready", after, hunks, canApply: true });
      expect(apply.disabled).toBe(false);
      apply.click();
      expect(cb.applyRewrite).toHaveBeenCalledTimes(1);
      expect(shown("[data-action=rewrite-copy]")).toBe(false);
    });

    test("a ready proposal says how many sentences were kept as written", () => {
      rewriting({ status: "ready", after: "The result shows a problem.", kept: { invented: 1 } });
      expect($(".rewrite-msg").textContent).toContain(
        "Sentences kept as you wrote them: 1 (their rewrite did not pass the safety checks).",
      );
    });

    test("preview-only offers Copy (trusted clicks only) instead of Apply", async () => {
      const writeText = jest.fn(() => Promise.resolve());
      Object.defineProperty(window.navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      rewriting({ status: "ready", after: "The result shows a problem.", previewOnly: true });
      expect(shown("[data-action=rewrite-apply]")).toBe(false);
      expect(shown("[data-action=rewrite-copy]")).toBe(true);
      expect($(".rewrite").textContent).toContain("review-only");
      expect(writeText).not.toHaveBeenCalled();

      $<HTMLButtonElement>("[data-action=rewrite-copy]").click();
      expect(writeText).not.toHaveBeenCalled();
      trustedClick($("[data-action=rewrite-copy]"));
      expect(writeText).toHaveBeenCalledWith("The result shows a problem.");
      await Promise.resolve();
      expect($(".copied").textContent).toBe("Copied");
      // A re-render of the same proposal keeps the confirmation.
      rewriting({ status: "ready", after: "The result shows a problem.", previewOnly: true });
      expect($(".copied").textContent).toBe("Copied");
      Reflect.deleteProperty(window.navigator, "clipboard");
    });

    test("stale, too-long, rejected and failed say what happened", () => {
      rewriting({ status: "stale" });
      expect($(".rewrite-msg").textContent).toBe("Text changed. Generate again.");
      rewriting({ status: "too-long" });
      expect($(".rewrite-msg").textContent).toBe(
        "Select a shorter passage (up to about 2,000 characters) to rewrite.",
      );
      expect($<HTMLButtonElement>("[data-action=rewrite-generate]").disabled).toBe(true);
      rewriting({ status: "rejected", rejection: "number", after: "The results show 3 problems." });
      expect($(".rewrite-msg").textContent).toBe(
        "The rewrite was discarded: it changed a number, which could change a fact. Your text is unchanged. Generate again or try another style.",
      );
      expect($<HTMLButtonElement>("[data-action=rewrite-apply]").disabled).toBe(true);
      rewriting({ status: "failed" });
      expect($(".rewrite-msg").textContent).toBe(
        "Local AI could not finish the rewrite. Try again.",
      );
    });

    test("Rewrite without a usable model points to settings instead of generating", () => {
      rewriting({}, { ai: ai({ availability: "setup-needed", offerSetup: false }) });
      expect($(".ai-line").textContent).toBe(
        "Rewriting needs the local AI model. Set it up in settings.",
      );
      expect(shown("[data-action=ai-settings]")).toBe(true);
      expect($<HTMLButtonElement>("[data-action=rewrite-generate]").disabled).toBe(true);
    });
  });
});
