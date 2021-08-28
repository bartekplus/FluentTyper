(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.Tribute = factory());
}(this, (function () { 'use strict';

  if (!Array.prototype.find) {
    Object.defineProperty(Array.prototype, "find", {
      value: function (predicate) {
        // 1. Let O be ? ToObject(this value).
        if (this === null) {
          throw TypeError('"this" is null or not defined');
        }

        const o = Object(this); // 2. Let len be ? ToLength(? Get(O, "length")).

        const len = o.length >>> 0; // 3. If IsCallable(predicate) is false, throw a TypeError exception.

        if (typeof predicate !== "function") {
          throw TypeError("predicate must be a function");
        } // 4. If thisArg was supplied, let T be thisArg; else let T be undefined.


        const thisArg = arguments[1]; // 5. Let k be 0.

        let k = 0; // 6. Repeat, while k < len

        while (k < len) {
          // a. Let Pk be ! ToString(k).
          // b. Let kValue be ? Get(O, Pk).
          // c. Let testResult be ToBoolean(? Call(predicate, T, « kValue, k, O »)).
          // d. If testResult is true, return kValue.
          const kValue = o[k];

          if (predicate.call(thisArg, kValue, k, o)) {
            return kValue;
          } // e. Increase k by 1.


          k++;
        } // 7. Return undefined.


        return undefined;
      },
      configurable: true,
      writable: true
    });
  }

  function CustomEvent$1(event, params) {
    params = params || {
      bubbles: false,
      cancelable: false,
      detail: undefined
    };
    const evt = document.createEvent("CustomEvent");
    evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
    return evt;
  }

  if (typeof window !== "undefined" && typeof window.CustomEvent !== "function") {
    if (typeof window.Event !== "undefined") {
      CustomEvent$1.prototype = window.Event.prototype;
    }

    window.CustomEvent = CustomEvent$1;
  }

  /*eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }]*/
  class TributeEvents {
    constructor(tribute) {
      this.tribute = tribute;
      this.tribute.events = this;
    }

    static keys() {
      return ["Tab", "Enter", "Escape", "ArrowUp", "ArrowDown"];
    }

    static modifiers() {
      return ["CapsLock", "Control", "Fn", "Hyper", "Meta", "OS", "Super", "Symbol", "Win"];
    }

    bind(element) {
      element.boundKeyDown = this.keydown.bind(element, this);
      element.boundKeyUpInput = this.tribute.debounce(this.input.bind(element, this), 16);
      element.addEventListener("keydown", element.boundKeyDown, true);
      element.addEventListener("keyup", element.boundKeyUpInput, true);
      element.addEventListener("input", element.boundKeyUpInput, true);
    }

    unbind(element) {
      element.removeEventListener("keydown", element.boundKeyDown, true);
      element.removeEventListener("keyup", element.boundKeyUpInput, true);
      element.removeEventListener("input", element.boundKeyUpInput, true);
      delete element.boundKeyDown;
      delete element.boundKeyUpInput;
    }

    keydown(instance, event) {
      if (instance.shouldDeactivate(event)) {
        instance.tribute.hideMenu();
      }

      if (event instanceof KeyboardEvent) {
        let controlKeyPressed = false;
        TributeEvents.modifiers().forEach(o => {
          if (event.getModifierState(o)) {
            controlKeyPressed = true;
            return;
          }
        });
        if (controlKeyPressed) return;
      }

      if (instance.tribute.isActive) {
        TributeEvents.keys().forEach(key => {
          if (key === event.code) {
            instance.callbacks()[key](event, this);
          }
        });
      }
    }

    input(instance, event) {
      if (!(event instanceof CustomEvent)) {
        instance.keyup.call(this, instance, event);
      }
    }

    click(instance, event) {
      const tribute = instance.tribute;

      if (tribute.menu && tribute.menu.contains(event.target)) {
        let li = event.target;
        event.preventDefault();
        event.stopImmediatePropagation();

        while (li.nodeName.toLowerCase() !== "li") {
          li = li.parentNode;

          if (!li || li === tribute.menu) {
            throw new Error("cannot find the <li> container for the click");
          }
        }

        tribute.selectItemAtIndex(li.getAttribute("data-index"), event);
      } else {
        tribute.hideMenu();
      }
    }

    keyup(instance, event) {
      // Check for modifiers keys
      if (event instanceof KeyboardEvent) {
        if (event.key && event.key.length > 1) {
          // Not a Character exit early
          return;
        }

        let controlKeyPressed = false;
        TributeEvents.modifiers().forEach(o => {
          if (event.getModifierState(o)) {
            controlKeyPressed = true;
            return;
          }
        }); // Check for control keys

        TributeEvents.keys().forEach(key => {
          if (key === event.code) {
            controlKeyPressed = true;
            return;
          }
        });
        if (controlKeyPressed) return;
      }

      if (!instance.updateSelection(this)) return;

      if (!instance.tribute.allowSpaces && instance.tribute.hasTrailingSpace) {
        instance.tribute.hasTrailingSpace = false;
        instance.callbacks().Space(event, this);
        return;
      }

      const keyCode = instance.getKeyCode(event); // Exit if no keyCode

      if (isNaN(keyCode)) {
        return;
      }

      if (!instance.tribute.autocompleteMode) {
        const trigger = instance.tribute.triggers().find(trigger => {
          return trigger.charCodeAt(0) === keyCode;
        });
        if (!trigger) return;
        const collection = instance.tribute.collection.find(item => {
          return item.trigger === trigger;
        });
        if (!collection) return;
        if (collection.menuShowMinLength > instance.tribute.current.mentionText.length) return;
        instance.tribute.current.collection = collection;
      } else {
        instance.tribute.current.collection = instance.tribute.collection[0];
      }

      instance.tribute.showMenuFor(this, true);
    }

    shouldDeactivate(event) {
      let controlKeyPressed = false;
      TributeEvents.keys().forEach(key => {
        if (key === event.code) {
          controlKeyPressed = true;
          return;
        }
      });
      if (controlKeyPressed) return false;
      if (this.tribute.isActive) return true;
      return false;
    }

    getKeyCode(event) {
      const keyCode = event.keyCode || event.which || event.code;

      if (keyCode) {
        return keyCode;
      } else {
        if (this.tribute.current.mentionTriggerChar) return this.tribute.current.mentionTriggerChar.charCodeAt(0);else if (this.tribute.current.mentionText) return this.tribute.current.mentionText.charCodeAt(this.tribute.current.mentionText.length - 1);
      }

      return NaN;
    }

    updateSelection(el) {
      this.tribute.current.element = el;
      const info = this.tribute.range.getTriggerInfo(false, this.tribute.hasTrailingSpace, true, this.tribute.allowSpaces, this.tribute.autocompleteMode);

      if (info) {
        this.tribute.current.mentionTriggerChar = info.mentionTriggerChar;
        this.tribute.current.mentionText = info.mentionText;
        this.tribute.current.mentionPosition = info.mentionPosition;
        this.tribute.current.fullText = info.fullText;
        return true;
      }

      return false;
    }

    callbacks() {
      return {
        Enter: (e, _el) => {
          // choose selection
          if (this.tribute.isActive && this.tribute.current.filteredItems) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.tribute.selectItemAtIndex(this.tribute.menuSelected, e);
          }
        },
        Escape: (e, _el) => {
          if (this.tribute.isActive) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.tribute.hideMenu();
          }
        },
        Tab: (e, el) => {
          // choose first match
          this.callbacks().Enter(e, el);
        },
        Space: (e, el) => {
          if (this.tribute.isActive) {
            if (this.tribute.spaceSelectsMatch) {
              this.callbacks().Enter(e, el);
            } else if (!this.tribute.allowSpaces) {
              e.stopImmediatePropagation();
              setTimeout(() => {
                this.tribute.hideMenu();
              }, 0);
            }
          }
        },
        ArrowUp: (e, _el) => {
          // navigate up ul
          if (this.tribute.isActive && this.tribute.current.filteredItems) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const count = this.tribute.current.filteredItems.length,
                  selected = this.tribute.menuSelected;

            if (count > selected && selected > 0) {
              this.tribute.menuSelected--;
              this.setActiveLi();
            } else if (selected === 0) {
              this.tribute.menuSelected = count - 1;
              this.setActiveLi();
              this.tribute.menu.scrollTop = this.tribute.menu.scrollHeight;
            }
          }
        },
        ArrowDown: (e, _el) => {
          // navigate down ul
          if (this.tribute.isActive && this.tribute.current.filteredItems) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const count = this.tribute.current.filteredItems.length - 1,
                  selected = this.tribute.menuSelected;

            if (count > selected) {
              this.tribute.menuSelected++;
              this.setActiveLi();
            } else if (count === selected) {
              this.tribute.menuSelected = 0;
              this.setActiveLi();
              this.tribute.menu.scrollTop = 0;
            }
          }
        },
        Delete: (e, el) => {
          if (this.tribute.isActive && this.tribute.current.mentionText.length < 1) {
            this.tribute.hideMenu();
          } else if (this.tribute.isActive) {
            this.tribute.showMenuFor(el);
          }
        }
      };
    }

    setActiveLi(index) {
      const lis = this.tribute.menu.querySelectorAll("li"),
            length = lis.length >>> 0;
      if (index) this.tribute.menuSelected = parseInt(index);

      for (let i = 0; i < length; i++) {
        const li = lis[i];

        if (i === this.tribute.menuSelected) {
          li.classList.add(this.tribute.current.collection.selectClass);
          const liClientRect = li.getBoundingClientRect();
          const menuClientRect = this.tribute.menu.getBoundingClientRect();

          if (liClientRect.bottom > menuClientRect.bottom) {
            const scrollDistance = liClientRect.bottom - menuClientRect.bottom;
            this.tribute.menu.scrollTop += scrollDistance;
          } else if (liClientRect.top < menuClientRect.top) {
            const scrollDistance = menuClientRect.top - liClientRect.top;
            this.tribute.menu.scrollTop -= scrollDistance;
          }
        } else {
          li.classList.remove(this.tribute.current.collection.selectClass);
        }
      }
    }

    getFullHeight(elem, includeMargin) {
      const height = elem.getBoundingClientRect().height;

      if (includeMargin) {
        const style = elem.currentStyle || window.getComputedStyle(elem);
        return height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
      }

      return height;
    }

  }

  /*eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }]*/
  class TributeMenuEvents {
    constructor(tribute) {
      this.tribute = tribute;
      this.tribute.menuEvents = this;
      this.menu = this.tribute.menu;
    }

    bind(_menu) {
      this.menuClickEvent = this.tribute.events.click.bind(null, this);
      this.menuContainerScrollEvent = this.tribute.debounce(() => {
        this.tribute.hideMenu();
      }, 10, false);
      this.windowResizeEvent = this.tribute.debounce(() => {
        this.tribute.hideMenu();
      }, 10, false);

      this.windowBlurEvent = () => {
        this.tribute.hideMenu();
      }; // fixes IE11 issues with mousedown


      this.tribute.range.getDocument().addEventListener("MSPointerDown", this.menuClickEvent, false);
      this.tribute.range.getDocument().addEventListener("mousedown", this.menuClickEvent, false);
      window.addEventListener("resize", this.windowResizeEvent);
      window.addEventListener("blur", this.windowBlurEvent);

      if (this.menuContainer) {
        this.menuContainer.addEventListener("scroll", this.menuContainerScrollEvent, false);
      } else {
        window.addEventListener("scroll", this.menuContainerScrollEvent);
      }
    }

    unbind(_menu) {
      this.tribute.range.getDocument().removeEventListener("mousedown", this.menuClickEvent, false);
      this.tribute.range.getDocument().removeEventListener("MSPointerDown", this.menuClickEvent, false);
      window.removeEventListener("resize", this.windowResizeEvent);

      if (this.menuContainer) {
        this.menuContainer.removeEventListener("scroll", this.menuContainerScrollEvent, false);
      } else {
        window.removeEventListener("scroll", this.menuContainerScrollEvent);
      }
    }

  }

  /*eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }]*/

  class TributeRange {
    constructor(tribute) {
      this.tribute = tribute;
      this.tribute.range = this;
    }

    getDocument() {
      let iframe;

      if (this.tribute.current.collection) {
        iframe = this.tribute.current.collection.iframe;
      }

      if (!iframe) {
        return document;
      }

      return iframe.contentWindow.document;
    }

    positionMenuAtCaret(scrollTo) {
      const context = this.tribute.current;
      let coordinates;

      if (!this.tribute.positionMenu) {
        this.tribute.menu.style.display = `block`;
        return;
      }

      if (!this.isContentEditable(context.element)) {
        coordinates = this.getTextAreaOrInputUnderlinePosition(context.element, context.mentionPosition + context.mentionText.length);
      } else {
        coordinates = this.getContentEditableCaretPosition(context.mentionPosition + context.mentionText.length);
      }

      this.tribute.menu.style.top = `${coordinates.top}px`;
      this.tribute.menu.style.left = `${coordinates.left}px`;
      this.tribute.menu.style.right = `${coordinates.right}px`;
      this.tribute.menu.style.bottom = `${coordinates.bottom}px`;
      this.tribute.menu.style["max-heigh"] = `${coordinates.maxHeight || 500}px`;
      this.tribute.menu.style["max-width"] = `${coordinates.maxWidth || 300}px`;
      this.tribute.menu.style.position = `${coordinates.position || "absolute"}`;
      this.tribute.menu.style.display = `block`;

      if (coordinates.left === "auto") {
        this.tribute.menu.style.left = "auto";
      }

      if (coordinates.top === "auto") {
        this.tribute.menu.style.top = "auto";
      }

      if (scrollTo) this.scrollIntoView();
    }

    get menuContainerIsBody() {
      return this.tribute.menuContainer === this.getDocument().body || !this.tribute.menuContainer;
    }

    replaceTriggerText(text, originalEvent, item) {
      const context = this.tribute.current;
      const detail = {
        item: item,
        context: context,
        event: originalEvent,
        text: text
      };
      const replaceEvent = new CustomEvent("tribute-replaced");

      if (!this.isContentEditable(context.element)) {
        const textEndsWithSpace = text !== text.trimEnd();
        const myField = this.tribute.current.element;
        const textSuffix = typeof this.tribute.replaceTextSuffix === "string" ? this.tribute.replaceTextSuffix : " ";
        text = this.stripHtml(text);
        text += textSuffix;
        const startPos = context.mentionPosition;
        let endPos = context.mentionPosition + context.mentionText.length + textSuffix.length + textEndsWithSpace;

        if (!this.tribute.autocompleteMode) {
          endPos += context.mentionTriggerChar.length - 1;
        }

        myField.value = myField.value.substring(0, startPos) + text + myField.value.substring(endPos, myField.value.length);
        myField.selectionStart = startPos + text.length;
        myField.selectionEnd = startPos + text.length;
      } else {
        const strippedText = this.stripHtml(text);
        const isHTML = text !== strippedText;
        const textSuffix = typeof this.tribute.replaceTextSuffix === "string" ? this.tribute.replaceTextSuffix : "\xA0";
        text += textSuffix;
        if (isHTML) this.pasteHtml(text, context.mentionText.length + context.mentionTriggerChar.length);else this.pasteText(strippedText, context.mentionText.length + context.mentionTriggerChar.length);
      }

      context.element.dispatchEvent(new CustomEvent("input", {
        bubbles: true,
        detail: detail
      }));
      context.element.dispatchEvent(replaceEvent);
    }

    pasteText(text, numOfCharsToRemove) {
      const {
        sel,
        range
      } = this.getContentEditableSelectionStart(true);

      for (let index = 0; index < numOfCharsToRemove; index++) {
        sel.modify("extend", "backward", "character");
      }

      const pre = sel.anchorNode.nodeValue.substring(0, sel.anchorOffset - 1);
      const post = sel.anchorNode.nodeValue.substring(sel.anchorOffset - 1, sel.anchorNode.nodeValue.length);
      sel.anchorNode.nodeValue = pre + text + post;
      range.setStart(sel.anchorNode, sel.anchorOffset - 1 + text.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      sel.collapseToEnd();
    }

    pasteHtml(html, numOfCharsToRemove) {
      const {
        sel
      } = this.getContentEditableSelectionStart(true);

      if (sel) {
        let range = null;

        for (let index = 0; index < numOfCharsToRemove; index++) {
          sel.modify("extend", "backward", "character");
        }

        range = sel.getRangeAt(0);
        range.deleteContents();
        const el = this.getDocument().createElement("div");
        el.innerHTML = html;
        const frag = this.getDocument().createDocumentFragment();
        let node, lastNode;

        while (node = el.firstChild) {
          lastNode = frag.appendChild(node);
        }

        range.insertNode(frag); // Preserve the selection

        if (lastNode) {
          range.setStart(lastNode, lastNode.length);
          range.setEnd(lastNode, lastNode.length);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          sel.collapseToEnd();
        }
      }
    }

    stripHtml(html) {
      const tmp = this.getDocument().createElement("DIV");
      tmp.innerHTML = html;
      return tmp.textContent || tmp.innerText || "";
    }

    getWindowSelection() {
      if (this.tribute.collection.iframe) {
        return this.tribute.collection.iframe.contentWindow.getSelection();
      }

      const rootNode = this.tribute.current.element.getRootNode();
      if (rootNode.getSelection) return rootNode.getSelection();else return window.getSelection();
    }

    getContentEditableSelectionStart(moveToEndOfWord) {
      const sel = this.getWindowSelection();

      if (!sel.isCollapsed) {
        return {
          sel: null,
          range: null,
          direction: null
        };
      }

      const direction = sel.anchorOffset <= sel.focusOffset;
      const range = sel.getRangeAt(0);
      const selectedElem = sel.anchorNode;
      const workingNodeContent = selectedElem.textContent;
      const selectStartOffset = range.startOffset;
      let nextChar = workingNodeContent.length > selectStartOffset ? workingNodeContent[selectStartOffset] : null;

      if (nextChar === null) {
        if (selectedElem.nextSibling && selectedElem.nextSibling.textContent) {
          const nextNodeText = selectedElem.nextSibling.textContent;
          nextChar = nextNodeText.length ? nextNodeText[0] : null;
        }
      }

      const nextCharIsSeparator = nextChar && nextChar.match(this.tribute.autocompleteSeparator);
      sel.collapseToEnd();
      if (nextChar && !nextCharIsSeparator && moveToEndOfWord) sel.modify("move", "forward", "word");
      return {
        sel,
        range,
        direction
      };
    }

    getWholeWordsUpToCharIndex(str, minLen) {
      let pos = 0;
      const arr = str.split(this.tribute.autocompleteSeparator).filter(function (e) {
        return e.trim();
      });
      const text = str;

      for (let i = 0, len = arr.length; i < len; i++) {
        const idx = str.indexOf(arr[i]);
        pos = pos + idx;
        str = str.slice(idx);

        if (minLen >= pos && minLen <= pos + arr[i].length) {
          minLen = pos + arr[i].length;
          break;
        }
      }

      return text.substring(0, minLen);
    }

    getTextPrecedingCurrentSelection() {
      const context = this.tribute.current;
      let text = null;

      if (!this.isContentEditable(context.element)) {
        const textComponent = this.tribute.current.element;

        if (textComponent) {
          const startPos = textComponent.selectionStart;
          const endPos = textComponent.selectionEnd;

          if (textComponent.value && startPos >= 0 && startPos === endPos) {
            text = textComponent.value.substring(0);
            text = this.getWholeWordsUpToCharIndex(text, startPos);
          }
        }
      } else {
        const {
          sel,
          range,
          direction
        } = this.getContentEditableSelectionStart(true);

        if (sel) {
          const selectedElem = sel.anchorNode;
          const workingNodeContent = selectedElem.textContent;
          const selectStartOffset = range.startOffset;
          const lastChar = workingNodeContent[Math.max(0, selectStartOffset - 1)];
          const addWhiteSpace = lastChar && lastChar !== lastChar.trim();
          text = sel.toString().trim();

          for (let index = 0; index < this.tribute.numberOfWordsInContextText; index++) {
            sel.modify("extend", "backward", "word");
            const newText = sel.toString().trim();

            if (newText.length > text.length && newText.endsWith(text)) {
              // Workarounds Firefox issue, where selection sometimes collapse or move instead of extend
              text = newText;
            }
          }

          text += addWhiteSpace ? " " : "";
          this.restoreSelection(sel, range, direction);
        }
      }

      return text;
    }

    getLastWordInText(text) {
      const separator = this.tribute.autocompleteSeparator ? this.tribute.autocompleteSeparator : /\s+/;
      const wordsArray = text.split(separator);
      if (!wordsArray.length) return " ";
      return wordsArray[wordsArray.length - 1];
    }

    getTriggerInfo(menuAlreadyActive, hasTrailingSpace, requireLeadingSpace, allowSpaces, isAutocomplete) {
      const effectiveRange = this.getTextPrecedingCurrentSelection();
      if (effectiveRange === null) return null;
      const lastWordOfEffectiveRange = this.getLastWordInText(effectiveRange);

      if (isAutocomplete) {
        return {
          mentionPosition: effectiveRange.length - lastWordOfEffectiveRange.length,
          mentionText: lastWordOfEffectiveRange,
          fullText: effectiveRange,
          mentionTriggerChar: ""
        };
      }

      if (effectiveRange !== undefined && effectiveRange !== null) {
        let mostRecentTriggerCharPos = -1;
        let triggerChar;
        this.tribute.collection.forEach(config => {
          const c = config.trigger;
          const idx = config.requireLeadingSpace ? this.lastIndexWithLeadingSpace(effectiveRange, c) : effectiveRange.lastIndexOf(c);

          if (idx > mostRecentTriggerCharPos) {
            mostRecentTriggerCharPos = idx;
            triggerChar = c;
            requireLeadingSpace = config.requireLeadingSpace;
          }
        });

        if (mostRecentTriggerCharPos >= 0 && (mostRecentTriggerCharPos === 0 || !requireLeadingSpace || /\s/.test(effectiveRange.substring(mostRecentTriggerCharPos - 1, mostRecentTriggerCharPos)))) {
          let currentTriggerSnippet = effectiveRange.substring(mostRecentTriggerCharPos + triggerChar.length, effectiveRange.length);
          triggerChar = effectiveRange.substring(mostRecentTriggerCharPos, mostRecentTriggerCharPos + triggerChar.length);
          const firstSnippetChar = currentTriggerSnippet.substring(0, 1);
          const leadingSpace = currentTriggerSnippet.length > 0 && (firstSnippetChar === " " || firstSnippetChar === "\xA0");

          if (hasTrailingSpace) {
            currentTriggerSnippet = currentTriggerSnippet.trim();
          }

          const regex = allowSpaces ? /[^\S ]/g : /[\xA0\s]/g;
          this.tribute.hasTrailingSpace = regex.test(currentTriggerSnippet);

          if (!leadingSpace && (menuAlreadyActive || !regex.test(currentTriggerSnippet))) {
            return {
              mentionPosition: mostRecentTriggerCharPos,
              mentionText: currentTriggerSnippet,
              mentionTriggerChar: triggerChar,
              fullText: effectiveRange
            };
          }
        }
      }
    }

    lastIndexWithLeadingSpace(str, trigger) {
      const reversedStr = str.split("").reverse().join("");
      let index = -1;

      for (let cidx = 0, len = str.length; cidx < len; cidx++) {
        const firstChar = cidx === str.length - 1;
        const leadingSpace = /\s/.test(reversedStr[cidx + 1]);
        let match = true;

        for (let triggerIdx = trigger.length - 1; triggerIdx >= 0; triggerIdx--) {
          if (trigger[triggerIdx] !== reversedStr[cidx - triggerIdx]) {
            match = false;
            break;
          }
        }

        if (match && (firstChar || leadingSpace)) {
          index = str.length - 1 - cidx;
          break;
        }
      }

      return index;
    }

    isContentEditable(element) {
      return element.nodeName !== "INPUT" && element.nodeName !== "TEXTAREA";
    }

    isMenuOffScreen(coordinates, menuDimensions) {
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      const doc = this.getDocument().documentElement;
      const windowLeft = (window.pageXOffset || doc.scrollLeft) - (doc.clientLeft || 0);
      const windowTop = (window.pageYOffset || doc.scrollTop) - (doc.clientTop || 0);
      const menuTop = typeof coordinates.top === "number" ? coordinates.top : coordinates.bottom - menuDimensions.height;
      const menuRight = typeof coordinates.right === "number" ? coordinates.right : coordinates.left + menuDimensions.width;
      const menuBottom = typeof coordinates.bottom === "number" ? coordinates.bottom : coordinates.top + menuDimensions.height;
      const menuLeft = typeof coordinates.left === "number" ? coordinates.left : coordinates.right - menuDimensions.width;
      return {
        top: menuTop < Math.floor(windowTop),
        right: menuRight > Math.ceil(windowLeft + windowWidth),
        bottom: menuBottom > Math.ceil(windowTop + windowHeight),
        left: menuLeft < Math.floor(windowLeft)
      };
    }

    getMenuDimensions() {
      // Width of the menu depends of its contents and position
      // We must check what its width would be without any obstruction
      // This way, we can achieve good positioning for flipping the menu
      const dimensions = {
        width: null,
        height: null
      };
      this.tribute.menu.style.top = `0px`;
      this.tribute.menu.style.left = `0px`;
      this.tribute.menu.style.right = null;
      this.tribute.menu.style.bottom = null;
      this.tribute.menu.style.position = `fixed`;
      this.tribute.menu.style.visibility = `hidden`;
      this.tribute.menu.style.display = `block`;
      dimensions.width = this.tribute.menu.offsetWidth;
      dimensions.height = this.tribute.menu.offsetHeight;
      this.tribute.menu.style.display = `none`;
      this.tribute.menu.style.visibility = `visible`;
      return dimensions;
    }

    getTextAreaOrInputUnderlinePosition(element, position, _flipped) {
      const properties = ["direction", "boxSizing", "width", "height", "overflowX", "overflowY", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "fontSizeAdjust", "lineHeight", "fontFamily", "textAlign", "textTransform", "textIndent", "textDecoration", "letterSpacing", "wordSpacing"];
      const div = this.getDocument().createElement("div");
      div.id = "input-textarea-caret-position-mirror-div";
      this.getDocument().body.appendChild(div);
      const style = div.style;
      const computed = window.getComputedStyle ? getComputedStyle(element) : element.currentStyle;
      style.whiteSpace = "pre-wrap";

      if (element.nodeName !== "INPUT") {
        style.wordWrap = "break-word";
      } // position off-screen


      style.position = "absolute";
      style.visibility = "hidden"; // transfer the element's properties to the div

      properties.forEach(prop => {
        style[prop] = computed[prop];
      });
      const span0 = this.getDocument().createElement("span");
      span0.textContent = element.value.substring(0, position);
      div.appendChild(span0);

      if (element.nodeName === "INPUT") {
        div.textContent = div.textContent.replace(/\s/g, " ");
      } //Create a span in the div that represents where the cursor
      //should be


      const span = this.getDocument().createElement("span"); //we give it no content as this represents the cursor

      div.appendChild(span);
      const span2 = this.getDocument().createElement("span");
      span2.textContent = element.value.substring(position, position + 1);
      div.appendChild(span2);
      const rect = element.getBoundingClientRect(); //position the div exactly over the element
      //so we can get the bounding client rect for the span and
      //it should represent exactly where the cursor is

      div.style.position = "fixed";
      div.style.left = rect.left + "px";
      div.style.top = rect.top + "px";
      div.style.width = rect.width + "px";
      div.style.height = rect.height + "px";
      div.scrollTop = element.scrollTop;
      const spanRect = span.getBoundingClientRect();
      const divRect = div.getBoundingClientRect();
      this.getDocument().body.removeChild(div);

      const clamp = function (number, min, max) {
        return Math.max(min, Math.min(number, max));
      };

      const finalRect = {
        height: Math.min(divRect.height, spanRect.height),
        left: clamp(spanRect.left, divRect.left, divRect.left + divRect.width),
        top: clamp(spanRect.top, divRect.top, divRect.top + divRect.height)
      };
      return this.getFixedCoordinatesRelativeToRect(finalRect);
    }

    getContentEditableCaretPosition(_selectedNodePosition) {
      const {
        sel,
        range,
        direction
      } = this.getContentEditableSelectionStart(false);
      const newRange = sel.getRangeAt(0); // restore selection

      this.restoreSelection(sel, range, direction);
      let rect = newRange.getBoundingClientRect();

      if (sel.anchorNode.parentNode) {
        const parentNodeRect = sel.anchorNode.parentNode.getBoundingClientRect();

        const clamp = function (number, min, max) {
          return Math.max(min, Math.min(number, max));
        };

        rect = {
          height: Math.min(parentNodeRect.height, rect.height),
          left: clamp(rect.left, parentNodeRect.left, parentNodeRect.left + parentNodeRect.width),
          top: clamp(rect.top, parentNodeRect.top, parentNodeRect.top + parentNodeRect.height)
        };
      }

      return this.getFixedCoordinatesRelativeToRect(rect);
    }

    getFixedCoordinatesRelativeToRect(rect) {
      const coordinates = {
        position: "fixed",
        left: rect.left,
        top: rect.top + rect.height
      };
      const menuDimensions = this.getMenuDimensions();
      const availableSpaceOnTop = rect.top;
      const availableSpaceOnBottom = window.innerHeight - (rect.top + rect.height); //check to see where's the right place to put the menu vertically

      if (availableSpaceOnBottom < menuDimensions.height) {
        if (availableSpaceOnTop >= menuDimensions.height || availableSpaceOnTop > availableSpaceOnBottom) {
          coordinates.top = "auto";
          coordinates.bottom = window.innerHeight - rect.top;

          if (availableSpaceOnBottom < menuDimensions.height) {
            coordinates.maxHeight = availableSpaceOnTop;
          }
        } else {
          if (availableSpaceOnTop < menuDimensions.height) {
            coordinates.maxHeight = availableSpaceOnBottom;
          }
        }
      }

      const availableSpaceOnLeft = rect.left;
      const availableSpaceOnRight = window.innerWidth - rect.left; //check to see where's the right place to put the menu horizontally

      if (availableSpaceOnRight < menuDimensions.width) {
        if (availableSpaceOnLeft >= menuDimensions.width || availableSpaceOnLeft > availableSpaceOnRight) {
          coordinates.left = "auto";
          coordinates.right = window.innerWidth - rect.left;

          if (availableSpaceOnRight < menuDimensions.width) {
            coordinates.maxWidth = availableSpaceOnLeft;
          }
        } else {
          if (availableSpaceOnLeft < menuDimensions.width) {
            coordinates.maxWidth = availableSpaceOnRight;
          }
        }
      }

      return coordinates;
    }

    scrollIntoView(_elem) {
      const reasonableBuffer = 20;
      const maxScrollDisplacement = 100;
      let clientRect;
      let e = this.menu;
      if (typeof e === "undefined") return;

      while (clientRect === undefined || clientRect.height === 0) {
        clientRect = e.getBoundingClientRect();

        if (clientRect.height === 0) {
          e = e.childNodes[0];

          if (e === undefined || !e.getBoundingClientRect) {
            return;
          }
        }
      }

      const elemTop = clientRect.top;
      const elemBottom = elemTop + clientRect.height;

      if (elemTop < 0) {
        window.scrollTo(0, window.pageYOffset + clientRect.top - reasonableBuffer);
      } else if (elemBottom > window.innerHeight) {
        let maxY = window.pageYOffset + clientRect.top - reasonableBuffer;

        if (maxY - window.pageYOffset > maxScrollDisplacement) {
          maxY = window.pageYOffset + maxScrollDisplacement;
        }

        let targetY = window.pageYOffset - (window.innerHeight - elemBottom);

        if (targetY > maxY) {
          targetY = maxY;
        }

        window.scrollTo(0, targetY);
      }
    }

    restoreSelection(sel, range, directionFwd = true) {
      sel.removeAllRanges();

      if (directionFwd) {
        sel.addRange(range);
      } else {
        const endRange = range.cloneRange();
        endRange.collapse(false);
        sel.addRange(endRange);
        sel.extend(range.startContainer, range.startOffset);
      }
    }

  }

  /*eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }]*/
  // Thanks to https://github.com/mattyork/fuzzy
  class TributeSearch {
    constructor(tribute) {
      this.tribute = tribute;
      this.tribute.search = this;
    }

    simpleFilter(pattern, array) {
      return array.filter(string => {
        return this.test(pattern, string);
      });
    }

    test(pattern, string) {
      return this.match(pattern, string) !== null;
    }

    match(pattern, string, opts) {
      opts = opts || {};
      const pre = opts.pre || "",
            post = opts.post || "",
            compareString = opts.caseSensitive && string || string.toLowerCase();

      if (opts.skip) {
        return {
          rendered: string,
          score: 0
        };
      }

      pattern = opts.caseSensitive && pattern || pattern.toLowerCase();
      const patternCache = this.traverse(compareString, pattern, 0, 0, []);

      if (!patternCache) {
        return null;
      }

      return {
        rendered: this.render(string, patternCache.cache, pre, post),
        score: patternCache.score
      };
    }

    traverse(string, pattern, stringIndex, patternIndex, patternCache) {
      if (this.tribute.autocompleteSeparator) {
        // if the pattern search at end
        pattern = pattern.split(this.tribute.autocompleteSeparator).splice(-1)[0];
      }

      if (pattern.length === patternIndex) {
        // calculate score and copy the cache containing the indices where it's found
        return {
          score: this.calculateScore(patternCache),
          cache: patternCache.slice()
        };
      } // if string at end or remaining pattern > remaining string


      if (string.length === stringIndex || pattern.length - patternIndex > string.length - stringIndex) {
        return undefined;
      }

      const c = pattern[patternIndex];
      let index = string.indexOf(c, stringIndex);
      let best;
      let temp;

      while (index > -1) {
        patternCache.push(index);
        temp = this.traverse(string, pattern, index + 1, patternIndex + 1, patternCache);
        patternCache.pop(); // if downstream traversal failed, return best answer so far

        if (!temp) {
          return best;
        }

        if (!best || best.score < temp.score) {
          best = temp;
        }

        index = string.indexOf(c, index + 1);
      }

      return best;
    }

    calculateScore(patternCache) {
      let score = 0;
      let temp = 1;
      patternCache.forEach((index, i) => {
        if (i > 0) {
          if (patternCache[i - 1] + 1 === index) {
            temp += temp + 1;
          } else {
            temp = 1;
          }
        }

        score += temp;
      });
      return score;
    }

    render(string, indices, pre, post) {
      let rendered = string.substring(0, indices[0]);
      indices.forEach((index, i) => {
        rendered += pre + string[index] + post + string.substring(index + 1, indices[i + 1] ? indices[i + 1] : string.length);
      });
      return rendered;
    }

    filter(pattern, arr, opts) {
      opts = opts || {};
      return arr.reduce((prev, element, idx, _arr) => {
        let str = element;

        if (opts.extract) {
          str = opts.extract(element);

          if (!str) {
            // take care of undefineds / nulls / etc.
            str = "";
          }
        }

        const rendered = this.match(pattern, str, opts);

        if (rendered !== null) {
          prev[prev.length] = {
            string: rendered.rendered,
            score: rendered.score,
            index: idx,
            original: element
          };
        }

        return prev;
      }, []).sort((a, b) => {
        const compare = b.score - a.score;
        if (compare) return compare;
        return a.index - b.index;
      });
    }

  }

  class Tribute {
    constructor({
      values = null,
      loadingItemTemplate = null,
      iframe = null,
      selectClass = "highlight",
      containerClass = "tribute-container",
      itemClass = "",
      trigger = "@",
      autocompleteMode = false,
      autocompleteSeparator = null,
      selectTemplate = null,
      menuItemTemplate = null,
      lookup = "key",
      fillAttr = "value",
      collection = null,
      menuContainer = null,
      noMatchTemplate = null,
      requireLeadingSpace = true,
      allowSpaces = false,
      replaceTextSuffix = null,
      positionMenu = true,
      spaceSelectsMatch = false,
      searchOpts = {},
      menuItemLimit = null,
      menuShowMinLength = 0,
      keys = null,
      numberOfWordsInContextText = 5
    }) {
      this.autocompleteMode = autocompleteMode;
      this.autocompleteSeparator = autocompleteSeparator;
      this.menuSelected = 0;
      this.current = {};
      this.isActive = false;
      this.activationPending = false;
      this.menuContainer = menuContainer;
      this.allowSpaces = allowSpaces;
      this.replaceTextSuffix = replaceTextSuffix;
      this.positionMenu = positionMenu;
      this.hasTrailingSpace = false;
      this.spaceSelectsMatch = spaceSelectsMatch;
      this.numberOfWordsInContextText = numberOfWordsInContextText;

      if (keys) {
        TributeEvents.keys = keys;
      }

      if (this.autocompleteMode) {
        trigger = "";
        allowSpaces = false;
      }

      if (values) {
        this.collection = [{
          // symbol that starts the lookup
          trigger: trigger,
          // is it wrapped in an iframe
          iframe: iframe,
          // class applied to selected item
          selectClass: selectClass,
          // class applied to the Container
          containerClass: containerClass,
          // class applied to each item
          itemClass: itemClass,
          // function called on select that retuns the content to insert
          selectTemplate: (selectTemplate || Tribute.defaultSelectTemplate).bind(this),
          // function called that returns content for an item
          menuItemTemplate: (menuItemTemplate || Tribute.defaultMenuItemTemplate).bind(this),
          // function called when menu is empty, disables hiding of menu.
          noMatchTemplate: (t => {
            if (typeof t === "string") {
              if (t.trim() === "") return null;
              return t;
            }

            if (typeof t === "function") {
              return t.bind(this);
            }

            return noMatchTemplate || function () {
              return "<li>No Match Found!</li>";
            };
          })(noMatchTemplate),
          // column to search against in the object
          lookup: lookup,
          // column that contains the content to insert by default
          fillAttr: fillAttr,
          // array of objects or a function returning an array of objects
          values: values,
          // useful for when values is an async function
          loadingItemTemplate: loadingItemTemplate,
          requireLeadingSpace: requireLeadingSpace,
          searchOpts: searchOpts,
          menuItemLimit: menuItemLimit,
          menuShowMinLength: menuShowMinLength
        }];
      } else if (collection) {
        if (this.autocompleteMode) console.warn("Tribute in autocomplete mode does not work for collections");
        this.collection = collection.map(item => {
          return {
            trigger: item.trigger || trigger,
            iframe: item.iframe || iframe,
            selectClass: item.selectClass || selectClass,
            containerClass: item.containerClass || containerClass,
            itemClass: item.itemClass || itemClass,
            selectTemplate: (item.selectTemplate || Tribute.defaultSelectTemplate).bind(this),
            menuItemTemplate: (item.menuItemTemplate || Tribute.defaultMenuItemTemplate).bind(this),
            // function called when menu is empty, disables hiding of menu.
            noMatchTemplate: (t => {
              if (typeof t === "string") {
                if (t.trim() === "") return null;
                return t;
              }

              if (typeof t === "function") {
                return t.bind(this);
              }

              return noMatchTemplate || function () {
                return "<li>No Match Found!</li>";
              };
            })(noMatchTemplate),
            lookup: item.lookup || lookup,
            fillAttr: item.fillAttr || fillAttr,
            values: item.values,
            loadingItemTemplate: item.loadingItemTemplate,
            requireLeadingSpace: item.requireLeadingSpace,
            searchOpts: item.searchOpts || searchOpts,
            menuItemLimit: item.menuItemLimit || menuItemLimit,
            menuShowMinLength: item.menuShowMinLength || menuShowMinLength
          };
        });
      } else {
        throw new Error("[Tribute] No collection specified.");
      }

      new TributeRange(this);
      new TributeEvents(this);
      new TributeMenuEvents(this);
      new TributeSearch(this);
    }

    get isActive() {
      return this._isActive;
    }

    set isActive(val) {
      if (this._isActive !== val) {
        this._isActive = val;

        if (this.current.element) {
          const noMatchEvent = new CustomEvent(`tribute-active-${val}`);
          this.current.element.dispatchEvent(noMatchEvent);
        }
      }
    }

    static defaultSelectTemplate(item) {
      if (typeof item === "undefined") return `${this.current.collection.trigger}${this.current.mentionText}`;

      if (this.range.isContentEditable(this.current.element)) {
        return '<span class="tribute-mention">' + (this.current.collection.trigger + item.original[this.current.collection.fillAttr]) + "</span>";
      }

      return this.current.collection.trigger + item.original[this.current.collection.fillAttr];
    }

    static defaultMenuItemTemplate(matchItem) {
      return matchItem.string;
    }

    static inputTypes() {
      return ["TEXTAREA", "INPUT"];
    }

    triggers() {
      return this.collection.map(config => {
        return config.trigger;
      });
    }

    attach(el) {
      if (!el) {
        throw new Error("[Tribute] Must pass in a DOM node or NodeList.");
      }
      /* global jQuery */
      // Check if it is a jQuery collection


      if (typeof jQuery !== "undefined" && el instanceof jQuery) {
        el = el.get();
      } // Is el an Array/Array-like object?


      if (el.constructor === NodeList || el.constructor === HTMLCollection || el.constructor === Array) {
        const length = el.length;

        for (let i = 0; i < length; ++i) {
          this._attach(el[i]);
        }
      } else {
        this._attach(el);
      }
    }

    _attach(el) {
      if (el.hasAttribute("data-tribute")) {
        console.warn("Tribute was already bound to " + el.nodeName);
      }

      this.ensureEditable(el);
      this.events.bind(el);
      el.setAttribute("data-tribute", true);
    }

    ensureEditable(element) {
      if (Tribute.inputTypes().indexOf(element.nodeName) === -1) {
        if (element.contentEditable) {
          element.contentEditable = true;
        } else {
          throw new Error("[Tribute] Cannot bind to " + element.nodeName);
        }
      }
    }

    createMenu(containerClass, element) {
      const properties = ["fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSizeAdjust", "fontFamily"];
      const computed = window.getComputedStyle ? getComputedStyle(element) : element.currentStyle;
      const wrapper = this.range.getDocument().createElement("div"),
            ul = this.range.getDocument().createElement("ul");
      wrapper.className = containerClass;
      wrapper.setAttribute("tabindex", "0");
      wrapper.appendChild(ul);
      wrapper.style.fontSize = Math.round(parseInt(computed.fontSize) * 0.9) + "px";
      wrapper.style.display = "none";
      properties.forEach(prop => {
        wrapper.style[prop] = computed[prop];
      });

      if (this.menuContainer) {
        return this.menuContainer.appendChild(wrapper);
      }

      return this.range.getDocument().body.appendChild(wrapper);
    }

    showMenuFor(element, scrollTo) {
      // Only proceed if menu isn't already shown for the current element & mentionText
      if (this.isActive && this.current.element === element && this.current.mentionText === this.currentMentionTextSnapshot) {
        return;
      }

      this.currentMentionTextSnapshot = this.current.mentionText; // create the menu if it doesn't exist.

      if (!this.menu) {
        this.menu = this.createMenu(this.current.collection.containerClass, element);
        element.tributeMenu = this.menu;
        this.menuEvents.bind(this.menu);
      }

      this.activationPending = true;
      this.menuSelected = 0;

      if (!this.current.mentionText) {
        this.current.mentionText = "";
      }

      const processValues = (values, forceReplace) => {
        // Tribute may not be active any more by the time the value callback returns
        if (!this.activationPending) {
          return;
        }

        this.activationPending = false; // Element is no longer in focus - don't show menu

        if (this.range.getDocument().activeElement !== this.current.element) {
          return;
        }

        if (forceReplace) {
          // Do force replace - don't show menu
          this.current.mentionPosition -= forceReplace.length;
          this.current.mentionText = " ".repeat(forceReplace.length) + this.current.mentionText;
          this.replaceText(forceReplace.text, null, null);
          return;
        }

        let items = this.search.filter(this.current.mentionText, values, {
          pre: this.current.collection.searchOpts.pre || "<span>",
          post: this.current.collection.searchOpts.post || "</span>",
          skip: this.current.collection.searchOpts.skip,
          extract: el => {
            if (typeof this.current.collection.lookup === "string") {
              return el[this.current.collection.lookup];
            } else if (typeof this.current.collection.lookup === "function") {
              return this.current.collection.lookup(el, this.current.mentionText);
            } else {
              throw new Error("Invalid lookup attribute, lookup must be string or function.");
            }
          }
        });

        if (this.current.collection.menuItemLimit) {
          items = items.slice(0, this.current.collection.menuItemLimit);
        }

        this.current.filteredItems = items;
        const ul = this.menu.querySelector("ul");
        let showMenu = false;

        if (!items.length) {
          const noMatchEvent = new CustomEvent("tribute-no-match", {
            detail: this.menu
          });
          this.current.element.dispatchEvent(noMatchEvent);

          if (typeof this.current.collection.noMatchTemplate === "function" && !this.current.collection.noMatchTemplate() || !this.current.collection.noMatchTemplate) {
            showMenu = false;
          } else {
            typeof this.current.collection.noMatchTemplate === "function" ? ul.innerHTML = this.current.collection.noMatchTemplate() : ul.innerHTML = this.current.collection.noMatchTemplate;
            showMenu = true;
          }
        } else {
          ul.innerHTML = "";
          const fragment = this.range.getDocument().createDocumentFragment();
          items.forEach((item, index) => {
            const li = this.range.getDocument().createElement("li");
            li.setAttribute("data-index", index);
            li.className = this.current.collection.itemClass;
            li.addEventListener("mousemove", e => {
              const [, index] = this._findLiTarget(e.target);

              if (e.movementY !== 0) {
                this.events.setActiveLi(index);
              }
            });

            if (this.menuSelected === index) {
              li.classList.add(this.current.collection.selectClass);
            }

            li.innerHTML = this.current.collection.menuItemTemplate(item);
            fragment.appendChild(li);
          });
          ul.appendChild(fragment);
          showMenu = true;
        }

        if (showMenu) {
          this.isActive = true;
          this.range.positionMenuAtCaret(scrollTo);
        }
      };

      if (typeof this.current.collection.values === "function") {
        if (this.current.collection.loadingItemTemplate) {
          this.menu.querySelector("ul").innerHTML = this.current.collection.loadingItemTemplate;
          this.range.positionMenuAtCaret(scrollTo);
        }

        this.current.collection.values(this.current.mentionText, processValues, this.current.fullText);
      } else {
        processValues(this.current.collection.values);
      }
    }

    _findLiTarget(el) {
      if (!el) return [];
      const index = el.getAttribute("data-index");
      return !index ? this._findLiTarget(el.parentNode) : [el, index];
    }

    showMenuForCollection(element, collectionIndex) {
      if (!this.events.updateSelection(element)) return;

      if (element !== this.range.getDocument().activeElement) {
        this.placeCaretAtEnd(element);
        if (element.isContentEditable) this.insertTextAtCursor(this.current.collection.trigger);else this.insertAtCaret(element, this.current.collection.trigger);
      }

      this.current.collection = this.collection[collectionIndex || 0];
      this.current.element = element;
      this.showMenuFor(element);
    } // TODO: make sure this works for inputs/textareas


    placeCaretAtEnd(el) {
      el.focus();

      if (typeof window.getSelection !== "undefined" && typeof this.range.getDocument().createRange !== "undefined") {
        const range = this.range.getDocument().createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } else if (typeof this.range.getDocument().body.createTextRange !== "undefined") {
        const textRange = this.range.getDocument().body.createTextRange();
        textRange.moveToElementText(el);
        textRange.collapse(false);
        textRange.select();
      }
    } // for contenteditable


    insertTextAtCursor(text) {
      const sel = window.getSelection();
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const textNode = this.range.getDocument().createTextNode(text);
      range.insertNode(textNode);
      range.selectNodeContents(textNode);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } // for regular inputs


    insertAtCaret(textarea, text) {
      const scrollPos = textarea.scrollTop;
      let caretPos = textarea.selectionStart;
      const front = textarea.value.substring(0, caretPos);
      const back = textarea.value.substring(textarea.selectionEnd, textarea.value.length);
      textarea.value = front + text + back;
      caretPos = caretPos + text.length;
      textarea.selectionStart = caretPos;
      textarea.selectionEnd = caretPos;
      textarea.focus();
      textarea.scrollTop = scrollPos;
    }

    hideMenu() {
      if (this.menu) {
        this.menu.remove();
        this.menu = null;
      }

      this.isActive = false;
      this.activationPending = false;
      this.current = {};
    }

    selectItemAtIndex(index, originalEvent) {
      index = parseInt(index);

      if (!(typeof index !== "number" || isNaN(index) || !originalEvent.target)) {
        const item = this.current.filteredItems[index];
        const content = this.current.collection.selectTemplate(item);
        if (content !== null) this.replaceText(content, originalEvent, item);
      }

      this.hideMenu();
    }

    replaceText(content, originalEvent, item) {
      this.range.replaceTriggerText(content, originalEvent, item);
    }

    _append(collection, newValues, replace) {
      if (typeof collection.values === "function") {
        throw new Error("Unable to append to values, as it is a function.");
      } else if (!replace) {
        collection.values = collection.values.concat(newValues);
      } else {
        collection.values = newValues;
      }
    }

    append(collectionIndex, newValues, replace) {
      const index = parseInt(collectionIndex);
      if (typeof index !== "number") throw new Error("please provide an index for the collection to update.");
      const collection = this.collection[index];

      this._append(collection, newValues, replace);
    }

    appendCurrent(newValues, replace) {
      if (this.isActive) {
        this._append(this.current.collection, newValues, replace);
      } else {
        throw new Error("No active state. Please use append instead and pass an index.");
      }
    }

    detach(el) {
      if (!el) {
        throw new Error("[Tribute] Must pass in a DOM node or NodeList.");
      } // Check if it is a jQuery collection


      if (typeof jQuery !== "undefined" && el instanceof jQuery) {
        el = el.get();
      } // Is el an Array/Array-like object?


      if (el.constructor === NodeList || el.constructor === HTMLCollection || el.constructor === Array) {
        const length = el.length;

        for (let i = 0; i < length; ++i) {
          this._detach(el[i]);
        }
      } else {
        this._detach(el);
      }
    }

    _detach(el) {
      this.events.unbind(el);

      if (el.tributeMenu) {
        this.menuEvents.unbind(el.tributeMenu);
      }

      setTimeout(() => {
        el.removeAttribute("data-tribute");
        this.isActive = false;

        if (el.tributeMenu) {
          el.tributeMenu.remove();
        }
      });
    }

    debounce(func, timeout) {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          func.apply(this, args);
        }, timeout);
      };
    }

  }

  /**
   * Tribute.js
   * Native ES6 JavaScript @mention Plugin
   **/

  return Tribute;

})));
