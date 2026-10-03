import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { separateUnit } from "./MeasurementUnitFormattingRule";

// Exact, case-sensitive markers written after the amount. ISO codes that are
// also words or common acronyms (ALL, TOP, CUP, TRY, CAD, ARS) are left out.
// "$", "£" and "¥" normally precede the amount, and moving them is not spacing.
export const CURRENCY_MARKERS = new Set(
  "EUR USD GBP CHF PLN SEK NOK DKK CZK HUF RON BGN JPY CNY AUD NZD BRL MXN SAR AED INR UAH € zł kr".split(
    " ",
  ),
);

/** "120zł " -> "120 zł ": inserts the locale separator and changes nothing else. */
export class CurrencySpacingRule implements GrammarRule {
  readonly id = "currencySpacing" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    return separateUnit(context, (value, start) => CURRENCY_MARKERS.has(value.slice(start)));
  }
}
