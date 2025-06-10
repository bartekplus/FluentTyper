import { DateTime } from "../third_party/luxon/luxon.js";

function getCurrentDateTime(lang?: string): DateTime {
  let now = DateTime.now();

  try {
    if (["textExpander", "auto_detect"].includes(lang as string)) {
      lang = undefined;
    }
    new Intl.DateTimeFormat(lang);
    now = DateTime.now().setLocale(lang);
  } catch (error) {
    console.log("Failed to set locale to: " + lang);
    console.log(error);
  }

  return now;
}

interface DateTimeVariables {
  time: (lang?: string, format?: string) => string;
  date: (lang?: string, format?: string) => string;
}

const DATE_TIME_VARIABLES: DateTimeVariables = {
  time: (lang?: string, format?: string): string => {
    const now = getCurrentDateTime(lang);

    if (format) {
      return now.toFormat(format);
    }
    return now.toLocaleString(DateTime.TIME_SIMPLE);
  },
  date: (lang?: string, format?: string): string => {
    const now = getCurrentDateTime(lang);

    if (format) {
      return now.toFormat(format);
    }
    return now.toLocaleString(DateTime.DATE_SHORT);
  },
};

export { DATE_TIME_VARIABLES };
