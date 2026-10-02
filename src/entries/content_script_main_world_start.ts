import {
  installGoogleDocsMainWorld,
  prepareGoogleDocsAnnotation,
} from "@adapters/chrome/content-script/google-docs/GoogleDocsMainWorld";
import {
  installEarlyTabAcceptMainWorldBridge,
  uninstallEarlyTabAcceptMainWorldBridge,
} from "@adapters/chrome/content-script/suggestions/EarlyTabAcceptMainWorldBridge";
import {
  HOST_EDITOR_ENABLED_ATTR,
  HOST_EDITOR_ENABLED_EVENT,
} from "@adapters/chrome/content-script/suggestions/HostEditorBridgeProtocol";

// The hint must precede Docs initialization; it performs no text read or work.
prepareGoogleDocsAnnotation();
let stopDocs: (() => void) | null = null;
document.addEventListener(HOST_EDITOR_ENABLED_EVENT, () => {
  if (document.documentElement.getAttribute(HOST_EDITOR_ENABLED_ATTR) === "true") {
    installEarlyTabAcceptMainWorldBridge();
    stopDocs ??= installGoogleDocsMainWorld();
  } else {
    uninstallEarlyTabAcceptMainWorldBridge();
    stopDocs?.();
    stopDocs = null;
  }
});
