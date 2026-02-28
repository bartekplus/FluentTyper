import {
  SPACE_CHARS,
  SPACING_RULES,
  Spacing,
  SpacingRulesHandler,
} from "../src/adapters/chrome/background/SpacingRulesHandler";

describe("SpacingRulesHandler", () => {
  test("exposes spacing constants through static getters", () => {
    expect(SpacingRulesHandler.Spacing).toBe(Spacing);
    expect(SpacingRulesHandler.SPACING_RULES).toBe(SPACING_RULES);
    expect(SpacingRulesHandler.SPACE_CHARS).toBe(SPACE_CHARS);
  });

  test("returns null when rules are disabled, input is empty, or input too short", () => {
    const disabled = new SpacingRulesHandler(true, false);
    const enabled = new SpacingRulesHandler(true, true);

    expect(disabled.applySpacingRules("a .")).toBeNull();
    expect(enabled.applySpacingRules("")).toBeNull();
    expect(enabled.applySpacingRules(".")).toBeNull();
  });

  test("inserts non-breaking space before opening punctuation", () => {
    const handler = new SpacingRulesHandler(true, true);

    expect(handler.applySpacingRules("a(")).toEqual({
      text: "\xA0(",
      length: 1,
    });
  });

  test("removes preceding space and inserts trailing space for sentence punctuation", () => {
    const handler = new SpacingRulesHandler(true, true);

    expect(handler.applySpacingRules("a .")).toEqual({
      text: ".\xA0",
      length: 2,
    });
  });

  test("removes preceding space even when trailing insertion is disabled", () => {
    const handler = new SpacingRulesHandler(false, true);

    expect(handler.applySpacingRules("a .")).toEqual({
      text: ".",
      length: 2,
    });
  });

  test("does not change symbols configured with NO_CHANGE spacing", () => {
    const handler = new SpacingRulesHandler(false, true);

    expect(handler.applySpacingRules("a -")).toBeNull();
  });

  test("skips replacement when the previous-previous character is already a space", () => {
    const handler = new SpacingRulesHandler(true, true);

    expect(handler.applySpacingRules("a  .")).toBeNull();
  });
});
