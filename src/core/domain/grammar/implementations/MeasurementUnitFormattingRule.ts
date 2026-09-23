import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { parseMeasurementExpression } from "../measurement/parser";
import { resolveMeasurementLocale } from "../measurement/registry";

export class MeasurementUnitFormattingRule implements GrammarRule {
  readonly id = "measurementUnitFormatting" as const;
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

    const expressionEnd = context.beforeCursor.length - 1;
    const prefixAndExpression = context.beforeCursor.slice(0, expressionEnd);
    const parsed = parseMeasurementExpression(prefixAndExpression, locale);
    if (
      !parsed ||
      parsed.unitStart !== parsed.numberEnd ||
      // Single capital letters also denote grades, models, resolutions, and names.
      // Single capitals denote grades and resolutions; "3d" and "5g" are not
      // a day and a gram either.
      /^([A-Z]|[dg])$/.test(prefixAndExpression.slice(parsed.unitStart)) ||
      !isProsePrefix(prefixAndExpression.slice(0, parsed.start))
    ) {
      return null;
    }

    return {
      replacement: `${prefixAndExpression.slice(parsed.start, parsed.numberEnd)}${locale.separator}${prefixAndExpression.slice(parsed.unitStart)}${trailing}`,
      deleteBackwards: context.beforeCursor.length - parsed.start,
      deleteForwards: 0,
      strict: true,
    };
  }
}

export function isProsePrefix(prefix: string): boolean {
  const lineStart = Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf("\r")) + 1;
  if (/\p{Bidi_Control}|`|~~~/u.test(prefix)) {
    return false;
  }
  const line = prefix.slice(lineStart);
  // Nothing before the measurement is not evidence against prose, and treating
  // it as such formatted "2Mbit 2Mbit" into "2Mbit 2 Mbit": the same text
  // twice, spaced only where a word happened to precede it.
  if (line.trim().length === 0) {
    return true;
  }
  if (
    /(?:^|[;\s])(?:(?:min|max)-)?(?:width|height|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|font(?:-[a-z]+)?|line-height|gap|inset|top|right|bottom|left|border(?:-[a-z]+)?|stroke(?:-[a-z]+)?)\s*:/iu.test(
      line,
    )
  )
    return false;
  if (
    // Case-insensitive: at the start of a field the capitalization rule turns
    // "npm" into "Npm" before this guard ever sees it.
    /^\s*(?:sudo|doas|git|npm|npx|bun|node|python\d*|pip\d*|curl|wget|echo|printf|export|let|const|var|return|import|docker|kubectl|cargo|apt|brew)(?:\s|$)/iu.test(
      line,
    )
  ) {
    return false;
  }
  if (!/\p{L}/u.test(line) || /(?:https?:\/\/|www\.|[\\/]|[`{}[\]$]|(?:^|\s)--?\w)/iu.test(line)) {
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
