import { TextTargetAdapter } from "./TextTargetAdapter";
import {
  SUGGESTION_MENU_LAYOUT_ATTR,
  SUGGESTION_MENU_PLACEMENT_ATTR,
  SUGGESTION_MENU_PLACEMENT_LINE_ATTR,
} from "./SuggestionMenuHost";
import { MIRROR_LAYOUT_PROPERTIES } from "./InlineSuggestionView";
import {
  NEUTRAL_THEME_SCALE,
  SUGGESTION_POPUP_MAX_WIDTH_PX,
  THEME_SCALE_REFERENCES,
  computeSuggestionPopupStyleVars,
  themeScaleFor,
  type SuggestionPopupThemeScale,
} from "@core/domain/suggestionPopup/metrics";
import {
  SUGGESTION_POPUP_FONT_FAMILY,
  SUGGESTION_POPUP_FONT_STYLE,
  SUGGESTION_POPUP_FONT_WEIGHT,
} from "@core/domain/suggestionPopup/typography";
import type { SuggestionElement } from "./types";

interface MenuCoordinates {
  left: number;
  top: number;
  maxHeight: number;
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
  private static readonly CARET_GAP_PX = 4;
  private static readonly PREFERRED_MENU_HEIGHT_PX = 200;
  private static readonly DEFAULT_FONT_SIZE_PX = 16;

  public syncMenuTypography(menu: HTMLDivElement, elem: SuggestionElement): void {
    const typographyAnchor = this.resolveTypographyAnchor(elem);
    const computed = window.getComputedStyle(typographyAnchor);
    const fontSizePx = this.resolveFontSizePx(computed.fontSize);
    const vars = computeSuggestionPopupStyleVars({
      fontSizePx,
      lineHeightPx: this.resolveLineHeightPx(computed.lineHeight, fontSizePx),
      themeScale: this.resolveLegacyThemeScale(menu, typographyAnchor, fontSizePx),
      viewportWidthPx: window.innerWidth,
    });

    menu.style.fontSize = vars["--ft-font-size"];
    menu.style.lineHeight = vars["--ft-line-height"];
    menu.style.direction = computed.direction;
    menu.style.fontFamily = SUGGESTION_POPUP_FONT_FAMILY;
    menu.style.fontWeight = SUGGESTION_POPUP_FONT_WEIGHT;
    menu.style.fontStyle = SUGGESTION_POPUP_FONT_STYLE;
    for (const [name, value] of Object.entries(vars)) {
      menu.style.setProperty(name, value);
    }
  }

  public positionMenu(menu: HTMLDivElement, elem: SuggestionElement): boolean {
    const rect = this.getCaretRect(elem);
    if (!rect) {
      return false;
    }

    // The host's inline \`all: initial\` overrides the stylesheet's :host caps, so
    // the layout's cap goes inline, before the menu is measured under it.
    const cap =
      menu.getAttribute(SUGGESTION_MENU_LAYOUT_ATTR) === "horizontal"
        ? SUGGESTION_POPUP_MAX_WIDTH_PX.row
        : SUGGESTION_POPUP_MAX_WIDTH_PX.list;
    const maxWidth = Math.max(
      1,
      Math.min(cap, window.innerWidth - SuggestionPositioningService.VIEWPORT_PADDING_PX * 2),
    );
    menu.style.setProperty("max-width", `${maxWidth}px`, "important");
    const coordinates = this.getMenuCoordinatesForRect(menu, rect, elem);

    menu.style.setProperty("position", "fixed", "important");
    menu.style.setProperty("top", `${coordinates.top}px`, "important");
    menu.style.setProperty("left", `${coordinates.left}px`, "important");
    menu.style.setProperty("right", "auto", "important");
    menu.style.setProperty("bottom", "auto", "important");
    menu.style.setProperty("max-height", `${coordinates.maxHeight}px`, "important");
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
    const showBelow =
      this.resolvePlacement(menu, rect, availableBelow, availableAbove, menuDimensions.height) ===
      "below";
    const maxHeight = Math.max(96, showBelow ? availableBelow : availableAbove);
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

    // The panel's inline-start edge sits at the caret.
    const isRtl = window.getComputedStyle(elem).direction === "rtl";
    const rawLeft = isRtl ? rect.right - menuDimensions.width : rect.left;
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
    };
  }

  /**
   * Picks a side once per caret line and keeps it: flipping as the list grows or
   * shrinks would move the first suggestion away from the caret. A resized
   * viewport changes the room on each side, so it decides afresh.
   */
  private resolvePlacement(
    menu: HTMLDivElement,
    rect: DOMRect,
    availableBelow: number,
    availableAbove: number,
    menuHeight: number,
  ): "above" | "below" {
    // Width counts too: it changes the width cap, the wrapping and so the height.
    const line = `${Math.round(rect.top)}:${window.innerWidth}x${window.innerHeight}`;
    const locked = menu.getAttribute(SUGGESTION_MENU_PLACEMENT_ATTR);
    if (
      menu.getAttribute(SUGGESTION_MENU_PLACEMENT_LINE_ATTR) === line &&
      (locked === "above" || locked === "below")
    ) {
      return locked;
    }
    // Judge by the room a longer list will need, not only the current one.
    // A row stays one row however many suggestions arrive: only a list needs room to grow.
    const needed =
      menu.getAttribute(SUGGESTION_MENU_LAYOUT_ATTR) === "horizontal"
        ? menuHeight
        : Math.max(menuHeight, SuggestionPositioningService.PREFERRED_MENU_HEIGHT_PX);
    const placement =
      availableBelow >= needed || availableBelow >= availableAbove ? "below" : "above";
    menu.setAttribute(SUGGESTION_MENU_PLACEMENT_ATTR, placement);
    menu.setAttribute(SUGGESTION_MENU_PLACEMENT_LINE_ATTR, line);
    return placement;
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

  /** The user's Appearance sizes (theme CSS variables on the page root) as a scale. */
  private resolveLegacyThemeScale(
    menu: HTMLDivElement,
    typographyAnchor: HTMLElement,
    contextFontSizePx: number,
  ): SuggestionPopupThemeScale {
    const root = menu.ownerDocument?.documentElement;
    if (!root) {
      return NEUTRAL_THEME_SCALE;
    }

    const rootComputedStyle = window.getComputedStyle(root);
    const rootFontSizePx = this.resolveFontSizePx(rootComputedStyle.fontSize);
    const scale = (
      key: keyof SuggestionPopupThemeScale,
      variableName: string,
      property: ThemeLengthProperty,
    ): number => {
      const rawThemeValue = rootComputedStyle.getPropertyValue(variableName).trim();
      if (!rawThemeValue) {
        return 1;
      }
      const toPx = (value: string) =>
        this.resolveCssLengthPx(
          value,
          property,
          typographyAnchor,
          rootFontSizePx,
          contextFontSizePx,
        );
      const { reference, min } = THEME_SCALE_REFERENCES[key];
      return themeScaleFor(toPx(rawThemeValue), toPx(reference), min);
    };

    return {
      fontSize: scale("fontSize", "--ft-theme-suggestion-font-size", "font-size"),
      paddingVertical: scale(
        "paddingVertical",
        "--ft-theme-suggestion-padding-vertical",
        "padding-top",
      ),
      paddingHorizontal: scale(
        "paddingHorizontal",
        "--ft-theme-suggestion-padding-horizontal",
        "padding-left",
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
      const resolvedPx = Number.parseFloat(
        window.getComputedStyle(probe).getPropertyValue(property),
      );
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
