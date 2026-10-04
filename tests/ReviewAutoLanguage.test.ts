import { resolveReviewLanguage } from "../src/core/domain/lang";

const resolveAutoLanguage = (detected: string | null, enabled: string[], fallback: string) =>
  resolveReviewLanguage("auto_detect", detected, enabled, fallback).language;

describe("resolveAutoLanguage", () => {
  test("preserves identified languages and only uses fallback for uncertainty", () => {
    const enabled = ["en_US", "pl_PL"];
    expect(resolveAutoLanguage("en", enabled, "pl_PL")).toBe("en_US");
    expect(resolveAutoLanguage("pl", enabled, "en_US")).toBe("pl_PL");
    // Identified, but not enabled; unidentified; unsupported.
    expect(resolveAutoLanguage("de", enabled, "pl_PL")).toBe("de_DE");
    expect(resolveAutoLanguage(null, enabled, "pl_PL")).toBe("pl_PL");
    expect(resolveAutoLanguage("ja", enabled, "en_US")).toBe("ja");
  });
});
