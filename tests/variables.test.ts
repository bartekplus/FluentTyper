import { jest } from "bun:test";
import { DateTime, Settings } from "luxon";
import { DATE_TIME_VARIABLES } from "../src/core/domain/variables";

describe("shared date/time variables", () => {
  const fixedNow = DateTime.utc(2026, 1, 2, 3, 4, 5);
  const defaultLocale = Settings.defaultLocale;

  beforeEach(() => {
    jest.spyOn(DateTime, "now").mockImplementation(() => fixedNow as DateTime<true>);
    Settings.defaultLocale = defaultLocale;
  });

  afterEach(() => {
    Settings.defaultLocale = defaultLocale;
    jest.restoreAllMocks();
  });

  test("formats time and date with custom formats", () => {
    expect(DATE_TIME_VARIABLES.time("en_US", "HH:mm")).toBe("03:04");
    expect(DATE_TIME_VARIABLES.date("en_US", "yyyy-MM-dd")).toBe("2026-01-02");
  });

  test("normalizes underscores in locale tags before applying locale", () => {
    const setLocaleSpy = jest.spyOn(DateTime.prototype, "setLocale");

    DATE_TIME_VARIABLES.time("en_US");

    expect(setLocaleSpy).toHaveBeenCalledWith("en-US");
  });

  test("uses default locale for auto-detect and text expander pseudo-languages", () => {
    Settings.defaultLocale = "pl_PL";
    const setLocaleSpy = jest.spyOn(DateTime.prototype, "setLocale");

    DATE_TIME_VARIABLES.date("auto_detect");
    DATE_TIME_VARIABLES.time("textExpander");

    expect(setLocaleSpy).toHaveBeenCalledWith("pl-PL");
  });

  test("warns and falls back when language input cannot be normalized", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const time = DATE_TIME_VARIABLES.time(null as unknown as string, "HH:mm");

    expect(time).toBe("03:04");
    expect(warnSpy).toHaveBeenCalled();
  });
});
