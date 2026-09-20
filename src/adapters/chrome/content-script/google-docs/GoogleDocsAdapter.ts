import { LANG_SEPARATOR_CHARS_REGEX } from "@core/domain/lang";
import type { GrammarEventType } from "@core/domain/grammar/types";
import type { PredictionInputAction } from "@core/domain/messageTypes";
import {
  SuggestionPredictionCoordinator,
  type PredictionSessionState,
} from "../suggestions/SuggestionPredictionCoordinator";
import { SuggestionGrammarCoordinator } from "../suggestions/SuggestionGrammarCoordinator";
import { SuggestionTelemetryService } from "../suggestions/SuggestionTelemetryService";
import { SuggestionPersonalizationService } from "../suggestions/SuggestionPersonalizationService";
import type { PredictionResponse, SuggestionManagerOptions } from "../suggestions/types";
import {
  DOCS_SESSION_ID,
  KEY_EVENT,
  KEY_STATE_ATTR,
  KEY_ACK_ATTR,
  parseObject,
  planCompletion,
  planGrammar,
  sameSnapshot,
  snapshotContext,
  type DocsSnapshot,
  type DocsReply,
  type DocsEdit,
} from "./GoogleDocsModel";
import { getDocsInput, type DocsInput } from "./GoogleDocsEnvironment";
import { GoogleDocsBridgeClient } from "./GoogleDocsBridgeClient";
import { GoogleDocsView } from "./GoogleDocsView";

/** Beyond this, the change is not a typing burst worth re-judging character by character. */
const MAX_REPLAY = 64;

/** These read the start of the context as a real beginning; a cut window is not one. */
const START_SENSITIVE_RULES = ["capitalizeSentenceStart", "capitalizeAfterLineBreak"] as const;

/** The model as grammar last saw it, plus how far through it grammar has ruled. */
interface GrammarBaseline extends DocsSnapshot {
  /** Absolute offset; everything before it has already been judged. */
  judged: number;
}

/**
 * The positions to judge, oldest first. The document must be the baseline with a plain
 * insertion run at its caret - anything else (a deletion, a moved selection, a shifted
 * window, an edit made elsewhere, a host that rewrote our own write) gives the caret
 * alone, which is what the adapter did before. `judged` is what lets a correction made
 * mid-burst resume: the characters typed after it have still never been ruled on.
 */
function replayCursors(baseline: GrammarBaseline | null, snapshot: DocsSnapshot): number[] {
  const caret = snapshot.anchor - snapshot.windowStart;
  if (
    !baseline ||
    baseline.scope !== snapshot.scope ||
    baseline.windowStart !== snapshot.windowStart ||
    baseline.anchor !== baseline.focus
  )
    return [caret];
  const was = baseline.anchor - baseline.windowStart;
  const judged = baseline.judged - snapshot.windowStart;
  const inserted = snapshot.documentLength - baseline.documentLength;
  const count = caret - judged;
  if (
    was < 0 ||
    judged < 0 ||
    inserted < 0 ||
    inserted > MAX_REPLAY ||
    count <= 0 ||
    count > MAX_REPLAY ||
    caret !== was + inserted ||
    snapshot.text.slice(0, was) !== baseline.text.slice(0, was) ||
    snapshot.text.slice(caret) !== baseline.text.slice(was)
  )
    return [caret];
  return Array.from({ length: count }, (_, index) => judged + index + 1);
}

/** The baseline the document reaches once `edit` lands, judged up to the text it wrote. */
function projectBaseline(snapshot: DocsSnapshot, edit: DocsEdit): GrammarBaseline | null {
  const start = edit.start - snapshot.windowStart;
  const end = edit.end - snapshot.windowStart;
  if (start < 0 || end < start || end > snapshot.text.length) return null;
  const text = snapshot.text.slice(0, start) + edit.replacement + snapshot.text.slice(end);
  return {
    ...snapshot,
    text,
    documentLength: snapshot.documentLength + edit.replacement.length - (end - start),
    anchor: edit.cursorAfter,
    focus: edit.cursorAfter,
    judged: edit.start + edit.replacement.length,
  };
}

