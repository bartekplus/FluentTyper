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
    console.warn(
      `Failed to set locale to ${lang} language: ${getErrorMessage(error)}`,
    );
  }

  return now;
}

interface DateTimeVariables {
  time: (lang: string, format?: string) => string;
  date: (lang: string, format?: string) => string;
}

export const DATE_TIME_VARIABLES: DateTimeVariables = {
  time: (lang: string, format?: string): string => {
    const now = getCurrentDateTime(lang);

    if (format) {
      return now.toFormat(format);
    }
    return now.toLocaleString(DateTime.TIME_SIMPLE);
  },
  date: (lang: string, format?: string): string => {
    const now = getCurrentDateTime(lang);

    if (format) {
      return now.toFormat(format);
    }
    return now.toLocaleString(DateTime.DATE_SHORT);
  },
};
