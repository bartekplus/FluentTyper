import Tribute from "../third_party/tribute/tribute.esm.js";
import {
  LANG_SEPERATOR_CHARS_REGEX,
  SUPPORTED_LANGUAGES,
} from "../shared/lang";
import { isInDocument } from "../shared/utils";
import type {
  PredictResponseContext,
  ContentScriptUsageEventMessage,
  ForceReplaceType,
} from "../shared/messageTypes";
import { SPACING_RULES, Spacing } from "../background/SpacingRulesHandler";
import { CMD_CONTENT_SCRIPT_USAGE_EVENT } from "../shared/constants";

interface TributeItem {
  original: { value: string };
  string: string;
}

interface TributeEntry {
  tribute: Tribute;
  elem: Element;
  done?: (
    results: unknown[],
    forceReplace: ForceReplaceType | null,
    menuHeader?: string,
  ) => void;
  requestId: number;
  // Store handler references for proper removal
  tributeReplacedHandlerRef?: EventListenerOrEventListenerObject;
  elementKeyDownHandlerRef?: EventListenerOrEventListenerObject;
  missingTrailingSpace?: boolean;
  expectedCursorPos?: number;
}

interface TributeReplaceEventContext {
  mentionText?: string;
}

interface TributeReplaceEventDetail {
  text?: string;
  context?: TributeReplaceEventContext;
}

export class TributeManager {
  private SELECTORS: string;
  private newTributeId: number;
  private tributeArr: Record<number, TributeEntry>;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  private getPrediction: Function;

  private minWordLengthToPredict: number;
  private autocomplete: boolean;
  private autocompleteOnEnter: boolean;
  private autocompleteOnTab: boolean;
  private lang: string;
  private _autocompleteSeparator: RegExp;
  private selectByDigit: boolean;
  private revertOnBackspace: boolean;
  private displayLangHeader: boolean;
  private inline_suggestion: boolean;
  private helperIdByElement: WeakMap<Element, number>;
  private reTriggerTributeOnReplaceEvent: boolean = false;
  private activeHelperArrId: number | null = null;

  // Logging prefix for all logs in this module
  private static readonly LOG_PREFIX = "[TributeManager]";

  constructor({
    selectors,
    minWordLengthToPredict,
    autocomplete,
    autocompleteOnEnter,
    autocompleteOnTab,
    lang,
    selectByDigit,
    revertOnBackspace,
    displayLangHeader,
    inline_suggestion,
    // Callbacks to FluentTyper
    getPrediction,
  }: {
    selectors: string;
    minWordLengthToPredict: number;
    autocomplete: boolean;
    autocompleteOnEnter: boolean;
    autocompleteOnTab: boolean;
    lang: string;
    selectByDigit: boolean;
    revertOnBackspace: boolean;
    displayLangHeader: boolean;
    inline_suggestion: boolean;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    getPrediction: Function;
  }) {
    this.SELECTORS = selectors;
    this.newTributeId = 0;
    this.tributeArr = {};
    // Configurable properties
    this.minWordLengthToPredict = minWordLengthToPredict;
    this.autocomplete = autocomplete;
    this.autocompleteOnEnter = autocompleteOnEnter;
    this.autocompleteOnTab = autocompleteOnTab;
    this.lang = lang;
    this._autocompleteSeparator = LANG_SEPERATOR_CHARS_REGEX[lang];
    this.selectByDigit = selectByDigit;
    this.revertOnBackspace = revertOnBackspace;
    this.displayLangHeader = displayLangHeader;
    this.inline_suggestion = inline_suggestion;
    this.helperIdByElement = new WeakMap<Element, number>();
    this.getPrediction = getPrediction; // callback to main class
    this.activeHelperArrId = null;
    console.info(
      "[%s:%s] Initialized TributeManager",
      TributeManager.LOG_PREFIX,
      this.constructor.name,
      {
        selectors,
        minWordLengthToPredict,
        autocomplete,
        autocompleteOnEnter,
        autocompleteOnTab,
        lang,
        selectByDigit,
        revertOnBackspace,
        displayLangHeader,
        inline_suggestion,
      },
    );
  }

