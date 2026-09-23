import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { parseMeasurementExpression } from "../measurement/parser";
import { resolveMeasurementLocale } from "../measurement/registry";
import { isProsePrefix } from "./MeasurementUnitFormattingRule";

// Exact, case-sensitive markers written after the amount. ISO codes that are
// also words or common acronyms (ALL, TOP, CUP, TRY, CAD, ARS) are left out.
// "$", "£" and "¥" normally precede the amount, and moving them is not spacing.
const CURRENCY_MARKERS = new Set(
  "EUR USD GBP CHF PLN SEK NOK DKK CZK HUF RON BGN JPY CNY AUD NZD BRL MXN SAR AED INR UAH € zł kr".split(
    " ",
  ),
);

/** "120zł " -> "120 zł ": inserts the locale separator and changes nothing else. */
export class CurrencySpacingRule implements GrammarRule {
  readonly id = "currencySpacing" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const hints = context.hints;
    if (
      hints?.measurementContext !== "prose" ||
      hints.inputAction !== "insert" ||
      hints.isPaste ||
      context.beforeCursor.length > 512 ||
      context.afterCursor.length > 0
    ) {
      return null;
    }

    const locale = resolveMeasurementLocale(hints.lang);
    const trailing = context.beforeCursor.at(-1);
    if (!locale || (trailing !== " " && trailing !== "\n")) {
      return null;
    }

    const text = context.beforeCursor.slice(0, -1);
    const parsed = parseMeasurementExpression(text, locale, (value, start) =>
      CURRENCY_MARKERS.has(value.slice(start)),
    );
    if (
      !parsed ||
      parsed.unitStart !== parsed.numberEnd ||
      !isProsePrefix(text.slice(0, parsed.start))
    ) {
      return null;
    }

    return {
      replacement: `${text.slice(parsed.start, parsed.numberEnd)}${locale.separator}${text.slice(parsed.unitStart)}${trailing}`,
      deleteBackwards: context.beforeCursor.length - parsed.start,
      deleteForwards: 0,
      strict: true,
    };
  }
}
