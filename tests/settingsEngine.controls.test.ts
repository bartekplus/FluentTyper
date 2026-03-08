import "./setup";
import { describe, expect, test } from "bun:test";
import { CheckboxControl } from "../src/ui/settings-engine/controls/CheckboxControl.js";
import { SliderControl } from "../src/ui/settings-engine/controls/SliderControl.js";
import { SelectControl } from "../src/ui/settings-engine/controls/SelectControl.js";
import { ButtonControl } from "../src/ui/settings-engine/controls/ButtonControl.js";
import { DescriptionControl } from "../src/ui/settings-engine/controls/DescriptionControl.js";
import { ValueOnlyControl } from "../src/ui/settings-engine/controls/ValueOnlyControl.js";
import { TextControl } from "../src/ui/settings-engine/controls/TextControl.js";
import { TextareaControl } from "../src/ui/settings-engine/controls/TextareaControl.js";
import { RadioControl } from "../src/ui/settings-engine/controls/RadioControl.js";
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
    const ctrl = new SliderControl(
      {
        type: "slider",
        min: 0,
        max: 10,
        displayModifier: (v) => `${v}x`,
      },
      makeStore(),
    );
    // Simulate user dragging the slider (fires "input" event)
    const input = ctrl.element as HTMLInputElement;
    input.value = "5";
    input.dispatchEvent(new Event("input"));
    const tooltip = ctrl.rootElement.querySelector(".slider-tooltip");
    expect(tooltip?.textContent).toBe("5x");
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

// ── TextControl ────────────────────────────────────────────────────────────

describe("TextControl", () => {
  test("get/set round-trip", () => {
    const ctrl = new TextControl({ type: "text" }, makeStore());
    ctrl.set("hello", true);
    expect(ctrl.get()).toBe("hello");
  });

  test("fires action on non-silent set", () => {
    const ctrl = new TextControl({ type: "text" }, makeStore());
    const received: string[] = [];
    ctrl.addEvent("action", (v) => received.push(v as string));
    ctrl.set("world", false);
    expect(received).toEqual(["world"]);
  });

  test("color subtype adds hex label", () => {
    const ctrl = new TextControl({ type: "text", subtype: "color" }, makeStore());
    const hexLabel = ctrl.rootElement.querySelector(".color-hex-label");
    expect(hexLabel).not.toBeNull();
  });

  test("default subtype produces input[type=text]", () => {
    const ctrl = new TextControl({ type: "text" }, makeStore());
    expect((ctrl.element as HTMLInputElement).type).toBe("text");
  });
});

// ── TextareaControl ────────────────────────────────────────────────────────

describe("TextareaControl", () => {
  test("get/set round-trip", () => {
    const ctrl = new TextareaControl({ type: "textarea" }, makeStore());
    ctrl.set("multi\nline", true);
    expect(ctrl.get()).toBe("multi\nline");
  });

  test("element is a textarea", () => {
    const ctrl = new TextareaControl({ type: "textarea" }, makeStore());
    expect(ctrl.element.tagName.toLowerCase()).toBe("textarea");
  });

  test("non-silent set fires action", () => {
    const ctrl = new TextareaControl({ type: "textarea" }, makeStore());
    const received: string[] = [];
    ctrl.addEvent("action", (v) => received.push(v as string));
    ctrl.set("hello", false);
    expect(received).toEqual(["hello"]);
  });

  test("silent set does not fire action", () => {
    const ctrl = new TextareaControl({ type: "textarea" }, makeStore());
    const received: string[] = [];
    ctrl.addEvent("action", (v) => received.push(v as string));
    ctrl.set("hello", true);
    expect(received).toHaveLength(0);
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

  test("setOptions replaces all options and selects value", () => {
    const ctrl = new SelectControl({ type: "popupButton", options: OPTIONS }, makeStore());
    const newOpts: [string, string][] = [
      ["x", "X"],
      ["y", "Y"],
    ];
    ctrl.setOptions(newOpts, "y");
    expect(ctrl.get()).toBe("y");
  });

  test("setOptions with no matching selectedValue selects first", () => {
    const ctrl = new SelectControl({ type: "popupButton", options: OPTIONS }, makeStore());
    ctrl.setOptions([["p", "P"]], undefined);
    expect(ctrl.get()).toBe("p");
  });

  test("fires action on non-silent set", () => {
    const ctrl = new SelectControl({ type: "popupButton", options: OPTIONS }, makeStore());
    const received: string[] = [];
    ctrl.addEvent("action", (v) => received.push(v as string));
    ctrl.set("c", false);
    expect(received).toEqual(["c"]);
  });
});

// ── RadioControl ───────────────────────────────────────────────────────────

describe("RadioControl", () => {
  const OPTIONS: [string, string][] = [
    ["opt1", "Option 1"],
    ["opt2", "Option 2"],
  ];

  test("get returns empty string when nothing is selected", () => {
    const ctrl = new RadioControl({ type: "radioButtons", options: OPTIONS }, makeStore());
    expect(ctrl.get()).toBe("");
  });

  test("set/get round-trip", () => {
    const ctrl = new RadioControl({ type: "radioButtons", options: OPTIONS }, makeStore());
    ctrl.set("opt2", true);
    expect(ctrl.get()).toBe("opt2");
  });

  test("renders radio inputs", () => {
    const ctrl = new RadioControl({ type: "radioButtons", options: OPTIONS }, makeStore());
    const inputs = ctrl.rootElement.querySelectorAll('input[type="radio"]');
    expect(inputs.length).toBe(2);
  });

  test("non-silent set fires action", () => {
    const ctrl = new RadioControl({ type: "radioButtons", options: OPTIONS }, makeStore());
    const received: string[] = [];
    ctrl.addEvent("action", (v) => received.push(v as string));
    ctrl.set("opt1", false);
    expect(received).toEqual(["opt1"]);
  });

  test("silent set does not fire action", () => {
    const ctrl = new RadioControl({ type: "radioButtons", options: OPTIONS }, makeStore());
    const received: string[] = [];
    ctrl.addEvent("action", (v) => received.push(v as string));
    ctrl.set("opt1", true);
    expect(received).toHaveLength(0);
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
