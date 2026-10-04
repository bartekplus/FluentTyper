import { expect, test } from "bun:test";
import { caseClassLiterals } from "./caseClassAudit";

// With the `i` flag, \p{Lu}, \p{Ll}, \p{Lt} and [A-Z] match both cases: a case test in such a
// pattern does nothing. Check the case of the matched text in code, or use \p{L} or [a-z].

test("no Review regex literal combines the i flag with a case class", () => {
  expect(caseClassLiterals()).toEqual([]);
});

test("no Review regex built at run time combines the i flag with a case class", () => {
  const run = Bun.spawnSync([process.execPath, "tests/grammar/caseClassAudit.ts"]);
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  expect(JSON.parse(run.stdout.toString())).toEqual([]);
});