  set autocompleteSeparator(val) {
    console.info(
      "[%s:%s:%s] Setting autocompleteSeparator",
      TributeManager.LOG_PREFIX,
      this.constructor.name,
      "set autocompleteSeparator",
      val,
    );
    this._autocompleteSeparator = val;
    for (const [key] of Object.entries(this.tributeArr)) {
      this.tributeArr[Number(key)].tribute.autocompleteSeparator = val;
    }
  }
  get autocompleteSeparator() {
    return this._autocompleteSeparator;
  }

  private keys(): string[] {
    const keyArr = ["Escape", "ArrowUp", "ArrowDown", "Space"];
    if (this.autocompleteOnEnter) keyArr.push("Enter");
    if (this.autocompleteOnTab) keyArr.push("Tab");
    if (this.revertOnBackspace) keyArr.push("Backspace");
    return keyArr;
  }

  private checkElemProperty(
    elem: Element,
    propertyName: string,
    expectedValue: string | RegExp,
    defaultValue: string,
  ): boolean {
    const elemValue = elem.hasAttribute(propertyName)
      ? elem.getAttribute(propertyName)!.toLowerCase().trim()
      : defaultValue;
    if (typeof expectedValue === "string") {
      return elemValue === expectedValue;
    }
    return Boolean(elemValue.match(expectedValue));
  }

  private attachHelperToNode(elem: Element) {
    console.info(
      "[%s:%s:%s] Attaching to: %o",
      TributeManager.LOG_PREFIX,
      this.constructor.name,
      this.attachHelperToNode.name,
      elem,
    );
    const tributeId = this.newTributeId++;
    this.tributeArr[tributeId] = {
      elem: elem,
      requestId: 0,
    } as TributeEntry; // Cast to allow tribute to be added next
    this.helperIdByElement.set(elem, tributeId);

    const tribueKeyFn = this.keys.bind(this);
    const tribueValuesFn = (
      _trigger: string, // text typed so far - not used directly here, context.text is used
      done: (
        results: unknown[],
        forceReplace: ForceReplaceType | null,
        menuHeader?: string,
      ) => void,
      fullText: string,
      nextChar: string,
    ) => {
      const currentEntry = this.tributeArr[tributeId];
      if (!currentEntry) return;

      currentEntry.done = done;
      currentEntry.requestId += 1;
      this.activeHelperArrId = tributeId;

      console.info(
        "[%s:%s:%s] Requesting prediction",
        TributeManager.LOG_PREFIX,
        this.constructor.name,
        "attachHelperToNode:valuesFn",
        {
          fullText,
          nextChar,
          tributeId,
          requestId: currentEntry.requestId,
          lang: this.lang,
        },
      );
      this.getPrediction({
        text: fullText,
        nextChar: nextChar,
        tributeId: tributeId,
        requestId: currentEntry.requestId,
        lang: this.lang,
      });
    };

    const tribute = new Tribute({
      trigger: "",
      iframe: null,
      selectClass: "highlight",
      containerClass: "tribute-container",
      itemClass: "",
      // @ts-expect-error ignore Tribute errors
      selectTemplate: (item: TributeItem) => item.original.value,
      // @ts-expect-error ignore Tribute errors
      menuItemTemplate: (item: TributeItem) => item.string,
      noMatchTemplate: undefined,
      // @ts-expect-error ignore Tribute errors
      menuContainer: document.body,
      lookup: "key",
      fillAttr: "value",
      // @ts-expect-error ignore Tribute errors
      values: tribueValuesFn,
      requireLeadingSpace: false,
      allowSpaces: false,
      // @ts-expect-error ignore Tribute errors
      replaceTextSuffix: "",
      positionMenu: true,
      spaceSelectsMatch: this.autocomplete,
      autocompleteMode: true,
      autocompleteSeparator: this.autocompleteSeparator,
      inline: this.inline_suggestion,
      searchOpts: {
        pre: "<span>",
        post: "</span>",
        skip: true,
      },
      menuShowMinLength:
        this.minWordLengthToPredict === -1
          ? Number.MAX_VALUE
          : this.minWordLengthToPredict,
      // @ts-expect-error ignore Tribute errors
      keys: tribueKeyFn,
      supportRevert: true, // Assuming this is related to revertOnBackspace
      selectByDigit: this.selectByDigit,
    });

    this.tributeArr[tributeId].tribute = tribute;
    tribute.attach(elem);

    const boundTributeReplacedHandler = this.tributeReplacedEventHandler.bind(
      this,
      tributeId,
    );
    // MUST be synchronous so event.preventDefault() works reliably without letter duplication.
    const boundElementKeyDownHandler = this.elementKeyDownEventHandler.bind(
      this,
      tributeId,
    );

    this.tributeArr[tributeId].tributeReplacedHandlerRef =
      boundTributeReplacedHandler;
    this.tributeArr[tributeId].elementKeyDownHandlerRef =
      boundElementKeyDownHandler;

    elem.addEventListener("tribute-replaced", boundTributeReplacedHandler);
    elem.addEventListener("keydown", boundElementKeyDownHandler);
  }

