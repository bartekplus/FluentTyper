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
        if (!this.isExpected(state, this.journal))
          return { status: "unverified", operationId: this.journal.id };
        // Late acknowledgement: reopen only after the exact expected model is observed.
        this.journal.uncertain = false;
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
      this.host.select(current, minimal.start, minimal.end);
      selected = {
        ...current,
        model: { ...current.model, anchor: minimal.start, focus: minimal.end },
      };
      const check = await this.readHost();
      if (epoch !== this.epoch || !this.matches(selected, check)) {
        await this.restoreSelection(selected, current, epoch);
        return { status: "stale" };
      }
      const text =
        current.model.text.slice(0, edit.start) +
        edit.replacement +
        current.model.text.slice(edit.end);
      const expectedRaw =
        current.model.raw.slice(0, current.model.offset) +
        text +
        current.model.raw.slice(current.model.offset + current.model.text.length);
      operationId = this.createId();
      this.journal = { id: operationId, before: current, expectedRaw, edit, uncertain: true };
      this.tokens.clear();
      // Mark before dispatch: a handler can mutate and THEN throw.
      dispatched = true;
      this.host.paste(check, minimal.replacement);
      const deadline = this.now() + 600;
      do {
        const observed = await this.readHost();
        if (this.isExpected(observed, this.journal)) {
          this.journal.uncertain = false;
          const naturalCaret = minimal.start + minimal.replacement.length;
          // Respect intervening navigation/composition. Reposition only a known post-paste caret.
          if (
            epoch === this.epoch &&
            observed.interaction === current.interaction &&
            observed.model.anchor === naturalCaret &&
            observed.model.focus === naturalCaret &&
            edit.cursorAfter !== naturalCaret
          ) {
            this.host.select(observed, edit.cursorAfter, edit.cursorAfter);
          }
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
