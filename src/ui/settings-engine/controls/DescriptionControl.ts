import type { DescriptionConfig } from "../types.js";
import type { Store } from "../store/Store.js";
import { BaseControl } from "./FieldControl.js";

export class DescriptionControl extends BaseControl<string> {
  constructor(params: DescriptionConfig, store: Store) {
    super(params, store);

    const root = document.createElement("div");
    this._rootElement = root;

    const body = document.createElement("div");
    body.className = "description-body";

    const content = params.description ?? params.text ?? "";
    if (content) {
      body.innerHTML = content;
    }

    root.appendChild(body);
    this._element = body;
  }

  get(): string {
    return this._element.innerHTML;
  }

  set(value: string): this {
    this._element.innerHTML = value;
    return this;
  }
}
