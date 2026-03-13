export const EARLY_TAB_ACCEPT_REQUEST_EVENT = "ft-early-tab-accept-request";
export const EARLY_TAB_ACCEPT_MAIN_WORLD_FLAG = "__ftEarlyTabAcceptBridgeInstalled";
export const EARLY_TAB_ACCEPT_ENTRY_ID_ATTR = "data-ft-suggestion-id";
export const EARLY_TAB_ACCEPT_ENABLED_ATTR = "data-ft-autocomplete-on-tab";
export const EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR = "data-ft-early-tab-bridge";
export const EARLY_TAB_ACCEPT_MESSAGE_TYPE = "ft-early-tab-accept-message";

export interface EarlyTabAcceptMessage {
  source: typeof EARLY_TAB_ACCEPT_REQUEST_EVENT;
  type: typeof EARLY_TAB_ACCEPT_MESSAGE_TYPE;
  entryId: string;
}

export function isEarlyTabAcceptMessage(value: unknown): value is EarlyTabAcceptMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<EarlyTabAcceptMessage>;
  return (
    candidate.source === EARLY_TAB_ACCEPT_REQUEST_EVENT &&
    candidate.type === EARLY_TAB_ACCEPT_MESSAGE_TYPE &&
    typeof candidate.entryId === "string"
  );
}
