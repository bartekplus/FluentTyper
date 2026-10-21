// Generic text and collection helpers of the rule library (library.ts).

/** The word with its first character in capitals ("ehre" -> "Ehre"). */
export const capitalize = (word: string) => word[0].toUpperCase() + word.slice(1);

/** Adds `value` to `set` and gives it back: a finding a filter of the same rule reads later. */
export function remember<T extends object>(set: WeakSet<T>, value: T): T {
  set.add(value);
  return value;
}
