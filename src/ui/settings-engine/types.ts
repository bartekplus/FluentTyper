export interface OptionEntry {
  value: string;
  text: string;
  group?: string;
}

export interface RuleToggleAction {
  actionKey?: string;
  text: string;
  values: string[];
}

// --- Discriminated union of all field config shapes ---

export type CheckboxConfig = {
  type: "checkbox";
  tab: string;
  group: string;
  name?: string;
  label?: string;
  default?: boolean;
};

export type SliderConfig = {
  type: "slider";
  tab: string;
  group: string;
  name?: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  display?: boolean;
  displayModifier?: (value: number) => string;
  default?: number;
};

export type TextConfig = {
  type: "text";
  tab: string;
  group: string;
  name?: string;
  label?: string;
  text?: string;
  subtype?: "color" | "password" | "email" | "url" | "search";
  pattern?: string;
  required?: boolean;
  masked?: boolean;
  colorPicker?: boolean;
  store?: false;
  default?: string;
};

export type TextareaConfig = {
  type: "textarea";
  tab: string;
  group: string;
  name?: string;
  label?: string;
  text?: string;
  default?: string;
};

export type SelectConfig = {
  type: "popupButton";
  tab: string;
  group: string;
  name?: string;
  label?: string;
  options?: OptionEntry[] | OptionEntry[][] | { groups?: string[]; values: OptionEntry[] };
  default?: string;
};

export type ListBoxConfig = {
  type: "listBox";
  tab: string;
  group: string;
  name?: string;
  label?: string;
};

export type ListBoxMultiselectConfig = {
  type: "listBoxMultiselect";
  tab: string;
  group: string;
  name?: string;
  label?: string;
  options?: { groups?: string[]; values: OptionEntry[] } | OptionEntry[][];
  default?: string[];
};

export type RadioConfig = {
  type: "radioButtons";
  tab: string;
  group: string;
  name?: string;
  label?: string;
  options?: [string, string][];
  default?: string;
};

export type ButtonConfig = {
  type: "button";
  tab: string;
  group: string;
  name?: string;
  label?: string;
  text?: string;
  store?: false;
};

export type ModalButtonConfig = {
  type: "modalButton";
  tab: string;
  group: string;
  name?: string;
  label?: string;
  text?: string;
  modal?: {
    title?: string;
    contents: FieldConfig[];
  };
};

export type DescriptionConfig = {
  type: "description";
  tab: string;
  group: string;
  name?: string;
  description?: string;
  text?: string;
};

export type RuleToggleCardsConfig = {
  type: "ruleToggleCards";
  tab: string;
  group: string;
  name?: string;
  label?: string;
  helpText?: string;
  searchPlaceholder?: string;
  sectionSafeLabel?: string;
  sectionAdvancedLabel?: string;
  filterAllLabel?: string;
  filterSafeLabel?: string;
  filterAdvancedLabel?: string;
  filterEnglishOnlyLabel?: string;
  filterEnabledOnlyLabel?: string;
  summaryLabel?: string;
  emptyStateText?: string;
  noMatchesText?: string;
  options?: unknown[];
  actions?: RuleToggleAction[];
  default?: string[];
};

export type ValueOnlyConfig = {
  type: "valueOnly";
  tab: string;
  group: string;
  name: string;
  default?: unknown;
};

export type FieldConfig =
  | CheckboxConfig
  | SliderConfig
  | TextConfig
  | TextareaConfig
  | SelectConfig
  | ListBoxConfig
  | ListBoxMultiselectConfig
  | RadioConfig
  | ButtonConfig
  | ModalButtonConfig
  | DescriptionConfig
  | RuleToggleCardsConfig
  | ValueOnlyConfig;

export interface ManifestDefinition {
  name: string;
  icon: string;
  settings: FieldConfig[];
}
