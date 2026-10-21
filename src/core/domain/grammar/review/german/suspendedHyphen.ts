// The suspended-hyphen rule is code in grammar/rules/de.yaml.

/** "Groß/Kleinschreibung", "Preis/Leistung": two capitalized words joined by a slash are prose, not
 * a path; Review's technical-token guard lets them through in German text. */
export const GERMAN_SLASH_PAIR = /^\p{Lu}\p{Ll}+\/\p{Lu}\p{Ll}+$/u;
