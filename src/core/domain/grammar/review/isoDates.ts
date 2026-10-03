import { emphasisOpenLength, NO_WORD_AFTER, NO_WORD_BEFORE } from "./markdownEmphasis";
import { frameMatches } from "./phraseTemplates";
import { daysInMonth } from "./reviewClock";
import type { DetectContext } from "./reviewDetectors";
import type { TextRange } from "./types";

/** A version word right before a token: "Version ", "v ", "build ", "Fassung ", "wersja ". */
const VERSION_WORD_BEFORE =
  /(?<![\p{L}\p{N}])(?:version|ver|v|release|build|fassung|versión|versão|wersj[aięąo]|الإصدار|إصدار|النسخة|نسخة|التحديث|تحديث)\.?:?[ \t]{1,4}$/iu;

/** True when a version word comes directly before the token at `start`. */
export const versionWordBefore = (source: string, start: number) =>
  VERSION_WORD_BEFORE.test(source.slice(Math.max(0, start - 24), start));

// An ISO date: a four-digit year, a two-digit month and a two-digit day ("2025-02-30"). The
// year first makes the form clear in each language. A fourth numeric part before or after
// ("1-2025-02-30", "2025-02-30-7", "2025-02-30.1") makes it an ID, not a date. Markdown
// emphasis around the date is not a word ("_2025-02-30_"); an underscore glued to a word is
// ("build_2025-02-30_x").
const ISO_DATE = new RegExp(
  `${NO_WORD_BEFORE}(?<![\\p{L}\\p{N}][-./])(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})${NO_WORD_AFTER}(?![-./][\\p{L}\\p{N}])`,
  "gu",
);
/** The ISO form alone: a technical token in emphasis ("_2025-02-30_") is a date. */
export const ISO_DATE_TOKEN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * The ISO dates in the chunk that no calendar has: a month that is 0 or above 12, or a day that
 * is 0 or after the end of the month ("2025-02-30", "2023-02-29"). A date after a version word
 * ("Version 2025-02-30") stays technical.
 */
export function invalidIsoDates(ctx: DetectContext): TextRange[] {
  const ranges: TextRange[] = [];
  for (const m of frameMatches(ctx, ISO_DATE, (match) => match.index)) {
    const year = Number(m.groups!.year);
    const month = Number(m.groups!.month);
    const day = Number(m.groups!.day);
    if (month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month, year)) continue;
    // Balanced emphasis between the version word and the date: "version **2025-02-30**".
    const end = m.index + m[0].length;
    if (versionWordBefore(ctx.text, m.index - emphasisOpenLength(ctx.text, m.index, end))) continue;
    ranges.push({ start: m.index, end });
  }
  return ranges;
}
