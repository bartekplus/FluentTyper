import { expect, test } from "bun:test";
import { checkExpression, defSignature } from "../../src/core/domain/grammar/engine/expressions";
import { compileRuleFiles } from "../../src/core/domain/grammar/engine/compiler";
import type { CheckSpec, RuleFile } from "../../src/core/domain/grammar/engine/types";

const LANGS = ["en", "fr", "hr", "es", "el", "sv", "de", "pl", "pr"];
const check: CheckSpec = {
  text: {
    title: Object.fromEntries(LANGS.map((l) => [l, "Demo"])),
    description: Object.fromEntries(LANGS.map((l) => [l, "Demo."])),
  },
  example: { lang: "en_US", before: "a", after: "b" },
  id: "demoCheck",
  modes: ["review"],
  priority: 5,
  category: "grammar",
  kind: "usage",
};
const compile = (en: RuleFile, library = new Set(["capitalize", "germanAdjective"])) =>
  compileRuleFiles(
    [
      ["common", { lang: "*", checks: [check] }],
      ["en", en],
    ],
    { library },
  );
const errorsOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return String(error);
  }
  return "";
};

test("an expression reads its free names; arrow parameters bind theirs", () => {
  const { refs, errors } = checkExpression(
    "words.some((w) => own.test(w)) ? capitalize(m.groups!.target) : null",
  );
  expect(errors).toEqual([]);
  expect([...refs].sort()).toEqual(["capitalize", "m", "own", "words"]);
  expect([...checkExpression("`${a}-${`${b}`}` as Inflection").refs]).toEqual(["a", "b"]);
  expect([...checkExpression("({ ...f, range: { start } }) satisfies X").refs]).toEqual([]);
});

test("regex literals, TypeScript assertions and type arguments parse", () => {
  for (const source of [
    String.raw`/^[ \t]+(\p{L}+)/u.exec(text.slice(m.index))?.[1]`,
    "a / b / c",
    "m.groups!.t2 ?? m.groups!.target",
    "new Set<string>(xs).has(x)",
    "x as Readonly<Record<string, RegExp>>",
    "[1, , ...xs]",
    "(f): RawFinding => ({ ...f })",
  ])
    expect(checkExpression(source).errors).toEqual([]);
});

test("an expression has no assignment, statements or ways out of the language", () => {
  for (const [source, error] of [
    ["x = 1", "assignment"],
    ["x += 1", "assignment"],
    ["x++", "changes a value"],
    ["a.constructor", "denied"],
    ['a["__proto__"]', "denied"],
    ["new Function('x')", '"new" may make only'],
    ["this.x", '"this" is not allowed'],
    ["(x) => { return x; }", "returns an expression"],
    ["a & b", "not allowed"],
  ])
    expect(checkExpression(source).errors.join()).toContain(error);
});

test("a whole negation gives its operand", () => {
  expect(checkExpression("!(a && b)").negated).toBe("(a && b)");
  expect(checkExpression("!a.b(c)").negated).toBe("a.b(c)");
  expect(checkExpression("!a && b").negated).toBeUndefined();
  expect(checkExpression("a !== b").negated).toBeUndefined();
});

test("a def signature gives its name and parameter names", () => {
  expect(defSignature("cap(word: string)")).toEqual({ name: "cap", params: ["word"] });
  expect(defSignature("near(m: RegExpExecArray, { w, end: e }: Token)")).toEqual({
    name: "near",
    params: ["m", "w", "e"],
  });
  expect(defSignature("OWN")).toEqual({ name: "OWN", params: [] });
  expect(defSignature("bad(")).toBeNull();
});

test("a frame's code: each condition runs right after the last binding it reads", () => {
  const set = compile({
    lang: "en",
    defs: { LIMIT: "3", short: { args: "w: string", return: "w.length < LIMIT" } },
    sets: { STOP: ["a", "an"] },
    rules: [
      {
        id: "en.code",
        checks: ["demoCheck"],
        style: "match",
        message: "review_msg_phrase_correction",
        frames: [
          {
            regex: "(?<target>\\p{L}+) (?<next>\\p{L}+)",
            let: { word: "target.toLowerCase()", after: "next.toLowerCase()" },
            when: ["!STOP.has(word)", "ctx.from === 0", "short(after)"],
            return: "capitalize(word)",
          },
        ],
      },
    ],
  });
  const [frame] = set.code.en.frames;
  expect(frame.key).toBe("@en.code/1");
  expect(frame.params).toEqual(["m", "ctx"]);
  expect(frame.groups).toEqual(["target", "next"]);
  expect(frame.steps).toEqual([
    { kind: "when", source: "ctx.from === 0" },
    { kind: "let", name: "word", source: "target.toLowerCase()" },
    { kind: "when", source: "!STOP.has(word)" },
    { kind: "let", name: "after", source: "next.toLowerCase()" },
    { kind: "when", source: "short(after)" },
  ]);
  expect(set.frames[0].fixer).toBe("en:@en.code/1");
  expect(set.code.en.sets).toEqual({ STOP: ["a", "an"] });
  expect(set.code.en.defs.map((def) => def.name)).toEqual(["LIMIT", "short"]);
});

test("the compiler names unknown and reused names", () => {
  const message = errorsOf(() =>
    compile({
      lang: "en",
      defs: { capitalize: "1" },
      rules: [
        {
          id: "en.bad",
          checks: ["demoCheck"],
          style: "match",
          message: "review_msg_phrase_correction",
          frames: [
            {
              regex: "(?<target>x)",
              let: { target: "1" },
              when: "missing(target)",
              return: "fetch(target)",
            },
            { regex: "(?<target>y)", fix: "z", return: "1" },
          ],
        },
      ],
    }),
  );
  for (const fragment of [
    'def capitalize: "capitalize" is a name of the rule library',
    'let target: "target" is taken',
    'when 1: unknown name "missing"',
    'return: unknown name "fetch"',
    'give exactly one of "fix" and "fixer", or a "return" expression',
  ])
    expect(message).toContain(fragment);
});
