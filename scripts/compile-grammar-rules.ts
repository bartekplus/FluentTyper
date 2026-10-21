// Compiles grammar/rules/*.yaml into the generated modules of grammar/engine/ and
// grammar/review/ (they are not in git: bun install, check, lint, typecheck, test and build run
// this script first).
// --force: write the modules again even when their inputs did not change.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateGrammarRuleModules, RULES_DIR } from "./grammarRules";

const ROOT = path.resolve(import.meta.dir, "..");
const GRAMMAR = path.join(ROOT, "src/core/domain/grammar");
// The hash of the inputs of the last write, then the outputs, one per line: the next run skips the
// work when the hash is the same and all the outputs are there.
const STAMP = path.join(GRAMMAR, "review/rules/.inputs");
const OUTPUT =
  /grammar\/review\/(?:rules\/|\w+\/phrases\.generated\.ts$)|grammar\/engine\/\w+\.generated\.ts$/;

const transpiler = new Bun.Transpiler({ loader: "ts" });

/** `file` and the files it imports, transitively (only the relative imports). */
function withImports(file: string, seen: Set<string>): void {
  // The modules this script writes are its outputs, not its inputs.
  if (seen.has(file) || !existsSync(file) || OUTPUT.test(file)) return;
  seen.add(file);
  if (!file.endsWith(".ts")) return;
  for (const { path: spec } of transpiler.scanImports(readFileSync(file, "utf8"))) {
    if (!spec.startsWith(".")) continue;
    const base = path.resolve(path.dirname(file), spec);
    const found = [`${base}.ts`, path.join(base, "index.ts"), base].find(
      (candidate) => candidate.endsWith(".ts") && existsSync(candidate),
    );
    if (found) withImports(found, seen);
  }
}

/**
 * The hash of the files the generated modules come from: the rule files, the scripts and all the
 * files they import, and the library (the scripts read only the names it exports).
 */
function inputsHash(): string {
  const files = new Set<string>();
  for (const file of [
    ...readdirSync(RULES_DIR).map((file) => path.join(RULES_DIR, file)),
    path.join(ROOT, "scripts/grammarRules.ts"),
    path.join(ROOT, "scripts/compile-grammar-rules.ts"),
  ])
    withImports(file, files);
  for (const file of [
    "library.ts",
    ...readdirSync(path.join(GRAMMAR, "library"), { recursive: true, encoding: "utf8" }).map(
      (file) => path.join("library", file),
    ),
  ])
    if (file.endsWith(".ts")) files.add(path.join(GRAMMAR, file));
  const hash = createHash("sha256");
  for (const file of [...files].sort()) hash.update(file).update(readFileSync(file));
  return hash.digest("hex");
}

const hash = inputsHash();
const [stamp, ...outputs] = (await readFile(STAMP, "utf8").catch(() => "")).split("\n");
const current =
  !process.argv.includes("--force") &&
  stamp === hash &&
  outputs.length > 0 &&
  outputs.every((file) => existsSync(path.join(ROOT, file)));
if (!current) {
  const modules = await generateGrammarRuleModules();
  for (const [file, content] of Object.entries(modules)) {
    if ((await readFile(file, "utf8").catch(() => "")) === content) continue;
    await Bun.write(file, content);
    console.log(`Wrote ${path.relative(process.cwd(), file)}`);
  }
  await Bun.write(
    STAMP,
    [hash, ...Object.keys(modules).map((file) => path.relative(ROOT, file))].join("\n"),
  );
}
