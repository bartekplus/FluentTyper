import { jest } from "bun:test";
import { DATE_TIME_VARIABLES } from "../src/core/domain/variables";
import { TemplateExpander } from "../src/adapters/chrome/background/TemplateExpander";

describe("TemplateExpander", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("parseStringTemplateAsync replaces known placeholders", async () => {
    const result = await TemplateExpander.parseStringTemplateAsync(
      "Hello ${name}!",
      async (name) => (name === "name" ? "World" : undefined),
    );

    expect(result).toBe("Hello World!");
  });

  test("parseStringTemplateAsync keeps missing placeholders and preserves empty values", async () => {
    const values: Record<string, string> = { known: "ok", empty: "" };
    const result = await TemplateExpander.parseStringTemplateAsync(
      "${known}-${missing}-${empty}",
      async (name) => values[name],
    );

    expect(result).toBe("ok-${missing}-");
  });

  test("createResolver resolves date/time variables with language and formats", async () => {
    const timeSpy = jest.spyOn(DATE_TIME_VARIABLES, "time").mockReturnValue("10:30");
    const dateSpy = jest.spyOn(DATE_TIME_VARIABLES, "date").mockReturnValue("2026-01-02");

    const resolver = TemplateExpander.createResolver("fr_FR", "HH:mm", "yyyy-MM-dd");
    const result = await TemplateExpander.parseStringTemplateAsync("${time} ${date}", resolver);

    expect(timeSpy).toHaveBeenCalledWith("fr_FR", "HH:mm");
    expect(dateSpy).toHaveBeenCalledWith("fr_FR", "yyyy-MM-dd", undefined);
    expect(result).toBe("10:30 2026-01-02");
  });
});
