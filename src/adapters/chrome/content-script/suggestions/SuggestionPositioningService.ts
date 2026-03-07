import { TextTargetAdapter } from "./TextTargetAdapter";
import type { SuggestionElement } from "./types";

interface MenuDimensions {
  width: number;
  height: number;
}

interface MenuCoordinates {
  position: "fixed";
  left: number | "auto";
  top: number | "auto";
  right?: number;
  bottom?: number;
  maxHeight?: number;
  maxWidth?: number;
}

type TypographyProperty =
  | "fontStyle"
  | "fontVariant"
  | "fontWeight"
  | "fontStretch"
  | "fontSizeAdjust"
  | "fontFamily";

export class SuggestionPositioningService {
  public syncMenuTypography(menu: HTMLDivElement, elem: SuggestionElement): void {
    const properties: TypographyProperty[] = [
      "fontStyle",
      "fontVariant",
      "fontWeight",
      "fontStretch",
      "fontSizeAdjust",
      "fontFamily",
    ];
    const computed = window.getComputedStyle(elem);
    const menuStyle = menu.style as unknown as Record<TypographyProperty, string>;

    menu.style.fontSize = `${Math.round((Number.parseInt(computed.fontSize, 10) || 16) * 0.9)}px`;
    for (const property of properties) {
      const value = computed[property];
      if (typeof value === "string") {
        menuStyle[property] = value;
      }
    }
  }

  public positionMenu(menu: HTMLDivElement, elem: SuggestionElement): boolean {
    const rect = this.getCaretRect(elem);
    if (!rect) {
      return false;
    }

    const coordinates = this.getMenuCoordinatesForRect(menu, rect);

    menu.style.position = coordinates.position;
    menu.style.top = coordinates.top === "auto" ? "auto" : `${Math.max(0, coordinates.top)}px`;
    menu.style.left = coordinates.left === "auto" ? "auto" : `${Math.max(0, coordinates.left)}px`;
    menu.style.right =
      typeof coordinates.right === "number" ? `${Math.max(0, coordinates.right)}px` : "auto";
    menu.style.bottom =
      typeof coordinates.bottom === "number" ? `${Math.max(0, coordinates.bottom)}px` : "auto";
    menu.style.maxHeight = `${Math.max(0, coordinates.maxHeight ?? 500)}px`;
    menu.style.maxWidth = `${Math.max(0, coordinates.maxWidth ?? 300)}px`;
    menu.style.zIndex = "2147483647";
    return true;
  }

  public getCaretRect(elem: SuggestionElement): DOMRect | null {
    if (TextTargetAdapter.isTextValue(elem)) {
      return this.getTextValueCaretRect(elem);
    }
    return this.getContentEditableCaretRect(elem);
  }

  private getTextValueCaretRect(elem: HTMLInputElement | HTMLTextAreaElement): DOMRect | null {
    const position = elem.selectionStart ?? elem.value.length;
    const properties = [
      "direction",
      "boxSizing",
      "width",
      "height",
      "overflowX",
      "overflowY",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "borderStyle",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "fontStyle",
      "fontVariant",
      "fontWeight",
      "fontStretch",
      "fontSize",
      "fontSizeAdjust",
      "lineHeight",
      "fontFamily",
      "textAlign",
      "textTransform",
      "textIndent",
      "textDecoration",
      "letterSpacing",
      "wordSpacing",
    ] as const;
    type MirrorProperty = (typeof properties)[number];

    const mirror = document.createElement("div");
    mirror.style.whiteSpace = "pre-wrap";
    if (!TextTargetAdapter.isInput(elem)) {
      mirror.style.wordWrap = "break-word";
    }
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.id = "input-textarea-caret-position-mirror-div";
    document.body.appendChild(mirror);

    const computed = window.getComputedStyle(elem);
    const mirrorStyle = mirror.style as unknown as Record<MirrorProperty, string>;
    for (const property of properties) {
      mirrorStyle[property] = computed[property];
    }

    const beforeSpan = document.createElement("span");
    beforeSpan.textContent = elem.value.substring(0, position);
    mirror.appendChild(beforeSpan);

    if (TextTargetAdapter.isInput(elem)) {
      mirror.textContent = mirror.textContent.replace(/\s/g, "\xA0");
    }

    const caretSpan = document.createElement("span");
    mirror.appendChild(caretSpan);

    const nextCharSpan = document.createElement("span");
    nextCharSpan.textContent = elem.value.substring(position, position + 1);
    mirror.appendChild(nextCharSpan);

    const elementRect = elem.getBoundingClientRect();
    mirror.style.position = "fixed";
    mirror.style.left = `${elementRect.left}px`;
    mirror.style.top = `${elementRect.top}px`;
    mirror.style.width = `${elementRect.width}px`;
    mirror.style.height = `${elementRect.height}px`;
    mirror.scrollTop = elem.scrollTop;

    const caretRect = caretSpan.getBoundingClientRect();
    const nextCharRect = nextCharSpan.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();

    const fontSize = Number.parseFloat(computed.fontSize) || 0;
    let lineHeight = Number.parseFloat(computed.lineHeight);
    if (!lineHeight || Number.isNaN(lineHeight)) {
      lineHeight = fontSize ? fontSize * 1.2 : 0;
    }

    const fallbackHeight = lineHeight || fontSize || mirrorRect.height;
    const glyphRect =
      nextCharSpan.textContent && nextCharRect.height > 0 ? nextCharRect : caretRect;
    const glyphHeight = glyphRect.height || fallbackHeight;
    const lineBoxHeight = Math.max(glyphHeight, fallbackHeight);
    const extraLeading = Math.max(0, lineBoxHeight - glyphHeight);
    const lineBoxTop = glyphRect.top - extraLeading / 2;

    document.body.removeChild(mirror);

    const clamp = (value: number, min: number, max: number): number =>
      Math.max(min, Math.min(value, max));

    return this.createRect(
      clamp(caretRect.left, mirrorRect.left, mirrorRect.left + mirrorRect.width),
      clamp(lineBoxTop, mirrorRect.top, mirrorRect.top + mirrorRect.height),
      0,
      Math.min(mirrorRect.height, lineBoxHeight),
    );
  }