interface Acceptance {
  triggerText: string;
  insertedText: string;
  language: string;
  suggestion: string;
}
interface TrackedEdit {
  operationId?: string;
  acceptance: Acceptance | null;
  before: DocsSnapshot;
}
interface HistoryEdit extends TrackedEdit {
  operationId: string;
  eventId: string;
  active: boolean;
}

/** Async canvas-editor adapter using the normal predictor, grammar rules, theme and local services. */
export class GoogleDocsAdapter {
  private readonly prediction: SuggestionPredictionCoordinator;
  private readonly grammar: SuggestionGrammarCoordinator;
  private readonly state: PredictionSessionState = {
    id: DOCS_SESSION_ID,
    requestId: 0,
    latestMentionText: "",
    latestMentionStart: 0,
    pendingRequestTimer: null,
  };
  private readonly bridge = new GoogleDocsBridgeClient();
  private readonly view: GoogleDocsView;
  private readonly telemetry;
  private readonly personalization;
  private snapshot: DocsSnapshot | null = null;
  private requested: { id: number; snapshot: DocsSnapshot } | null = null;
  private suggestions: string[] = [];
  private selectedIndex = 0;
  private input: DocsInput | null = null;
  private epoch = 0;
  private composing = false;
  private disposed = false;
  private reading = false;
  private applying = false;
  private uncertain: TrackedEdit | null = null;
  private lastEdit: HistoryEdit | null = null;
  private grammarSuppressed: DocsSnapshot | null = null;
  // Reading the Docs model is a cross-world round trip, so a refresh scheduled for one
  // keystroke is routinely cancelled by the next one. Triggers outlive that cancellation
  // and are consumed only once grammar has actually looked at them, otherwise the
  // wordBoundary that completes a word is lost whenever typing does not pause.
  private readonly pendingTriggers = new Set<GrammarEventType>();
  private pendingAction: PredictionInputAction | undefined;
  // A refresh that arrives while the host is busy must not be dropped: the keystroke
  // that produced it is the only thing that will ever carry its triggers.
  private rerun = false;
  // The model as it stood when grammar last looked at it. The difference against the
  // next snapshot is what tells us which characters the user typed in between.
  private grammarBaseline: GrammarBaseline | null = null;
  private visible = false;
  private failureStatus: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly keyListener = (event: Event) => this.onKey(event as KeyboardEvent);
  private readonly inputListener = (event: Event) => this.onInput(event as InputEvent);
  private readonly compositionStart = () => {
    this.composing = true;
    this.dismiss();
  };
  private readonly compositionEnd = () => {
    this.composing = false;
    this.scheduleRefresh("insert", [], 60);
  };
  private readonly navigationListener = (event: Event) => {
    const owned = event
      .composedPath()
      .some(
        (node) =>
          node instanceof Element &&
          (node.id === `ft-menu-${DOCS_SESSION_ID}` ||
            node.hasAttribute("data-ft-suggestion-owned")),
      );
    if (!owned && !this.applying) this.dismiss();
  };
  private readonly layoutListener = () => this.render();
  private readonly bridgeKeyListener = (event: Event) => {
    const value = parseObject((event as CustomEvent<unknown>).detail);
    if (
      !value ||
      typeof value.id !== "string" ||
      value.token !== this.snapshot?.token ||
      typeof value.key !== "string"
    )
      return;
    const input = getDocsInput();
    if (!input || !this.handleKey(value.key)) return;
    input.frame.setAttribute(KEY_ACK_ATTR, value.id);
  };

  constructor(private readonly options: SuggestionManagerOptions) {
    this.telemetry = options.telemetry ?? new SuggestionTelemetryService();
    this.personalization = options.personalization ?? new SuggestionPersonalizationService();
    this.prediction = new SuggestionPredictionCoordinator({
      debounceByAction: { insert: 20, delete: 12, other: 20 },
      lang: options.lang,
      minWordLengthToPredict: options.minWordLengthToPredict,
      separatorRegex: LANG_SEPARATOR_CHARS_REGEX[options.lang] ?? /\s+/,
      getPrediction: (context) => {
        if (!this.snapshot || this.disposed || this.applying || this.composing) return;
        this.requested = { id: context.requestId, snapshot: this.snapshot };
        options.getPrediction(context);
      },
    });
    this.grammar = new SuggestionGrammarCoordinator({
      enabledGrammarRules: options.enabledGrammarRules,
      insertSpaceAfterAutocomplete: options.insertSpaceAfterAutocomplete,
      lang: options.lang,
      userDictionaryList: options.userDictionaryList,
    });
    this.view = new GoogleDocsView({
      inline: options.inline_suggestion,
      digits: options.selectByDigit,
      langHeader: options.displayLangHeader,
      findToken: (text) => this.prediction.findMentionToken(text),
      accept: (index) => {
        this.accept(index);
      },
    });
  }

