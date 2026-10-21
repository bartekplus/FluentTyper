import { DIGIT } from "../isoDates";

// The calendar checks of English dates are in grammar/rules/en.yaml (rule en.dates).

/**
 * A date is prose, not a path or a dotted name, in any language: "2/30/2025",
 * "31.11.2025", "31/9/69", "31/سبتمبر/1969", Arabic-Indic digits.
 * Dotted forms need a four-digit year so versions ("1.12.31") stay technical.
 */
export const NUMERIC_DATE_TOKEN = new RegExp(
  "^(?:D{1,2}/(?:D{1,2}|\\p{L}{3,12})/(?:D{2}|D{4})|D{1,2}\\.D{1,2}\\.D{4})$".replace(/D/g, DIGIT),
  "u",
);
