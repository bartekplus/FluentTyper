import { describe, expect, test } from "bun:test";
import {
  isOnlyFillers,
  trimTrailingFillers,
} from "../src/adapters/chrome/content-script/suggestions/editorFillers";

describe("editorFillers", () => {
  test("treats empty string and filler-only strings as fillers", () => {
    expect(isOnlyFillers("")).toBe(true);
    expect(isOnlyFillers("\u200B\u200C\u200D\uFEFF\u2060")).toBe(true);
  });

  test("rejects non-filler content", () => {
    expect(isOnlyFillers("a\u2060")).toBe(false);
    expect(isOnlyFillers("\u2060 ")).toBe(false);
  });

  test("trims trailing fillers including word joiner", () => {
    expect(trimTrailingFillers("Hello\u2060")).toBe("Hello");
    expect(trimTrailingFillers("Hello\u200B\u2060")).toBe("Hello");
    expect(trimTrailingFillers("\u2060")).toBe("");
  });
});
