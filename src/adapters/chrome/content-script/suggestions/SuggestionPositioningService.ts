import { TextTargetAdapter } from "./TextTargetAdapter";
import { MIRROR_LAYOUT_PROPERTIES } from "./InlineSuggestionView";
import {
  SUGGESTION_POPUP_FONT_FAMILY,
  SUGGESTION_POPUP_FONT_STRETCH,
  SUGGESTION_POPUP_FONT_STYLE,
  SUGGESTION_POPUP_FONT_WEIGHT,
  SUGGESTION_POPUP_LETTER_SPACING,
  SUGGESTION_POPUP_TEXT_TRANSFORM,
  SUGGESTION_POPUP_WORD_SPACING,
} from "./SuggestionPopupTypography";
import type { SuggestionElement } from "./types";

interface MenuCoordinates {
  left: number;
  top: number;
  maxHeight: number;
  maxWidth: number;
}

type ThemeLengthProperty = "font-size" | "padding-top" | "padding-left";

/** Styles that lay the menu out invisibly so its natural size can be read. */
const MENU_MEASURE_STYLES = {
  top: "0px",
  left: "0px",
  right: "auto",
  bottom: "auto",
  position: "fixed",
  visibility: "hidden",
  display: "block",
} as const;

export class SuggestionPositioningService {
  private static readonly VIEWPORT_PADDING_PX = 8;
  private static readonly CARET_GAP_PX = 8;
  private static readonly HORIZONTAL_OFFSET_PX = 12;
  private static readonly DEFAULT_FONT_SIZE_PX = 16;
  private static readonly LEGACY_THEME_FONT_SIZE = "0.9rem";
  private static readonly LEGACY_THEME_PADDING_VERTICAL = "0.6rem";
  private static readonly LEGACY_THEME_PADDING_HORIZONTAL = "0.8rem";

  public syncMenuTypography(menu: HTMLDivElement, elem: SuggestionElement): void {
    const typographyAnchor = this.resolveTypographyAnchor(elem);
    const computed = window.getComputedStyle(typographyAnchor);
    const fontSizePx = this.resolveFontSizePx(computed.fontSize);
    const lineHeightPx = this.resolveLineHeightPx(computed.lineHeight, fontSizePx);
    const themeScale = this.resolveLegacyThemeScale(menu, typographyAnchor, fontSizePx);
    const popupFontSizePx = Math.round(this.clamp(fontSizePx * 0.84 * themeScale.fontSize, 12, 15));
    const popupLineHeightPx = Math.round(
      this.clamp(lineHeightPx * 0.86 * themeScale.fontSize, 16, 22),
    );
    const padX = Math.round(this.clamp(fontSizePx * 0.44 * themeScale.paddingHorizontal, 6, 10));
    const padY = Math.round(this.clamp(fontSizePx * 0.14 * themeScale.paddingVertical, 3, 6));
    const rowHeightPx = Math.round(
      this.clamp(popupLineHeightPx + fontSizePx * 0.24 * themeScale.paddingVertical, 27, 34),
    );
    const radiusPx = Math.round(this.clamp(fontSizePx * 0.56, 9, 12));
    const availableViewportWidth = Math.max(
      152,
      window.innerWidth - SuggestionPositioningService.VIEWPORT_PADDING_PX * 2,
    );

    menu.style.fontSize = `${popupFontSizePx}px`;
    menu.style.lineHeight = `${popupLineHeightPx}px`;
    menu.style.direction = computed.direction;
    menu.style.fontFamily = SUGGESTION_POPUP_FONT_FAMILY;
    menu.style.fontWeight = SUGGESTION_POPUP_FONT_WEIGHT;
    menu.style.fontStyle = SUGGESTION_POPUP_FONT_STYLE;
    menu.style.setProperty("--ft-font-size", `${popupFontSizePx}px`);
    menu.style.setProperty("--ft-line-height", `${popupLineHeightPx}px`);
    menu.style.setProperty("--ft-row-height", `${rowHeightPx}px`);
    menu.style.setProperty("--ft-pad-x", `${padX}px`);
    menu.style.setProperty("--ft-pad-y", `${padY}px`);
    menu.style.setProperty("--ft-radius", `${radiusPx}px`);
    menu.style.setProperty(
      "--ft-panel-min-width",
      `${Math.round(this.clamp(Math.max(popupFontSizePx * 9, 148), 148, availableViewportWidth))}px`,
    );
    menu.style.setProperty("--suggestion-font-size", `${popupFontSizePx}px`);
    menu.style.setProperty("--suggestion-padding-vertical", `${padY}px`);
    menu.style.setProperty("--suggestion-padding-horizontal", `${padX}px`);
    menu.style.setProperty("--ft-font-family", SUGGESTION_POPUP_FONT_FAMILY);
    menu.style.setProperty("--ft-font-weight", SUGGESTION_POPUP_FONT_WEIGHT);
    menu.style.setProperty("--ft-font-style", SUGGESTION_POPUP_FONT_STYLE);
    menu.style.setProperty("--ft-font-stretch", SUGGESTION_POPUP_FONT_STRETCH);
    menu.style.setProperty("--ft-letter-spacing", SUGGESTION_POPUP_LETTER_SPACING);
    menu.style.setProperty("--ft-word-spacing", SUGGESTION_POPUP_WORD_SPACING);
    menu.style.setProperty("--ft-text-transform", SUGGESTION_POPUP_TEXT_TRANSFORM);
  }

