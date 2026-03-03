import { beforeEach, describe, expect, test } from "bun:test";
import { SuggestionElementDiscovery } from "../src/adapters/chrome/content-script/suggestions/SuggestionElementDiscovery";
import type { SuggestionElement } from "../src/adapters/chrome/content-script/suggestions/types";

describe("SuggestionElementDiscovery", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("returns eligible visible candidates from the document", () => {
    const input = document.createElement("input");
    input.type = "text";
    const hidden = document.createElement("input");
    hidden.type = "text";
    hidden.style.display = "none";
    document.body.appendChild(input);
    document.body.appendChild(hidden);

    const discovery = new SuggestionElementDiscovery({
      selectors: "input",
      isStructurallyEligibleElement: (elem: HTMLElement): elem is SuggestionElement =>
        elem.tagName === "INPUT",
    });

    const candidates = discovery.queryCandidates();
    expect(candidates).toEqual([input]);
  });

  test("includes root element when root matches selectors", () => {
    const rootInput = document.createElement("input");
    rootInput.type = "text";
    document.body.appendChild(rootInput);

    const discovery = new SuggestionElementDiscovery({
      selectors: "input",
      isStructurallyEligibleElement: (elem: HTMLElement): elem is SuggestionElement =>
        elem.tagName === "INPUT",
    });

    const candidates = discovery.queryCandidates(rootInput);
    expect(candidates).toEqual([rootInput]);
  });
});
