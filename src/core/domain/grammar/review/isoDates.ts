import { emphasisOpenLength } from "./markdownEmphasis";
import { daysInMonth } from "./reviewClock";
import type { DetectContext } from "./reviewDetectors";
import type { TextRange } from "./types";
import type { MatchFixer } from "../engine/reviewRules";

/** A version word right before a token: "Version ", "v ", "build ", "Fassung ", "wersja ". */
const VERSION_WORD_BEFORE =
  /(?<![\p{L}\p{N}])(?:version|ver|v|release|build|fassung|versión|versão|wersj[aięąo]|الإصدار|إصدار|النسخة|نسخة|التحديث|تحديث)\.?:?[ \t]{1,4}$/iu;

/** True when a version word comes directly before the token at `start`. */
export const versionWordBefore = (source: string, start: number) =>
  VERSION_WORD_BEFORE.test(source.slice(Math.max(0, start - 24), start));

// An ISO date: a four-digit year, a two-digit month and a two-digit day ("2025-02-30"). The
// frames of the date rules in grammar/rules/*.yaml find it.
/** Regex source: one Western or Arabic-Indic digit. */
export const DIGIT = "[0-9٠-٩۰-۹]";
/** The ISO form alone: a technical token in emphasis ("_2025-02-30_") is a date. */
export const ISO_DATE_TOKEN = new RegExp(`^${DIGIT}{4}-${DIGIT}{2}-${DIGIT}{2}$`, "u");

/** "٢٠٢٥" -> 2025, NaN for a Roman numeral. Both Arabic-Indic digit ranges sit 0x90 apart. */
export const digitValue = (digits: string) =>
  Number(digits.replace(/[٠-٩۰-۹]/gu, (d) => String((d.charCodeAt(0) - 0x0660) % 0x90)));

/**
 * The range of an ISO date match (groups `year`, `month`, `day`) that starts in the chunk and
 * that no calendar has: a month that is 0 or above 12, or a day that is 0 or after the end of
 * the month ("2025-02-30", "2023-02-29"). A date after a version word ("Version 2025-02-30")
 * stays technical. Null for every other match.
 */
export function invalidIsoDate(m: RegExpExecArray, ctx: DetectContext): TextRange | null {
  if (m.index < ctx.from || m.index >= ctx.to) return null;
  const year = digitValue(m.groups!.year);
  const month = digitValue(m.groups!.month);
  const day = digitValue(m.groups!.day);
  if (month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month, year)) return null;
  // Balanced emphasis between the version word and the date: "version **2025-02-30**".
  const end = m.index + m[0].length;
  if (versionWordBefore(ctx.text, m.index - emphasisOpenLength(ctx.text, m.index, end)))
    return null;
  return { start: m.index, end };
}

/** The named frame fixes of grammar/rules/*.yaml (`fixer: common:<name>`). */
export const FIXERS = {
  /** An impossible ISO date: a warning with the rule and message of the frame. */
  invalidIsoDate: (m, ctx, frame) => {
    const range = invalidIsoDate(m, ctx);
    return (
      range && {
        ruleId: frame.ruleId,
        messageKey: frame.messageKey,
        range,
        alternatives: [],
        warningOnly: true,
      }
    );
  },
} satisfies Record<string, MatchFixer>;
