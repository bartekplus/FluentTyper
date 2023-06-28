import { DateTime } from "./third_party/luxon/luxon.js";

const DATE_TIME_VARIABLES = {
  time: (lang, format) => {
    let now = DateTime.now();

    try {
      new Intl.DateTimeFormat(lang);
      now = DateTime.now().setLocale(lang);
    } catch (error) {
      console.log("Failed to set locatle to: " + lang);
      console.log(error);
    }
    if (format) {
      return now.toFormat(format);
    }
    return now.toLocaleString(DateTime.TIME_SIMPLE);
  },
  date: (lang, format) => {
    let now = DateTime.now();

    try {
      new Intl.DateTimeFormat(lang);
      now = DateTime.now().setLocale(lang);
    } catch (error) {
      console.log("Failed to set locatle to: " + lang);
      console.log(error);
    }
    if (format) {
      return now.toFormat(format);
    }
    return now.toLocaleString(DateTime.DATE_SHORT);
  },
};

export { DATE_TIME_VARIABLES };
