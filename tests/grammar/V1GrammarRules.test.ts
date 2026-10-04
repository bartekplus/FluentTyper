import { describe, expect, test } from "bun:test";
import { context, edit, typeText } from "./grammarTestUtils";
import { CapitalizeSentenceStartRule } from "../../src/core/domain/grammar/implementations/CapitalizeSentenceStartRule";
import { CapitalizeAfterLineBreakRule } from "../../src/core/domain/grammar/implementations/CapitalizeAfterLineBreakRule";
import { CommaPeriodSpacingRule } from "../../src/core/domain/grammar/implementations/CommaPeriodSpacingRule";
import { OpeningBracketSpacingRule } from "../../src/core/domain/grammar/implementations/OpeningBracketSpacingRule";
import { ClosingBracketSpacingRule } from "../../src/core/domain/grammar/implementations/ClosingBracketSpacingRule";
import { SlashContextSpacingRule } from "../../src/core/domain/grammar/implementations/SlashContextSpacingRule";
import { MathOperatorSpacingRule } from "../../src/core/domain/grammar/implementations/MathOperatorSpacingRule";
import { TechnicalTokenCompactionRule } from "../../src/core/domain/grammar/implementations/TechnicalTokenCompactionRule";
import { CollapseRepeatedSpacesRule } from "../../src/core/domain/grammar/implementations/CollapseRepeatedSpacesRule";
import { TrimSpaceBeforeLineBreakRule } from "../../src/core/domain/grammar/implementations/TrimSpaceBeforeLineBreakRule";
import { ZERO_WIDTH_FILLER_CHARS } from "../../src/core/domain/spacingRules";

