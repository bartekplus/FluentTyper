import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TextTargetAdapter } from "../src/adapters/chrome/content-script/suggestions/TextTargetAdapter";
import { createEditor, setCaret } from "./codeContextTestUtils";
import { createSuggestionEntry, createTextEditService } from "./suggestionTestUtils";

describe("measurement edit transaction", () => {
  let native: typeof document.execCommand;
  beforeEach(() => {
    native = document.execCommand;
    // The preload supplies a DOM-only native editing simulation.
  });
  afterEach(() => {
    document.execCommand = native;
  });
  test("inserts only the separator and retains adjacent rich-text nodes", () => {
    const editable = createEditor("<p><b>Mass: 10</b><i>kg </i></p>");
    setCaret(editable.querySelector("i")!.firstChild!);
    const entry = createSuggestionEntry({ elem: editable });
    const snapshot = TextTargetAdapter.snapshot(editable);

    const result = createTextEditService().applyGrammarEdit(
      entry,
      {
        replacement: "10\u00a0kg ",
        deleteBackwards: 5,
        deleteForwards: 0,
        sourceRuleId: "measurementUnitFormatting",
        strict: true,
      },
      { snapshot },
    );

    expect(result.applied).toBe(true);
    expect(editable.textContent).toBe("Mass: 10\u00a0kg ");
    expect(editable.querySelector("b")?.textContent).toBe("Mass: 10\u00a0");
    expect(editable.querySelector("i")?.textContent).toBe("kg ");
  });

  test("rejects a stale supplied snapshot without writing or scheduling a retry", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.value = "Mass: 10kg ";
    input.selectionStart = input.selectionEnd = input.value.length;
    const snapshot = TextTargetAdapter.snapshot(input);
    input.value = "Mass: 20kg ";
    input.selectionStart = input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });
    let inputs = 0;
    input.addEventListener("input", () => (inputs += 1));

    const result = createTextEditService().applyGrammarEdit(
      entry,
      {
        replacement: "10\u00a0kg ",
        deleteBackwards: 5,
        deleteForwards: 0,
        sourceRuleId: "measurementUnitFormatting",
        strict: true,
      },
      { snapshot },
    );

    expect(result).toEqual({ applied: false, didDispatchInput: false });
    expect(input.value).toBe("Mass: 20kg ");
    expect(inputs).toBe(0);
    expect(entry.pendingExtensionEdit).toBeNull();
  });

  test("leaves Undo of the verified separator insertion to the browser", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.value = "Mass: 10kg ";
    input.selectionStart = input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });
    const editor = createTextEditService();
    expect(
      editor.applyGrammarEdit(entry, {
        replacement: "10\u00a0kg ",
        deleteBackwards: 5,
        deleteForwards: 0,
        sourceRuleId: "measurementUnitFormatting",
        strict: true,
      }).applied,
    ).toBe(true);
    const event = new window.KeyboardEvent("keydown", {
      key: "z",
      metaKey: true,
      cancelable: true,
    });
    const reverted = editor.tryUndoLastExtensionEdit(entry, event, {
      consumeKeyboardEvent: (value) => value.preventDefault(),
      clearSuggestions: () => undefined,
    });
    expect(reverted).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(input.value).toBe("Mass: 10\u00a0kg ");
  });
});
