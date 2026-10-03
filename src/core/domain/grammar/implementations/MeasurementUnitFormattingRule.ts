import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { parseMeasurementExpression } from "../measurement/parser";
import { resolveMeasurementLocale } from "../measurement/registry";
import type { MeasurementLocalePolicy } from "../measurement/contracts";

export class MeasurementUnitFormattingRule implements GrammarRule {
  readonly id = "measurementUnitFormatting" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    // Single capitals also denote grades, models, resolutions and names; "3d"
    // and "5g" are not a day and a gram either.
    return separateUnit(context, undefined, (unit) => /^([A-Z]|[dg])$/.test(unit));
  }
}

/**
 * Inserts the locale separator between the number and the unit (`isUnit`) that end the
 * text before a just-typed space, and changes nothing else. Shared with currency.
 */
export function separateUnit(
  context: GrammarContext,
  isUnit?: (text: string, start: number) => boolean,
  skipUnit: (unit: string) => boolean = () => false,
): GrammarEdit | null {
  const boundary = readMeasurementBoundary(context);
  if (!boundary) {
    return null;
  }

  const { locale, text, trailing } = boundary;
  const parsed = parseMeasurementExpression(text, locale, isUnit);
  if (
    !parsed ||
    skipUnit(text.slice(parsed.numberEnd)) ||
    !isProsePrefix(text.slice(0, parsed.start))
  ) {
    return null;
  }

  return {
    replacement: `${text.slice(parsed.start, parsed.numberEnd)}${locale.separator}${text.slice(parsed.numberEnd)}${trailing}`,
    deleteBackwards: context.beforeCursor.length - parsed.start,
    deleteForwards: 0,
    strict: true,
  };
}

/**
 * The text before a just-typed space or newline, when that keystroke is a plain
 * prose insertion in a locale with a measurement policy.
 */
function readMeasurementBoundary(
  context: GrammarContext,
): { locale: MeasurementLocalePolicy; text: string; trailing: string } | null {
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
  return { locale, text: context.beforeCursor.slice(0, -1), trailing };
}

export function isProsePrefix(prefix: string): boolean {
  const lineStart = Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf("\r")) + 1;
  if (/\p{Bidi_Control}/u.test(prefix)) {
    return false;
  }
  const line = prefix.slice(lineStart);
  // Nothing before the measurement is not evidence against prose, and treating
  // it as such formatted "2Mbit 2Mbit" into "2Mbit 2 Mbit": the same text
  // twice, spaced only where a word happened to precede it.
  if (line.trim().length === 0) {
    return true;
  }
  if (!/\p{L}/u.test(line) || /(?:https?:\/\/|www\.|[\\/]|[[\]])/iu.test(line)) {
    return false;
  }
  // "the mass (10kg) is" is prose in brackets, so look past an opening bracket
  // that follows a space. "f(10kg)" keeps its bracket attached and is refused.
  const unbracketed = /(?<=^|\s)[([]$/u.test(line) ? line.slice(0, -1) : line;
  if (unbracketed.trim().length === 0) {
    return true;
  }
  return /(?:[:：]\s*|\p{L}[\p{L}\p{M}'’.-]*\s+)$/u.test(unbracketed);
}
