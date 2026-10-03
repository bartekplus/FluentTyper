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
// ("1-2025-02-30", "2025-02-30-7", "2025-02-30.1") makes it an ID, not a date. Arabic-Indic
// digits count too ("٢٠٢٥-٠٢-٣٠").
const ISO_DATE =
  /(?<![\p{L}\p{N}_]|[\p{L}\p{N}][-./])(?<year>[0-9٠-٩۰-۹]{4})-(?<month>[0-9٠-٩۰-۹]{2})-(?<day>[0-9٠-٩۰-۹]{2})(?![\p{L}\p{N}_]|[-./][\p{L}\p{N}])/gu;

/** "٢٠٢٥" -> 2025. Both Arabic-Indic digit ranges sit 0x90 apart. */
const value = (digits: string) =>
  Number(digits.replace(/[٠-٩۰-۹]/gu, (d) => String((d.charCodeAt(0) - 0x0660) % 0x90)));

/**
 * The ISO dates in the chunk that no calendar has: a month that is 0 or above 12, or a day that
 * is 0 or after the end of the month ("2025-02-30", "2023-02-29"). A date after a version word
 * ("Version 2025-02-30") stays technical.
 */
export function invalidIsoDates(ctx: DetectContext): TextRange[] {
  const ranges: TextRange[] = [];
  for (const m of frameMatches(ctx, ISO_DATE, (match) => match.index)) {
    const year = value(m.groups!.year);
    const month = value(m.groups!.month);
    const day = value(m.groups!.day);
    if (month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month, year)) continue;
    if (versionWordBefore(ctx.text, m.index)) continue;
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
}
