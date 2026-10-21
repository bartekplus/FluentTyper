import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

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
