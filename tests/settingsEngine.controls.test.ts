import "./setup";
import { describe, expect, test } from "bun:test";
import { CheckboxControl } from "../src/ui/settings-engine/controls/CheckboxControl.js";
import { SliderControl } from "../src/ui/settings-engine/controls/SliderControl.js";
import { SelectControl } from "../src/ui/settings-engine/controls/SelectControl.js";
import { ButtonControl } from "../src/ui/settings-engine/controls/ButtonControl.js";
import { DescriptionControl } from "../src/ui/settings-engine/controls/DescriptionControl.js";
import { ValueOnlyControl } from "../src/ui/settings-engine/controls/ValueOnlyControl.js";
import { Store } from "../src/core/application/storage/Store.js";

function makeStore(): Store {
  return new Store("test-controls");
}

// ── CheckboxControl ────────────────────────────────────────────────────────

describe("CheckboxControl", () => {
  test("get returns false by default", () => {
    const ctrl = new CheckboxControl({ type: "checkbox" }, makeStore());
    expect(ctrl.get()).toBe(false);
  });

  test("set/get round-trip", () => {
    const ctrl = new CheckboxControl({ type: "checkbox" }, makeStore());
    ctrl.set(true, true);
    expect(ctrl.get()).toBe(true);
    ctrl.set(false, true);
    expect(ctrl.get()).toBe(false);
  });

  test("fires action event on non-silent set", () => {
    const ctrl = new CheckboxControl({ type: "checkbox" }, makeStore());
    const received: boolean[] = [];
    ctrl.addEvent("action", (v) => received.push(v as boolean));
    ctrl.set(true, false);
    expect(received).toEqual([true]);
  });

  test("silent set does not fire action", () => {
    const ctrl = new CheckboxControl({ type: "checkbox" }, makeStore());
    const received: boolean[] = [];
    ctrl.addEvent("action", (v) => received.push(v as boolean));
    ctrl.set(true, true);
    expect(received).toHaveLength(0);
  });

  test("rootElement has field class", () => {
    const ctrl = new CheckboxControl({ type: "checkbox", label: "Enable" }, makeStore());
    expect(ctrl.rootElement.classList.contains("field")).toBe(true);
  });

  test("element has role=switch", () => {
    const ctrl = new CheckboxControl({ type: "checkbox" }, makeStore());
    expect(ctrl.element.getAttribute("role")).toBe("switch");
  });

  test("label renders when provided", () => {
    const ctrl = new CheckboxControl({ type: "checkbox", label: "My Feature" }, makeStore());
    expect(ctrl.rootElement.textContent).toContain("My Feature");
  });
});

// ── SliderControl ──────────────────────────────────────────────────────────

describe("SliderControl", () => {
  test("get returns 0 by default (no name)", () => {
    const ctrl = new SliderControl({ type: "slider", min: 0, max: 10 }, makeStore());
    expect(ctrl.get()).toBe(0);
  });

  test("set/get round-trip", () => {
    const ctrl = new SliderControl({ type: "slider", min: 0, max: 100 }, makeStore());
    ctrl.set(42, true);
    expect(ctrl.get()).toBe(42);
  });

  test("tooltip text updates when user changes value", () => {
    const ctrl = new SliderControl({ type: "slider", min: 0, max: 10 }, makeStore());
    // Simulate user dragging the slider (fires "input" event)
    const input = ctrl.element as HTMLInputElement;
    input.value = "5";
    input.dispatchEvent(new Event("input"));
    const tooltip = ctrl.rootElement.querySelector(".slider-tooltip");
    expect(tooltip?.textContent).toBe("5");
  });

  test("fires action when user changes value via input event", () => {
    const ctrl = new SliderControl({ type: "slider", min: 0, max: 10 }, makeStore());
    const received: number[] = [];
    ctrl.addEvent("action", (v) => received.push(v as number));
    const input = ctrl.element as HTMLInputElement;
    input.value = "7";
    input.dispatchEvent(new Event("input"));
    expect(received).toEqual([7]);
  });

  test("non-silent set fires action exactly once", () => {
    const ctrl = new SliderControl({ type: "slider", min: 0, max: 10 }, makeStore());
    const received: number[] = [];
    ctrl.addEvent("action", (v) => received.push(v as number));
    ctrl.set(5, false);
    expect(received).toEqual([5]);
  });

  test("silent set does not fire action", () => {
    const ctrl = new SliderControl({ type: "slider", min: 0, max: 10 }, makeStore());
    const received: number[] = [];
    ctrl.addEvent("action", (v) => received.push(v as number));
    ctrl.set(5, true);
    expect(received).toHaveLength(0);
  });

  test("tooltip element is rendered", () => {
    const ctrl = new SliderControl({ type: "slider", min: 0, max: 10 }, makeStore());
    const tooltip = ctrl.rootElement.querySelector(".slider-tooltip");
    expect(tooltip).not.toBeNull();
  });
});

// ── SelectControl ──────────────────────────────────────────────────────────

