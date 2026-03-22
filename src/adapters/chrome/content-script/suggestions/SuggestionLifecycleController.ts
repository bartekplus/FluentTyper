import { isSuggestionMenuHostVisible } from "./SuggestionMenuHost";
import type { SuggestionEntry } from "./types";

export interface SuggestionLifecycleControllerOptions {
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
  private documentPointerDownListenerAttached = false;
  private documentKeyDownListenerAttached = false;
  private documentSelectionChangeListenerAttached = false;
  private readonly onDocumentPointerDownBound: EventListener =
    this.onDocumentPointerDown.bind(this);
  private readonly onDocumentKeyDownBound: EventListener = this.onDocumentKeyDown.bind(this);
  private readonly onDocumentSelectionChangeBound: EventListener =
    this.onDocumentSelectionChange.bind(this);

  constructor(options: SuggestionLifecycleControllerOptions) {
    this.getEntries = options.getEntries;
    this.dismissEntry = options.dismissEntry;
    this.reconcileEntrySelection = options.reconcileEntrySelection;
    this.doc = options.doc ?? document;
  }

  public attachEntryListeners(entry: SuggestionEntry): void {
    entry.elem.addEventListener("beforeinput", entry.handlers.beforeinput, true);
    entry.elem.addEventListener("input", entry.handlers.input, true);
    entry.elem.addEventListener("keydown", this.getEntryKeydownListener(entry), true);
    entry.elem.addEventListener("paste", entry.handlers.paste, true);
    entry.elem.addEventListener("focus", entry.handlers.focus, true);
    entry.elem.addEventListener("blur", entry.handlers.blur, true);
    entry.elem.addEventListener("click", entry.handlers.click, true);
    entry.elem.addEventListener("compositionstart", entry.handlers.compositionStart, true);
    entry.elem.addEventListener("compositionend", entry.handlers.compositionEnd, true);
    this.toggleBackingInputTargetListeners(entry, true);
    entry.list.addEventListener("mousedown", entry.handlers.menuMouseDown);
    entry.list.addEventListener("click", entry.handlers.menuClick);

    this.attachedEntryCount += 1;
    this.ensureDocumentPointerDownListener();
    this.ensureDocumentKeyDownListener();
    this.ensureDocumentSelectionChangeListener();
  }

  public detachEntryListeners(entry: SuggestionEntry): void {
    entry.elem.removeEventListener("beforeinput", entry.handlers.beforeinput, true);
    entry.elem.removeEventListener("input", entry.handlers.input, true);
    entry.elem.removeEventListener("keydown", this.getEntryKeydownListener(entry), true);
    entry.elem.removeEventListener("paste", entry.handlers.paste, true);
    entry.elem.removeEventListener("focus", entry.handlers.focus, true);
    entry.elem.removeEventListener("blur", entry.handlers.blur, true);
    entry.elem.removeEventListener("click", entry.handlers.click, true);
    entry.elem.removeEventListener("compositionstart", entry.handlers.compositionStart, true);
    entry.elem.removeEventListener("compositionend", entry.handlers.compositionEnd, true);
    this.toggleBackingInputTargetListeners(entry, false);
    entry.list.removeEventListener("mousedown", entry.handlers.menuMouseDown);
    entry.list.removeEventListener("click", entry.handlers.menuClick);
    this.keydownListenerByEntryId.delete(entry.id);

    this.attachedEntryCount = Math.max(0, this.attachedEntryCount - 1);
    if (this.attachedEntryCount === 0) {
      this.removeDocumentPointerDownListener();
      this.removeDocumentKeyDownListener();
      this.removeDocumentSelectionChangeListener();
    }
  }

  private toggleBackingInputTargetListeners(entry: SuggestionEntry, attach: boolean): void {
    const inputEventTarget = entry.inputEventTarget;
    if (!inputEventTarget || inputEventTarget === entry.elem) {
      return;
    }
    const method = attach ? "addEventListener" : "removeEventListener";
    inputEventTarget[method]("beforeinput", entry.handlers.beforeinput, true);
    inputEventTarget[method]("input", entry.handlers.input, true);
    inputEventTarget[method]("keydown", this.getEntryKeydownListener(entry), true);
    inputEventTarget[method]("paste", entry.handlers.paste, true);
    inputEventTarget[method]("focus", entry.handlers.focus, true);
    inputEventTarget[method]("blur", entry.handlers.blur, true);
    inputEventTarget[method]("compositionstart", entry.handlers.compositionStart, true);
    inputEventTarget[method]("compositionend", entry.handlers.compositionEnd, true);
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

  private ensureDocumentPointerDownListener(): void {
    if (this.documentPointerDownListenerAttached) {
      return;
    }
    this.doc.addEventListener("mousedown", this.onDocumentPointerDownBound, true);
    this.documentPointerDownListenerAttached = true;
  }

  private removeDocumentPointerDownListener(): void {
    if (!this.documentPointerDownListenerAttached) {
      return;
    }
    this.doc.removeEventListener("mousedown", this.onDocumentPointerDownBound, true);
    this.documentPointerDownListenerAttached = false;
  }

  private ensureDocumentKeyDownListener(): void {
    if (this.documentKeyDownListenerAttached) {
      return;
    }
    this.doc.addEventListener("keydown", this.onDocumentKeyDownBound, true);
    this.documentKeyDownListenerAttached = true;
  }

  private removeDocumentKeyDownListener(): void {
    if (!this.documentKeyDownListenerAttached) {
      return;
    }
    this.doc.removeEventListener("keydown", this.onDocumentKeyDownBound, true);
    this.documentKeyDownListenerAttached = false;
  }

  private ensureDocumentSelectionChangeListener(): void {
    if (this.documentSelectionChangeListenerAttached) {
      return;
    }
    this.doc.addEventListener("selectionchange", this.onDocumentSelectionChangeBound, true);
    this.documentSelectionChangeListenerAttached = true;
  }

  private removeDocumentSelectionChangeListener(): void {
    if (!this.documentSelectionChangeListenerAttached) {
      return;
    }
    this.doc.removeEventListener("selectionchange", this.onDocumentSelectionChangeBound, true);
    this.documentSelectionChangeListenerAttached = false;
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

    for (const node of path) {
      const directBackingTargetMatch = entries.find(
        (entry) => this.isDocumentTabFallbackEligible(entry) && node === entry.inputEventTarget,
      );
      if (directBackingTargetMatch) {
        directBackingTargetMatch.handlers.keydown(keyboardEvent);
        keyboardEvent.__ftDocumentTabCaptureHandled = true;
        return;
      }

      const directElementMatch = entries.find(
        (entry) => this.isDocumentTabFallbackEligible(entry) && node === entry.elem,
      );
      if (directElementMatch) {
        directElementMatch.handlers.keydown(keyboardEvent);
        keyboardEvent.__ftDocumentTabCaptureHandled = true;
        return;
      }

      if (!(node instanceof Node)) {
        continue;
      }

      const containingEntry = entries.find(
        (entry) => this.isDocumentTabFallbackEligible(entry) && entry.elem.contains(node),
      );
      if (containingEntry) {
        containingEntry.handlers.keydown(keyboardEvent);
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
