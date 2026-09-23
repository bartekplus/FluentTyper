import { isSuggestionMenuHostVisible } from "./SuggestionMenuHost";
import type { SuggestionEntry } from "./types";

interface SuggestionLifecycleControllerOptions {
  getEntries: () => Iterable<SuggestionEntry>;
  dismissEntry: (entry: SuggestionEntry) => void;
  reconcileEntrySelection: (entry: SuggestionEntry) => void;
  doc?: Document;
}

export class SuggestionLifecycleController {
  private readonly getEntries: () => Iterable<SuggestionEntry>;
  private readonly dismissEntry: (entry: SuggestionEntry) => void;
  private readonly reconcileEntrySelection: (entry: SuggestionEntry) => void;
  private readonly doc: Document;
  private readonly keydownListenerByEntryId = new Map<number, EventListener>();
  private attachedEntryCount = 0;
  private documentListenersAttached = false;
  private readonly documentListeners: readonly [string, EventListener][] = [
    ["mousedown", this.onDocumentPointerDown.bind(this)],
    ["keydown", this.onDocumentKeyDown.bind(this)],
    ["selectionchange", this.onDocumentSelectionChange.bind(this)],
  ];

  constructor(options: SuggestionLifecycleControllerOptions) {
    this.getEntries = options.getEntries;
    this.dismissEntry = options.dismissEntry;
    this.reconcileEntrySelection = options.reconcileEntrySelection;
    this.doc = options.doc ?? document;
  }

  public attachEntryListeners(entry: SuggestionEntry): void {
    this.toggleEntryListeners(entry, true);
    this.attachedEntryCount += 1;
    this.toggleDocumentListeners(true);
  }

  public detachEntryListeners(entry: SuggestionEntry): void {
    this.toggleEntryListeners(entry, false);
    this.keydownListenerByEntryId.delete(entry.id);

    this.attachedEntryCount = Math.max(0, this.attachedEntryCount - 1);
    if (this.attachedEntryCount === 0) {
      this.toggleDocumentListeners(false);
    }
  }

  private toggleEntryListeners(entry: SuggestionEntry, attach: boolean): void {
    const method = attach ? "addEventListener" : "removeEventListener";
    const { handlers } = entry;
    const targetListeners: [string, EventListener][] = [
      ["beforeinput", handlers.beforeinput],
      ["input", handlers.input],
      ["keydown", this.getEntryKeydownListener(entry)],
      ["paste", handlers.paste],
      ["focus", handlers.focus],
      ["blur", handlers.blur],
      ["compositionstart", handlers.compositionStart],
      ["compositionend", handlers.compositionEnd],
    ];
    for (const [eventName, listener] of targetListeners) {
      entry.elem[method](eventName, listener, true);
    }
    entry.elem[method]("click", handlers.click, true);
    // A backing input (e.g. CodeMirror's hidden textarea) receives the keystrokes.
    const inputEventTarget = entry.inputEventTarget;
    if (inputEventTarget && inputEventTarget !== entry.elem) {
      for (const [eventName, listener] of targetListeners) {
        inputEventTarget[method](eventName, listener, true);
      }
    }
    entry.list[method]("mousedown", handlers.menuMouseDown);
    entry.list[method]("click", handlers.menuClick);
  }

  private getEntryKeydownListener(entry: SuggestionEntry): EventListener {
    const existing = this.keydownListenerByEntryId.get(entry.id);
    if (existing) {
      return existing;
    }

    const listener: EventListener = (event) => {
      const keyboardEvent = event as KeyboardEvent & { __ftDocumentTabCaptureHandled?: boolean };
      if (keyboardEvent.__ftDocumentTabCaptureHandled) {
        return;
      }
      entry.handlers.keydown(event);
    };
    this.keydownListenerByEntryId.set(entry.id, listener);
    return listener;
  }

  private toggleDocumentListeners(attach: boolean): void {
    if (this.documentListenersAttached === attach) {
      return;
    }
    const method = attach ? "addEventListener" : "removeEventListener";
    for (const [eventName, listener] of this.documentListeners) {
      this.doc[method](eventName, listener, true);
    }
    this.documentListenersAttached = attach;
  }

  private onDocumentPointerDown(event: Event): void {
    // Use composedPath() so that clicks inside shadow-hosted entry elements are
    // correctly identified: event.target is retargeted to the shadow host at
    // document level, but composedPath() contains the full chain including the
    // actual target inside the shadow root.
    const composedPath = event.composedPath();

    for (const entry of this.getEntries()) {
      const clickedInEntry = composedPath.includes(entry.elem);
      const clickedInMenu = composedPath.some(
        (n) => n === entry.menu || (n instanceof Node && entry.menu.contains(n)),
      );
      if (clickedInEntry || clickedInMenu) {
        continue;
      }
      this.dismissEntry(entry);
    }
  }

  private onDocumentKeyDown(event: Event): void {
    const keyboardEvent = event as KeyboardEvent & { __ftDocumentTabCaptureHandled?: boolean };
    if (
      keyboardEvent.defaultPrevented ||
      keyboardEvent.key !== "Tab" ||
      keyboardEvent.__ftDocumentTabCaptureHandled
    ) {
      return;
    }

    const composedPath = typeof event.composedPath === "function" ? event.composedPath() : [];
    const path = composedPath.length > 0 ? composedPath : [event.target];
    const entries = [...this.getEntries()];

    const eligible = entries.filter((entry) => this.isDocumentTabFallbackEligible(entry));
    for (const node of path) {
      const match =
        eligible.find((entry) => node === entry.inputEventTarget) ??
        eligible.find((entry) => node === entry.elem) ??
        (node instanceof Node ? eligible.find((entry) => entry.elem.contains(node)) : undefined);
      if (match) {
        match.handlers.keydown(keyboardEvent);
        keyboardEvent.__ftDocumentTabCaptureHandled = true;
        return;
      }
    }
  }

  private isDocumentTabFallbackEligible(entry: SuggestionEntry): boolean {
    return entry.inlineSuggestion !== null || isSuggestionMenuHostVisible(entry.menu);
  }

  private onDocumentSelectionChange(): void {
    for (const entry of this.getEntries()) {
      this.reconcileEntrySelection(entry);
    }
  }
}
