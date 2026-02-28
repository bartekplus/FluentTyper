export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasStringProperty<TProperty extends string>(
  value: Record<string, unknown>,
  property: TProperty,
): value is Record<TProperty, string> & Record<string, unknown> {
  return typeof value[property] === "string";
}
