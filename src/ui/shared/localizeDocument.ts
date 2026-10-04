import { i18n } from "@ui/options/fluenttyperI18n.js";

/** Sets the text of each [data-i18n] element and each named attribute from [data-i18n-<attribute>]. */
export function localizeDocument(attributes: string[]): void {
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    if (key) {
      element.textContent = i18n.get(key);
    }
  });
  for (const attribute of attributes) {
    document.querySelectorAll(`[data-i18n-${attribute}]`).forEach((element) => {
      const key = element.getAttribute(`data-i18n-${attribute}`);
      if (key) {
        element.setAttribute(attribute, i18n.get(key));
      }
    });
  }
}