  start(): void {
    if (this.disposed || this.pollTimer !== null) return;
    document.addEventListener(KEY_EVENT, this.bridgeKeyListener);
    document.addEventListener("pointerdown", this.navigationListener, true);
    window.addEventListener("scroll", this.layoutListener, true);
    window.addEventListener("resize", this.layoutListener);
    document.addEventListener("visibilitychange", this.navigationListener);
    this.pollTimer = setInterval(() => {
      void this.refresh();
    }, 200);
    void this.refresh();
  }
  dispose(): void {
    if (this.disposed) return;
    this.dismiss();
    this.disposed = true;
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.bind(null);
    this.bridge.dispose();
    this.view.dispose();
    document.removeEventListener(KEY_EVENT, this.bridgeKeyListener);
    document.removeEventListener("pointerdown", this.navigationListener, true);
    window.removeEventListener("scroll", this.layoutListener, true);
    window.removeEventListener("resize", this.layoutListener);
    document.removeEventListener("visibilitychange", this.navigationListener);
  }
  updateLanguage(lang: string): void {
    this.options.lang = lang;
    this.dismiss();
    this.prediction.updateLang(lang, LANG_SEPARATOR_CHARS_REGEX[lang] ?? /\s+/);
    this.grammar.updateLanguage(lang);
    void this.refresh(true);
  }
  triggerActiveSuggestion(): void {
    void this.refresh(true);
  }
  fulfillPrediction(response: PredictionResponse): void {
    void this.receivePrediction(response);
  }

  private async receivePrediction(response: PredictionResponse): Promise<void> {
    const request = this.requested;
    if (
      !request ||
      response.suggestionId !== DOCS_SESSION_ID ||
      request.id !== response.requestId ||
      this.state.requestId !== response.requestId ||
      this.disposed ||
      this.applying ||
      this.composing
    )
      return;
    const epoch = this.epoch;
    const reply = await this.bridge.read();
    if (
      epoch !== this.epoch ||
      this.requested !== request ||
      this.disposed ||
      this.applying ||
      !reply.snapshot ||
      !sameSnapshot(request.snapshot, reply.snapshot) ||
      !getDocsInput()
    )
      return;
    this.snapshot = reply.snapshot;
    this.suggestions = (Array.isArray(response.predictions) ? response.predictions : [])
      .filter((text): text is string => typeof text === "string" && this.completion(text) !== null)
      .slice(0, 10);
    this.selectedIndex = 0;
    this.render(response.lang);
    if (this.visible)
      this.telemetry.recordSuggestionShown({
        suggestionCount: this.suggestions.length,
        language: response.lang,
      });
  }