  private getContentEditableCaretRect(elem: HTMLElement): DOMRect | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return elem.getBoundingClientRect();
    }

    const range = selection.getRangeAt(0).cloneRange();
    const getRangeRect = (value: Range): DOMRect | null => {
      if (typeof value.getBoundingClientRect !== "function") {
        return null;
      }
      return value.getBoundingClientRect();
    };
    let rect = getRangeRect(range);

    if ((!rect || rect.height === 0) && selection.anchorNode) {
      const marker = document.createElement("span");
      marker.textContent = "\u200b";
      let markerInserted = false;
      try {
        range.insertNode(marker);
        markerInserted = true;
        rect = marker.getBoundingClientRect();
      } finally {
        if (markerInserted) {
          marker.parentNode?.removeChild(marker);
        }
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    if (!rect) {
      return elem.getBoundingClientRect();
    }

    const parent =
      selection.anchorNode?.nodeType === Node.TEXT_NODE
        ? selection.anchorNode.parentElement
        : (selection.anchorNode as Element | null);
    if (!parent) {
      return rect;
    }

    const parentRect = parent.getBoundingClientRect();
    const clamp = (value: number, min: number, max: number): number =>
      Math.max(min, Math.min(value, max));

    return this.createRect(
      clamp(rect.left, parentRect.left, parentRect.left + parentRect.width),
      clamp(rect.top, parentRect.top, parentRect.top + parentRect.height),
      0,
      Math.min(parentRect.height, rect.height),
    );
  }

  private getMenuCoordinatesForRect(menu: HTMLDivElement, rect: DOMRect): MenuCoordinates {
    const menuDimensions = this.getMenuDimensions(menu);
    const coordinates: MenuCoordinates = {
      position: "fixed",
      left: rect.left,
      top: rect.top + rect.height,
    };

    const availableSpaceOnTop = rect.top;
    const availableSpaceOnBottom = window.innerHeight - (rect.top + rect.height);

    if (availableSpaceOnBottom < menuDimensions.height) {
      if (
        availableSpaceOnTop >= menuDimensions.height ||
        availableSpaceOnTop > availableSpaceOnBottom
      ) {
        coordinates.top = "auto";
        coordinates.bottom = window.innerHeight - rect.top;
        if (availableSpaceOnBottom < menuDimensions.height) {
          coordinates.maxHeight = availableSpaceOnTop;
        }
      } else if (availableSpaceOnTop < menuDimensions.height) {
        coordinates.maxHeight = availableSpaceOnBottom;
      }
    }

    const availableSpaceOnLeft = rect.left;
    const availableSpaceOnRight = window.innerWidth - rect.left;

    if (availableSpaceOnRight < menuDimensions.width) {
      if (
        availableSpaceOnLeft >= menuDimensions.width ||
        availableSpaceOnLeft > availableSpaceOnRight
      ) {
        coordinates.left = "auto";
        coordinates.right = window.innerWidth - rect.left;
        if (availableSpaceOnRight < menuDimensions.width) {
          coordinates.maxWidth = availableSpaceOnLeft;
        }
      } else if (availableSpaceOnLeft < menuDimensions.width) {
        coordinates.maxWidth = availableSpaceOnRight;
      }
    }

    return coordinates;
  }

  private getMenuDimensions(menu: HTMLDivElement): MenuDimensions {
    menu.style.top = "0px";
    menu.style.left = "0px";
    menu.style.right = "auto";
    menu.style.bottom = "auto";
    menu.style.position = "fixed";
    menu.style.visibility = "hidden";
    menu.style.display = "block";

    const dimensions: MenuDimensions = {
      width: menu.offsetWidth,
      height: menu.offsetHeight,
    };

    menu.style.display = "none";
    menu.style.visibility = "visible";

    return dimensions;
  }

  private createRect(left: number, top: number, width: number, height: number): DOMRect {
    return {
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({ left, top, width, height }),
    } as DOMRect;
  }

}
