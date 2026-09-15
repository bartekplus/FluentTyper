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
  onPaste: ((host: Host, text: string) => void) | null = null;
  async read(): Promise<DocsHostState> {
    this.reads += 1;
    this.beforeRead?.(this);
    return {
      model: readModel(this.raw, [{ anchor: this.anchor + 1, focus: this.focus + 1 }])!,
      scope: this.scope,
      input: this.input,
      interaction: this.interaction,
    };
  }
  select(_state: DocsHostState, anchor: number, focus: number): void {
    this.selections.push([anchor, focus]);
    this.anchor = anchor;
    this.focus = focus;
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
  test("rechecks after selecting the replacement range", async () => {
    const { host, transaction, token } = await setup();
    host.beforeRead = (h) => {
      if (h.reads === 3) h.raw = "\u0003helo!\n";
    };
    expect((await transaction.apply(token, edit)).status).toBe("stale");
    expect(host.pastes).toBe(0);
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
