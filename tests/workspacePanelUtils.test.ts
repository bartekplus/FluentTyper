import "./setup";
import { afterEach, describe, expect, jest, test } from "bun:test";
import {
  createSearchInput,
  downloadBlob,
  formatLooseText,
} from "../src/ui/options/workspacePanelUtils";

describe("workspacePanelUtils", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test("createSearchInput builds a search input and reports trimmed lowercase queries", () => {
    const onQuery = jest.fn();
    const input = createSearchInput("Search", "abc", onQuery);
    expect(input.type).toBe("search");
    expect(input.className).toBe("input");
    expect(input.placeholder).toBe("Search");
    expect(input.value).toBe("abc");
    input.value = "  MiXeD ";
    input.dispatchEvent(new Event("input"));
    expect(onQuery).toHaveBeenCalledWith("mixed");
  });

  test("downloadBlob clicks a download link and revokes the object URL after the delay", () => {
    jest.useFakeTimers();
    const originalCreate = window.URL.createObjectURL;
    const originalRevoke = window.URL.revokeObjectURL;
    const createObjectURL = jest.fn(() => "blob:test");
    const revokeObjectURL = jest.fn();
    Object.assign(window.URL, { createObjectURL, revokeObjectURL });
    const clicks: HTMLAnchorElement[] = [];
    jest
      .spyOn(Object.getPrototypeOf(document.createElement("a")) as HTMLAnchorElement, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push(this);
      });
    try {
      const blob = new Blob(["x"], { type: "text/plain" });
      downloadBlob(blob, "file.txt", 1500);

      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(clicks).toHaveLength(1);
      expect(clicks[0].download).toBe("file.txt");
      jest.advanceTimersByTime(1499);
      expect(revokeObjectURL).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(revokeObjectURL).toHaveBeenCalledWith(clicks[0].href);
    } finally {
      Object.assign(window.URL, {
        createObjectURL: originalCreate,
        revokeObjectURL: originalRevoke,
      });
    }
  });

  test("formatLooseText stringifies primitives and falls back otherwise", () => {
    expect(formatLooseText("a")).toBe("a");
    expect(formatLooseText(3)).toBe("3");
    expect(formatLooseText(false)).toBe("false");
    expect(formatLooseText(10n)).toBe("10");
    expect(formatLooseText(null, "n/a")).toBe("n/a");
    expect(formatLooseText({})).toBe("");
  });
});
