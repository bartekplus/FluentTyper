import type { CustomPanelConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { BaseControl } from "./FieldControl.js";

export class CustomPanelControl extends BaseControl<null> {
  constructor(params: CustomPanelConfig, store: Store) {
    super(params, store);

    const root = document.createElement("section");
    root.className = "settings-custom-panel field";
    this._rootElement = root;

    const body = document.createElement("div");
    body.className = "settings-custom-panel-body";
    if (params.name) {
      body.id = `${params.name}PanelRoot`;
    }
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
