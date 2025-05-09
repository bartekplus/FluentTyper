import { I18n } from "./js/i18n.js";

// SAMPLE
let i18n = new I18n();
i18n = Object.assign(i18n, {
  add_domain: {
    en: "Add new domain URL to list",
  },
  add: {
    en: "Add",
  },
  remove: {
    en: "Remove",
  },
  "x-domain": {
    en: "http://example.com",
  },
  settings: {
    en: "Settings",
  },
  Management: {
    en: "Management",
  },
  search: {
    en: "Search",
  },
  "nothing-found": {
    en: "No matches were found.",
  },
  General: {
    en: "General",
  },
  information: {
    en: "Information",
  },
  login: {
    en: "Login",
  },
  username: {
    en: "Username:",
  },
  password: {
    en: "Password:",
  },
  "x-characters": {
    en: "6 - 12 characters",
  },
  "x-characters-pw": {
    en: "10 - 18 characters",
  },
  "description-url": {
    en: "Regexp are accepted (see <a href='https://www.w3schools.com/jsref/jsref_match.asp'>JavaScript String match() Method</a>)",
  },
  logout: {
    en: "Logout",
  },
  enable: {
    en: "Enable",
  },
  About: {
    en: "About",
  },
  Credits: {
    en: "Credits",
  },
  "x-FluentTyper": {
    en: "The fastest way to contact me or report a bug in FluentTyper is by creating an issue on <a href='https://github.com/bartekplus/FluentTyper'>GitHub</a>.",
  },
  "x-Credits": {
    en: "With special thanks to: ",
  },
  showIcon: {
    en: "Show icon in location bar",
  },
});

export { i18n };
