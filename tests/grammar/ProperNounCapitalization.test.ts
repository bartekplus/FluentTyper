import { describe, expect, test } from "bun:test";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import { applyGrammarEditToContext } from "../../src/core/domain/grammar/GrammarEditSequencing";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import { DEFAULT_CURRENT_GRAMMAR_RULES } from "../../src/core/domain/grammar/ruleCatalog";
import type { GrammarContext } from "../../src/core/domain/grammar/types";

const RULE = "englishProperNounCapitalization";
const DEFAULTS: string[] = DEFAULT_CURRENT_GRAMMAR_RULES;
const DEFAULTS_WITHOUT_RULE = DEFAULTS.filter((id) => id !== RULE);

/** Types `input` one keystroke at a time through `rules`. */
function type(input: string, rules: string[], hints: GrammarContext["hints"] = {}): string {
  const engine = new GrammarRuleEngine();
  for (const item of createGrammarRuleCatalogRuntime({
    insertSpaceAfterAutocomplete: true,
    userDictionaryList: [],
  })) {
    engine.registerRule(item);
  }
  let state: GrammarContext = {
    beforeCursor: "",
    afterCursor: "",
    hints: { lang: "en_US", inputAction: "insert", ...hints },
  };
  for (const char of input) {
    state.beforeCursor += char;
    const events: ("insertChar" | "wordBoundary")[] =
      char === " " || char === "\n" ? ["wordBoundary"] : ["insertChar"];
    if (/[.!?]/.test(char)) events.push("wordBoundary");
    const edit = engine.processSequence(events, state, rules);
    if (edit) state = applyGrammarEditToContext(state, edit);
  }
  return state.beforeCursor + state.afterCursor;
}

function expectFixed(input: string, expected: string): void {
  expect(type(input, [RULE])).toBe(expected);
  expect(type(input, DEFAULTS)).toBe(type(expected, DEFAULTS_WITHOUT_RULE));
}

/** The rule changes nothing on its own nor in the default pipeline. */
function expectUnchanged(input: string, hints: GrammarContext["hints"] = {}): void {
  expect(type(input, [RULE], hints)).toBe(input);
  expect(type(input, DEFAULTS, hints)).toBe(type(input, DEFAULTS_WITHOUT_RULE, hints));
}

