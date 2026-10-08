import { ManualAttachUiManager } from "../../../src/adapters/chrome/content-script/suggestions/ManualAttachUiManager";

declare global {
  interface Window {
    __testManualAttachUi: typeof ManualAttachUiManager;
  }
}

window.__testManualAttachUi = ManualAttachUiManager;