  public fulfillPrediction(context: PredictResponseContext) {
    console.info(
      "[%s:%s:%s] fulfillPrediction called",
      TributeManager.LOG_PREFIX,
      this.constructor.name,
      this.fulfillPrediction.name,
      context,
    );
    const tributeEntry = this.tributeArr[context.tributeId];
    if (
      tributeEntry &&
      tributeEntry.requestId === context.requestId &&
      tributeEntry.done
    ) {
      const keyValPairs = context.predictions.map((prediction) => ({
        key: prediction,
        value: prediction,
      }));

      const header: string | undefined =
        this.displayLangHeader && context.lang
          ? `Lang: ${SUPPORTED_LANGUAGES[context.lang]}`
          : undefined;

      console.info(
        "[%s:%s:%s] Fulfilling prediction",
        TributeManager.LOG_PREFIX,
        this.constructor.name,
        this.fulfillPrediction.name,
        {
          keyValPairs,
          header,
        },
      );
      tributeEntry.done(keyValPairs, context.forceReplace, header);
      if (context.predictions.length > 0) {
        this.emitUsageEvent({
          eventType: "suggestion_shown",
          suggestionCount: context.predictions.length,
          language: context.lang,
        });
      }
    } else {
      console.warn(
        "[%s:%s:%s] fulfillPrediction: No matching tributeEntry or requestId mismatch",
        TributeManager.LOG_PREFIX,
        this.constructor.name,
        this.fulfillPrediction.name,
        context,
      );
    }
  }

  detachHelper(tributeId: number) {
    const entry = this.tributeArr[tributeId];
    if (!entry) return;
    const elem = entry.elem;
    entry.tribute.detach(elem);
    if (entry.tributeReplacedHandlerRef) {
      elem.removeEventListener(
        "tribute-replaced",
        entry.tributeReplacedHandlerRef,
      );
    }
    if (entry.elementKeyDownHandlerRef) {
      elem.removeEventListener("keydown", entry.elementKeyDownHandlerRef);
    }
    this.helperIdByElement.delete(elem);
    delete this.tributeArr[tributeId];
  }

  detachAllHelpers() {
    for (const [key] of Object.entries(this.tributeArr)) {
      this.detachHelper(Number(key));
    }
    this.tributeArr = {};
    this.helperIdByElement = new WeakMap<Element, number>();
  }

  isHelperAttached(elem: Element) {
    const helperId = this.helperIdByElement.get(elem);
    return (
      typeof helperId === "number" &&
      Boolean(this.tributeArr[helperId]) &&
      this.tributeArr[helperId].elem === elem
    );
  }

  removeHelpersNotInDocument() {
    // This method is used to clean up any helpers that are no longer in the document.
    for (const [key, entry] of Object.entries(this.tributeArr)) {
      if (!isInDocument(entry.elem)) {
        this.detachHelper(Number(key));
      }
    }
  }

