import { installGoogleDocsMainWorld } from "@adapters/chrome/content-script/google-docs/GoogleDocsMainWorld";
import { installEarlyTabAcceptMainWorldBridge } from "@adapters/chrome/content-script/suggestions/EarlyTabAcceptMainWorldBridge";

installEarlyTabAcceptMainWorldBridge();

installGoogleDocsMainWorld();
