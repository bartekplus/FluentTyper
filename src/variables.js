import { DateTime } from "./third_party/luxon/luxon.js";

const DATE_TIME_VARIABLES = {
  time: (lang, format) => {
    const now = DateTime.now().setLocale(lang);
    if (format) {
      return now.toFormat(format);
    }
    return now.toLocaleString(DateTime.TIME_SIMPLE);
  },
  date: (lang, format) => {
    const now = DateTime.now().setLocale(lang);
    if (format) {
      return now.toFormat(format);
    }
    return now.toLocaleString(DateTime.DATE_SHORT);
  },
};

export { DATE_TIME_VARIABLES };
