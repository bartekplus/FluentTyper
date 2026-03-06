export class SuggestionKeyboardController {
  static readonly DEFAULT_KEYS = ["Escape", "ArrowUp", "ArrowDown", "Space"] as const;

  static buildActiveKeys(config: {
    autocompleteOnEnter: boolean;
    autocompleteOnTab: boolean;
  }): string[] {
    const keys: string[] = [...SuggestionKeyboardController.DEFAULT_KEYS];
    if (config.autocompleteOnEnter) {
      keys.push("Enter");
    }
    if (config.autocompleteOnTab) {
      keys.push("Tab");
    }
    return keys;
  }

  static normalizeKey(key: string): string {
    return key === " " ? "Space" : key;
  }

  static isActiveKey(activeKeys: readonly string[], key: string): boolean {
    return activeKeys.includes(SuggestionKeyboardController.normalizeKey(key));
  }
}
