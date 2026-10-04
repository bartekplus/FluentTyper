import type { CustomPanelConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { createElement } from "../dom/createElement.js";
import { BaseControl } from "./FieldControl.js";

export class CustomPanelControl extends BaseControl<null> {
  constructor(params: CustomPanelConfig, store: Store) {
    super(params, store);

    const root = createElement("section", { className: "settings-custom-panel field" });
    this._rootElement = root;

    const body = createElement("div", {
      className: "settings-custom-panel-body",
      id: params.name && `${params.name}PanelRoot`,
    });
    root.appendChild(body);
    this._element = body;
  }

  get(): null {
    return null;
  }

  set(): this {
    return this;
  }
}
