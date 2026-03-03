declare module "./SuggestionEngineCore.js" {
  interface SuggestionItem {
    original?: { value?: string };
    string?: string;
    [key: string]: unknown;
  }

  interface SuggestionEngineConfig {
    trigger: string;
    iframe: HTMLElement | null;
    selectClass: string;
    containerClass: string;
    itemClass: string;
    selectTemplate: (item: SuggestionItem) => string | null;
    menuItemTemplate: (item: SuggestionItem) => string;
    noMatchTemplate?: (() => string) | string;
    menuContainer: HTMLElement;
    lookup: string;
    fillAttr: string;
    values: (
      trigger: string,
      done: (results: unknown[], textEdit: unknown | null, menuHeader?: string) => void,
      fullText: string,
      nextChar: string,
    ) => void;
    requireLeadingSpace: boolean;
    allowSpaces: boolean;
    replaceTextSuffix: string;
    positionMenu: boolean;
    spaceSelectsMatch: boolean;
    autocompleteMode: boolean;
    autocompleteSeparator: RegExp;
    inline: boolean;
    searchOpts: {
      pre: string;
      post: string;
      skip: boolean;
    };
    menuShowMinLength: number;
    keys: () => string[];
    supportRevert: boolean;
    selectByDigit: boolean;
  }

  export default class SuggestionEngineCore {
    constructor(config: SuggestionEngineConfig);
    autocompleteSeparator: RegExp;
    attach(elem: Element): void;
    detach(elem: Element): void;
    showMenuForCollection(elem: Element): void;
    hideMenu(): void;
  }
}
