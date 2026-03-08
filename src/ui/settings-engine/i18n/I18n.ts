export type TranslationMap = Record<string, string>;
export type TranslationDictionary = Record<string, TranslationMap>;

export class I18n {
  lang: string;
  [key: string]: unknown;

  constructor() {
    this.lang = navigator.language.split("-")[0];
  }

  get(value: string): string {
    if (value === "lang") {
      return this.lang;
    }

    if (Object.prototype.hasOwnProperty.call(this, value)) {
      const entry = this[value] as TranslationMap;
      if (Object.prototype.hasOwnProperty.call(entry, this.lang)) {
        return entry[this.lang];
      } else if (Object.prototype.hasOwnProperty.call(entry, "en")) {
        return entry["en"];
      } else {
        return Object.values(entry)[0] ?? value;
      }
    }

    return value;
  }

  extend(translations: TranslationDictionary): void {
    Object.assign(this, translations);
  }
}
