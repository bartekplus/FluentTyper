import { describe, expect, test } from "bun:test";
import {
  GoogleDocsTransaction,
  DocsHostError,
  type DocsHostState,
  type DocsHost,
} from "../src/adapters/chrome/content-script/google-docs/GoogleDocsTransaction";
import {
  readModel,
  type DocsEdit,
} from "../src/adapters/chrome/content-script/google-docs/GoogleDocsModel";
class Host implements DocsHost {
  raw = "\u0003helo\n";
  anchor = 4;
  focus = 4;
  scope = "doc?tab=t.1";
  input = {};
  interaction = 0;
  pastes = 0;
  reads = 0;
  selections: number[][] = [];
  beforeRead: ((host: Host) => void) | null = null;
  beforePeek: ((host: Host) => void) | null = null;
  onPaste: ((host: Host, text: string) => void) | null = null;
  async read(): Promise<DocsHostState> {
    this.reads += 1;
    this.beforeRead?.(this);
    const state = {
      model: readModel(this.raw, [{ anchor: this.anchor + 1, focus: this.focus + 1 }])!,
      scope: this.scope,
      input: this.input,
      interaction: this.interaction,
    };
    this.handles.add(state);
    return state;
  }
  // Like the real host: only a state that read() handed out can be selected through.
  private readonly handles = new WeakSet<DocsHostState>();
  select(state: DocsHostState, anchor: number, focus: number): void {
    if (!this.handles.has(state)) throw new DocsHostError("stale");
    this.selections.push([anchor, focus]);
    this.anchor = anchor;
    this.focus = focus;
  }
  peek(_state: DocsHostState): DocsHostState | null {
    const hook = this.beforePeek;
    this.beforePeek = null;
    hook?.(this);
    return {
      model: readModel(this.raw, [{ anchor: this.anchor + 1, focus: this.focus + 1 }])!,
      scope: this.scope,
      input: this.input,
      interaction: this.interaction,
    };
  }
  paste(_state: DocsHostState, text: string): void {
    this.pastes += 1;
    if (this.onPaste) this.onPaste(this, text);
    else this.insert(text);
  }
  insert(text: string): void {
    this.raw = this.raw.slice(0, this.anchor + 1) + text + this.raw.slice(this.focus + 1);
    this.anchor += text.length;
    this.focus = this.anchor;
  }
}
const edit: DocsEdit = { start: 0, end: 4, replacement: "hello", cursorAfter: 5 };
async function setup() {
  const host = new Host();
  let id = 0;
  const transaction = new GoogleDocsTransaction(host, () => `id-${++id}`);
  const token = (await transaction.read()).snapshot!.token;
  return { host, transaction, token };
}
describe("Google Docs verified transactions", () => {
  test("performs one minimal paste and places the final caret", async () => {
    const { host, transaction, token } = await setup();
    expect((await transaction.apply(token, edit)).status).toBe("applied");
    expect(host.raw).toBe("\u0003hello\n");
    expect(host.pastes).toBe(1);
    expect(host.selections).toEqual([
      [3, 3],
      [5, 5],
    ]);
    expect((await transaction.read()).history).toBe("applied");
  });
  test("a review read carries the whole document and its token writes far from the caret", async () => {
    const host = new Host();
    const prose = "We saw teh cat. " + "Plenty of text. ".repeat(3000);
    host.raw = `\u0003${prose}\n`;
    host.anchor = host.focus = prose.length;
    const transaction = new GoogleDocsTransaction(host, () => "id");
    // A typing read stops 8,192 characters before the caret; a review read does not.
    expect((await transaction.read()).snapshot!.text.startsWith("We saw")).toBe(false);
    const snapshot = (await transaction.read({ review: true })).snapshot!;
    expect(snapshot.text).toBe(prose);
    const reply = await transaction.apply(snapshot.token, {
      start: 7,
      end: 10,
      replacement: "the",
      cursorAfter: prose.length,
    });
    expect(reply.status).toBe("applied");
    expect(host.raw.startsWith("\u0003We saw the cat.")).toBe(true);
    expect(host.pastes).toBe(1);
  });
  test("replayed tokens never produce a second insertion", async () => {
    const { host, transaction, token } = await setup();
    await transaction.apply(token, edit);
    expect((await transaction.apply(token, edit)).status).toBe("stale");
    expect(host.pastes).toBe(1);
  });
  test("serializes overlapping apply requests", async () => {
    const { host, transaction, token } = await setup();
    const first = transaction.apply(token, edit);
    expect((await transaction.apply(token, edit)).status).toBe("busy");
    await first;
    expect(host.pastes).toBe(1);
  });
  for (const [name, mutate] of Object.entries({
    "remote text": (h: Host) => {
      h.raw = "\u0003helo!\n";
    },
    caret: (h: Host) => {
      h.anchor = 2;
      h.focus = 2;
    },
    tab: (h: Host) => {
      h.scope = "doc?tab=t.2";
    },
    "input node": (h: Host) => {
      h.input = {};
    },
    "user interaction": (h: Host) => {
      h.interaction += 1;
    },
  })) {
    test(`rejects a stale ${name} snapshot without editing`, async () => {
      const { host, transaction, token } = await setup();
      mutate(host);
      expect((await transaction.apply(token, edit)).status).toBe("stale");
      expect(host.pastes).toBe(0);
    });
  }
  test("rechecks after selecting the replacement range, without yielding", async () => {
    const { host, transaction, token } = await setup();
    host.beforePeek = (h) => {
      h.raw = "\u0003helo!\n";
    };
    expect((await transaction.apply(token, edit)).status).toBe("stale");
    expect(host.pastes).toBe(0);
  });
  // A failed recheck means the transaction can no longer prove what it owns. Putting the
  // ORIGINAL selection back then overwrites wherever the user has since moved to, and their
  // next keystroke lands at a position this transaction has no claim on.
  for (const [name, mutate, selection] of [
    [
      "a moved caret",
      (h: Host) => {
        h.anchor = h.focus = 1;
        h.interaction++;
      },
      [1, 1],
    ],
    ["a replaced target", (h: Host) => void (h.input = {}), [3, 3]],
  ] as Array<[string, (h: Host) => void, number[]]>) {
    test(`leaves the selection alone when the recheck finds ${name}`, async () => {
      const { host, transaction, token } = await setup();
      host.beforePeek = mutate;
      expect((await transaction.apply(token, edit)).status).toBe("stale");
      expect(host.pastes).toBe(0);
      expect([host.anchor, host.focus]).toEqual(selection);
    });
  }
  test("leaves the selection alone when cancelled during the recheck", async () => {
    const { host, transaction, token } = await setup();
    host.beforePeek = () => transaction.cancel();
    expect((await transaction.apply(token, edit)).status).toBe("stale");
    expect(host.pastes).toBe(0);
    expect([host.anchor, host.focus]).toEqual([3, 3]);
  });
  test("hands back the caret it took when only the text changed under it", async () => {
    const { host, transaction, token } = await setup();
    host.beforePeek = (h) => {
      h.raw = "helo!\n";
    };
    expect((await transaction.apply(token, edit)).status).toBe("stale");
    expect([host.anchor, host.focus]).toEqual([4, 4]);
  });
  // Removing the await stops another task interleaving; it does not stop the host calling
  // back re-entrantly while the paste is dispatched. The write is still acknowledged, but
  // a selection newer than the paste is the user's.
  test("acknowledges an inline paste without overriding a newer selection", async () => {
    const { host, transaction, token } = await setup();
    host.onPaste = (h, text) => {
      h.insert(text);
      h.anchor = h.focus = 0;
      h.interaction++;
      transaction.cancel();
    };
    expect((await transaction.apply(token, edit)).status).toBe("applied");
    expect(host.raw).toBe("hello\n");
    expect([host.anchor, host.focus]).toEqual([0, 0]);
  });
  // Handing the user a selected range and then awaiting anything lets a keystroke replace
  // it. The recheck between select and paste therefore has to be synchronous, which shows
  // up as the apply doing no second asynchronous read before it writes.
  test("does not read asynchronously between selecting and pasting", async () => {
    const { host, transaction, token } = await setup();
    const before = host.reads;
    let readsWhenPasted = -1;
    host.onPaste = (h, text) => {
      readsWhenPasted = h.reads;
      h.insert(text);
    };
    expect((await transaction.apply(token, edit)).status).toBe("applied");
    expect(readsWhenPasted - before).toBe(1);
  });
  test("cancellation invalidates an already-issued snapshot", async () => {
    const { host, transaction, token } = await setup();
    transaction.cancel();
    expect((await transaction.apply(token, edit)).status).toBe("stale");
    expect(host.pastes).toBe(0);
  });
  test("never treats a silently ignored paste as success or retries it", async () => {
    const { host, transaction, token } = await setup();
    host.onPaste = () => {};
    expect((await transaction.apply(token, edit)).status).toBe("unverified");
    expect((await transaction.read()).status).toBe("unverified");
    expect((await transaction.apply(token, edit)).status).toBe("unverified");
    expect(host.pastes).toBe(1);
  });
  test("recovers on a late model acknowledgement without replay", async () => {
    const { host, transaction, token } = await setup();
    host.onPaste = () => {};
    const reply = await transaction.apply(token, edit);
    host.raw = "\u0003hello\n";
    host.anchor = 5;
    host.focus = 5;
    const observed = await transaction.read();
    expect(observed.status).toBe("ready");
    expect(observed.history).toBe("applied");
    expect(observed.operationId).toBe(reply.operationId);
    expect(host.pastes).toBe(1);
  });
  test("never retries a handler that mutates then throws", async () => {
    const { host, transaction, token } = await setup();
    host.onPaste = (h, text) => {
      h.insert(text);
      throw new Error("after editing");
    };
    expect((await transaction.apply(token, edit)).status).toBe("unverified");
    expect((await transaction.read()).history).toBe("applied");
    expect(host.pastes).toBe(1);
  });
  test("releases an unverified write after the next user interaction without replay", async () => {
    const { host, transaction, token } = await setup();
    host.onPaste = () => {};
    await transaction.apply(token, edit);
    expect((await transaction.read()).status).toBe("unverified");
    host.interaction += 1;
    const reply = await transaction.read();
    expect(reply.status).toBe("ready");
    expect(reply.history).toBeUndefined();
    expect(host.pastes).toBe(1);
  });
  test("cannot clear uncertain writes by toggling the extension", async () => {
    const { host, transaction, token } = await setup();
    host.onPaste = () => {};
    await transaction.apply(token, edit);
    transaction.cancel();
    expect((await transaction.read()).status).toBe("unverified");
    expect(host.pastes).toBe(1);
  });
  test("observes exact native undo and redo without dispatching either", async () => {
    const { host, transaction, token } = await setup();
    await transaction.apply(token, edit);
    host.raw = "\u0003helo\n";
    host.anchor = 4;
    host.focus = 4;
    expect((await transaction.read()).history).toBe("undone");
    host.raw = "\u0003hello\n";
    host.anchor = 5;
    host.focus = 5;
    expect((await transaction.read()).history).toBe("applied");
    expect(host.pastes).toBe(1);
  });
  test("rejects stale expiry with no write", async () => {
    const host = new Host();
    let now = 0;
    const transaction = new GoogleDocsTransaction(
      host,
      () => "token",
      () => now,
    );
    const token = (await transaction.read()).snapshot!.token;
    now = 10001;
    expect((await transaction.apply(token, edit)).status).toBe("stale");
  });
  test("reports missing API as unavailable", async () => {
    const { host, transaction } = await setup();
    host.beforeRead = () => {
      throw new DocsHostError("unavailable");
    };
    expect((await transaction.read()).status).toBe("unavailable");
  });
});
