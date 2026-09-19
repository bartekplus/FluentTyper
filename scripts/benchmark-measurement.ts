import { MeasurementUnitFormattingRule } from "../src/core/domain/grammar/implementations/MeasurementUnitFormattingRule";

const iterations = Number.parseInt(process.argv[2] ?? "100000", 10);
if (!Number.isFinite(iterations) || iterations < 1) throw new Error("iterations must be positive");

const rule = new MeasurementUnitFormattingRule();
const cases = {
  typical: "Mass: 10kg ",
  nonmatch: "Please send the report tomorrow ",
  long: `${"ordinary prose ".repeat(80)}Mass: 10kg `,
  adversarial: `Note: ${"(".repeat(160)}10W/${"(".repeat(160)}m `,
} as const;

const results: Record<string, { totalMs: number; nsPerOperation: number; matches: number }> = {};
for (const [name, beforeCursor] of Object.entries(cases)) {
  let matches = 0;
  const start = Bun.nanoseconds();
  for (let index = 0; index < iterations; index += 1) {
    matches += rule.apply({
      beforeCursor,
      afterCursor: "",
      hints: { lang: "en_US", inputAction: "insert", measurementContext: "prose" },
    })
      ? 1
      : 0;
  }
  const elapsedNs = Bun.nanoseconds() - start;
  results[name] = {
    totalMs: elapsedNs / 1e6,
    nsPerOperation: elapsedNs / iterations,
    matches,
  };
}

console.log(
  JSON.stringify(
    {
      environment: { bun: Bun.version, platform: process.platform, arch: process.arch },
      iterations,
      results,
    },
    null,
    2,
  ),
);
