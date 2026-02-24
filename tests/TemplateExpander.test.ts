import { jest } from "@jest/globals";
import { DATE_TIME_VARIABLES } from "../src/shared/variables";
import { TemplateExpander } from "../src/background/TemplateExpander";

describe("TemplateExpander", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("parseStringTemplate replaces known placeholders", () => {
    const result = TemplateExpander.parseStringTemplate("Hello ${name}!", {
      name: "World",
    });

    expect(result).toBe("Hello World!");
  });

  test("parseStringTemplate keeps missing placeholders and preserves empty values", () => {
    const result = TemplateExpander.parseStringTemplate(
      "${known}-${missing}-${empty}",
      {
        known: "ok",
        empty: "",
      },
    );

    expect(result).toBe("ok-${missing}-");
  });

  test("getExpandedVariables returns empty object when variable expansion is disabled", () => {
    expect(
      TemplateExpander.getExpandedVariables("en_US", false, "HH:mm", "yyyy"),
    ).toEqual({});
  });

  test("getExpandedVariables uses date/time providers with language and formats", () => {
    const timeSpy = jest
      .spyOn(DATE_TIME_VARIABLES, "time")
      .mockReturnValue("10:30");
    const dateSpy = jest
      .spyOn(DATE_TIME_VARIABLES, "date")
      .mockReturnValue("2026-01-02");

    const result = TemplateExpander.getExpandedVariables(
      "fr_FR",
      true,
      "HH:mm",
      "yyyy-MM-dd",
    );

    expect(timeSpy).toHaveBeenCalledWith("fr_FR", "HH:mm");
    expect(dateSpy).toHaveBeenCalledWith("fr_FR", "yyyy-MM-dd");
    expect(result).toEqual({
      time: "10:30",
      date: "2026-01-02",
    });
  });
});
