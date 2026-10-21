// Lints the modules that bun run compile:grammar generates from the rule files. They are not in
// git, and oxlint skips the files that .gitignore names. So this script lints them in a copy of
// src/ outside the repository, with the same configuration and the type-aware rules.
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const GENERATED = [
  "src/core/domain/grammar/review/rules",
  "src/core/domain/grammar/engine/catalog.generated.ts",
  "src/core/domain/grammar/engine/copy.generated.ts",
  "src/core/domain/grammar/engine/live.generated.ts",
  "src/core/domain/grammar/engine/review.generated.ts",
];

const copy = mkdtempSync(path.join(tmpdir(), "fluenttyper-lint-"));
try {
  cpSync(path.join(ROOT, "src"), path.join(copy, "src"), { recursive: true });
  for (const file of ["tsconfig.json", "package.json", ".oxlintrc.json"])
    cpSync(path.join(ROOT, file), path.join(copy, file));
  symlinkSync(path.join(ROOT, "node_modules"), path.join(copy, "node_modules"));
  const lint = Bun.spawnSync(
    [
      path.join(ROOT, "node_modules/.bin/oxlint"),
      "--type-aware",
      "--deny-warnings",
      "--report-unused-disable-directives",
      ...GENERATED,
    ],
    { cwd: copy, stdout: "inherit", stderr: "inherit" },
  );
  process.exitCode = lint.exitCode ?? 1;
} finally {
  rmSync(copy, { recursive: true, force: true });
}
