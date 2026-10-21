import { table } from "./tables";

// The frames of the names (products, nationalities, places) are in grammar/rules/en.yaml.

/**
 * Names in their owners' spelling, for englishCanonicalCasing: each row's typed forms (any
 * case) become the name exactly. Only forms that are never ordinary English words.
 */
export const NAMES = table("properNames.names");
