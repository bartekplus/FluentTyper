import {
  SNAPSHOT_LIFETIME_MS,
  minimizeEdit,
  sameModel,
  snapshotFor,
  validEdit,
  type DocsEdit,
  type DocsModel,
  type DocsReply,
  type DocsSnapshot,
  type DocsStatus,
} from "./GoogleDocsModel";

export interface DocsHostState {
  model: DocsModel;
  scope: string;
  /** Object identity, not a selector: replacements/reloads invalidate a pending edit. */
  input: object;
  interaction: number;
}
export interface DocsHost {
  read(): Promise<DocsHostState>;
  select(state: DocsHostState, anchor: number, focus: number): void;
  paste(state: DocsHostState, text: string): void;
  /**
   * Read the model synchronously, without yielding. Between handing the user's own
   * selection to an edit range and pasting over it there must be no await at all: a
   * keystroke arriving in that gap is typed INTO the range and destroys the word being
   * corrected. Returns null when the target is gone.
   */
  peek(state: DocsHostState): DocsHostState | null;
  /**
   * The text the host will really end up holding for `text`, when its insertion
   * channel rewrites characters. Verification compares against the result, so an
   * edit whose replacement the host normalizes must predict that here or it can
   * never be confirmed: the caret is then left wherever the insertion put it and
   * the adapter blocks on an edit that in fact applied.
   */
  normalize?(text: string): string;
}
export class DocsHostError extends Error {
  constructor(public readonly status: DocsStatus) {
    super(status);
  }
}
interface Cached {
  state: DocsHostState;
  at: number;
}
interface Journal {
  id: string;
  before: DocsHostState;
  expectedRaw: string;
  edit: DocsEdit;
  uncertain: boolean;
}

/**
 * Model-verified, single-flight edits. This is NOT a compare-and-swap API: Docs exposes
 * no collaborative revision transaction. Never retry a dispatched paste or undo a
 * mismatched document to manufacture a successful result.
 */
