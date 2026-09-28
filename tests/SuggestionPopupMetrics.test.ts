import { describe, expect, jest, test } from "bun:test";
import { themeScaleFromValues } from "../src/core/domain/suggestionPopup/metrics";

describe("themeScaleFromValues", () => {
  test("reads px, rem and em itself and asks the resolver for any other CSS length", () => {
    const resolve = jest.fn((value: string, property: string) =>
      value === "calc(1rem + 2px)" && property === "font-size" ? 18 : null,
    );

    const scale = themeScaleFromValues(
      { fontSize: "calc(1rem + 2px)", paddingVertical: "0.6rem", paddingHorizontal: "0.8rem" },
      resolve,
    );

    // 18px against the 0.9rem (14.4px) reference, clamped to 1.2.
    expect(scale).toEqual({ fontSize: 1.2, paddingVertical: 1, paddingHorizontal: 1 });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  test("uses scale 1 for lengths nothing can resolve", () => {
    expect(
      themeScaleFromValues({
        fontSize: "1vw",
        paddingVertical: "0.6rem",
        paddingHorizontal: "0.8rem",
      }).fontSize,
    ).toBe(1);
  });
});