describe("SelectControl", () => {
  const OPTIONS: [string, string][] = [
    ["a", "Option A"],
    ["b", "Option B"],
    ["c", "Option C"],
  ];

  test("get returns first option by default", () => {
    const ctrl = new SelectControl({ type: "popupButton", options: OPTIONS }, makeStore());
    expect(ctrl.get()).toBe("a");
  });

  test("set/get round-trip", () => {
    const ctrl = new SelectControl({ type: "popupButton", options: OPTIONS }, makeStore());
    ctrl.set("b", true);
    expect(ctrl.get()).toBe("b");
  });

  test("fires action on non-silent set", () => {
    const ctrl = new SelectControl({ type: "popupButton", options: OPTIONS }, makeStore());
    const received: string[] = [];
    ctrl.addEvent("action", (v) => received.push(v as string));
    ctrl.set("c", false);
    expect(received).toEqual(["c"]);
  });

  test("uses plain text for aria-label when label contains helper markup", () => {
    const ctrl = new SelectControl(
      {
        type: "popupButton",
        options: OPTIONS,
        label: "Extension Language:&nbsp;<small>Choose the UI language.</small>",
      },
      makeStore(),
    );

    expect(ctrl.element.getAttribute("aria-label")).toBe(
      "Extension Language: Choose the UI language.",
    );
  });
});

// ── ButtonControl ──────────────────────────────────────────────────────────

describe("ButtonControl", () => {
  test("fires action on click", () => {
    const ctrl = new ButtonControl({ type: "button", text: "Click me" }, makeStore());
    const received: string[] = [];
    ctrl.addEvent("action", (v) => received.push(v as string));
    (ctrl.element as HTMLInputElement).click();
    expect(received).toHaveLength(1);
  });

  test("get returns button text", () => {
    const ctrl = new ButtonControl({ type: "button", text: "Go" }, makeStore());
    expect(ctrl.get()).toBe("Go");
  });

  test("set updates button text", () => {
    const ctrl = new ButtonControl({ type: "button", text: "Go" }, makeStore());
    ctrl.set("Stop");
    expect(ctrl.get()).toBe("Stop");
  });
});

// ── DescriptionControl ─────────────────────────────────────────────────────

describe("DescriptionControl", () => {
  test("renders description text", () => {
    const ctrl = new DescriptionControl(
      { type: "description", description: "Hello world" },
      makeStore(),
    );
    expect(ctrl.rootElement.textContent).toContain("Hello world");
  });

  test("get returns description text", () => {
    const ctrl = new DescriptionControl(
      { type: "description", description: "Some text" },
      makeStore(),
    );
    expect(ctrl.get()).toBe("Some text");
  });

  test("sanitizes html while preserving allowed markup", () => {
    const ctrl = new DescriptionControl(
      {
        type: "description",
        description:
          '<div id="safe-root">Hello<script>alert(1)</script><a href="javascript:alert(1)" target="_blank">link</a><strong>world</strong></div>',
      },
      makeStore(),
    );

    expect(ctrl.rootElement.querySelector("#safe-root")).not.toBeNull();
    expect(ctrl.rootElement.querySelector("script")).toBeNull();
    expect(ctrl.rootElement.querySelector("a")?.getAttribute("href")).toBeNull();
    expect(ctrl.rootElement.querySelector("strong")?.textContent).toBe("world");
    expect(ctrl.rootElement.textContent).toContain("Hello");
  });
});

// ── ValueOnlyControl ───────────────────────────────────────────────────────

describe("ValueOnlyControl", () => {
  test("get returns undefined by default", () => {
    const ctrl = new ValueOnlyControl({ type: "valueOnly", name: "test-key" }, makeStore());
    expect(ctrl.get()).toBeUndefined();
  });

  test("set/get round-trip (silent)", () => {
    const ctrl = new ValueOnlyControl({ type: "valueOnly", name: "test-key" }, makeStore());
    ctrl.set(42, true);
    expect(ctrl.get()).toBe(42);
  });

  test("set with array (silent)", () => {
    const ctrl = new ValueOnlyControl({ type: "valueOnly", name: "test-key" }, makeStore());
    ctrl.set(["a", "b"], true);
    expect(ctrl.get()).toEqual(["a", "b"]);
  });

  test("fires action on non-silent set", () => {
    const ctrl = new ValueOnlyControl({ type: "valueOnly", name: "test-key" }, makeStore());
    const received: unknown[] = [];
    ctrl.addEvent("action", (v) => received.push(v));
    ctrl.set("hello", false);
    expect(received).toEqual(["hello"]);
  });

  test("rootElement is a div (invisible)", () => {
    const ctrl = new ValueOnlyControl({ type: "valueOnly", name: "test-key" }, makeStore());
    expect(ctrl.rootElement.tagName.toLowerCase()).toBe("div");
    expect(ctrl.element.getAttribute("type")).toBe("hidden");
  });
});

// ── destroy ────────────────────────────────────────────────────────────────

describe("BaseControl.destroy()", () => {
  test("removes rootElement from DOM", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const ctrl = new CheckboxControl({ type: "checkbox", label: "Test" }, makeStore());
    container.appendChild(ctrl.rootElement);
    expect(container.contains(ctrl.rootElement)).toBe(true);
    ctrl.destroy();
    expect(container.contains(ctrl.rootElement)).toBe(false);
  });
});