describe("V1 grammar rules", () => {
  describe("CapitalizeSentenceStartRule", () => {
    test("capitalizes sequence start and sentence start after punctuation", () => {
      const rule = new CapitalizeSentenceStartRule();

      expect(rule.apply(context("hello "))).toEqual(edit("Hello ", 6));

      expect(rule.apply(context("Hello. world "))).toEqual(edit("World ", 6));

      expect(rule.apply(context("hello,\n"))).toEqual(edit("Hello,\n", 7));
    });

    test("supports optional closing quotes/brackets after sentence punctuation", () => {
      const rule = new CapitalizeSentenceStartRule();
      expect(rule.apply(context('Hello." world '))).toEqual(edit("World ", 6));
    });

    test("waits for the word boundary", () => {
      const rule = new CapitalizeSentenceStartRule();
      expect(rule.apply(context("h"))).toBeNull();
      expect(rule.apply(context("Hello. w"))).toBeNull();
      expect(rule.apply(context("hello  "))).toBeNull();
    });

    test("does not capitalize without sentence boundary gap", () => {
      const rule = new CapitalizeSentenceStartRule();
      expect(rule.apply(context("Hello.w "))).toBeNull();
      expect(rule.apply(context("Hello, w "))).toBeNull();
    });

    test("leaves technical tokens alone", () => {
      const rule = new CapitalizeSentenceStartRule();
      for (const token of ["user.save()", "node.js", "google.com", "@john.doe", "src/index.ts"]) {
        expect(rule.apply(context(`${token} `))).toBeNull();
        expect(rule.apply(context(`Done. ${token} `))).toBeNull();
      }
    });

    test("capitalizes Unicode letters", () => {
      const rule = new CapitalizeSentenceStartRule();
      expect(rule.apply(context("ż "))?.replacement).toBe("Ż ");
      expect(rule.apply(context("Cześć. ć "))?.replacement).toBe("Ć ");
      expect(rule.apply(context("Привет. п "))?.replacement).toBe("П ");
    });
  });

  describe("CapitalizeAfterLineBreakRule", () => {
    test("capitalizes a completed word after one or more line breaks", () => {
      const rule = new CapitalizeAfterLineBreakRule();

      expect(rule.apply(context("Hello\nworld "))).toEqual(edit("World ", 6));

      expect(rule.apply(context("Hello\n\n   world\n"))).toEqual(edit("World\n", 6));
    });

    test("does not capitalize without line break context or before the word is complete", () => {
      const rule = new CapitalizeAfterLineBreakRule();
      expect(rule.apply(context("Hello w "))).toBeNull();
      expect(rule.apply(context("Hello\nW "))).toBeNull();
      // "i" may still become "iPhone".
      expect(rule.apply(context("Hello\ni"))).toBeNull();
      expect(rule.apply(context("Hello\niPhone "))).toBeNull();
    });
  });

  describe("CommaPeriodSpacingRule", () => {
    test("normalizes comma/period spacing with regular spaces", () => {
      const rule = new CommaPeriodSpacingRule(true);
      const prose = { inputAction: "insert" as const };
      // A period is never spaced by the rule: "Hello." may be "Hello.world".
      expect(rule.apply(context("Hello."))).toBeNull();
      expect(rule.apply(context("Hello ."))).toBeNull();
      expect(rule.apply(context("Hello.w", prose))).toBeNull();
      // The user's space after it confirms the sentence end, and the stray
      // spaces before it go.
      expect(rule.apply(context("Hello . ", prose))).toEqual(edit(". ", 3));
      expect(rule.apply(context("Hello  . ", prose))).toEqual(edit(". ", 4));
      expect(rule.apply(context("Hello. ", prose))).toBeNull();
      // "?" and "!" close the same way, keeping the typed mark.
      for (const mark of ["?", "!", "؟"]) {
        expect(rule.apply(context(`Really ${mark} `, prose))).toEqual(edit(`${mark} `, 3));
        expect(rule.apply(context(`Really ${mark}`, prose))).toBeNull();
        expect(rule.apply(context(`Really${mark} `, prose))).toBeNull();
      }
      // French keeps its space before high punctuation; Canadian French does not.
      expect(rule.apply(context("Vraiment ? ", { ...prose, lang: "fr_FR" }))).toBeNull();
      expect(rule.apply(context("Vraiment ? ", { ...prose, lang: "fr_CA" }))).toEqual(
        edit("? ", 3),
      );
      expect(rule.apply(context("x != ", prose))).toBeNull();
      expect(rule.apply(context("Path .. ", prose))).toBeNull();
      expect(rule.apply(context("Hello   ,"))).toEqual(edit(", ", 4));
    });

    test("respects insertSpaceAfterAutocomplete=false", () => {
      const noInsertRule = new CommaPeriodSpacingRule(false);

      expect(noInsertRule.apply(context("Hello,"))).toBeNull();
      expect(noInsertRule.apply(context("Hello . ", { inputAction: "insert" }))).toEqual(
        edit(". ", 3),
      );
      expect(noInsertRule.apply(context("Hello   ,"))).toEqual(edit(",", 4));
    });

    test("only completes deferred numeric punctuation for direct prose typing", () => {
      const rule = new CommaPeriodSpacingRule(true);
      const prose = {
        lang: "en_US",
        inputAction: "insert" as const,
        measurementContext: "prose" as const,
      };

      expect(rule.apply(context("There were 2,a", prose))).toEqual(edit(", a", 2));
      expect(rule.apply(context("Values: 1.5", prose))).toBeNull();
      expect(rule.apply(context("Values: 1,2", prose))).toBeNull();
      expect(rule.apply(context("Value 1.e", prose))).toBeNull();
      expect(rule.apply(context("Value 1.e3", prose))).toBeNull();
      expect(rule.apply(context("Value 1.e+", prose))).toBeNull();
      expect(rule.apply(context("Value 1e2.n", prose))).toBeNull();
      expect(rule.apply(context("file2.n", prose))).toBeNull();
      expect(rule.apply(context("Value 2.n", { ...prose, inputAction: "delete" }))).toBeNull();
      expect(rule.apply(context("Value 2.n", { ...prose, isPaste: true }))).toBeNull();
      expect(rule.apply({ ...context("Value 2.n", prose), afterCursor: "ow" })).toBeNull();
    });

    test("only defers numeric punctuation where the repair can complete it", () => {
      const rule = new CommaPeriodSpacingRule(true);
      const prose = {
        lang: "en_US",
        inputAction: "insert" as const,
        measurementContext: "prose" as const,
      };
      const spaced = edit(", ", 1);

      // Deferring in a context the repair cannot reach would drop the space forever.
      expect(rule.apply({ ...context("There were 2,", prose), afterCursor: "xyz" })).toEqual(
        spaced,
      );
      expect(rule.apply(context("There were 2,", { ...prose, isPaste: true }))).toEqual(spaced);
      expect(rule.apply(context("There were 2,", { ...prose, inputAction: "other" }))).toEqual(
        spaced,
      );
      expect(rule.apply(context("There were 2,", prose))).toBeNull();
    });

    test("every deferred comma is repaired once prose resumes (typed char by char)", () => {
      const type = (input: string, lang: string): string => {
        const rule = new CommaPeriodSpacingRule(true);
        let text = "";
        for (const char of input) {
          text += char;
          const result = rule.apply(
            context(text, { lang, inputAction: "insert", measurementContext: "prose" }),
          );
          if (result)
            text = text.slice(0, text.length - result.deleteBackwards) + result.replacement;
        }
        return text;
      };
      const cases: [string, string, string][] = [
        ["ar_SA", "العدد ٢,ثم", "العدد ٢, ثم"],
        ["ar_SA", "العدد ٢،ثم", "العدد ٢، ثم"],
        ["ar_SA", "القيمة ١٫٥,ثم", "القيمة ١٫٥, ثم"],
        ["ar_SA", "كتاب،قلم", "كتاب، قلم"],
        ["ar_SA", "١,٥", "١,٥"],
        ["en_US", "x 1,500,000,and", "x 1,500,000, and"],
        ["en_US", "x 1,500,000,000", "x 1,500,000,000"],
        ["en_US", "x 1.5.3,and", "x 1.5.3, and"],
        ["en_US", "file2,and", "file2, and"],
        ["en_US", "x 2​,and", "x 2​, and"],
        ["en_US", "x 2,eel", "x 2, eel"],
        ["en_US", "x 2,e5", "x 2,e5"],
      ];
      for (const [lang, input, expected] of cases) {
        expect(type(input, lang)).toBe(expected);
      }
      // Repair keeps the authored comma: ، is never swapped for ASCII ",".
      const arabic = type("العدد ٢،ثم", "ar_SA");
      expect(arabic).toContain("،");
      expect(arabic).not.toContain(",");
    });

    test("closes a quote tight after a comma", () => {
      const rule = new CommaPeriodSpacingRule(true);
      expect(rule.apply(context('"Hi, "'))).toEqual(edit('"', 2));
    });

    test("treats zero-width fillers as ignorable separators for duplicate commas", () => {
      const rule = new CommaPeriodSpacingRule(true);

      for (const filler of ZERO_WIDTH_FILLER_CHARS) {
        expect(rule.apply(context(`Hello,${filler},`))).toBeNull();
        expect(rule.apply(context(`Hello,\u00A0${filler},`))).toBeNull();
        // The fillers before a typed comma go with the spaces.
        expect(rule.apply(context(`word ${filler},`))).toEqual(edit(", ", 3));
      }
    });
  });

  describe("OpeningBracketSpacingRule", () => {
    test("keeps a bracket typed against a word attached", () => {
      const rule = new OpeningBracketSpacingRule();

      expect(rule.apply(context("item("))).toBeNull();

      expect(rule.apply(context("if (x){"))).toEqual(edit(" {", 1));

      expect(rule.apply(context("console.log("))).toBeNull();
      expect(rule.apply(context("myArray["))).toBeNull();
    });
  });

  describe("ClosingBracketSpacingRule", () => {
    test("removes inner pre-close spaces and adds prose trailing space", () => {
      const rule = new ClosingBracketSpacingRule(true);

      expect(rule.apply(context("foo(bar() )"))).toEqual(edit(")", 2));

      expect(rule.apply(context("Hello (world)"))).toEqual(edit(") ", 1));

      expect(rule.apply(context("foo(bar())"))).toBeNull();
    });

    test("supports no trailing-space mode", () => {
      const noInsert = new ClosingBracketSpacingRule(false);

      expect(noInsert.apply(context("Hello (world)"))).toBeNull();
    });
  });

  describe("SlashContextSpacingRule", () => {
    test("compacts protocol spacing and applies operator spacing only in operator context", () => {
      const rule = new SlashContextSpacingRule(true);

      expect(rule.apply(context("https: /"))).toEqual(edit("/", 2));

      expect(rule.apply(context("x /"))).toEqual(edit("/ ", 1));

      expect(rule.apply(context("src/"))).toBeNull();
      expect(rule.apply(context("</"))).toBeNull();
    });
  });

  describe("MathOperatorSpacingRule", () => {
    test("normalizes compact math/operator forms in safe contexts", () => {
      const rule = new MathOperatorSpacingRule();

      expect(rule.apply(context("x=y"))).toEqual(edit("x = y", 3));

      expect(rule.apply(context("y+1"))).toEqual(edit("y + 1", 3));

      expect(rule.apply(context("x*y"))).toEqual(edit("x * y", 3));
    });

    test("does not alter comparator chains or prose-like compact tokens", () => {
      const rule = new MathOperatorSpacingRule();
      expect(rule.apply(context("x==y"))).toBeNull();
      expect(rule.apply(context("foo+b"))).toBeNull();
    });

    test("leaves HTML attributes inside an open tag alone", () => {
      const rule = new MathOperatorSpacingRule();
      expect(rule.apply(context('<span title="'))).toBeNull();
      expect(rule.apply(context('<img src="a.png" alt="'))).toBeNull();
      expect(rule.apply(context("Use <td colspan=2"))).toBeNull();
      // A closed tag or a comparison does not hide later arithmetic.
      expect(rule.apply(context("<b>Note</b> x=y"))?.replacement).toBe("x = y");
      expect(rule.apply(context("if 3 < 4 then x=y"))?.replacement).toBe("x = y");
    });
  });

  describe("TechnicalTokenCompactionRule", () => {
    test("compacts time/ratio spacing but never a digit-period-digit sentence", () => {
      const rule = new TechnicalTokenCompactionRule();

      // "We sold 12. 5 were returned" is a sentence boundary, not a decimal.
      expect(rule.apply(context("3. 1"))).toBeNull();

      expect(rule.apply(context("12: 3"))).toEqual(edit(":3", 3));
    });

    test("preserves spacing after dotted words without language-specific detection", () => {
      const rule = new TechnicalTokenCompactionRule();
      expect(rule.apply(context("Hello. w"))).toBeNull();
      expect(rule.apply(context("old_word. X"))).toBeNull();
      expect(rule.apply(context("Read on. Duplicate. W"))).toBeNull();
      expect(rule.apply(context("obj.cfg_1. x"))).toBeNull();
      expect(rule.apply(context("a.b. c"))).toBeNull();
      expect(rule.apply(context("return a.b. c"))).toBeNull();
      expect(rule.apply(context("9 a.m. a"))).toBeNull();
      expect(rule.apply(context("Use e.g. examples"))).toBeNull();
      expect(rule.apply(context("Siehe z.B. examples"))).toBeNull();
      expect(rule.apply(context("Użyj m.in. examples"))).toBeNull();
    });
  });

  describe("CollapseRepeatedSpacesRule", () => {
    test("collapses repeated trailing spaces outside indentation context", () => {
      const rule = new CollapseRepeatedSpacesRule();

      expect(rule.apply(context("hello  "))).toEqual(edit(" ", 2));

      expect(rule.apply(context("hello   "))).toEqual(edit(" ", 3));
    });

    test("leaves two spaces to doubleSpaceToPeriod when a space sends two events", () => {
      for (const docs of [false, true])
        expect(typeText("Hello  ", { sequence: true, docs }).beforeCursor).toBe("Hello. ");
    });

    test("preserves indentation-like leading spaces", () => {
      const rule = new CollapseRepeatedSpacesRule();
      expect(rule.apply(context("\n  "))).toBeNull();
      expect(rule.apply(context(" "))).toBeNull();
    });
  });

  describe("TrimSpaceBeforeLineBreakRule", () => {
    test("trims spaces before newline", () => {
      const rule = new TrimSpaceBeforeLineBreakRule();

      expect(rule.apply(context("Hello \n"))).toEqual(edit("\n", 2));

      expect(rule.apply(context("Hello   \n"))).toEqual(edit("\n", 4));
    });

    test("does not edit when no trailing spaces precede newline", () => {
      const rule = new TrimSpaceBeforeLineBreakRule();
      expect(rule.apply(context("Hello\n"))).toBeNull();
      expect(rule.apply(context("Hello"))).toBeNull();
    });
  });
});
