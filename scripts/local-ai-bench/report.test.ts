import { expect, test } from "bun:test";
import { meaningFlags } from "./report";

test("meaning flags", () => {
  expect(meaningFlags("She dont know.", "She doesn't know.")).toEqual([]);
  expect(meaningFlags("Do not enable this.", "Enable this.")).toContain("negation");
  expect(meaningFlags("We measured 6.3 GB.", "We measured 63 GB.")).toEqual(["number"]);
  expect(meaningFlags("It may rain.", "It will rain.")).toEqual(["hedge"]);
  expect(meaningFlags("Ask Anna today.", "Ask Maria today.")).toEqual(["name"]);
  expect(meaningFlags("the build is probably broken again today", "it broke")).toEqual([
    "hedge",
    "drift",
  ]);
});
