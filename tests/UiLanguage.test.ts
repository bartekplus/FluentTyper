import { describe, expect, test } from "bun:test";
import { resolveUiLanguage } from "../src/core/domain/lang";

describe("resolveUiLanguage", () => {
  test("uses the Extension UI Language setting, or the browser's when it is auto", () => {
    expect(resolveUiLanguage("de_DE", "en-US")).toBe("de_DE");
    expect(resolveUiLanguage("auto_detect", "fr-FR")).toBe("fr-FR");
    expect(resolveUiLanguage(undefined, "pl")).toBe("pl");
    expect(resolveUiLanguage(undefined, "")).toBe("en");
  });
});
