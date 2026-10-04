export type OptionTuple = [string, string];

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
  min: number;
  max: number;
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
  /** Styles the button as destructive. */
  danger?: true;
};

export type DescriptionConfig = {
  type: "description";
  tab: string;
  group: string;
  name?: string;
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

export type ValueOnlyConfig = {
  type: "valueOnly";
  tab: string;
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
  | ValueOnlyConfig;

export interface TabConfig {
  id: string;
  label: string;
  shortDescription?: string;
  keywords?: string[];
}

export interface ManifestDefinition {
  tabs: TabConfig[];
  settings: FieldConfig[];
}
