export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasStringProperty<TProperty extends string>(
  value: Record<string, unknown>,
  property: TProperty,
): value is Record<TProperty, string> & Record<string, unknown> {
  return typeof value[property] === "string";
}

/** True when both arrays have the same items in the same order. */
export function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function getOwnProperty<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function defineOwnProperty<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}