describe("English proper noun capitalization", () => {
  test("is on in the production default selection", () => {
    expect(DEFAULTS).toContain(RULE);
  });

  test("capitalizes days, unambiguous months, holidays and continents", () => {
    expectFixed("see you on monday ", "see you on Monday ");
    expectFixed("see you on friday. ", "see you on Friday. ");
    expectFixed("due in january, ok ", "due in January, ok ");
    expectFixed("we met in december ", "we met in December ");
    expectFixed("happy easter!", "happy Easter!");
    expectFixed("we love halloween ", "we love Halloween ");
    expectFixed("a trip to europe ", "a trip to Europe ");
    expectFixed("across africa and asia ", "across Africa and Asia ");
    expectFixed("the mondays are long ", "the Mondays are long ");
    expectFixed("easter's coming ", "Easter's coming ");
    expectFixed("mid-january sales ", "mid-January sales ");
  });

  test("capitalizes multi-word holidays and regions", () => {
    expectFixed("on christmas eve ", "on Christmas Eve ");
    expectFixed("on new year's day ", "on New Year's Day ");
    expectFixed("on new year’s eve ", "on New Year’s Eve ");
    expectFixed("valentine's day plans ", "Valentine's Day plans ");
    expectFixed("in north america ", "in North America ");
    expectFixed("in south america ", "in South America ");
  });

  test("capitalizes may, march and august only in a date context", () => {
    expectFixed("see you in may, ok ", "see you in May, ok ");
    expectFixed("due in may and june ", "due in May and June ");
    expectFixed("since march this year ", "since March this year ");
    expectFixed("may 15 works ", "May 15 works ");
    expectFixed("on march 3rd we ", "on March 3rd we ");
    expectFixed("from august 2026 on ", "from August 2026 on ");
    expectFixed("the 3rd of may. ", "the 3rd of May. ");
    expectFixed("on 15 august, we ", "on 15 August, we ");
    expectFixed("mid-march is busy ", "mid-March is busy ");
    expectFixed("Dates: march 10 ", "Dates: March 10 ");
    expectFixed("due (march 10) ", "due (March 10) ");
    expectFixed("due by march 10 ", "due by March 10 ");
  });

  test("leaves the verb and adjective senses alone", () => {
    expectUnchanged("it may happen ");
    expectUnchanged("this may happen ");
    expectUnchanged("you may go ");
    expectUnchanged("logging in may fail ");
    expectUnchanged("only 3 may enter ");
    expectUnchanged("we march forward ");
    expectUnchanged("march on! ");
    expectUnchanged("we march 10 miles ");
    expectUnchanged("an august institution ");
    expectUnchanged("men of august bearing ");
    expectUnchanged("users logging in may or may not see it ");
    expectUnchanged("now that you're in may I ask ");
    expectUnchanged("only 2 may or may not attend ");
    expectUnchanged("we'll march 10 miles ");
    expectUnchanged("they'd march 5 km ");
    expectUnchanged("don't march 2 abreast ");
    expectUnchanged("soldiers march 10 miles ");
    // Known miss: no date word before "march".
    expectUnchanged("deadline march 10 ");
  });

  test("leaves seasons, directions, titles and ambiguous holidays alone", () => {
    expectUnchanged("last summer we ");
    expectUnchanged("drive west now ");
    expectUnchanged("the president spoke ");
    expectUnchanged("a memorial day for the family ");
    expectUnchanged("my mother's day was busy ");
    expectUnchanged("Saturday is boxing day at the club ");
    expectFixed("have a good friday ", "have a good Friday ");
  });

  test("leaves typed casing, technical tokens and other languages alone", () => {
    expectUnchanged("MONDAY is here ");
    expectUnchanged("mOnday is here ");
    expectUnchanged("@monday hi ");
    expectUnchanged("#december hi ");
    expectUnchanged("see ./june now ");
    expectUnchanged("see files/june now ");
    expectUnchanged("my_monday hi ");
    expectUnchanged("mondays_ ");
    expectUnchanged("in `monday` ");
    expectUnchanged("dismay 15 ");
    expectUnchanged("https://cal.example.com/?month=june ");
    expectUnchanged("day:monday ");
    expectUnchanged("see monday.com now ");
    expectUnchanged("open june.pdf now ");
    expectUnchanged("visit europe.eu today ");
    expect(type("see you on monday ", [RULE], { lang: "de_DE" })).toBe("see you on monday ");
  });

  test("fixes a name before a bare period only after a date word or on the next key", () => {
    expectFixed("see you on monday.", "see you on Monday.");
    expectFixed("due by friday.", "due by Friday.");
    expectFixed("see you on christmas eve.", "see you on Christmas Eve.");
    expectFixed("the 3rd of may. ", "the 3rd of May. ");
    expectUnchanged("the 3rd of may.");
    expectUnchanged("see monday.");
    expectUnchanged("see monday.com ");
    expectUnchanged("open june.pdf now ");
    expectUnchanged("visit europe.eu today ");
  });

  test("only looks at the text near the cursor in long documents", () => {
    const long = `${"word ".repeat(20_000)}see you on monday `;
    const engine = new GrammarRuleEngine();
    for (const item of createGrammarRuleCatalogRuntime({
      insertSpaceAfterAutocomplete: true,
      userDictionaryList: [],
    })) {
      engine.registerRule(item);
    }
    const edit = engine.processSequence(
      ["wordBoundary"],
      { beforeCursor: long, afterCursor: "", hints: { lang: "en_US" } },
      [RULE],
    );
    expect(edit?.replacement).toBe("Monday ");
  });

  test("respects the user dictionary", () => {
    const engine = new GrammarRuleEngine();
    for (const item of createGrammarRuleCatalogRuntime({
      insertSpaceAfterAutocomplete: true,
      userDictionaryList: ["monday"],
    })) {
      engine.registerRule(item);
    }
    const edit = engine.processSequence(
      ["wordBoundary"],
      { beforeCursor: "on monday ", afterCursor: "", hints: { lang: "en_US" } },
      [RULE],
    );
    expect(edit).toBeNull();
  });
});