  queryAndAttachHelper(elem?: Element) {
    let elems: Element[] = [];
    if (elem) {
      if (elem.matches && elem.matches(this.SELECTORS)) {
        elems = [elem];
      } else if (elem.querySelectorAll) {
        elems = Array.from(elem.querySelectorAll(this.SELECTORS));
      }
    } else {
      elems = Array.from(document.querySelectorAll(this.SELECTORS));
    }

    const propertiesToFilter = [
      {
        property: "contentEditable",
        expectedValue: RegExp(/.*/),
        defaultValue: "true",
        reverseCheck: false,
      },
      {
        property: "contentEditable",
        expectedValue: "false",
        defaultValue: "",
        reverseCheck: true,
      },
      {
        property: "name",
        expectedValue: "username",
        defaultValue: "",
        reverseCheck: true,
      },
      {
        property: "name",
        expectedValue: "password",
        defaultValue: "",
        reverseCheck: true,
      },
      {
        property: "id",
        expectedValue: "username",
        defaultValue: "",
        reverseCheck: true,
      },
      // Add other relevant checks if needed, e.g., for 'email', 'search', 'url', 'tel' input types
      // Or ensure the element is not of type 'password', 'email', etc. if those are excluded.
      // Example: { property: "type", expectedValue: "password", defaultValue: "", reverseCheck: true }
    ];

    const filteredElems: Element[] = [];
    for (let i = 0; i < elems.length; i++) {
      const currentElem = elems[i];
      let propertiesCheck = true;
      // Skip if it's an input element and not of a text-like type
      if (currentElem.tagName === "INPUT") {
        const inputType = (currentElem as HTMLInputElement).type.toLowerCase();
        if (!["text", "search", ""].includes(inputType)) {
          // Empty string for default type
          propertiesCheck = false;
        }
      }

      if (propertiesCheck) {
        // Continue if basic type check passes
        for (const check of propertiesToFilter) {
          let checkVal = this.checkElemProperty(
            currentElem,
            check.property,
            check.expectedValue,
            check.defaultValue,
          );
          if (check.reverseCheck) checkVal = !checkVal;
          if (!checkVal) {
            propertiesCheck = false;
            break;
          }
        }
      }

      if (propertiesCheck) filteredElems.push(currentElem);
    }
    for (let i = 0; i < filteredElems.length; i++) {
      if (this.isHelperAttached(filteredElems[i])) continue;
      let skip = false;
      for (const [key] of Object.entries(this.tributeArr)) {
        const keyAsNumber = Number(key);
        if (filteredElems[i].contains(this.tributeArr[keyAsNumber].elem)) {
          this.detachHelper(keyAsNumber);
        } else if (
          this.tributeArr[keyAsNumber].elem.contains(filteredElems[i])
        ) {
          skip = true;
          break;
        }
      }
      if (skip) continue;
      this.attachHelperToNode(filteredElems[i]);
    }
  }

  triggerActiveTribute() {
    console.info(
      "[%s:%s:%s] triggerActiveTribute called",
      TributeManager.LOG_PREFIX,
      this.constructor.name,
      this.triggerActiveTribute.name,
      { activeHelperArrId: this.activeHelperArrId },
    );
    if (this.activeHelperArrId === null) return;
    if (this.tributeArr[this.activeHelperArrId]) {
      this.tributeArr[this.activeHelperArrId].tribute.showMenuForCollection(
        this.tributeArr[this.activeHelperArrId].elem,
      );
      console.info(
        "[%s:%s:%s] Active tribute menu shown",
        TributeManager.LOG_PREFIX,
        this.constructor.name,
        this.triggerActiveTribute.name,
        { activeHelperArrId: this.activeHelperArrId },
      );
    }
  }

  private emitUsageEvent(
    context: ContentScriptUsageEventMessage["context"],
  ): void {
    const message: ContentScriptUsageEventMessage = {
      command: CMD_CONTENT_SCRIPT_USAGE_EVENT,
      context,
    };
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  }

  private emitSuggestionAcceptedUsageEvents(detail: TributeReplaceEventDetail) {
    const triggerText =
      typeof detail.context?.mentionText === "string"
        ? detail.context.mentionText
        : "";
    const insertedText =
      typeof detail.text === "string" ? detail.text : triggerText;
    const typedTextLength = triggerText.length;
    const insertedTextLength = insertedText.length;
    this.emitUsageEvent({
      eventType: "suggestion_accepted",
      triggerText,
      typedTextLength,
      insertedTextLength,
      language: this.lang,
    });
    this.emitUsageEvent({
      eventType: "snippet_expanded",
      triggerText,
      typedTextLength,
      insertedTextLength,
      language: this.lang,
    });
    this.emitUsageEvent({
      eventType: "chars_inserted_from_snippet",
      amount: insertedTextLength,
      triggerText,
      language: this.lang,
    });
    this.emitUsageEvent({
      eventType: "chars_typed_for_trigger",
      amount: typedTextLength,
      triggerText,
      language: this.lang,
    });
  }

