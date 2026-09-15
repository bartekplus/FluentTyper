import {
  REQUEST_EVENT,
  RESPONSE_EVENT,
  KEY_EVENT,
  KEY_STATE_ATTR,
  KEY_ACK_ATTR,
  INPUT_FRAME_SELECTOR,
  parseObject,
  readModel,
  type DocsEdit,
} from "./GoogleDocsModel";
import { getDocsInput, isGoogleDocsPage, isGoogleDocsInputFrame } from "./GoogleDocsEnvironment";
import { DocsHostError, GoogleDocsTransaction, type DocsHostState } from "./GoogleDocsTransaction";

interface AnnotatedText {
  getText(): unknown;
  getSelection(): unknown;
  setSelection(anchor: number, focus: number): void;
}
type DocsWindow = Window & {
  _docs_annotate_canvas_by_ext?: unknown;
  _docs_annotate_getAnnotatedText?: () => AnnotatedText | Promise<AnnotatedText>;
};
const COMPOSING_ATTR = "data-ft-docs-composing";

/** Page-visible messages are not an authentication boundary and grant no extension APIs. */
export function installGoogleDocsMainWorld(win: Window = window): () => void {
  if (win.top !== win) return installFrameKeys(win);
  if (!isGoogleDocsPage(win)) return () => {};
  const docs = win as DocsWindow;
  try {
    // Use FluentTyper's own ID, never impersonate another extension.
    if (docs._docs_annotate_canvas_by_ext == null) {
      docs._docs_annotate_canvas_by_ext = /Edg\//.test(win.navigator.userAgent)
        ? "ljenfpihmhkddgmjoipinkhflinoofcn"
        : "mbjlobpodpimgbkmlmjiblnmfgajmebm";
    }
  } catch {
    /* Missing capability is reported on read. */
  }
  let stopped = false;
  let interaction = 0;
  let inner: Document | null = null;
  let composing = false;
  let compositionSettlesAt = 0;
  const states = new WeakMap<DocsHostState, AnnotatedText>();
  const onInteraction = (event: Event) => {
    if (event.isTrusted) interaction += 1;
  };
  const onCompositionStart = () => {
    composing = true;
    interaction += 1;
    transactions.cancel();
  };
  const onCompositionEnd = () => {
    composing = false;
    compositionSettlesAt = Date.now() + 50;
    interaction += 1;
  };
  const bind = (doc: Document | null) => {
    for (const kind of ["keydown", "pointerdown", "beforeinput"])
      inner?.removeEventListener(kind, onInteraction, true);
    inner?.removeEventListener("compositionstart", onCompositionStart, true);
    inner?.removeEventListener("compositionend", onCompositionEnd, true);
    inner = doc;
    for (const kind of ["keydown", "pointerdown", "beforeinput"])
      inner?.addEventListener(kind, onInteraction, true);
    inner?.addEventListener("compositionstart", onCompositionStart, true);
    inner?.addEventListener("compositionend", onCompositionEnd, true);
  };
  const transactions = new GoogleDocsTransaction(
    {
      read: async () => {
        if (stopped || !isGoogleDocsPage(win)) throw new DocsHostError("inactive");
        const input = getDocsInput(win.document);
        if (!input) throw new DocsHostError("inactive");
        if (inner !== input.document) bind(input.document);
        if (
          composing ||
          Date.now() < compositionSettlesAt ||
          input.frame.hasAttribute(COMPOSING_ATTR)
        ) {
          throw new DocsHostError("composing");
        }
        if (typeof docs._docs_annotate_getAnnotatedText !== "function")
          throw new DocsHostError("unavailable");
        const scope = win.location.href;
        const version = interaction;
        const annotated = await docs._docs_annotate_getAnnotatedText();
        if (
          !annotated ||
          typeof annotated.getText !== "function" ||
          typeof annotated.getSelection !== "function" ||
          typeof annotated.setSelection !== "function"
        ) {
          throw new DocsHostError("unavailable");
        }
        const current = getDocsInput(win.document);
        if (
          stopped ||
          current?.element !== input.element ||
          current.document !== input.document ||
          scope !== win.location.href ||
          version !== interaction ||
          composing
        )
          throw new DocsHostError("stale");
        const model = readModel(annotated.getText(), annotated.getSelection());
        if (!model) throw new DocsHostError("unsupported-selection");
        const state = { model, scope, input: input.element, interaction };
        states.set(state, annotated);
        return state;
      },
      select: (state, anchor, focus) => {
        const api = states.get(state);
        if (!api || getDocsInput(win.document)?.element !== state.input)
          throw new DocsHostError("stale");
        api.setSelection(anchor + state.model.offset, focus + state.model.offset);
      },
      paste: (state, text) => {
        const input = getDocsInput(win.document);
        if (
          !input ||
          input.element !== state.input ||
          state.scope !== win.location.href ||
          composing
        ) {
          throw new DocsHostError("stale");
        }
        const realm = input.document.defaultView;
        if (!realm) throw new DocsHostError("inactive");
        const data = new realm.DataTransfer();
        data.setData("text/plain", text);
        // A request to the editor, NOT trusted/native paste. Its return value is irrelevant.
        input.element.dispatchEvent(
          new realm.ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: data,
          }),
        );
      },
    },
    () => win.crypto.randomUUID(),
  );
  let pending = 0;
  const onRequest = (event: Event) => {
    if (stopped || !isGoogleDocsPage(win)) return;
    const request = parseObject((event as CustomEvent<unknown>).detail);
    if (!request || typeof request.id !== "string" || !/^[\w-]{1,100}$/.test(request.id)) return;
    if (request.kind === "cancel") {
      transactions.cancel();
      return;
    }
    if (request.kind !== "read" && request.kind !== "apply") return;
    const reply = (value: object) => {
      if (!stopped)
        win.document.dispatchEvent(
          new CustomEvent(RESPONSE_EVENT, {
            detail: JSON.stringify({ id: request.id, ...value }),
          }),
        );
    };
    if (pending >= 2) {
      reply({ status: "busy" });
      return;
    }
    if (
      request.kind === "apply" &&
      (typeof request.token !== "string" || !request.edit || typeof request.edit !== "object")
    ) {
      reply({ status: "invalid" });
      return;
    }
    pending += 1;
    void (
      request.kind === "read"
        ? transactions.read()
        : transactions.apply(request.token as string, request.edit as DocsEdit)
    )
      .then(reply, () => reply({ status: "unverified" }))
      .finally(() => {
        pending -= 1;
      });
  };
  win.document.addEventListener(REQUEST_EVENT, onRequest);
  return () => {
    stopped = true;
    transactions.cancel();
    bind(null);
    win.document.removeEventListener(REQUEST_EVENT, onRequest);
  };
}