  private async refresh(
    force = false,
    action?: PredictionInputAction,
    triggers: GrammarEventType[] = [],
  ): Promise<void> {
    for (const trigger of triggers) this.pendingTriggers.add(trigger);
    if (action) this.pendingAction = action;
    if (this.disposed || this.composing || document.hidden) return;
    if (this.applying || this.reading) {
      if (this.pendingTriggers.size || force) this.rerun = true;
      return;
    }
    const input = getDocsInput();
    if (!input) {
      this.bind(null);
      this.dismiss();
      return;
    }
    this.bind(input);
    const epoch = this.epoch;
    this.reading = true;
    let reply: DocsReply;
    try {
      reply = await this.bridge.read();
    } catch {
      reply = { status: "unavailable" };
    } finally {
      this.reading = false;
      this.drainRerun();
    }
    if (this.disposed || epoch !== this.epoch || this.applying) return;
    if (reply.status !== "ready" || !reply.snapshot) {
      if (this.failureStatus !== reply.status) {
        this.invalidatePrediction();
        this.snapshot = null;
        this.clearVisual();
        this.view.status(reply.status);
      }
      this.failureStatus = reply.status;
      return;
    }
    this.failureStatus = null;
    this.observeHistory(reply);
    // A ready host has acknowledged or dropped its journal; a dropped edit is not learned.
    this.uncertain = null;
    const snapshot = reply.snapshot;
    const changed = !this.snapshot || !sameSnapshot(this.snapshot, snapshot);
    if (this.hasNativePopup()) {
      this.invalidatePrediction();
      this.clearVisual();
      return;
    }
    if (!changed && !force && !this.pendingTriggers.size) {
      // Reads rotate the bounded single-use-token cache even while the text is unchanged.
      // Renew the visible edit capability without re-requesting or re-announcing suggestions.
      this.snapshot = snapshot;
      this.updateKeyState();
      return;
    }
    if (changed) {
      this.invalidatePrediction();
      this.clearVisual();
    }
    this.snapshot = snapshot;
    if (this.hasNativePopup()) {
      this.clearVisual();
      return;
    }
    if (this.grammarSuppressed && !sameSnapshot(this.grammarSuppressed, snapshot))
      this.grammarSuppressed = null;
    const context = snapshotContext(snapshot);
    if (
      this.pendingTriggers.size &&
      !this.grammarSuppressed &&
      this.grammar.hasEnabledRules() &&
      snapshot.anchor === snapshot.focus
    ) {
      const collected = [...this.pendingTriggers];
      const collectedAction = this.pendingAction;
      this.clearPendingTriggers();
      // The baseline is left alone while an edit is outstanding: apply() advances it only
      // once the write lands, so a write that never happened is retried from the same spot.
      const edit = this.planGrammarEdit(snapshot, this.grammarBaseline, collected, collectedAction);
      if (edit) {
        void this.apply(edit, null);
        return;
      }
    }
    // Nothing left to rule on before the caret.
    this.grammarBaseline = { ...snapshot, judged: snapshot.anchor };
    if (snapshot.anchor !== snapshot.focus && !force) {
      this.clearVisual();
      return;
    }
    // Selected text is supplied as the explicit trigger; no autonomous selection replacement.
    this.prediction.schedule(this.state, {
      force,
      inputAction: action ?? this.pendingAction,
      beforeCursorOverride: context.beforeCursor + context.selectedText,
      afterCursorOverride: context.afterCursor,
      clearSuggestions: () => this.clearVisual(),
    });
  }

