import { afterEach, describe, expect, test } from "bun:test";
import { installGoogleDocsMainWorld } from "../src/adapters/chrome/content-script/google-docs/GoogleDocsMainWorld";
import {
  INPUT_FRAME_SELECTOR,
  KEY_ACK_ATTR,
  KEY_EVENT,
  KEY_STATE_ATTR,
  REQUEST_EVENT,
  RESPONSE_EVENT,
  type DocsEdit,
  type DocsReply,
} from "../src/adapters/chrome/content-script/google-docs/GoogleDocsModel";

// These are protocol/host tests, not a live Google Docs or Firefox smoke test.
// In particular, Firefox may create its own store instead of using ClipboardEventInit.clipboardData.
type ClipboardMode = "chromium" | "firefox" | "missing" | "readonly";
class MemoryTransfer {
  private readonly values = new Map<string, string>();
  constructor(private readonly writable = true) {}
  get types(): string[] {
    return [...this.values.keys()];
  }
  setData(type: string, value: string): void {
    if (this.writable) this.values.set(type, value);
  }
  getData(type: string): string {
    return this.values.get(type) ?? "";
  }
}
// Normalize capture options for server-side EventTarget implementations used by unit runners.
class HostEventTarget extends EventTarget {
  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(
      type,
      callback,
      typeof options === "boolean" ? { capture: options } : options,
    );
  }
}
class HostElement extends HostEventTarget {
  readonly attributes = new Map<string, string>();
  isContentEditable = false;
  contentDocument: HostDocument | null = null;
  onFocus = () => {};
  constructor(private readonly isFrame = false) {
    super();
  }
  matches(selector: string): boolean {
    return this.isFrame && selector === INPUT_FRAME_SELECTOR;
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  focus(): void {
    this.onFocus();
  }
}
class HostDocument extends HostEventTarget {
  activeElement: HostElement | null = null;
  editor: HostElement | null = null;
  defaultView: HostWindow | null = null;
  querySelector(selector: string): HostElement | null {
    return selector === '[contenteditable="true"]' ? this.editor : null;
  }
}
class HostWindow extends HostEventTarget {
  readonly document = new HostDocument();
  readonly navigator = { userAgent: "Firefox/155.0" };
  readonly location = { href: "https://docs.google.com/document/d/fixture/edit" };
  readonly crypto = globalThis.crypto;
  readonly DataTransfer = MemoryTransfer;
  readonly ClipboardEvent;
  top: HostWindow = this;
  frameElement: HostElement | null = null;
  _docs_annotate_getAnnotatedText?: () => Promise<{
    getText(): string;
    getSelection(): { anchor: number; focus: number }[];
    setSelection(anchor: number, focus: number): void;
  }>;
  constructor(mode: ClipboardMode) {
    super();
    this.document.defaultView = this;
    this.ClipboardEvent = class extends Event {
      readonly clipboardData: MemoryTransfer | null;
      constructor(type: string, init: EventInit & { clipboardData?: MemoryTransfer }) {
        super(type, init);
        this.clipboardData =
          mode === "missing"
            ? null
            : mode === "chromium"
              ? (init.clipboardData ?? null)
              : new MemoryTransfer(mode !== "readonly");
      }
    };
  }
}
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
function harness(mode: ClipboardMode = "firefox") {
  const win = new HostWindow(mode);
  const model = { text: "hel", anchor: 3, focus: 3, pastes: 0, payloads: [] as string[] };
  let ignorePaste = false;
  const attachEditor = () => {
    const frame = new HostElement(true);
    const inner = new HostWindow(mode);
    inner.top = win;
    inner.frameElement = frame;
    inner.location.href = "about:blank";
    frame.contentDocument = inner.document;
    const element = new HostElement();
    element.isContentEditable = true;
    inner.document.editor = element;
    element.onFocus = () => {
      win.document.activeElement = frame;
      inner.document.activeElement = element;
    };
    element.addEventListener("paste", (event) => {
      model.pastes += 1;
      const data = (event as Event & { clipboardData: MemoryTransfer | null }).clipboardData;
      if (!data?.types.includes("text/plain") || ignorePaste) return;
      const payload = data.getData("text/plain");
      model.payloads.push(payload);
      const text = payload.replace(/\u00a0/g, " ");
      model.text = model.text.slice(0, model.anchor) + text + model.text.slice(model.focus);
      model.anchor += text.length;
      model.focus = model.anchor;
    });
    element.focus();
    return { frame, inner, element };
  };
  let editor = attachEditor();
  win._docs_annotate_getAnnotatedText = async () => ({
    getText: () => `\u0003${model.text}\n`,
    getSelection: () => [{ anchor: model.anchor + 1, focus: model.focus + 1 }],
    setSelection: (anchor, focus) => {
      model.anchor = anchor - 1;
      model.focus = focus - 1;
      editor.inner.document.activeElement = null; // Docs blurs the editable on selection.
    },
  });
  const dispose = installGoogleDocsMainWorld(win as unknown as Window);
  cleanups.push(dispose);
  let requestId = 0;
  const request = (kind: string, values: object = {}): Promise<DocsReply> =>
    new Promise((resolve, reject) => {
      const id = `request-${++requestId}`;
      const listener = (event: Event) => {
        const reply = JSON.parse((event as CustomEvent<string>).detail) as DocsReply & {
          id: string;
        };
        if (reply.id !== id) return;
        clearTimeout(timer);
        win.document.removeEventListener(RESPONSE_EVENT, listener);
        resolve(reply);
      };
      const timer = setTimeout(() => {
        win.document.removeEventListener(RESPONSE_EVENT, listener);
        reject(new Error(`No response to ${kind}`));
      }, 2000);
      win.document.addEventListener(RESPONSE_EVENT, listener);
      win.document.dispatchEvent(
        new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify({ id, kind, ...values }) }),
      );
    });
  return {
    win,
    model,
    get editor() {
      return editor;
    },
    dispose,
    request,
    ignorePaste: () => {
      ignorePaste = true;
    },
    replaceEditor: () => {
      editor = attachEditor();
    },
    publishKeys: (token: string) => {
      editor.frame.setAttribute(KEY_STATE_ATTR, JSON.stringify({ token, keys: ["Tab"] }));
    },
  };
}
function keyEvent(overrides: Record<string, unknown> = {}): Event {
  // Native trust is simulated only in this unit fixture; production never overwrites it.
  const event = new Event("keydown", { cancelable: true });
  for (const [name, value] of Object.entries({ isTrusted: true, key: "Tab", ...overrides }))
    Object.defineProperty(event, name, { value });
  return event;
}
const completion: DocsEdit = { start: 0, end: 3, replacement: "hello", cursorAfter: 5 };

