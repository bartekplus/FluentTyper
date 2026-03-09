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
      isEligibleElement: (elem: HTMLElement): elem is SuggestionElement => elem.tagName === "INPUT",
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
      isEligibleElement: (elem: HTMLElement): elem is SuggestionElement => elem.tagName === "INPUT",
    });

    const candidates = discovery.queryCandidates(rootInput);
    expect(candidates).toEqual([rootInput]);
  });

  // Regression: querySelectorAll does not pierce shadow roots;
  // deepQuerySelectorAll must recurse into each open shadowRoot.
  test("discovers eligible input inside an open shadow root via full scan", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const shadowInput = document.createElement("input");
    shadowInput.type = "text";
    shadow.appendChild(shadowInput);

    // Naive querySelectorAll("input") on the document would miss this element:
    expect(document.querySelectorAll("input").length).toBe(0);

    const discovery = new SuggestionElementDiscovery({
      selectors: "input",
      isEligibleElement: (elem: HTMLElement): elem is SuggestionElement => elem.tagName === "INPUT",
    });

    const candidates = discovery.queryCandidates();
    expect(candidates).toContain(shadowInput);

    host.remove();
  });

  test("calls onShadowRootDiscovered for each open shadow root encountered", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const shadowInput = document.createElement("input");
    shadowInput.type = "text";
    shadow.appendChild(shadowInput);

    const discovered: ShadowRoot[] = [];
    const discovery = new SuggestionElementDiscovery({
      selectors: "input",
      isEligibleElement: (elem: HTMLElement): elem is SuggestionElement => elem.tagName === "INPUT",
      onShadowRootDiscovered: (root) => discovered.push(root),
    });

    discovery.queryCandidates();
    expect(discovered).toContain(shadow);

    host.remove();
  });

  test("queryCandidates(host) scans inside the host's shadow root", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const shadowInput = document.createElement("input");
    shadowInput.type = "text";
    shadow.appendChild(shadowInput);

    const discovery = new SuggestionElementDiscovery({
      selectors: "input",
      isEligibleElement: (elem: HTMLElement): elem is SuggestionElement => elem.tagName === "INPUT",
    });

    const candidates = discovery.queryCandidates(host);
    expect(candidates).toContain(shadowInput);

    host.remove();
  });

  test("discovers inputs nested in doubly-recursive shadow trees", () => {
    const outerHost = document.createElement("div");
    document.body.appendChild(outerHost);
    const outerShadow = outerHost.attachShadow({ mode: "open" });
    const innerHost = document.createElement("div");
    outerShadow.appendChild(innerHost);
    const innerShadow = innerHost.attachShadow({ mode: "open" });
    const deepInput = document.createElement("input");
    deepInput.type = "text";
    innerShadow.appendChild(deepInput);

    const discovered: ShadowRoot[] = [];
    const discovery = new SuggestionElementDiscovery({
      selectors: "input",
      isEligibleElement: (elem: HTMLElement): elem is SuggestionElement => elem.tagName === "INPUT",
      onShadowRootDiscovered: (root) => discovered.push(root),
    });

    const candidates = discovery.queryCandidates();
    expect(candidates).toContain(deepInput);
    expect(discovered).toContain(outerShadow);
    expect(discovered).toContain(innerShadow);

    outerHost.remove();
  });
});
