import { describe, expect, test } from "bun:test";
import { SuggestionTextEditService } from "../src/adapters/chrome/content-script/suggestions/SuggestionTextEditService";
import { TextTargetAdapter } from "../src/adapters/chrome/content-script/suggestions/TextTargetAdapter";
import { createSuggestionEntry } from "./suggestionTestUtils";

function service(): SuggestionTextEditService {
  return new SuggestionTextEditService({
    findMentionToken: (text) => ({ token: text, start: 0 }),
    isSeparator: (value) => /\s/.test(value),
  });
}

function setCursor(node: Text, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("measurement edit transaction", () => {
  test("inserts only the separator and retains adjacent rich-text nodes", () => {
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    editable.innerHTML = "<p><b>Mass: 10</b><i>kg </i></p>";
    document.body.appendChild(editable);
    const unit = editable.querySelector("i")!.firstChild as Text;
    setCursor(unit, unit.length);
    const entry = createSuggestionEntry({ elem: editable });
    const snapshot = TextTargetAdapter.snapshot(editable);

    const result = service().applyGrammarEdit(
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
    input.value = "Mass: 10kg ";
    input.selectionStart = input.selectionEnd = input.value.length;
    const snapshot = TextTargetAdapter.snapshot(input);
    input.value = "Mass: 20kg ";
    input.selectionStart = input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });
    let inputs = 0;
    input.addEventListener("input", () => (inputs += 1));

    const result = service().applyGrammarEdit(
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

  test("supports immediate revert of the verified separator insertion", () => {
    const input = document.createElement("input");
    input.value = "Mass: 10kg ";
    input.selectionStart = input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });
    const editor = service();
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
    expect(reverted).toBe(true);
    expect(input.value).toBe("Mass: 10kg ");
  });
});
