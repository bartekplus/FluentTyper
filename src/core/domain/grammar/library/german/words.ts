// The rule library (library.ts): word facts that the German rules read from other Review data.
import { hasCanonicalCasing } from "../../review/canonicalCasing";

/** A word that has its own spelling of capitals ("javascript" → "JavaScript", "NASA"). */
export const deCanonicalCasing = (word: string): boolean => hasCanonicalCasing(word);
