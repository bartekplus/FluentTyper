import { DateTime, Settings } from "luxon";
import { getErrorMessage } from "./error";
import { randomUUID } from "./randomId";

function getCurrentDateTime(lang: string): DateTime {
  let now = DateTime.now();

  try {
    if (["textExpander", "auto_detect"].includes(lang)) {
      lang = Settings.defaultLocale;
    }
    // Convert underscores to hyphens for valid BCP 47 locale tags
    const normalizedLang = lang.replace(/_/g, "-");
    now = DateTime.now().setLocale(normalizedLang);
  } catch (error) {
    console.warn(`Failed to set locale to ${lang} language: ${getErrorMessage(error)}`);
  }

  return now;
}

interface DateTimeVariables {
  time: (lang: string, format?: string) => string;
  date: (lang: string, format?: string, dateMath?: string) => string;
  datetime: (lang: string, format?: string, dateMath?: string) => string;
}

function applyDateMath(now: DateTime, mathArg?: string): DateTime {
  if (!mathArg) {
    return now;
  }
  const match = mathArg.match(/^([+-])(\d+)([dwmy])$/);
  if (!match) {
    return now;
  }

  const amount = parseInt(match[2], 10) * (match[1] === "+" ? 1 : -1);
  const unit = { d: "days", w: "weeks", m: "months", y: "years" }[
    match[3] as "d" | "w" | "m" | "y"
  ];
  return now.plus({ [unit]: amount });
}

function formatDateTime(
  now: DateTime,
  format: string | undefined,
  fallback: Intl.DateTimeFormatOptions,
): string {
  return format ? now.toFormat(format) : now.toLocaleString(fallback);
}

export const DATE_TIME_VARIABLES: DateTimeVariables = {
  time: (lang, format) => formatDateTime(getCurrentDateTime(lang), format, DateTime.TIME_SIMPLE),
  date: (lang, format, dateMath) =>
    formatDateTime(applyDateMath(getCurrentDateTime(lang), dateMath), format, DateTime.DATE_SHORT),
  datetime: (lang, format, dateMath) =>
    formatDateTime(
      applyDateMath(getCurrentDateTime(lang), dateMath),
      format,
      DateTime.DATETIME_SHORT,
    ),
};

export function resolveDynamicVariable(
  varName: string,
  arg: string | undefined,
  lang: string,
  timeFormat?: string,
  dateFormat?: string,
): string | undefined {
  if (varName === "time") {
    return DATE_TIME_VARIABLES.time(lang, timeFormat);
  }
  if (varName === "date") {
    // If arg exists, it might be +1d or something else. We assume date math.
    return DATE_TIME_VARIABLES.date(lang, dateFormat, arg);
  }
  if (varName === "datetime") {
    return DATE_TIME_VARIABLES.datetime(
      lang,
      dateFormat ? `${dateFormat} '${timeFormat || ""}'` : undefined,
      arg,
    );
  }
  if (varName === "uuid") {
    return randomUUID();
  }
  if (varName === "random" && arg) {
    const options = arg.split("|");
    return options[Math.floor(Math.random() * options.length)];
  }

  return undefined;
}
