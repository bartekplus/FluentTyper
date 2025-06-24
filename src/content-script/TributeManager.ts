import Tribute from "../third_party/tribute/tribute.esm.js";
import {
  LANG_SEPERATOR_CHARS_REGEX,
  SUPPORTED_LANGUAGES,
} from "../shared/lang";
import { debounce, isInDocument } from "../shared/utils"; // Assuming debounce is available here
import {
  PredictResponseContext,
  ForceReplaceType,
} from "../shared/messageTypes";

interface TributeEntry {
  tribute: Tribute;
  elem: Element;
  done?: (
    results: any[],
    forceReplace: ForceReplaceType | null,
    menuHeader?: string,
  ) => void;
  requestId: number;
  // Store handler references for proper removal
  tributeReplacedHandlerRef?: EventListenerOrEventListenerObject;
  elementKeyDownHandlerRef?: EventListenerOrEventListenerObject;
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
  private reTriggerTributeOnReplaceEvent: boolean = false;
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
    this.getPrediction = getPrediction; // callback to main class
    this.activeHelperArrId = null;
  }

  set autocompleteSeparator(val) {
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
    const tributeId = this.newTributeId++;
    this.tributeArr[tributeId] = {
      elem: elem,
      requestId: 0,
    } as TributeEntry; // Cast to allow tribute to be added next

    const tribueKeyFn = this.keys.bind(this);
    const tribueValuesFn = (
      _trigger: string, // text typed so far - not used directly here, context.text is used
      done: (
        results: any[],
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
      selectTemplate: (item: any) => item.original.value,
      // @ts-expect-error ignore Tribute errors
      menuItemTemplate: (item) => item.string,
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

    // Event listeners
    const boundTributeReplacedHandler = debounce(
      this.tributeReplacedEventHandler.bind(this, tributeId),
      16,
      { leading: false, trailing: true },
    );
    const boundElementKeyDownHandler = debounce(
      this.elementKeyDownEventHandler.bind(this, tributeId),
      32,
    );
    // @ts-expect-error ignore Tribute errors
    this.tributeArr[tributeId].tributeReplacedHandlerRef =
      boundTributeReplacedHandler;
    // @ts-expect-error ignore Tribute errors
    this.tributeArr[tributeId].elementKeyDownHandlerRef =
      boundElementKeyDownHandler;
    // @ts-expect-error ignore Tribute errors
    elem.addEventListener("tribute-replaced", boundTributeReplacedHandler);
    // @ts-expect-error ignore Tribute errors
    elem.addEventListener("keydown", boundElementKeyDownHandler);
  }

  public fulfillPrediction(context: PredictResponseContext) {
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
      tributeEntry.done(keyValPairs, context.forceReplace, header);
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
    delete this.tributeArr[tributeId];
  }

  detachAllHelpers() {
    for (const [key] of Object.entries(this.tributeArr)) {
      this.detachHelper(Number(key));
    }
    this.tributeArr = {};
  }

  isHelperAttached(elem: Element) {
    for (const [key] of Object.entries(this.tributeArr)) {
      if (elem === this.tributeArr[Number(key)].elem) {
        return true;
      }
    }
    return false;
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
      let skip = false;
      for (const [key] of Object.entries(this.tributeArr)) {
        const keyAsNumber = Number(key);
        if (filteredElems[i] === this.tributeArr[keyAsNumber].elem) continue;
        if (filteredElems[i].contains(this.tributeArr[keyAsNumber].elem)) {
          this.detachHelper(keyAsNumber);
        } else if (
          this.tributeArr[keyAsNumber].elem.contains(filteredElems[i])
        ) {
          skip = true;
        }
      }
      if (skip) continue;
      if (this.isHelperAttached(filteredElems[i])) continue;
      this.attachHelperToNode(filteredElems[i]);
    }
  }

  triggerActiveTribute() {
    if (this.activeHelperArrId === null) return;
    if (this.tributeArr[this.activeHelperArrId]) {
      this.tributeArr[this.activeHelperArrId].tribute.showMenuForCollection(
        this.tributeArr[this.activeHelperArrId].elem,
      );
    }
  }

  tributeReplacedEventHandler(helperArrId: number) {
    this.activeHelperArrId = helperArrId;
    if (this.tributeArr[helperArrId] && this.reTriggerTributeOnReplaceEvent) {
      this.triggerActiveTribute();
    }
  }

  elementKeyDownEventHandler(helperArrId: number) {
    this.activeHelperArrId = helperArrId;
  }

  updateLangConfig(lang: string) {
    this.autocompleteSeparator = LANG_SEPERATOR_CHARS_REGEX[lang];
    this.lang = lang;
    this.triggerActiveTribute();
  }
}