function installFrameKeys(win: Window): () => void {
  try {
    if (!win.top || !isGoogleDocsPage(win.top)) return () => {};
  } catch {
    return () => {};
  }
  const composing = () => {
    win.frameElement?.setAttribute(COMPOSING_ATTR, "true");
  };
  const composed = () => {
    win.frameElement?.removeAttribute(COMPOSING_ATTR);
  };
  const keydown = (event: KeyboardEvent) => {
    if (
      !event.isTrusted ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.defaultPrevented ||
      event.repeat ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey ||
      !isGoogleDocsInputFrame(win)
    )
      return;
    const frame = win.frameElement;
    const state = parseObject(frame?.getAttribute(KEY_STATE_ATTR));
    if (
      !frame ||
      !state ||
      typeof state.token !== "string" ||
      !Array.isArray(state.keys) ||
      !state.keys.includes(event.key)
    )
      return;
    const id = win.crypto.randomUUID();
    frame.removeAttribute(KEY_ACK_ATTR);
    win.top?.document.dispatchEvent(
      new CustomEvent(KEY_EVENT, {
        detail: JSON.stringify({ id, token: state.token, key: event.key }),
      }),
    );
    if (frame.getAttribute(KEY_ACK_ATTR) === id) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    frame.removeAttribute(KEY_ACK_ATTR);
  };
  win.addEventListener("keydown", keydown, true);
  win.addEventListener("compositionstart", composing, true);
  win.addEventListener("compositionend", composed, true);
  return () => {
    win.removeEventListener("keydown", keydown, true);
    win.removeEventListener("compositionstart", composing, true);
    win.removeEventListener("compositionend", composed, true);
    if (win.frameElement?.matches(INPUT_FRAME_SELECTOR)) composed();
  };
}
