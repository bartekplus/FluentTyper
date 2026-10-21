import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { compileGrammarRules } from "../../scripts/grammarRules";
import { compileRuleFiles, RULE_FILES } from "../../src/core/domain/grammar/engine/compiler";
import type { RuleFile } from "../../src/core/domain/grammar/engine/types";

const ROOT = path.resolve(import.meta.dir, "../..");
// The modules that scripts/compile-grammar-rules.ts writes.
const OUTPUT =
  /grammar\/review\/rules\/|grammar\/engine\/\w+\.generated\.ts$|phrases\.generated\.ts$/;
const transpiler = new Bun.Transpiler({ loader: "ts" });

/** The local files that `file` imports statically, transitively. */
function staticImports(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const { path: spec, kind } of transpiler.scanImports(readFileSync(file, "utf8"))) {
    if (kind === "dynamic-import") continue;
    let resolved: string;
    try {
      resolved = Bun.resolveSync(spec, path.dirname(file));
    } catch {
      continue;
    }
    if (resolved.startsWith(ROOT) && !resolved.includes("node_modules") && resolved.endsWith(".ts"))
      staticImports(resolved, seen);
  }
  return seen;
}

test("build.ts loads no generated grammar module before it compiles the rule files", () => {
  const generated = [...staticImports(path.join(ROOT, "build.ts"))].filter((file) =>
    OUTPUT.test(file),
  );
  expect(generated).toEqual([]);
});

// A rule file with errors on purpose: one cast at the boundary.
const compile = (file: Record<string, unknown>) => () =>
  compileRuleFiles([["common", { lang: "*", ...file } as unknown as RuleFile]]);

test("an unknown top-level key of a rule file is an error", () => {
  expect(compile({ phrase: {} })).toThrow('common.yaml: unknown field "phrase"');
});

test("a check without modes is an error, not a TypeError", () => {
  const check = { id: "demo", priority: 1, category: "grammar", kind: "usage" };
  expect(compile({ checks: [check] })).toThrow('common.yaml check demo: "modes" lists no mode');
});

test("a rule without checks is an error, not a TypeError", () => {
  const rule = { id: "x", message: "m", frames: [{ regex: "(?<target>a)", fix: "b" }] };
  expect(compile({ rules: [rule] })).toThrow('common.yaml rule x: "checks" names no check');
});

test("a YAML error names its file, and a rule file outside RULE_FILES is an error", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fluenttyper-rules-"));
  try {
    for (const name of RULE_FILES) writeFileSync(path.join(dir, `${name}.yaml`), "lang: en\n");
    writeFileSync(path.join(dir, "fr.yaml"), "rules: [\n");
    await expect(compileGrammarRules(dir)).rejects.toThrow("fr.yaml");
    writeFileSync(path.join(dir, "fr.yaml"), "lang: fr\n");
    writeFileSync(path.join(dir, "xx.yaml"), "lang: xx\n");
    await expect(compileGrammarRules(dir)).rejects.toThrow("xx.yaml");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
