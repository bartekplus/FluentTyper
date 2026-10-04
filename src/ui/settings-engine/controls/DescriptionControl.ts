import type { DescriptionConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { createElement } from "../dom/createElement.js";
import { BaseControl } from "./FieldControl.js";
import { setSafeHtmlContent } from "../dom/safeHtml.js";

export class DescriptionControl extends BaseControl<string> {
  private value = "";

  constructor(params: DescriptionConfig, store: Store) {
    super(params, store);

    this._element = createElement("div", { className: "description-body" });
    this._rootElement = createElement("div");
    this._rootElement.appendChild(this._element);
    this.set(params.description ?? params.text ?? "");
  }

  get(): string {
    return this.value;
  }

  set(value: string): this {
    this.value = value;
    setSafeHtmlContent(this._element, value);
    return this;
  }
}