  public positionMenu(menu: HTMLDivElement, elem: SuggestionElement): boolean {
    const rect = this.getCaretRect(elem);
    if (!rect) {
      return false;
    }

    const coordinates = this.getMenuCoordinatesForRect(menu, rect, elem);

    menu.style.setProperty("position", "fixed", "important");
    menu.style.setProperty("top", `${coordinates.top}px`, "important");
    menu.style.setProperty("left", `${coordinates.left}px`, "important");
    menu.style.setProperty("right", "auto", "important");
    menu.style.setProperty("bottom", "auto", "important");
    menu.style.setProperty("max-height", `${coordinates.maxHeight}px`, "important");
    menu.style.setProperty("max-width", `${coordinates.maxWidth}px`, "important");
    menu.style.setProperty("z-index", "2147483647", "important");
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
    type MirrorProperty = (typeof MIRROR_LAYOUT_PROPERTIES)[number];

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
    for (const property of MIRROR_LAYOUT_PROPERTIES) {
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
    const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.2;

    const fallbackHeight = lineHeight || fontSize || mirrorRect.height;
    const glyphRect =
      nextCharSpan.textContent && nextCharRect.height > 0 ? nextCharRect : caretRect;
    const glyphHeight = glyphRect.height || fallbackHeight;
    const lineBoxHeight = Math.max(glyphHeight, fallbackHeight);
    const extraLeading = Math.max(0, lineBoxHeight - glyphHeight);
    let lineBoxTop = glyphRect.top - extraLeading / 2;

    // <input> elements vertically center their text, but the mirror <div>
    // top-aligns it after padding.  Shift the caret down by the centering
    // offset so inline suggestions align with the actual text position.
    if (TextTargetAdapter.isInput(elem)) {
      const padTop = Number.parseFloat(computed.paddingTop) || 0;
      const padBottom = Number.parseFloat(computed.paddingBottom) || 0;
      const borderTop = Number.parseFloat(computed.borderTopWidth) || 0;
      const borderBottom = Number.parseFloat(computed.borderBottomWidth) || 0;
      const contentHeight = elementRect.height - padTop - padBottom - borderTop - borderBottom;
      lineBoxTop += Math.max(0, (contentHeight - lineBoxHeight) / 2);
    }

    document.body.removeChild(mirror);

    return this.createRect(
      this.clamp(caretRect.left, mirrorRect.left, mirrorRect.left + mirrorRect.width),
      this.clamp(lineBoxTop, mirrorRect.top, mirrorRect.top + mirrorRect.height),
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
    let rect =
      typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;

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
    return this.createRect(
      this.clamp(rect.left, parentRect.left, parentRect.left + parentRect.width),
      this.clamp(rect.top, parentRect.top, parentRect.top + parentRect.height),
      0,
      Math.min(parentRect.height, rect.height),
    );
  }

  private getMenuCoordinatesForRect(
    menu: HTMLDivElement,
    rect: DOMRect,
    elem: SuggestionElement,
  ): MenuCoordinates {
    const menuDimensions = this.getMenuDimensions(menu);
    const viewportPadding = SuggestionPositioningService.VIEWPORT_PADDING_PX;
    const gap = SuggestionPositioningService.CARET_GAP_PX;
    const availableBelow = Math.max(0, window.innerHeight - rect.bottom - gap - viewportPadding);
    const availableAbove = Math.max(0, rect.top - gap - viewportPadding);
    const maxHeight = Math.max(
      96,
      availableBelow >= availableAbove ? availableBelow : availableAbove,
    );
    const showBelow = availableBelow >= menuDimensions.height || availableBelow >= availableAbove;
    const rawTop = showBelow
      ? rect.bottom + gap
      : rect.top - gap - Math.min(menuDimensions.height, maxHeight);
    const top = this.clamp(
      rawTop,
      viewportPadding,
      Math.max(
        viewportPadding,
        window.innerHeight - viewportPadding - Math.min(menuDimensions.height, maxHeight),
      ),
    );

    const isRtl = window.getComputedStyle(elem).direction === "rtl";
    const rawLeft = isRtl
      ? rect.right - menuDimensions.width + SuggestionPositioningService.HORIZONTAL_OFFSET_PX
      : rect.left - SuggestionPositioningService.HORIZONTAL_OFFSET_PX;
    const left = this.clamp(
      rawLeft,
      viewportPadding,
      Math.max(
        viewportPadding,
        window.innerWidth - viewportPadding - Math.max(1, menuDimensions.width),
      ),
    );

    return {
      left,
      top,
      maxHeight,
      maxWidth: Math.max(1, window.innerWidth - viewportPadding * 2),
    };
  }

  private getMenuDimensions(menu: HTMLDivElement): { width: number; height: number } {
    const keys = Object.keys(MENU_MEASURE_STYLES) as (keyof typeof MENU_MEASURE_STYLES)[];
    const previous = keys.map((key) => menu.style[key]);
    for (const key of keys) {
      menu.style.setProperty(key, MENU_MEASURE_STYLES[key], "important");
    }

    const dimensions = { width: menu.offsetWidth, height: menu.offsetHeight };

    keys.forEach((key, index) => {
      menu.style[key] = previous[index];
    });
    return dimensions;
  }

  private resolveTypographyAnchor(elem: SuggestionElement): HTMLElement {
    if (TextTargetAdapter.isTextValue(elem)) {
      return elem;
    }

    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    if (anchorNode && elem.contains(anchorNode)) {
      if (anchorNode.nodeType === Node.TEXT_NODE) {
        return anchorNode.parentElement ?? elem;
      }
      if (anchorNode instanceof HTMLElement) {
        return anchorNode;
      }
    }

    return elem;
  }

  private resolveLegacyThemeScale(
    menu: HTMLDivElement,
    typographyAnchor: HTMLElement,
    contextFontSizePx: number,
  ): {
    fontSize: number;
    paddingVertical: number;
    paddingHorizontal: number;
  } {
    const root = menu.ownerDocument?.documentElement;
    if (!root) {
      return {
        fontSize: 1,
        paddingVertical: 1,
        paddingHorizontal: 1,
      };
    }

    const rootComputedStyle = window.getComputedStyle(root);
    // The theme value's scale relative to its legacy default, clamped.
    const scale = (
      variableName: string,
      legacyDefaultValue: string,
      property: ThemeLengthProperty,
      minScale: number,
    ): number => {
      const rawThemeValue = rootComputedStyle.getPropertyValue(variableName).trim();
      if (!rawThemeValue) {
        return 1;
      }
      const rootFontSizePx = this.resolveFontSizePx(rootComputedStyle.fontSize);
      const toPx = (value: string) =>
        this.resolveCssLengthPx(
          value,
          property,
          typographyAnchor,
          rootFontSizePx,
          contextFontSizePx,
        );
      const themePx = toPx(rawThemeValue);
      const legacyDefaultPx = toPx(legacyDefaultValue);
      if (
        !themePx ||
        !legacyDefaultPx ||
        legacyDefaultPx <= 0 ||
        !Number.isFinite(themePx) ||
        !Number.isFinite(legacyDefaultPx)
      ) {
        return 1;
      }
      return this.clamp(themePx / legacyDefaultPx, minScale, 1.2);
    };

    return {
      fontSize: scale(
        "--ft-theme-suggestion-font-size",
        SuggestionPositioningService.LEGACY_THEME_FONT_SIZE,
        "font-size",
        0.85,
      ),
      paddingVertical: scale(
        "--ft-theme-suggestion-padding-vertical",
        SuggestionPositioningService.LEGACY_THEME_PADDING_VERTICAL,
        "padding-top",
        0.75,
      ),
      paddingHorizontal: scale(
        "--ft-theme-suggestion-padding-horizontal",
        SuggestionPositioningService.LEGACY_THEME_PADDING_HORIZONTAL,
        "padding-left",
        0.75,
      ),
    };
  }

  private resolveCssLengthPx(
    value: string,
    property: ThemeLengthProperty,
    typographyAnchor: HTMLElement,
    rootFontSizePx: number,
    contextFontSizePx: number,
  ): number | null {
    const normalizedValue = value.trim().toLowerCase();
    if (!normalizedValue) {
      return null;
    }
    if (normalizedValue === "0") {
      return 0;
    }

    const match = normalizedValue.match(/^(-?\d*\.?\d+)(px|rem|em)$/);
    if (match) {
      const unitPx =
        match[2] === "px" ? 1 : match[2] === "rem" ? rootFontSizePx : contextFontSizePx;
      return Number.parseFloat(match[1]) * unitPx;
    }

    return this.measureCssLengthPx(value, property, typographyAnchor, contextFontSizePx);
  }

  private measureCssLengthPx(
    value: string,
    property: ThemeLengthProperty,
    typographyAnchor: HTMLElement,
    contextFontSizePx: number,
  ): number | null {
    const doc = typographyAnchor.ownerDocument ?? document;
    const measurementRoot = doc.body ?? doc.documentElement;
    if (!measurementRoot) {
      return null;
    }

    const measurementContainer = doc.createElement("div");
    measurementContainer.style.position = "absolute";
    measurementContainer.style.visibility = "hidden";
    measurementContainer.style.pointerEvents = "none";
    measurementContainer.style.fontSize = `${contextFontSizePx}px`;

    const probe = doc.createElement("div");
    probe.style.setProperty(property, value);
    measurementContainer.appendChild(probe);
    measurementRoot.appendChild(measurementContainer);

    try {
      const probeComputedStyle = window.getComputedStyle(probe);
      const resolvedValue =
        property === "font-size"
          ? probeComputedStyle.fontSize
          : property === "padding-top"
            ? probeComputedStyle.paddingTop
            : probeComputedStyle.paddingLeft;
      const resolvedPx = Number.parseFloat(resolvedValue);
      return Number.isFinite(resolvedPx) ? resolvedPx : null;
    } finally {
      measurementContainer.remove();
    }
  }

  private resolveFontSizePx(fontSize: string): number {
    return Number.parseFloat(fontSize) || SuggestionPositioningService.DEFAULT_FONT_SIZE_PX;
  }

  private resolveLineHeightPx(lineHeight: string, fontSizePx: number): number {
    const parsed = Number.parseFloat(lineHeight);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return fontSizePx * 1.35;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
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
    };
  }
}
