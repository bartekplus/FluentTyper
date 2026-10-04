import { i18n } from "@ui/options/fluenttyperI18n.js";

export function formatMetricNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0";
  }
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(value);
}

function parseDateKey(dateKey: string): Date | null {
  const date = new Date(`${dateKey}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTrendDayLabel(dateKey: unknown): string {
  if (typeof dateKey !== "string") {
    return "";
  }
  const date = parseDateKey(dateKey);
  return date ? new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date) : dateKey;
}

export function formatWeekRange(weekKey: unknown): string {
  if (typeof weekKey !== "string") {
    return "n/a";
  }
  const startDate = parseDateKey(weekKey);
  if (!startDate) {
    return weekKey;
  }
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
}

/** Formats "N accepted • N chars • N min" from a stats record. */
export function formatSavingsSummary(
  stats:
    | { acceptedSuggestions?: unknown; charactersSaved?: unknown; estimatedMinutesSaved?: unknown }
    | undefined,
  separator = " • ",
  unitSeparator = " ",
): string {
  return [
    `${formatMetricNumber(stats?.acceptedSuggestions)}${unitSeparator}${i18n.get("popup_short_accepted")}`,
    `${formatMetricNumber(stats?.charactersSaved)}${unitSeparator}${i18n.get("popup_short_chars")}`,
    `${formatMetricNumber(stats?.estimatedMinutesSaved)}${unitSeparator}${i18n.get("popup_short_minutes")}`,
  ].join(separator);
}
