import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CATALOG } from "../../src/core/domain/grammar/engine/catalog.generated";

const GRAMMAR = path.resolve(import.meta.dir, "../../src/core/domain/grammar");

/** library.ts, the library/ files it re-exports and the modules those files re-export from. */
function libraryFiles(): string[] {
  const files = new Set<string>();
  const visit = (file: string, depth: number) => {
    if (files.has(file)) return;
    files.add(file);
    if (depth === 0) return;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+"(\.[^"]+)"/g)) {
      // Types (the engine's own) are not rule code.
      if (/export\s+type/.test(m[0])) continue;
      visit(path.resolve(path.dirname(file), `${m[1]}.ts`), depth - 1);
    }
  };
  visit(path.join(GRAMMAR, "library.ts"), 2);
  return [...files];
}

test("the rule library names no check and no message: a rule's identity stays in its rule file", () => {
  const ids = new Set(CATALOG.map((entry) => entry.id as string));
  const quoted = /["'`]([A-Za-z][\w.]*)["'`]/g;
  const offenders: string[] = [];
  for (const file of libraryFiles()) {
    const text = readFileSync(file, "utf8");
    const named = [...text.matchAll(quoted)].map((m) => m[1]).filter((word) => ids.has(word));
    const messages = text.match(/review_msg_\w+/g) ?? [];
    if (named.length || messages.length)
      offenders.push(`${path.relative(GRAMMAR, file)}: ${[...named, ...messages].join(", ")}`);
  }
  expect(offenders).toEqual([]);
});

/** The file a relative import names, or null. */
function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  return [`${base}.ts`, path.join(base, "index.ts")].find((file) => existsSync(file)) ?? null;
}

test("the rule library never loads the engine or the generated rule modules (no import cycle)", () => {
  // The generated rule modules read library values when they load: a library module that
  // loads them (through any chain of value imports) makes an import cycle.
  const engine =
    /engine\/(?:reviewRules|liveRules|rules\/[^/]+\.generated)\.ts$|review\/reviewDetectors\.ts$/;
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const offenders: string[] = [];
  const chainTo = (file: string, seen: Set<string>): string[] | null => {
    if (engine.test(file)) return [file];
    if (seen.has(file)) return null;
    seen.add(file);
    for (const entry of transpiler.scanImports(readFileSync(file, "utf8"))) {
      if (entry.kind !== "import-statement") continue;
      const next = resolveImport(file, entry.path);
      const chain = next && chainTo(next, seen);
      if (chain) return [file, ...chain];
    }
    return null;
  };
  for (const file of libraryFiles()) {
    const chain = chainTo(file, new Set());
    if (chain) offenders.push(chain.map((step) => path.relative(GRAMMAR, step)).join(" -> "));
  }
  expect(offenders).toEqual([]);
});
