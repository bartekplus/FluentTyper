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

const OPTIONS: [string, string][] = [
  ["a", "Option A"],
  ["b", "Option B"],
  ["c", "Option C"],
];

describe.each([
  {
    name: "CheckboxControl",
    create: () => new CheckboxControl({ type: "checkbox" }, makeStore()),
    values: [true, false] as unknown[],
    actionValue: true as unknown,
  },
  {
    name: "SliderControl",
    create: () => new SliderControl({ type: "slider", min: 0, max: 100 }, makeStore()),
    values: [42],
    actionValue: 5,
  },
  {
    name: "SelectControl",
    create: () => new SelectControl({ type: "popupButton", options: OPTIONS }, makeStore()),
    values: ["b"],
    actionValue: "c",
  },
  {
    name: "ValueOnlyControl",
    create: () => new ValueOnlyControl({ type: "valueOnly", name: "test-key" }, makeStore()),
    values: [42, ["a", "b"]],
    actionValue: "hello",
  },
])("$name set", ({ create, values, actionValue }) => {
  test("silent set/get round-trip", () => {
    const ctrl = create();
    for (const value of values) {
      ctrl.set(value, true);
      expect(ctrl.get()).toEqual(value);
    }
  });

  test("non-silent set fires action exactly once", () => {
    const ctrl = create();
    const received: unknown[] = [];
    ctrl.addEvent("action", (value) => received.push(value));
    ctrl.set(actionValue, false);
    expect(received).toEqual([actionValue]);
  });

  test("silent set does not fire action", () => {
    const ctrl = create();
    const received: unknown[] = [];
    ctrl.addEvent("action", (value) => received.push(value));
    ctrl.set(actionValue, true);
    expect(received).toEqual([]);
  });
});

describe("CheckboxControl", () => {
  test("get returns false by default", () => {
    const ctrl = new CheckboxControl({ type: "checkbox" }, makeStore());
    expect(ctrl.get()).toBe(false);
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

describe("SliderControl", () => {
  test("get returns 0 by default (no name)", () => {
    const ctrl = new SliderControl({ type: "slider", min: 0, max: 10 }, makeStore());
    expect(ctrl.get()).toBe(0);
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
});

test("the slider label and output point to the range input", () => {
  const slider = new SliderControl(
    { type: "slider", label: "Suggestions", min: 0, max: 10 },
    makeStore(),
  );
  const id = slider.element.id;
  expect(id).not.toBe("");
  expect(slider.rootElement.querySelector("label")?.htmlFor).toBe(id);
  expect(slider.rootElement.querySelector("output")?.getAttribute("for")).toBe(id);
});

describe("SelectControl", () => {
  test("get returns first option by default", () => {
    const ctrl = new SelectControl({ type: "popupButton", options: OPTIONS }, makeStore());
    expect(ctrl.get()).toBe("a");
  });

  test("the label names the select", () => {
    const ctrl = new SelectControl(
      {
        type: "popupButton",
        options: OPTIONS,
        label: "Extension Language:&nbsp;<small>Choose the UI language.</small>",
      },
      makeStore(),
    );

    const label = ctrl.rootElement.querySelector("label")!;
    expect(ctrl.element.id).not.toBe("");
    expect(label.htmlFor).toBe(ctrl.element.id);
    expect(label.textContent).toBe("Extension Language:\u00a0Choose the UI language.");
  });
});

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

describe("DescriptionControl", () => {
  test("renders description text", () => {
    const ctrl = new DescriptionControl({ type: "description", text: "Hello world" }, makeStore());
    expect(ctrl.rootElement.textContent).toContain("Hello world");
  });

  test("get returns description text", () => {
    const ctrl = new DescriptionControl({ type: "description", text: "Some text" }, makeStore());
    expect(ctrl.get()).toBe("Some text");
  });

  test("sanitizes html while preserving allowed markup", () => {
    const ctrl = new DescriptionControl(
      {
        type: "description",
        text: '<div id="safe-root">Hello<script>alert(1)</script><a href="javascript:alert(1)" target="_blank">link</a><strong>world</strong></div>',
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

describe("ValueOnlyControl", () => {
  test("get returns undefined by default", () => {
    const ctrl = new ValueOnlyControl({ type: "valueOnly", name: "test-key" }, makeStore());
    expect(ctrl.get()).toBeUndefined();
  });

  test("rootElement is an empty div", () => {
    const ctrl = new ValueOnlyControl({ type: "valueOnly", name: "test-key" }, makeStore());
    expect(ctrl.rootElement.tagName.toLowerCase()).toBe("div");
    expect(ctrl.rootElement.childElementCount).toBe(0);
  });
});

test("a value-only set starts the storage write before it fires change", () => {
  const writes: unknown[] = [];
  const ctrl = new ValueOnlyControl({ type: "valueOnly", name: "test-key" }, {
    get: async () => undefined,
    set: async (_key: string, value: unknown) => {
      writes.push(value);
    },
  } as unknown as Store);
  const writesAtChange: unknown[][] = [];
  ctrl.addEvent("change", () => writesAtChange.push([...writes]));
  ctrl.set("new");
  expect(writesAtChange).toEqual([["new"]]);
});

test("settings announce persistence only after the storage write finishes", async () => {
  let complete!: () => void;
  const stored = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const ctrl = new ValueOnlyControl({ type: "valueOnly", name: "test-key" }, {
    get: async () => undefined,
    set: () => stored,
  } as unknown as Store);
  const events: unknown[] = [];
  ctrl.addEvent("persisted", (value) => events.push(value));
  ctrl.set({ enabled: true });
  expect(events).toEqual([]);
  complete();
  await stored;
  await Promise.resolve();
  expect(events).toEqual([{ enabled: true }]);
});
