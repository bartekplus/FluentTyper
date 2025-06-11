// Context for CMD_BACKGROUND_PAGE_SET_CONFIG
export interface SetConfigContext {
  autocomplete: boolean;
  autocompleteOnEnter: boolean;
  autocompleteOnTab: boolean;
  selectByDigit: boolean;
  lang: string;
  autocompleteSeparatorSource: string;
  minWordLengthToPredict: number;
  revertOnBackspace: boolean;
  enabled: boolean;
}

// Context for CMD_BACKGROUND_PAGE_PREDICT_REQ
export interface PredictRequestContext {
  text: string;
  nextChar: string;
  lang: string;
  tabId: number;
  frameId?: number;
  tributeId: number;
  requestId: number;
}
// Context for CMD_BACKGROUND_PAGE_PREDICT_RESP
export interface PredictResponseContext {
  text: string;
  nextChar: string;
  lang: string;
  tabId: number;
  frameId?: number;
  tributeId: number;
  requestId: number;
  predictions: string[];
  forceReplace: string | null;
}

// Context for CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG
export interface UpdateLangConfigContext {
  lang: string;
  autocompleteSeparatorSource: string;
}

// Context for CMD_CONTENT_SCRIPT_PREDICT_REQ
export interface ContentScriptPredictRequestContext {
  text: string;
  nextChar: string;
  tributeId: number;
  requestId: number;
  lang: string;
}

// Context for CMD_OPTIONS_PAGE_CONFIG_CHANGE
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface OptionsPageConfigChangeContext {}
// Context for CMD_CONTENT_SCRIPT_GET_CONFIG
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ContentScriptGetConfigContext {}
// Discriminated union for Message
export type Message =
  | { command: "CMD_BACKGROUND_PAGE_SET_CONFIG"; context: SetConfigContext }
  | {
      command: "CMD_BACKGROUND_PAGE_PREDICT_REQ";
      context: PredictRequestContext;
    }
  | {
      command: "CMD_BACKGROUND_PAGE_PREDICT_RESP";
      context: PredictResponseContext;
    }
  | { command: "CMD_TOGGLE_FT_ACTIVE_TAB" }
  | { command: "CMD_TRIGGER_FT_ACTIVE_TAB" }
  | {
      command: "CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG";
      context: UpdateLangConfigContext;
    }
  | {
      command: "CMD_CONTENT_SCRIPT_PREDICT_REQ";
      context: ContentScriptPredictRequestContext;
    }
  | {
      command: "CMD_OPTIONS_PAGE_CONFIG_CHANGE";
      context: OptionsPageConfigChangeContext;
    }
  | {
      command: "CMD_CONTENT_SCRIPT_GET_CONFIG";
      context: ContentScriptGetConfigContext;
    };
export type ConfigMessage = Extract<
  Message,
  { command: "CMD_BACKGROUND_PAGE_SET_CONFIG" }
>;
export type PredictRequestMessage = Extract<
  Message,
  { command: "CMD_BACKGROUND_PAGE_PREDICT_REQ" }
>;
export type PredictResponseMessage = Extract<
  Message,
  { command: "CMD_BACKGROUND_PAGE_PREDICT_RESP" }
>;
export type ToggleActiveTabMessage = Extract<
  Message,
  { command: "CMD_TOGGLE_FT_ACTIVE_TAB" }
>;
export type TriggerActiveTabMessage = Extract<
  Message,
  { command: "CMD_TRIGGER_FT_ACTIVE_TAB" }
>;
export type UpdateLangConfigMessage = Extract<
  Message,
  { command: "CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG" }
>;
export type ContentScriptPredictRequestMessage = Extract<
  Message,
  { command: "CMD_CONTENT_SCRIPT_PREDICT_REQ" }
>;
export type OptionsPageConfigChangeMessage = Extract<
  Message,
  { command: "CMD_OPTIONS_PAGE_CONFIG_CHANGE" }
>;
export type ContentScriptGetConfigMessage = Extract<
  Message,
  { command: "CMD_CONTENT_SCRIPT_GET_CONFIG" }
>;
