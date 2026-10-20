// Compiles grammar/rules/*.yaml into grammar/engine/*.generated.ts.
// --check: fail when a generated module is not current, and write nothing.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateGrammarRuleModules, writeGrammarRuleModules } from "./grammarRules";

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
  for (const file of await writeGrammarRuleModules())
    console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}
