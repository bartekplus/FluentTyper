import SuggestionEngine from "./suggestions/SuggestionEngineCore.js";
import { LANG_SEPARATOR_CHARS_REGEX, SUPPORTED_LANGUAGES } from "@core/domain/lang";
import { isInDocument } from "@core/application/dom-utils";
import { createLogger } from "@core/application/logging/Logger";
import type {
  PredictResponseContext,
  ContentScriptUsageEventMessage,
  TextEditOperation,
} from "@core/domain/messageTypes";
import { SPACING_RULES, Spacing } from "@core/domain/spacingRules";
import { CMD_CONTENT_SCRIPT_USAGE_EVENT } from "@core/domain/constants";
import { SuggestionKeyboardController } from "./suggestions/SuggestionKeyboardController";

const logger = createLogger("SuggestionManager");

interface SuggestionItem {
  original: { value: string };
  string: string;
}

interface SuggestionEntry {
  suggestionEngine: SuggestionEngine;
  elem: Element;
  done?: (results: unknown[], textEdit: TextEditOperation | null, menuHeader?: string) => void;
  requestId: number;
  // Store handler references for proper removal
  suggestionReplacedHandlerRef?: EventListenerOrEventListenerObject;
  elementKeyDownHandlerRef?: EventListenerOrEventListenerObject;
  missingTrailingSpace?: boolean;
  expectedCursorPos?: number;
}

interface SuggestionReplaceEventContext {
  mentionText?: string;
}

interface SuggestionReplaceEventDetail {
  text?: string;
  context?: SuggestionReplaceEventContext;
}