  tributeReplacedEventHandler(helperArrId: number, event?: Event) {
    this.activeHelperArrId = helperArrId;
    const customEvent = event as CustomEvent<TributeReplaceEventDetail>;
    if (customEvent && customEvent.detail) {
      this.emitSuggestionAcceptedUsageEvents(customEvent.detail);
    }

    // We check if the inserted text ends with a space. If not, the user might need one.
    // However, we only know if they need one AFTER they start typing.
    // So we mark that a replacement just happened.
    const entry = this.tributeArr[helperArrId];
    if (entry) {
      entry.missingTrailingSpace = true;
      const elem = entry.elem;
      let cursorPos = 0;
      if (
        elem instanceof HTMLTextAreaElement ||
        elem instanceof HTMLInputElement
      ) {
        cursorPos = elem.selectionStart ?? 0;
      } else {
        const sel = window.getSelection();
        if (sel && sel.anchorNode && sel.anchorNode.textContent) {
          cursorPos = sel.anchorOffset;
        }
      }
      entry.expectedCursorPos = cursorPos;
    }

    if (this.tributeArr[helperArrId] && this.reTriggerTributeOnReplaceEvent) {
      this.triggerActiveTribute();
    }
  }

  elementKeyDownEventHandler(helperArrId: number, event: Event) {
    this.activeHelperArrId = helperArrId;
    const entry = this.tributeArr[helperArrId];

    // Only perform logic if we just had a replacement
    if (entry && entry.missingTrailingSpace) {
      const keyboardEvent = event as KeyboardEvent;
      const key = keyboardEvent.key;

      // Ignore modifier keys that don't change cursor or insert text
      if (
        ["Shift", "Control", "Alt", "Meta", "CapsLock", "Escape"].includes(key)
      ) {
        return;
      }

      const elem = entry.elem;
      let currentPos = 0;
      if (
        elem instanceof HTMLTextAreaElement ||
        elem instanceof HTMLInputElement
      ) {
        currentPos = elem.selectionStart ?? 0;
      } else {
        const sel = window.getSelection();
        if (sel && sel.anchorNode && sel.anchorNode.textContent) {
          currentPos = sel.anchorOffset;
        }
      }

      // If the cursor moved from the expected position or user pressed a navigational key
      if (currentPos !== entry.expectedCursorPos || key.length > 1) {
        entry.missingTrailingSpace = false;
        return;
      }

      // If user types a visible character
      if (key && key.length === 1 && key.trim()) {
        // Clear flag immediately so it only applies to the VERY FIRST key pressed after autocomplete.
        entry.missingTrailingSpace = false;
        const elem = entry.elem;
        let charBeforeCursor = "";

        if (
          elem instanceof HTMLTextAreaElement ||
          elem instanceof HTMLInputElement
        ) {
          const cursorPos = elem.selectionStart ?? 0;
          charBeforeCursor = cursorPos > 0 ? elem.value[cursorPos - 1] : "";
        } else {
          const sel = window.getSelection();
          if (sel && sel.anchorNode && sel.anchorNode.textContent) {
            const offset = sel.anchorOffset;
            charBeforeCursor =
              offset > 0 ? sel.anchorNode.textContent[offset - 1] : "";
          }
        }

        // If there's ALREADY a whitespace, do nothing
        if (!charBeforeCursor || /\s/.test(charBeforeCursor)) {
          return;
        }

        // Check spacing rules
        const spacingRule = SPACING_RULES[key];
        if (
          !spacingRule ||
          (spacingRule.spaceBefore !== Spacing.REMOVE_SPACE &&
            spacingRule.spaceBefore !== Spacing.NO_CHANGE)
        ) {
          event.preventDefault();
          document.execCommand("insertText", false, "\xA0" + key);
        }
      }
    }
  }

  updateLangConfig(lang: string) {
    this.autocompleteSeparator = LANG_SEPERATOR_CHARS_REGEX[lang];
    this.lang = lang;
    this.triggerActiveTribute();
  }
}
