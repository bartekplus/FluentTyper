import { jest } from "bun:test";
import { DateTime, Settings } from "luxon";
import { DATE_TIME_VARIABLES, resolveDynamicVariable } from "../src/core/domain/variables";

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

  test("applies date math in days, weeks, months and years; ignores malformed math", () => {
    const date = (math?: string) => DATE_TIME_VARIABLES.date("en_US", "yyyy-MM-dd", math);
    expect(date("+1d")).toBe("2026-01-03");
    expect(date("-2w")).toBe("2025-12-19");
    expect(date("+1m")).toBe("2026-02-02");
    expect(date("-1y")).toBe("2025-01-02");
    expect(date("+1x")).toBe("2026-01-02");
    expect(date("1d")).toBe("2026-01-02");
    expect(DATE_TIME_VARIABLES.datetime("en_US", "yyyy-MM-dd HH:mm", "+1d")).toBe(
      "2026-01-03 03:04",
    );
  });

  test("resolveDynamicVariable picks random options and ignores unknown names", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.99);
    expect(resolveDynamicVariable("random", "a|b|c", "en_US")).toBe("c");
    expect(resolveDynamicVariable("random", "only", "en_US")).toBe("only");
    expect(resolveDynamicVariable("random", undefined, "en_US")).toBeUndefined();
    expect(resolveDynamicVariable("nope", "x", "en_US")).toBeUndefined();
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