describe("Google Docs MAIN-world acceptance", () => {
  for (const mode of ["chromium", "firefox"] as const) {
    test(`${mode}: apply populates the event's actual store and pastes exactly once`, async () => {
      const h = harness(mode);
      const token = (await h.request("read")).snapshot!.token;
      expect((await h.request("apply", { token, edit: completion })).status).toBe("applied");
      expect(h.model.text).toBe("hello");
      expect(h.model.payloads).toEqual(["lo"]);
      expect(h.model.pastes).toBe(1);
      expect(h.editor.inner.document.activeElement).toBe(h.editor.element);
      expect((await h.request("apply", { token, edit: completion })).status).toBe("stale");
      expect(h.model.pastes).toBe(1);
    });
  }
  test("preserves edge spaces, Unicode and multiline replacement", async () => {
    const h = harness();
    const replacement = "  Zażółć 👩‍💻\n\nline two  ";
    const token = (await h.request("read")).snapshot!.token;
    const edit = { ...completion, replacement, cursorAfter: replacement.length };
    expect((await h.request("apply", { token, edit })).status).toBe("applied");
    expect(h.model.text).toBe(replacement);
    expect(h.model.payloads).toEqual(["\u00a0\u00a0Zażółć 👩‍💻\n\nline two\u00a0\u00a0"]);
  });
  test("retains a text/plain type for an empty deletion payload", async () => {
    const h = harness();
    const token = (await h.request("read")).snapshot!.token;
    const edit = { ...completion, replacement: "", cursorAfter: 0 };
    expect((await h.request("apply", { token, edit })).status).toBe("applied");
    expect(h.model.text).toBe("");
    expect(h.model.payloads).toEqual([""]);
  });
  for (const mode of ["missing", "readonly"] as const) {
    test(`${mode} event store never dispatches an empty or invalid paste`, async () => {
      const h = harness(mode);
      const token = (await h.request("read")).snapshot!.token;
      expect((await h.request("apply", { token, edit: completion })).status).toBe("unverified");
      expect(h.model.pastes).toBe(0);
      expect(h.model.text).toBe("hel");
      expect((await h.request("read")).status).toBe("unverified");
      expect(h.model.pastes).toBe(0);
    });
  }
  test("dispatch alone is not success and ignored writes are never retried", async () => {
    const h = harness();
    h.ignorePaste();
    const token = (await h.request("read")).snapshot!.token;
    expect((await h.request("apply", { token, edit: completion })).status).toBe("unverified");
    expect((await h.request("read")).status).toBe("unverified");
    expect((await h.request("apply", { token, edit: completion })).status).toBe("unverified");
    expect(h.model.pastes).toBe(1);
    expect(h.model.text).toBe("hel");
  });
  test("fresh acceptance and exact undo/redo observation still work", async () => {
    const h = harness();
    let token = (await h.request("read")).snapshot!.token;
    expect((await h.request("apply", { token, edit: completion })).status).toBe("applied");
    h.model.text = "hel";
    h.model.anchor = h.model.focus = 3;
    expect((await h.request("read")).history).toBe("undone");
    h.model.text = "hello";
    h.model.anchor = h.model.focus = 5;
    expect((await h.request("read")).history).toBe("applied");
    token = (await h.request("read")).snapshot!.token;
    const edit = { start: 5, end: 5, replacement: " world", cursorAfter: 11 };
    expect((await h.request("apply", { token, edit })).status).toBe("applied");
    expect(h.model.text).toBe("hello world");
    expect(h.model.pastes).toBe(2);
  });
  test("stale selections and ordinary top-level fields cannot receive a Docs paste", async () => {
    const h = harness();
    let token = (await h.request("read")).snapshot!.token;
    h.model.anchor = h.model.focus = 1;
    expect((await h.request("apply", { token, edit: completion })).status).toBe("stale");
    token = (await h.request("read")).snapshot!.token;
    h.win.document.activeElement = new HostElement(); // Title/comment, not the input iframe.
    expect((await h.request("apply", { token, edit: completion })).status).toBe("inactive");
    expect(h.model.pastes).toBe(0);
  });
});