export class GoogleDocsTransaction {
  private readonly tokens = new Map<string, Cached>();
  private epoch = 0;
  private busy = false;
  private journal: Journal | null = null;
  constructor(
    private readonly host: DocsHost,
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  cancel(): void {
    this.epoch += 1;
    this.tokens.clear();
  }

  async read(): Promise<DocsReply> {
    if (this.busy) return { status: "busy" };
    const epoch = this.epoch;
    try {
      const state = await this.readHost();
      if (epoch !== this.epoch) return { status: "cancelled" };
      if (this.journal?.uncertain) {
        if (this.isExpected(state, this.journal)) {
          // Late acknowledgement: reopen only after the exact expected model is observed.
          this.journal.uncertain = false;
        } else if (state.interaction === this.journal.before.interaction) {
          return { status: "unverified", operationId: this.journal.id };
        } else {
          // The user acted after the unverified write; stop blocking, never retry it.
          this.journal = null;
        }
      }
      const snapshot = this.cache(state);
      if (!snapshot) return { status: "unsupported-selection" };
      const journal = this.journal;
      const history =
        journal && state.scope === journal.before.scope && state.input === journal.before.input
          ? state.model.raw === journal.expectedRaw
            ? "applied"
            : state.model.raw === journal.before.model.raw
              ? "undone"
              : undefined
          : undefined;
      return {
        status: "ready",
        snapshot,
        ...(history && journal ? { operationId: journal.id, history } : {}),
      };
    } catch (error) {
      return this.failure(error);
    }
  }

  async apply(token: string, edit: DocsEdit): Promise<DocsReply> {
    if (this.busy) return { status: "busy" };
    if (this.journal?.uncertain) return { status: "unverified", operationId: this.journal.id };
    const cached = this.tokens.get(token);
    this.tokens.delete(token); // Single use, including validation failure and concurrent replays.
    if (!cached || this.now() - cached.at > SNAPSHOT_LIFETIME_MS) return { status: "stale" };
    const normalized = this.host.normalize?.(edit.replacement) ?? edit.replacement;
    // Length-preserving by contract, so the caller's cursorAfter still holds.
    if (normalized.length !== edit.replacement.length) return { status: "invalid" };
    edit = { ...edit, replacement: normalized };
    if (!validEdit(cached.state.model.text, edit)) return { status: "invalid" };
    this.busy = true;
    const epoch = this.epoch;
    let selected: DocsHostState | null = null;
    let dispatched = false;
    let operationId: string | undefined;
    try {
      const current = await this.readHost();
      if (!this.matches(cached.state, current) || epoch !== this.epoch) return { status: "stale" };
      const minimal = minimizeEdit(current.model.text, edit);
      if (minimal.start === minimal.end && !minimal.replacement) return { status: "invalid" };
      const text =
        current.model.text.slice(0, edit.start) +
        edit.replacement +
        current.model.text.slice(edit.end);
      const expectedRaw =
        current.model.raw.slice(0, current.model.offset) +
        text +
        current.model.raw.slice(current.model.offset + current.model.text.length);
      const naturalCaret = minimal.start + minimal.replacement.length;

      // ONE SYNCHRONOUS TASK from here to the paste. Awaiting anything in between hands
      // the user a selected range and then lets a keystroke replace it, which mangles the
      // text instead of correcting it. JavaScript is single threaded: with no yield, a
      // keystroke lands entirely before or entirely after this write.
      this.host.select(current, minimal.start, minimal.end);
      selected = {
        ...current,
        model: { ...current.model, anchor: minimal.start, focus: minimal.end },
      };
      const check = this.host.peek(current);
      if (!check || epoch !== this.epoch || !this.matches(selected, check)) {
        // Hand the caret back only while the range is provably still the one installed
        // above. Anything else is a selection this transaction does not own.
        if (check && epoch === this.epoch && this.sameSelection(selected, check))
          this.restoreSelectionNow(current);
        return { status: "stale" };
      }
      operationId = this.createId();
      this.journal = { id: operationId, before: current, expectedRaw, edit, uncertain: true };
      this.tokens.clear();
      // Mark before dispatch: a handler can mutate and THEN throw.
      dispatched = true;
      this.host.paste(check, minimal.replacement);
      // Still the same task. A host that applied the paste inline gets its final caret
      // now, rather than leaving it mid-word for a round trip the user can type into.
      // Dispatch can still call back re-entrantly, so the caret is owed the same proof.
      const settled = this.host.peek(current);
      if (settled && this.isExpected(settled, this.journal)) {
        this.journal.uncertain = false;
        // A peeked state is not a handle the host can select through; `current` is.
        this.placeCaret(settled, current, current, epoch, naturalCaret, edit.cursorAfter);
        return { status: "applied", operationId };
      }
      const deadline = this.now() + 600;
      do {
        const observed = await this.readHost();
        if (this.isExpected(observed, this.journal)) {
          this.journal.uncertain = false;
          this.placeCaret(observed, observed, current, epoch, naturalCaret, edit.cursorAfter);
          return { status: "applied", operationId };
        }
        if (epoch !== this.epoch || this.now() >= deadline) break;
        // Poll only for an acknowledgement; this never submits another edit.
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      } while (this.now() < deadline);
      return { status: "unverified", operationId };
    } catch (error) {
      if (dispatched) return { status: "unverified", operationId };
      if (selected) await this.restoreSelection(selected, cached.state, epoch);
      return this.failure(error);
    } finally {
      this.busy = false;
    }
  }

  /** Respect intervening navigation/composition. Reposition only a known post-paste caret. */
  private placeCaret(
    observed: DocsHostState,
    handle: DocsHostState,
    before: DocsHostState,
    epoch: number,
    naturalCaret: number,
    cursorAfter: number,
  ): void {
    if (
      epoch === this.epoch &&
      observed.interaction === before.interaction &&
      observed.model.anchor === naturalCaret &&
      observed.model.focus === naturalCaret &&
      cursorAfter !== naturalCaret
    )
      this.host.select(handle, cursorAfter, cursorAfter);
  }
  /** Same target, same interaction, same range: the text is allowed to have moved on. */
  private sameSelection(a: DocsHostState, b: DocsHostState): boolean {
    return (
      a.scope === b.scope &&
      a.input === b.input &&
      a.interaction === b.interaction &&
      a.model.anchor === b.model.anchor &&
      a.model.focus === b.model.focus
    );
  }
  /** Synchronous counterpart, for the window where yielding is what causes the damage. */
  private restoreSelectionNow(original: DocsHostState): void {
    try {
      this.host.select(original, original.model.anchor, original.model.focus);
    } catch {
      /* Never edit to repair a failed selection operation. */
    }
  }
  private async restoreSelection(
    selected: DocsHostState,
    original: DocsHostState,
    epoch: number,
  ): Promise<void> {
    try {
      const current = await this.readHost();
      if (epoch === this.epoch && this.matches(selected, current)) {
        this.host.select(current, original.model.anchor, original.model.focus);
      }
    } catch {
      /* Never edit to repair a failed selection operation. */
    }
  }

  private matches(a: DocsHostState, b: DocsHostState): boolean {
    return (
      a.scope === b.scope &&
      a.input === b.input &&
      a.interaction === b.interaction &&
      sameModel(a.model, b.model)
    );
  }
  private isExpected(state: DocsHostState, journal: Journal): boolean {
    return (
      state.scope === journal.before.scope &&
      state.input === journal.before.input &&
      state.model.raw === journal.expectedRaw
    );
  }
  private cache(state: DocsHostState): DocsSnapshot | null {
    const token = this.createId();
    const snapshot = snapshotFor(state.model, state.scope, token);
    if (!snapshot) return null;
    for (const [key, value] of this.tokens) {
      if (this.now() - value.at > SNAPSHOT_LIFETIME_MS) this.tokens.delete(key);
    }
    while (this.tokens.size >= 8) this.tokens.delete(this.tokens.keys().next().value!);
    this.tokens.set(token, { state, at: this.now() });
    return snapshot;
  }
  private failure(error: unknown): DocsReply {
    return { status: error instanceof DocsHostError ? error.status : "unavailable" };
  }
  private async readHost(): Promise<DocsHostState> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.host.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new DocsHostError("unavailable")), 800);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
