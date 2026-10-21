// Compiles grammar/rules/*.yaml into the generated modules of grammar/engine/ and
// grammar/review/ (they are not in git: bun install, check, lint, typecheck, test and build run
// this script first).
// --check: fail when a generated module is not current, and write nothing.
// --force: write the modules again even when their inputs did not change.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateGrammarRuleModules, RULES_DIR, writeGrammarRuleModules } from "./grammarRules";

const ROOT = path.resolve(import.meta.dir, "..");
const GRAMMAR = path.join(ROOT, "src/core/domain/grammar");
// The hash of the inputs of the last write: the next run skips the work when they are the same.
const STAMP = path.join(GRAMMAR, "review/rules/.inputs");

/** The hash of the files the generated modules come from. */
function inputsHash(): string {
  const files = [
    ...readdirSync(RULES_DIR).map((file) => path.join(RULES_DIR, file)),
    path.join(GRAMMAR, "library.ts"),
    ...["library", "engine"].flatMap((dir) =>
      readdirSync(path.join(GRAMMAR, dir), { recursive: true, encoding: "utf8" }).map((file) =>
        path.join(GRAMMAR, dir, file),
      ),
    ),
    path.join(GRAMMAR, "review/phraseTemplates.ts"),
    path.join(ROOT, "scripts/grammarRules.ts"),
    path.join(ROOT, "scripts/compile-grammar-rules.ts"),
    path.join(ROOT, ".prettierrc"),
  ].filter(
    (file) => /\.(?:ts|yaml|json)$|\.prettierrc$/.test(file) && !file.includes(".generated."),
  );
  const hash = createHash("sha256");
  for (const file of files.sort())
    if (existsSync(file)) hash.update(file).update(readFileSync(file));
  return hash.digest("hex");
}

if (process.argv.includes("--check")) {
  const stale: string[] = [];
  for (const [file, content] of Object.entries(await generateGrammarRuleModules()))
    if ((await readFile(file, "utf8").catch(() => "")) !== content)
      stale.push(path.relative(process.cwd(), file));
  if (stale.length) {
    console.error(`Not current; run bun scripts/compile-grammar-rules.ts:\n${stale.join("\n")}`);
    process.exit(1);
  }
} else {
  const hash = inputsHash();
  const current =
    !process.argv.includes("--force") &&
    existsSync(path.join(GRAMMAR, "engine/review.generated.ts")) &&
    existsSync(path.join(GRAMMAR, "review/rules/index.generated.ts")) &&
    (await readFile(STAMP, "utf8").catch(() => "")) === hash;
  if (!current) {
    for (const file of await writeGrammarRuleModules())
      console.log(`Wrote ${path.relative(process.cwd(), file)}`);
    await Bun.write(STAMP, hash);
  }
}