describe("Google Docs blank-frame keyboard fallback", () => {
  test("Tab is acknowledged and applied without document_start injection into the frame", async () => {
    const h = harness();
    const token = (await h.request("read")).snapshot!.token;
    h.publishKeys(token);
    let apply: Promise<DocsReply> | undefined;
    h.win.document.addEventListener(KEY_EVENT, (event) => {
      const key = JSON.parse((event as CustomEvent<string>).detail) as {
        id: string;
        token: string;
      };
      h.editor.frame.setAttribute(KEY_ACK_ATTR, key.id);
      apply = h.request("apply", { token: key.token, edit: completion });
    });
    const event = keyEvent();
    h.editor.inner.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect((await apply)?.status).toBe("applied");
    expect(h.model.text).toBe("hello");
    expect(h.model.pastes).toBe(1);
  });
  test("early frame injection and parent fallback do not double-handle an acknowledged key", async () => {
    const h = harness();
    cleanups.push(installGoogleDocsMainWorld(h.editor.inner as unknown as Window));
    const token = (await h.request("read")).snapshot!.token;
    h.publishKeys(token);
    let keys = 0;
    h.win.document.addEventListener(KEY_EVENT, (event) => {
      keys += 1;
      const key = JSON.parse((event as CustomEvent<string>).detail) as { id: string };
      h.editor.frame.setAttribute(KEY_ACK_ATTR, key.id);
    });
    const event = keyEvent();
    h.editor.inner.dispatchEvent(event);
    expect(keys).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });
  test("unacknowledged keys, modifiers and composition remain native", async () => {
    const h = harness();
    h.publishKeys((await h.request("read")).snapshot!.token);
    const unacknowledged = keyEvent();
    h.editor.inner.dispatchEvent(unacknowledged);
    expect(unacknowledged.defaultPrevented).toBe(false);
    let keys = 0;
    h.win.document.addEventListener(KEY_EVENT, () => {
      keys += 1;
    });
    for (const overrides of [
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
      { shiftKey: true },
      { repeat: true },
      { isComposing: true },
      { keyCode: 229 },
      { isTrusted: false },
      { key: "z" },
    ]) {
      const event = keyEvent(overrides);
      h.editor.inner.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(keys).toBe(0);
    h.editor.inner.dispatchEvent(new Event("compositionstart"));
    expect((await h.request("read")).status).toBe("composing");
  });
  test("rebind removes the old fallback and disposal removes the new fallback", async () => {
    const h = harness();
    h.publishKeys((await h.request("read")).snapshot!.token);
    const old = h.editor;
    h.replaceEditor();
    h.publishKeys((await h.request("read")).snapshot!.token);
    let keys = 0;
    h.win.document.addEventListener(KEY_EVENT, () => {
      keys += 1;
    });
    old.inner.dispatchEvent(keyEvent());
    expect(keys).toBe(0);
    h.editor.inner.dispatchEvent(keyEvent());
    expect(keys).toBe(1);
    h.dispose();
    h.editor.inner.dispatchEvent(keyEvent());
    expect(keys).toBe(1);
  });
});
