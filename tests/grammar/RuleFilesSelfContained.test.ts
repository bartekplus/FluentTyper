import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { LIVE_RULES } from "../../src/core/domain/grammar/engine/live.generated";
import { REVIEW_FRAMES, REVIEW_RULES } from "../../src/core/domain/grammar/engine/review.generated";
import {
  RULE_DETECTORS,
  RULE_FILTERS,
  RULE_FIXERS,
} from "../../src/core/domain/grammar/review/rules/index.generated";
import { RULE_LIVE } from "../../src/core/domain/grammar/review/rules/live-index.generated";

const GRAMMAR = path.resolve(import.meta.dir, "../../src/core/domain/grammar");

/** The generated function that a compiled rule names ("<file>:<name>"). */
const generated = (records: Readonly<Record<string, Readonly<Record<string, unknown>>>>) => {
  return (ref: string) => {
    const [file, name] = ref.split(":");
    return typeof records[file]?.[name] === "function" || typeof records[file]?.[name] === "object";
  };
};

test("all rule logic is code of the rule files: no rule names a TypeScript function", () => {
  const fixer = generated(RULE_FIXERS);
  const filter = generated(RULE_FILTERS);
  const detector = generated(RULE_DETECTORS);
  const live = generated(RULE_LIVE);
  const missing: string[] = [];
  for (const rule of REVIEW_RULES) {
    for (const index of rule.frames ?? []) {
      const ref = REVIEW_FRAMES[index].fixer;
      if (ref !== undefined && !fixer(ref)) missing.push(`${rule.id}: fixer ${ref}`);
    }
    if (rule.filter !== undefined && !filter(rule.filter))
      missing.push(`${rule.id}: filter ${rule.filter}`);
    if (rule.predicate !== undefined && !detector(rule.predicate))
      missing.push(`${rule.id}: predicate ${rule.predicate}`);
  }
  for (const rule of LIVE_RULES)
    if (rule.predicate !== undefined && !live(rule.predicate))
      missing.push(`typing rule ${rule.check}: ${rule.predicate}`);
  expect(missing).toEqual([]);
});

test("no TypeScript module holds a record of rule functions", () => {
  const records = /export const (?:FIXERS|FILTERS|PREDICATES)\b/;
  const offenders = ["review", "implementations", "library"].flatMap((dir) =>
    readdirSync(path.join(GRAMMAR, dir), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts") && !file.includes(".generated."))
      .filter((file) => records.test(readFileSync(path.join(GRAMMAR, dir, file), "utf8")))
      .map((file) => `${dir}/${file}`),
  );
  expect(offenders).toEqual([]);
});
