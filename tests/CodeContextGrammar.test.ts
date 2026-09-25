import { afterEach, expect, test } from "bun:test";
import { GRAMMAR_RULE_CATALOG } from "../src/core/domain/grammar/ruleCatalog";
import { measurementEditingContext } from "../src/adapters/chrome/content-script/suggestions/MeasurementEditingContext";
import { SuggestionGrammarCoordinator } from "../src/adapters/chrome/content-script/suggestions/SuggestionGrammarCoordinator";

function fixture(): { root: HTMLDivElement; prose: Text; code: Text } {
  const root = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  Object.defineProperty(root, "isContentEditable", { configurable: true, value: true });
  root.innerHTML = '<p>teh </p><div class="ql-code-block">teh </div>';
  document.body.append(root);
  return {
    root,
    prose: root.firstElementChild!.firstChild as Text,
    code: root.lastElementChild!.firstChild as Text,
  };
}

function select(node: Text): void {
  const range = document.createRange();
  range.setStart(node, node.length);
  range.collapse(true);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
}

function coordinator(enabledGrammarRules?: string[]): SuggestionGrammarCoordinator {
  return new SuggestionGrammarCoordinator({
    enabledGrammarRules:
      enabledGrammarRules ??
      GRAMMAR_RULE_CATALOG.filter((rule) => rule.defaultRollout === "on").map((rule) => rule.id),
    insertSpaceAfterAutocomplete: true,
    lang: "en_US",
    userDictionaryList: [],
  });
}

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

test("default grammar protects Quill code and resumes in prose without reconfiguration", () => {
  const { root, prose, code } = fixture();
  const grammar = coordinator();
  const run = () =>
    grammar.run({
      beforeCursor: "teh ",
      afterCursor: "",
      inputAction: "insert",
      triggers: ["insertChar", "wordBoundary"],
      measurementContext: measurementEditingContext(root),
    });
  select(prose);
  expect(run()).not.toBeNull();
  select(code);
  expect(run()).toBeNull();
  select(prose);
  expect(run()).not.toBeNull();
});

test("all automatic grammar triggers receive code protection from the shared resolver", () => {
  const { root, code } = fixture();
  const grammar = coordinator();
  select(code);
  for (const trigger of ["insertChar", "wordBoundary", "idle", "paste"] as const) {
    expect(
      grammar.run({
        beforeCursor: "teh ",
        afterCursor: "",
        inputAction: "insert",
        triggers: [trigger],
        measurementContext: measurementEditingContext(root),
      }),
    ).toBeNull();
  }
});

test("Enter virtual word-boundary grammar respects the current code region", () => {
  const { root, prose, code } = fixture();
  const grammar = coordinator(["englishTypoWhitelistCorrection"]);
  const run = () =>
    grammar.runVirtualWordBoundary({
      beforeCursor: "teh",
      afterCursor: "",
      measurementContext: measurementEditingContext(root),
    });
  select(prose);
  expect(run()).not.toBeNull();
  select(code);
  expect(run()).toBeNull();
});

test("automatic protection preserves the existing optional code-safe bracket rule", () => {
  const { root, code } = fixture();
  code.textContent = "(";
  select(code);
  const edit = coordinator(["autoBracketClose"]).run({
    beforeCursor: "(",
    afterCursor: "",
    inputAction: "insert",
    triggers: ["insertChar"],
    measurementContext: measurementEditingContext(root),
  });
  expect(edit?.sourceRuleId).toBe("autoBracketClose");
  expect(edit?.replacement).toBe("()");
  expect(
    coordinator([]).run({
      beforeCursor: "(",
      afterCursor: "",
      inputAction: "insert",
      triggers: ["insertChar"],
      measurementContext: measurementEditingContext(root),
    }),
  ).toBeNull();
});