  /**
   * Judge every position the user typed through since grammar last looked, not only the
   * one the caret has ended up on. Reading the Docs model is a cross-world round trip, so
   * at speed the boundary that completes a word is already buried under the next few
   * keystrokes by the time the text comes back, and a rule that anchors at the caret can
   * never see it. Two snapshots are enough to recover which characters are new and to
   * rule on each of them where it was actually typed.
   */
  private planGrammarEdit(
    snapshot: DocsSnapshot,
    baseline: GrammarBaseline | null,
    collected: GrammarEventType[],
    action: PredictionInputAction | undefined,
  ): DocsEdit | null {
    const caret = snapshot.anchor - snapshot.windowStart;
    // A paste is one event, not a run of keystrokes; it is judged only where it landed.
    const cursors = collected.includes("paste") ? [caret] : replayCursors(baseline, snapshot);
    for (const cursor of cursors) {
      const beforeCursor = snapshot.text.slice(0, cursor);
      // Anchor on a real line break and keep it: capitalizeAfterLineBreak needs the break
      // that opens the current paragraph, and trimSpaceBeforeLineBreak needs the line
      // before it, so the anchor is the break one paragraph further back.
      const lastBreak = beforeCursor.lastIndexOf("\n");
      const anchored =
        snapshot.windowStart === 0
          ? 0
          : lastBreak > 0
            ? beforeCursor.lastIndexOf("\n", lastBreak - 1)
            : -1;
      // Failing that, the context begins at an arbitrary cut, and a paragraph longer than
      // the window has no break to anchor on at all - which is an ordinary long document,
      // not an edge case. Only the two rules that read position 0 as a real beginning can
      // be misled by that, so they sit it out instead of every rule doing so.
      const grammar = this.grammar.run({
        // A Docs body is prose. The model exposes no code/readonly styling, so the
        // DOM-based probe the generic path uses has nothing to inspect here; the
        // single-use-token transaction supplies the re-verification `strict` wants.
        measurementContext: "prose",
        beforeCursor: beforeCursor.slice(Math.max(0, anchored)),
        afterCursor: snapshot.text.slice(cursor).split("\n")[0],
        excludeRules: anchored < 0 ? START_SENSITIVE_RULES : undefined,
        // A replayed position is an insertion by construction, and its triggers come
        // from the character itself rather than from a key event that is long gone.
        inputAction: cursor === caret ? action : "insert",
        triggers: cursor === caret ? collected : this.charTriggers(snapshot.text[cursor - 1]),
      });
      const edit = grammar && planGrammar(snapshot, grammar, cursor);
      if (edit) return edit;
    }
    return null;
  }
  private charTriggers(char: string): GrammarEventType[] {
    const triggers: GrammarEventType[] = ["insertChar"];
    if (char === "\n" || this.prediction.isSeparator(char)) triggers.push("wordBoundary");
    return triggers;
  }
  private completion(text: string): DocsEdit | null {
    return (
      this.snapshot &&
      planCompletion(
        this.snapshot,
        text,
        (value) => this.prediction.findMentionToken(value),
        (char) => this.prediction.isSeparator(char),
        this.options.insertSpaceAfterAutocomplete,
      )
    );
  }
  private accept(index: number): boolean {
    if (
      !this.visible ||
      this.applying ||
      this.composing ||
      this.disposed ||
      this.uncertain ||
      !this.snapshot
    )
      return false;
    const suggestion = this.suggestions[index];
    const edit = suggestion && this.completion(suggestion);
    if (!edit) return false;
    const context = snapshotContext(this.snapshot);
    const acceptance = {
      triggerText:
        context.selectedText || this.prediction.findMentionToken(context.beforeCursor).token,
      insertedText: edit.replacement,
      language: this.options.lang,
      suggestion,
    };
    void this.apply(edit, acceptance);
    return true;
  }
  private async apply(edit: DocsEdit, acceptance: Acceptance | null): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || this.applying || this.disposed || this.uncertain) return;
    this.applying = true;
    this.clearPendingTriggers();
    // Project what the document becomes, so the characters typed after the point this
    // edit corrects are still replayed instead of being written off as already judged.
    // Only our own grammar writes carry over; an accepted suggestion is not typing, and
    // a host that rewrites the text fails the baseline checks and falls back to the caret.
    const projected: GrammarBaseline | null = acceptance ? null : projectBaseline(snapshot, edit);
    const resume = this.grammarBaseline;
    this.grammarBaseline = null;
    this.invalidatePrediction();
    this.clearVisual();
    const tracked: TrackedEdit = { acceptance, before: snapshot };
    let reply: DocsReply;
    try {
      reply = await this.bridge.apply(snapshot.token, edit);
    } catch {
      reply = { status: "unverified" };
    }
    this.applying = false;
    this.drainRerun();
    if (this.disposed) return;
    // "unverified" is the one status that may or may not have written, so it keeps nothing.
    if (reply.status === "applied") this.grammarBaseline = projected;
    else if (reply.status !== "unverified") this.grammarBaseline = resume;
    tracked.operationId = reply.operationId;
    if (reply.status === "applied" && reply.operationId)
      this.recordApplied(tracked, reply.operationId);
    else if (reply.status === "unverified") this.uncertain = tracked;
    this.snapshot = null;
    this.view.status(reply.status);
    if (!this.uncertain) void this.refresh();
  }
  private recordApplied(edit: TrackedEdit, operationId: string): void {
    if (this.lastEdit?.operationId === operationId) return;
    const eventId = edit.acceptance
      ? this.personalization.recordSuggestionAccepted(edit.acceptance)
      : "";
    if (edit.acceptance) this.telemetry.recordSuggestionAccepted(edit.acceptance);
    this.lastEdit = { ...edit, operationId, eventId, active: true };
  }
  private observeHistory(reply: DocsReply): void {
    if (!reply.operationId || !reply.snapshot || !reply.history) return;
    if (
      this.uncertain &&
      reply.history === "applied" &&
      (!this.uncertain.operationId || this.uncertain.operationId === reply.operationId) &&
      this.uncertain.before.scope === reply.snapshot.scope
    ) {
      this.recordApplied(this.uncertain, reply.operationId);
      this.uncertain = null;
    }
    const last = this.lastEdit;
    if (!last || last.operationId !== reply.operationId) return;
    if (reply.history === "undone" && last.active) {
      if (last.eventId) this.personalization.recordSuggestionReverted(last.eventId);
      last.active = false;
      this.grammarSuppressed = reply.snapshot;
    } else if (reply.history === "applied" && !last.active) {
      last.eventId = last.acceptance
        ? this.personalization.recordSuggestionAccepted(last.acceptance)
        : "";
      last.active = true;
    }
  }
  private handleKey(key: string): boolean {
    if (!this.visible || !this.snapshot || this.applying || this.composing || this.hasNativePopup())
      return false;
    if (key === "Escape") {
      this.dismiss();
      return true;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      this.selectedIndex =
        (this.selectedIndex + (key === "ArrowDown" ? 1 : -1) + this.suggestions.length) %
        this.suggestions.length;
      this.render();
      return true;
    }
    if (this.options.selectByDigit && /^\d$/.test(key))
      return this.accept(key === "0" ? 9 : Number(key) - 1);
    if (
      (key === "Tab" && (this.options.autocompleteOnTab || this.options.inline_suggestion)) ||
      (key === "Enter" && this.options.autocompleteOnEnter) ||
      (key === " " && this.options.autocomplete)
    )
      return this.accept(this.selectedIndex);
    return false;
  }
  private onKey(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) {
      this.composing = true;
      this.dismiss();
      return;
    }
    if (event.defaultPrevented) return;
    if (
      !event.repeat &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey &&
      this.handleKey(event.key)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    // Native undo/redo is deliberately not intercepted. History is checked against the model.
    this.dismiss();
    this.queueEditFromKey(event);
  }

  /**
   * Docs consumes keystrokes on keydown and paints the canvas itself, so the hidden
   * input iframe never fires `input`. Grammar triggers are derived from the key instead;
   * the model is already updated by the time the scheduled macrotask reads it.
   */
  private queueEditFromKey(event: KeyboardEvent): void {
    if (event.altKey || event.metaKey || event.ctrlKey) {
      if (event.key === "v" || event.key === "V") this.queueEdit("insert", ["insertChar", "paste"]);
      return;
    }
    const key = event.key;
    const printable = key === "Enter" || [...key].length === 1;
    if (!printable && key !== "Backspace" && key !== "Delete") return;
    if (!printable) {
      this.queueEdit("delete", []);
      return;
    }
    const triggers: GrammarEventType[] = ["insertChar"];
    if (key === "Enter" || this.prediction.isSeparator(key)) triggers.push("wordBoundary");
    this.queueEdit("insert", triggers);
  }
  private onInput(event: InputEvent): void {
    if (this.applying || this.disposed) return;
    this.dismiss();
    if (event.isComposing || this.composing) return;
    const type = event.inputType || "";
    const action = type.startsWith("delete")
      ? "delete"
      : type.startsWith("insert")
        ? "insert"
        : "other";
    const triggers: GrammarEventType[] = action === "insert" ? ["insertChar"] : [];
    if (type === "insertFromPaste") triggers.push("paste");
    if (event.data && this.prediction.isSeparator(event.data.slice(-1)))
      triggers.push("wordBoundary");
    this.queueEdit(action, triggers);
  }
  private queueEdit(action: PredictionInputAction, triggers: GrammarEventType[]): void {
    for (const trigger of triggers) this.pendingTriggers.add(trigger);
    this.pendingAction = action;
    // The host applies the keystroke later in this same dispatch, so the earliest
    // correct moment to read it back is the next task, not a fixed settle delay.
    // Waiting longer only lets the following keystroke cancel this pass and take the
    // word boundary with it.
    this.scheduleRefresh(action, [], 0);
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (action === "insert")
      this.idleTimer = setTimeout(() => {
        void this.refresh(false, action, ["idle"]);
      }, 240);
  }
  private scheduleRefresh(
    action: PredictionInputAction | undefined,
    triggers: GrammarEventType[],
    delay: number,
  ): void {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh(false, action, triggers);
    }, delay);
  }
  private render(language = this.options.lang): void {
    if (!this.snapshot || !getDocsInput() || !this.suggestions.length || this.hasNativePopup()) {
      this.clearVisual();
      return;
    }
    this.visible = this.view.render(this.suggestions, this.selectedIndex, this.snapshot, language);
    this.updateKeyState();
  }
  private updateKeyState(): void {
    if (!this.snapshot) {
      this.input?.frame.removeAttribute(KEY_STATE_ATTR);
      return;
    }
    const keys = ["Escape", "ArrowUp", "ArrowDown"];
    if (this.options.autocompleteOnTab || this.options.inline_suggestion) keys.push("Tab");
    if (this.options.autocompleteOnEnter) keys.push("Enter");
    if (this.options.autocomplete) keys.push(" ");
    if (this.options.selectByDigit)
      keys.push(...this.suggestions.map((_, index) => (index === 9 ? "0" : String(index + 1))));
    if (this.visible)
      this.input?.frame.setAttribute(
        KEY_STATE_ATTR,
        JSON.stringify({ token: this.snapshot.token, keys }),
      );
    else this.input?.frame.removeAttribute(KEY_STATE_ATTR);
  }
  private hasNativePopup(): boolean {
    if (!this.options.preferNativeAutocomplete) return false;
    const input = getDocsInput();
    const controls = input?.element.getAttribute("aria-controls")?.split(/\s+/) ?? [];
    return controls.some((id) => {
      const popup = input?.document.getElementById(id) ?? document.getElementById(id);
      return (
        !!popup &&
        !popup.closest('[data-ft-suggestion-owned="true"]') &&
        popup.getAttribute("aria-hidden") !== "true" &&
        popup.getClientRects().length > 0
      );
    });
  }
  private invalidatePrediction(): void {
    this.epoch += 1;
    this.state.requestId += 1;
    this.requested = null;
    this.suggestions = [];
    this.selectedIndex = 0;
    this.prediction.cancelPending(this.state);
  }
  private drainRerun(): void {
    if (!this.rerun || this.disposed) return;
    this.rerun = false;
    this.scheduleRefresh(this.pendingAction, [], 0);
  }
  private clearPendingTriggers(): void {
    this.pendingTriggers.clear();
    this.pendingAction = undefined;
  }
  private clearVisual(): void {
    this.visible = false;
    this.view.clear();
    this.input?.frame.removeAttribute(KEY_STATE_ATTR);
  }
  private dismiss(): void {
    this.invalidatePrediction();
    this.bridge.cancel();
    this.clearVisual();
    this.snapshot = null;
    this.failureStatus = null;
    this.suggestions = [];
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.refreshTimer = null;
    this.idleTimer = null;
  }
  private bind(input: DocsInput | null): void {
    if (input?.document === this.input?.document && input?.element === this.input?.element) return;
    this.clearPendingTriggers();
    this.grammarBaseline = null;
    const old = this.input;
    old?.frame.removeAttribute(KEY_STATE_ATTR);
    old?.document.removeEventListener("keydown", this.keyListener, true);
    old?.document.removeEventListener("input", this.inputListener, true);
    old?.document.removeEventListener("compositionstart", this.compositionStart, true);
    old?.document.removeEventListener("compositionend", this.compositionEnd, true);
    old?.document.removeEventListener("pointerdown", this.navigationListener, true);
    this.input = input;
    this.composing = false;
    input?.document.addEventListener("keydown", this.keyListener, true);
    input?.document.addEventListener("input", this.inputListener, true);
    input?.document.addEventListener("compositionstart", this.compositionStart, true);
    input?.document.addEventListener("compositionend", this.compositionEnd, true);
    input?.document.addEventListener("pointerdown", this.navigationListener, true);
  }
}
