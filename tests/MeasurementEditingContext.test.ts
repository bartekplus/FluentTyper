import { describe, expect, test } from "bun:test";
import { measurementEditingContext } from "../src/adapters/chrome/content-script/suggestions/MeasurementEditingContext";

describe("measurement editing context", () => {
  test("allows collapsed prose fields and rejects structured or unavailable fields", () => {
    for (const type of ["text", "search", "password", "number", "email", "url", "tel", "date"]) {
      const input = document.createElement("input");
      input.type = type;
      expect(measurementEditingContext(input)).toBe(
        ["text", "search"].includes(type) ? "prose" : "protected",
      );
    }
    const field = document.createElement("textarea");
    field.value = "Mass: 10kg ";
    field.setSelectionRange(0, 3);
    expect(measurementEditingContext(field)).toBe("protected");
    field.setSelectionRange(3, 3);
    expect(measurementEditingContext(field)).toBe("prose");
    field.readOnly = true;
    expect(measurementEditingContext(field)).toBe("protected");
    field.readOnly = false;
    field.setAttribute("inputmode", "decimal");
    expect(measurementEditingContext(field)).toBe("protected");
    const password = document.createElement("input");
    password.type = "text";
    password.autocomplete = "current-password";
    expect(measurementEditingContext(password)).toBe("protected");
  });

  test("rejects code ancestors and code nodes at the caret", () => {
    const pre = document.createElement("pre");
    const field = document.createElement("textarea");
    pre.append(field);
    expect(measurementEditingContext(field)).toBe("protected");
    const editor = document.createElement("div");
    Object.defineProperty(editor, "isContentEditable", { value: true });
    editor.innerHTML = "<code>Mass: 10kg </code>";
    document.body.append(editor);
    const selection = document.getSelection()!;
    selection.collapse(editor.firstChild!.firstChild!, 10);
    expect(measurementEditingContext(editor)).toBe("protected");
    editor.innerHTML = "<b>Mass: 10kg </b>";
    selection.collapse(editor.firstChild!.firstChild!, 10);
    expect(measurementEditingContext(editor)).toBe("prose");
    selection.removeAllRanges();
    editor.remove();
  });
});
