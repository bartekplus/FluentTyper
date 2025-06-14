import Tribute from "../third_party/tribute/tribute.esm.js";
import {
  LANG_SEPERATOR_CHARS_REGEX,
  SUPPORTED_LANGUAGES,
} from "../shared/lang";
import { debounce } from "../shared/utils"; // Assuming debounce is available here
import { PredictResponseContext } from "../shared/messageTypes";

interface TributeEntry {
  tribute: Tribute;
  elem: Element;
  done?: (results: any[], forceReplace?: string, menuHeader?: string) => void;
  requestId?: number;
  // Store handler references for proper removal
  tributeReplacedHandlerRef?: EventListenerOrEventListenerObject;
  elementKeyDownHandlerRef?: EventListenerOrEventListenerObject;
}

export class TributeManager {
  SELECTORS: string;
  private newTributeId: number;
  tributeArr: Record<string, TributeEntry>;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  getPrediction: Function | undefined;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  onTrigger: Function | undefined;

  constructor({
    selectors,
    minWordLengthToPredict,
    autocomplete,
    autocompleteOnEnter,
    autocompleteOnTab,
    lang,
    selectByDigit,
    revertOnBackspace,
    // Callbacks to FluentTyper
    getPrediction,
    onTrigger,
  }: {
    selectors: string;
    minWordLengthToPredict: number;
    autocomplete: boolean;
    autocompleteOnEnter: boolean;
    autocompleteOnTab: boolean;
    lang: string;
    selectByDigit: boolean;
    revertOnBackspace: boolean;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    getPrediction?: Function;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    onTrigger?: Function;
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
    this.getPrediction = getPrediction; // callback to main class
    this.onTrigger = onTrigger; // callback to main class
  }

  // Make these properties public so FluentTyper can update them
  public minWordLengthToPredict: number;
  public autocomplete: boolean;
  public autocompleteOnEnter: boolean;
  public autocompleteOnTab: boolean;
  public lang: string;
  private _autocompleteSeparator: RegExp;
  public selectByDigit: boolean;
  public revertOnBackspace: boolean;

  set autocompleteSeparator(val) {
    this._autocompleteSeparator = val;
    for (const [key] of Object.entries(this.tributeArr)) {
      this.tributeArr[key].tribute.autocompleteSeparator = val;
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
        forceReplace?: string,
        menuHeader?: string,
      ) => void,
      fullText: string,
      nextChar: string,
    ) => {
      const currentEntry = this.tributeArr[tributeId];
      if (!currentEntry) return;

      currentEntry.done = done;
      currentEntry.requestId = (currentEntry.requestId || 0) + 1;

      if (this.getPrediction) {
        this.getPrediction({
          text: fullText,
          nextChar: nextChar,
          tributeId: tributeId,
          requestId: currentEntry.requestId,
          lang: this.lang,
        });
      }
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
      replaceTextSuffix: undefined,
      positionMenu: true,
      spaceSelectsMatch: this.autocomplete,
      autocompleteMode: true,
      autocompleteSeparator: this.autocompleteSeparator,
      searchOpts: {
        pre: "<span>",
        post: "</span>",
        skip: true,
      },
      menuShowMinLength: this.minWordLengthToPredict,
      // @ts-expect-error ignore Tribute errors
      keys: tribueKeyFn,
      supportRevert: true, // Assuming this is related to revertOnBackspace
      selectByDigit: this.selectByDigit,
    });

    this.tributeArr[tributeId].tribute = tribute;
    tribute.attach(elem);

    // Event listeners
    const boundTributeReplacedHandler = debounce(
      this.tributeReplacedEventHandler.bind(this, tributeId.toString()),
      16,
      { leading: false, trailing: true },
    );
    const boundElementKeyDownHandler = debounce(
      this.elementKeyDownEventHandler.bind(this, tributeId.toString()),
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

      const header: string | undefined = context.lang
        ? `Lang: ${SUPPORTED_LANGUAGES[context.lang]}`
        : undefined;
      tributeEntry.done(keyValPairs, context.forceReplace, header);
    }
  }

  detachHelper(tributeId: string) {
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
      this.detachHelper(key);
    }
    this.tributeArr = {};
  }

  isHelperAttached(elem: Element) {
    for (const [key] of Object.entries(this.tributeArr)) {
      if (elem === this.tributeArr[key].elem) {
        return true;
      }
    }
    return false;
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
        property: "type",
        expectedValue: "text",
        defaultValue: "text",
        reverseCheck: false,
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
        if (
          !["text", "search", "url", "tel", "email", ""].includes(inputType)
        ) {
          // Empty string for default type
          propertiesCheck = true;
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
        if (filteredElems[i] === this.tributeArr[key].elem) continue;
        if (filteredElems[i].contains(this.tributeArr[key].elem)) {
          this.detachHelper(key);
        } else if (this.tributeArr[key].elem.contains(filteredElems[i])) {
          skip = true;
        }
      }
      if (skip) continue;
      if (this.isHelperAttached(filteredElems[i])) continue;
      this.attachHelperToNode(filteredElems[i]);
    }
  }

  triggerTribute(helperArrId: string) {
    if (this.tributeArr[helperArrId]) {
      this.tributeArr[helperArrId].tribute.showMenuForCollection(
        this.tributeArr[helperArrId].elem,
      );
    }
  }

  tributeReplacedEventHandler(helperArrId: string) {
    console.log(
      `tribute-replaced event triggered for helperArrId: ${helperArrId}`,
    );
    if (this.tributeArr[helperArrId]) {
      this.triggerTribute(helperArrId);
    }
  }

  elementKeyDownEventHandler(helperArrId: string) {
    if (this.onTrigger && this.tributeArr[helperArrId])
      this.onTrigger(helperArrId);
  }

  updateLangConfig(lang: string, tributeId: string) {
    this.autocompleteSeparator = LANG_SEPERATOR_CHARS_REGEX[lang];
    this.lang = lang;
    this.triggerTribute(tributeId);
  }
}
