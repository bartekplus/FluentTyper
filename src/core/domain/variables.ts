import { DateTime, Settings } from "luxon";
import { getErrorMessage } from "./error";

function getCurrentDateTime(lang: string): DateTime {
  let now = DateTime.now();

  try {
    if (["textExpander", "auto_detect"].includes(lang as string)) {
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

export interface DateTimeVariables {
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

  const sign = match[1] === "+" ? 1 : -1;
  const amount = parseInt(match[2], 10) * sign;
  const unitChar = match[3];

  let unit: string = "days";
  if (unitChar === "d") {
    unit = "days";
  } else if (unitChar === "w") {
    unit = "weeks";
  } else if (unitChar === "m") {
    unit = "months";
  } else if (unitChar === "y") {
    unit = "years";
  }

  return now.plus({ [unit]: amount });
}

export const DATE_TIME_VARIABLES: DateTimeVariables = {
  time: (lang: string, format?: string): string => {
    const now = getCurrentDateTime(lang);

    if (format) {
      return now.toFormat(format);
    }
    return now.toLocaleString(DateTime.TIME_SIMPLE);
  },
  date: (lang: string, format?: string, dateMath?: string): string => {
    let now = getCurrentDateTime(lang);
    now = applyDateMath(now, dateMath);

    if (format) {
      return now.toFormat(format);
    }
    return now.toLocaleString(DateTime.DATE_SHORT);
  },
  datetime: (lang: string, format?: string, dateMath?: string): string => {
    let now = getCurrentDateTime(lang);
    now = applyDateMath(now, dateMath);

    if (format) {
      return now.toFormat(format);
    }
    return now.toLocaleString(DateTime.DATETIME_SHORT);
  },
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
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "00000000-0000-0000-0000-000000000000"; // fallback if crypto unavailable
  }
  if (varName === "random" && arg) {
    const options = arg.split("|");
    if (options.length > 0) {
      const randomIndex = Math.floor(Math.random() * options.length);
      return options[randomIndex];
    }
  }

  return undefined;
}