export class SuggestionManager {
  private selectors: string;
  private nextSuggestionId: number;
  private suggestionEntries: Record<number, SuggestionEntry>;
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
  private reTriggerSuggestionOnReplaceEvent: boolean = false;
  private activeHelperArrId: number | null = null;

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
    this.selectors = selectors;
    this.nextSuggestionId = 0;
    this.suggestionEntries = {};
    // Configurable properties
    this.minWordLengthToPredict = minWordLengthToPredict;
    this.autocomplete = autocomplete;
    this.autocompleteOnEnter = autocompleteOnEnter;
    this.autocompleteOnTab = autocompleteOnTab;
    this.lang = lang;
    this._autocompleteSeparator = LANG_SEPARATOR_CHARS_REGEX[lang];
    this.selectByDigit = selectByDigit;
    this.revertOnBackspace = revertOnBackspace;
    this.displayLangHeader = displayLangHeader;
    this.inline_suggestion = inline_suggestion;
    this.helperIdByElement = new WeakMap<Element, number>();
    this.getPrediction = getPrediction; // callback to main class
    this.activeHelperArrId = null;
    logger.debug("Initialized suggestion manager", {
      selectors,
      minWordLengthToPredict,
      autocomplete,
      autocompleteOnEnter,
      autocompleteOnTab,
      lang,
      selectByDigit,
      revertOnBackspace,
      displayLangHeader,
      inlineSuggestion: inline_suggestion,
    });
  }

  set autocompleteSeparator(val) {
    logger.debug("Updated autocomplete separator", { separator: val });
    this._autocompleteSeparator = val;
    for (const [key] of Object.entries(this.suggestionEntries)) {
      this.suggestionEntries[Number(key)].suggestionEngine.autocompleteSeparator = val;
    }
  }
  get autocompleteSeparator() {
    return this._autocompleteSeparator;
  }

  private keys(): string[] {
    return SuggestionKeyboardController.buildActiveKeys({
      autocompleteOnEnter: this.autocompleteOnEnter,
      autocompleteOnTab: this.autocompleteOnTab,
      revertOnBackspace: this.revertOnBackspace,
    });
  }

  private checkElemProperty(
    elem: Element,
    propertyName: string,
    expectedValue: string | RegExp,
    defaultValue: string,
  ): boolean {
    const attributeValue = elem.getAttribute(propertyName);
    const elemValue =
      typeof attributeValue === "string" ? attributeValue.toLowerCase().trim() : defaultValue;
    if (typeof expectedValue === "string") {
      return elemValue === expectedValue;
    }
    return Boolean(elemValue.match(expectedValue));
  }

  private attachHelperToNode(elem: Element) {
    logger.debug("Attaching suggestion helper to element", {
      tagName: elem.tagName,
    });
    const suggestionId = this.nextSuggestionId++;
    this.suggestionEntries[suggestionId] = {
      elem,
      requestId: 0,
    } as SuggestionEntry; // Cast to allow suggestionEngine to be added next
    this.helperIdByElement.set(elem, suggestionId);

    const suggestionKeyFn = this.keys.bind(this);
    const suggestionValuesFn = (
      _trigger: string, // text typed so far - not used directly here, context.text is used
      done: (
        results: unknown[],
        textEdit: TextEditOperation | null,
        menuHeader?: string,
      ) => void,
      fullText: string,
      nextChar: string,
    ) => {
      const currentEntry = this.suggestionEntries[suggestionId];
      if (!currentEntry) {
        return;
      }

      currentEntry.done = done;
      currentEntry.requestId += 1;
      this.activeHelperArrId = suggestionId;

      logger.debug("Requesting prediction for suggestion helper", {
        fullText,
        nextChar,
        suggestionId,
        requestId: currentEntry.requestId,
        lang: this.lang,
      });
      this.getPrediction({
        text: fullText,
        nextChar,
        suggestionId,
        requestId: currentEntry.requestId,
        lang: this.lang,
      });
    };

    const suggestionEngine = new SuggestionEngine({
      trigger: "",
      iframe: null,
      selectClass: "highlight",
      containerClass: "suggestion-container",
      itemClass: "",
      selectTemplate: (item: SuggestionItem) => item.original.value,
      menuItemTemplate: (item: SuggestionItem) => item.string,
      noMatchTemplate: undefined,
      menuContainer: document.body,
      lookup: "key",
      fillAttr: "value",
      values: suggestionValuesFn,
      requireLeadingSpace: false,
      allowSpaces: false,
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
        this.minWordLengthToPredict === -1 ? Number.MAX_VALUE : this.minWordLengthToPredict,
      keys: suggestionKeyFn,
      supportRevert: true, // Assuming this is related to revertOnBackspace
      selectByDigit: this.selectByDigit,
    });

    this.suggestionEntries[suggestionId].suggestionEngine = suggestionEngine;
    suggestionEngine.attach(elem);

    const boundSuggestionReplacedHandler = this.suggestionReplacedEventHandler.bind(
      this,
      suggestionId,
    );
    // MUST be synchronous so event.preventDefault() works reliably without letter duplication.
    const boundElementKeyDownHandler = this.elementKeyDownEventHandler.bind(this, suggestionId);

    this.suggestionEntries[suggestionId].suggestionReplacedHandlerRef =
      boundSuggestionReplacedHandler;
    this.suggestionEntries[suggestionId].elementKeyDownHandlerRef = boundElementKeyDownHandler;

    elem.addEventListener("suggestion-replaced", boundSuggestionReplacedHandler);
    elem.addEventListener("keydown", boundElementKeyDownHandler);
  }

  public fulfillPrediction(context: PredictResponseContext) {
    logger.debug("Received prediction response", {
      suggestionId: context.suggestionId,
      requestId: context.requestId,
      predictionCount: context.predictions.length,
      lang: context.lang,
    });
    const suggestionEntry = this.suggestionEntries[context.suggestionId];
    const isCurrentRequest = suggestionEntry && suggestionEntry.requestId === context.requestId;
    const hasTextEdit = context.textEdit != null;

    if (suggestionEntry && (isCurrentRequest || hasTextEdit) && suggestionEntry.done) {
      // For grammar corrections (textEdit), we allow stale responses through
      // because the correction (e.g. capitalize first letter) is still valid even
      // after the user has typed more characters. The position is computed from the
      // original text length, not the current fullText.
      if (!isCurrentRequest && hasTextEdit) {
        logger.debug("Applying stale textEdit grammar correction", {
          suggestionId: context.suggestionId,
          requestId: context.requestId,
          currentRequestId: suggestionEntry.requestId,
        });
      }

      const predictionItems = isCurrentRequest
        ? context.predictions.map((prediction) => ({
            key: prediction,
            value: prediction,
          }))
        : [];

      const header: string | undefined =
        this.displayLangHeader && context.lang
          ? `Lang: ${SUPPORTED_LANGUAGES[context.lang]}`
          : undefined;

      logger.debug("Fulfilling prediction into suggestion manager", {
        suggestionId: context.suggestionId,
        requestId: context.requestId,
        predictionCount: predictionItems.length,
        hasHeader: Boolean(header),
      });
      suggestionEntry.done(predictionItems, context.textEdit, header);

      if (isCurrentRequest && context.predictions.length > 0) {
        this.emitUsageEvent({
          eventType: "suggestion_shown",
          suggestionCount: context.predictions.length,
          language: context.lang,
        });
      }
    } else {
      logger.warn("Ignoring prediction response due to stale request", {
        suggestionId: context.suggestionId,
        requestId: context.requestId,
      });
    }
  }

  detachHelper(suggestionId: number) {
    const entry = this.suggestionEntries[suggestionId];
    if (!entry) {
      return;
    }
    const elem = entry.elem;
    entry.suggestionEngine.detach(elem);
    if (entry.suggestionReplacedHandlerRef) {
      elem.removeEventListener("suggestion-replaced", entry.suggestionReplacedHandlerRef);
    }
    if (entry.elementKeyDownHandlerRef) {
      elem.removeEventListener("keydown", entry.elementKeyDownHandlerRef);
    }
    this.helperIdByElement.delete(elem);
    delete this.suggestionEntries[suggestionId];
  }

  detachAllHelpers() {
    for (const [key] of Object.entries(this.suggestionEntries)) {
      this.detachHelper(Number(key));
    }
    this.suggestionEntries = {};
    this.helperIdByElement = new WeakMap<Element, number>();
  }

  isHelperAttached(elem: Element) {
    const helperId = this.helperIdByElement.get(elem);
    return (
      typeof helperId === "number" &&
      Boolean(this.suggestionEntries[helperId]) &&
      this.suggestionEntries[helperId].elem === elem
    );
  }

  removeHelpersNotInDocument() {
    // This method is used to clean up any helpers that are no longer in the document.
    for (const [key, entry] of Object.entries(this.suggestionEntries)) {
      if (!isInDocument(entry.elem)) {
        this.detachHelper(Number(key));
      }
    }
  }

  queryAndAttachHelper(elem?: Element) {
    let elems: Element[] = [];
    if (elem) {
      if (elem.matches && elem.matches(this.selectors)) {
        elems = [elem];
      } else if (elem.querySelectorAll) {
        elems = Array.from(elem.querySelectorAll(this.selectors));
      }
    } else {
      elems = Array.from(document.querySelectorAll(this.selectors));
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
          if (check.reverseCheck) {
            checkVal = !checkVal;
          }
          if (!checkVal) {
            propertiesCheck = false;
            break;
          }
        }
      }

      if (propertiesCheck) {
        filteredElems.push(currentElem);
      }
    }
    for (let i = 0; i < filteredElems.length; i++) {
      if (this.isHelperAttached(filteredElems[i])) {
        continue;
      }
      let skip = false;
      for (const [key] of Object.entries(this.suggestionEntries)) {
        const keyAsNumber = Number(key);
        if (filteredElems[i].contains(this.suggestionEntries[keyAsNumber].elem)) {
          this.detachHelper(keyAsNumber);
        } else if (this.suggestionEntries[keyAsNumber].elem.contains(filteredElems[i])) {
          skip = true;
          break;
        }
      }
      if (skip) {
        continue;
      }
      this.attachHelperToNode(filteredElems[i]);
    }
  }

  triggerActiveSuggestion() {
    logger.debug("Triggering active suggestion", {
      activeHelperArrId: this.activeHelperArrId,
    });
    if (this.activeHelperArrId === null) {
      return;
    }
    if (this.suggestionEntries[this.activeHelperArrId]) {
      this.suggestionEntries[this.activeHelperArrId].suggestionEngine.showMenuForCollection(
        this.suggestionEntries[this.activeHelperArrId].elem,
      );
      logger.debug("Active suggestion menu shown", {
        activeHelperArrId: this.activeHelperArrId,
      });
    }
  }

  private emitUsageEvent(context: ContentScriptUsageEventMessage["context"]): void {
    const message: ContentScriptUsageEventMessage = {
      command: CMD_CONTENT_SCRIPT_USAGE_EVENT,
      context,
    };
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  }

  private emitSuggestionAcceptedUsageEvents(detail: SuggestionReplaceEventDetail) {
    const triggerText =
      typeof detail.context?.mentionText === "string" ? detail.context.mentionText : "";
    const insertedText = typeof detail.text === "string" ? detail.text : triggerText;
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

  suggestionReplacedEventHandler(helperArrId: number, event?: Event) {
    this.activeHelperArrId = helperArrId;
    const customEvent = event as CustomEvent<SuggestionReplaceEventDetail>;
    if (customEvent && customEvent.detail) {
      this.emitSuggestionAcceptedUsageEvents(customEvent.detail);
    }

    // We check if the inserted text ends with a space. If not, the user might need one.
    // However, we only know if they need one AFTER they start typing.
    // So we mark that a replacement just happened.
    // Skip for grammar corrections (textEdit) which have null event/item in detail.
    const entry = this.suggestionEntries[helperArrId];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detail = customEvent?.detail as any;
    const isForceReplace = detail && !detail.event && !detail.item;
    if (entry && !isForceReplace) {
      entry.missingTrailingSpace = true;
      const elem = entry.elem;
      let cursorPos = 0;
      if (elem instanceof HTMLTextAreaElement || elem instanceof HTMLInputElement) {
        cursorPos = elem.selectionStart ?? 0;
      } else {
        const sel = window.getSelection();
        if (sel && sel.anchorNode && sel.anchorNode.textContent) {
          cursorPos = sel.anchorOffset;
        }
      }
      entry.expectedCursorPos = cursorPos;
    }

    if (this.suggestionEntries[helperArrId] && this.reTriggerSuggestionOnReplaceEvent) {
      this.triggerActiveSuggestion();
    }
  }

  elementKeyDownEventHandler(helperArrId: number, event: Event) {
    this.activeHelperArrId = helperArrId;
    const entry = this.suggestionEntries[helperArrId];

    // Only perform logic if we just had a replacement
    if (entry && entry.missingTrailingSpace) {
      const keyboardEvent = event as KeyboardEvent;
      const key = keyboardEvent.key;

      // Ignore modifier keys that don't change cursor or insert text
      if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Escape"].includes(key)) {
        return;
      }

      const elem = entry.elem;
      let currentPos = 0;
      if (elem instanceof HTMLTextAreaElement || elem instanceof HTMLInputElement) {
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

        if (elem instanceof HTMLTextAreaElement || elem instanceof HTMLInputElement) {
          const cursorPos = elem.selectionStart ?? 0;
          charBeforeCursor = cursorPos > 0 ? elem.value[cursorPos - 1] : "";
        } else {
          const sel = window.getSelection();
          if (sel && sel.anchorNode && sel.anchorNode.textContent) {
            const offset = sel.anchorOffset;
            charBeforeCursor = offset > 0 ? sel.anchorNode.textContent[offset - 1] : "";
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
          document.execCommand("insertText", false, `\xA0${key}`);
        }
      }
    }
  }

  updateLangConfig(lang: string) {
    this.autocompleteSeparator = LANG_SEPARATOR_CHARS_REGEX[lang];
    this.lang = lang;
    this.triggerActiveSuggestion();
  }
}
