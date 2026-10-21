/**
 * A word table that has no prototype: a lookup of an Object member name ("constructor",
 * "toString") finds nothing, as for any other unknown word.
 */
export const wordTable = <T>(entries: Readonly<Record<string, T>>): Record<string, T> =>
  Object.assign(Object.create(null) as Record<string, T>, entries);
