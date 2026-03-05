import type { SuggestionEntry } from "./types";

export interface SuggestionLifecycleControllerOptions {
  getEntries: () => Iterable<SuggestionEntry>;
  dismissEntry: (entry: SuggestionEntry) => void;
  doc?: Document;
}

export class SuggestionLifecycleController {
  private readonly getEntries: () => Iterable<SuggestionEntry>;
  private readonly dismissEntry: (entry: SuggestionEntry) => void;
  private readonly doc: Document;
  private attachedEntryCount = 0;
  private documentPointerDownListenerAttached = false;
  private readonly onDocumentPointerDownBound: EventListener =
    this.onDocumentPointerDown.bind(this);

  constructor(options: SuggestionLifecycleControllerOptions) {
    this.getEntries = options.getEntries;
    this.dismissEntry = options.dismissEntry;
    this.doc = options.doc ?? document;
  }

  public attachEntryListeners(entry: SuggestionEntry): void {
    entry.elem.addEventListener("input", entry.handlers.input, true);
    entry.elem.addEventListener("keydown", entry.handlers.keydown, true);
    entry.elem.addEventListener("focus", entry.handlers.focus, true);
    entry.elem.addEventListener("blur", entry.handlers.blur, true);
    entry.elem.addEventListener("click", entry.handlers.click, true);
    entry.elem.addEventListener("compositionstart", entry.handlers.compositionStart, true);
    entry.elem.addEventListener("compositionend", entry.handlers.compositionEnd, true);
    entry.menu.addEventListener("mousedown", entry.handlers.menuMouseDown);
    entry.menu.addEventListener("click", entry.handlers.menuClick);

    this.attachedEntryCount += 1;
    this.ensureDocumentPointerDownListener();
  }

  public detachEntryListeners(entry: SuggestionEntry): void {
    entry.elem.removeEventListener("input", entry.handlers.input, true);
    entry.elem.removeEventListener("keydown", entry.handlers.keydown, true);
    entry.elem.removeEventListener("focus", entry.handlers.focus, true);
    entry.elem.removeEventListener("blur", entry.handlers.blur, true);
    entry.elem.removeEventListener("click", entry.handlers.click, true);
    entry.elem.removeEventListener("compositionstart", entry.handlers.compositionStart, true);
    entry.elem.removeEventListener("compositionend", entry.handlers.compositionEnd, true);
    entry.menu.removeEventListener("mousedown", entry.handlers.menuMouseDown);
    entry.menu.removeEventListener("click", entry.handlers.menuClick);

    this.attachedEntryCount = Math.max(0, this.attachedEntryCount - 1);
    if (this.attachedEntryCount === 0) {
      this.removeDocumentPointerDownListener();
    }
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

  private onDocumentPointerDown(event: Event): void {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    for (const entry of this.getEntries()) {
      if (entry.elem.contains(target) || entry.menu.contains(target)) {
        continue;
      }
      this.dismissEntry(entry);
    }
  }
}
