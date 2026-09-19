export type OptionTuple = [string, string];

export interface RuleOption {
  value: string;
  text: string;
  description?: string;
  example?: string;
  badge?: string;
  safetyTier: "safe" | "advanced";
  languageScope: "all" | "en_US";
}

export interface RuleToggleAction {
  actionKey?: string;
  text: string;
  values: string[];
}

export interface RuleToggleStorageAdapter {
  getSelection(value: unknown): string[];
  setSelection(selection: readonly string[]): unknown;
  setChoice(value: unknown, rule: string, enabled: boolean): unknown;
}

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
  default?: number;
};

export type SelectConfig = {
  type: "popupButton";
  tab: string;
  group: string;
  name?: string;
  label?: string;
  options?: OptionTuple[];
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

export type DescriptionConfig = {
  type: "description";
  tab: string;
  group: string;
  name?: string;
  description?: string;
  text?: string;
};

export type CustomPanelConfig = {
  type: "customPanel";
  tab: string;
  group: string;
  name?: string;
  label?: string;
  description?: string;
  keywords?: string[];
};

export type RuleToggleCardsConfig = {
  type: "ruleToggleCards";
  tab: string;
  group: string;
  name?: string;
  label?: string;
  helpText?: string;
  searchPlaceholder: string;
  sectionSafeLabel: string;
  sectionAdvancedLabel: string;
  filterAllLabel: string;
  filterSafeLabel: string;
  filterAdvancedLabel: string;
  filterEnglishOnlyLabel: string;
  filterEnabledOnlyLabel: string;
  summaryLabel: string;
  emptyStateText: string;
  noMatchesText: string;
  options: RuleOption[];
  actions: RuleToggleAction[];
  default?: unknown;
  storageAdapter?: RuleToggleStorageAdapter;
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
  | SelectConfig
  | ButtonConfig
  | DescriptionConfig
  | CustomPanelConfig
  | RuleToggleCardsConfig
  | ValueOnlyConfig;

export interface TabConfig {
  id: string;
  label: string;
  title?: string;
  shortDescription?: string;
  icon?: string;
  keywords?: string[];
}

export interface ManifestDefinition {
  name: string;
  icon: string;
  tabs: TabConfig[];
  settings: FieldConfig[];
}
