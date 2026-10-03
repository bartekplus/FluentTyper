import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Grammar code runs in the browser background bundle, where `process` may not exist.
const ROOT = join(import.meta.dir, "../../src/core/domain/grammar");

test("grammar sources carry no process.env reads or console.log debugging", () => {
  const offenders = (readdirSync(ROOT, { recursive: true }) as string[])
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => /process\.env|console\.log\(/.test(readFileSync(join(ROOT, file), "utf8")));
  expect(offenders).toEqual([]);
});
