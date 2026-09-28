import { expect, test } from "bun:test";
import { groupOf, hunks } from "./recall";
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

test("recall hunks and groups", () => {
  const t = (s: string) => s.split(" ");
  expect(hunks(t("we was late"), t("we were late"))).toEqual(["1:was→were"]);
  expect(hunks(t("a b c"), t("a b c"))).toEqual([]);
  expect(hunks(t("discussed about it"), t("discussed it"))).toEqual(["1:about→"]);
  expect(groupOf("dense-ok-03")).toBe("control");
  expect(groupOf("dense-para-01")).toBe("dense");
  expect(groupOf("heldout-07")).toBe("heldout");
  expect(groupOf("spec-01")).toBe("trap");
});
