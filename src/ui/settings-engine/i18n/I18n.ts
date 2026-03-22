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

    if (!Object.prototype.hasOwnProperty.call(this, value)) {
      return value;
    }

    const entry = this[value] as TranslationMap;
    return entry[this.lang] ?? entry.en ?? Object.values(entry)[0] ?? value;
  }

  extend(translations: TranslationDictionary): void {
    Object.assign(this, translations);
  }
}
