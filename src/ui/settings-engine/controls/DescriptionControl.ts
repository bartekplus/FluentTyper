import type { DescriptionConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { BaseControl } from "./FieldControl.js";
import { setSafeHtmlContent } from "../dom/safeHtml.js";

export class DescriptionControl extends BaseControl<string> {
  private value = "";

  constructor(params: DescriptionConfig, store: Store) {
    super(params, store);

    const root = document.createElement("div");
    this._rootElement = root;

    const body = document.createElement("div");
    body.className = "description-body";

    const content = params.description ?? params.text ?? "";
    if (content) {
      this.value = content;
      setSafeHtmlContent(body, content);
    }

    root.appendChild(body);
    this._element = body;
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
