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
      /^[A-Z]$/.test(prefixAndExpression.slice(parsed.unitStart)) ||
      !isProsePrefix(prefixAndExpression.slice(0, parsed.start))
    ) {
      return null;
    }

    return {
      replacement: `${prefixAndExpression.slice(parsed.start, parsed.numberEnd)}${locale.separator}${prefixAndExpression.slice(parsed.unitStart)}${trailing}`,
      deleteBackwards: context.beforeCursor.length - parsed.start,
      deleteForwards: 0,
    };
  }
}

function isProsePrefix(prefix: string): boolean {
  const lineStart = Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf("\r")) + 1;
  if (/\p{Bidi_Control}|`|~~~/u.test(prefix)) {
    return false;
  }
  const line = prefix.slice(lineStart);
  if (
    /(?:^|[;\s])(?:(?:min|max)-)?(?:width|height|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|font(?:-[a-z]+)?|line-height|gap|inset|top|right|bottom|left|border(?:-[a-z]+)?|stroke(?:-[a-z]+)?)\s*:/iu.test(
      line,
    )
  )
    return false;
  if (
    /^\s*(?:sudo|doas|git|npm|npx|bun|node|python\d*|pip\d*|curl|wget|echo|printf|export|let|const|var|return|import|docker|kubectl|cargo|apt|brew)(?:\s|$)/u.test(
      line,
    )
  ) {
    return false;
  }
  if (!/\p{L}/u.test(line) || /(?:https?:\/\/|www\.|[\\/]|[`{}[\]$]|(?:^|\s)--?\w)/iu.test(line)) {
    return false;
  }
  return /(?:[:：]\s*|\p{L}[\p{L}\p{M}'’.-]*\s+)$/u.test(line);
}
