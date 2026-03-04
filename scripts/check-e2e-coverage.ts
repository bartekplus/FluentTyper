import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

type CoverageLayer = "e2e-smoke" | "e2e-full" | "unit" | "integration";

interface CoverageRef {
  layer: CoverageLayer;
  file: string;
  test: string;
}

interface BehaviorCoverage {
  id: string;
  description: string;
  coverage: CoverageRef[];
}

interface CoverageMatrix {
  version: number;
  capturedAt: string;
  behaviors: BehaviorCoverage[];
}

interface CoverageBaseline {
  version: number;
  capturedAt: string;
  baselineBehaviorIds: string[];
}

const ALLOWED_LAYERS: readonly CoverageLayer[] = ["e2e-smoke", "e2e-full", "unit", "integration"];

function fail(message: string): never {
  throw new Error(`[coverage-matrix] ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    fail(message);
  }
}

function parseCoverageMatrix(filePath: string): CoverageMatrix {
  if (!existsSync(filePath)) {
    fail(`Missing coverage matrix file: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Failed to parse JSON from ${filePath}: ${String(error)}`);
  }

  assert(typeof parsed === "object" && parsed !== null, "Matrix root must be an object");
  const matrix = parsed as Partial<CoverageMatrix>;

  assert(matrix.version === 1, "Matrix version must be 1");
  assert(
    typeof matrix.capturedAt === "string" && matrix.capturedAt.length > 0,
    "capturedAt must be a non-empty string",
  );
  assert(Array.isArray(matrix.behaviors), "behaviors must be an array");
  assert(matrix.behaviors.length > 0, "behaviors must not be empty");

  return matrix as CoverageMatrix;
}

function parseCoverageBaseline(filePath: string): CoverageBaseline {
  if (!existsSync(filePath)) {
    fail(`Missing baseline IDs file: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Failed to parse JSON from ${filePath}: ${String(error)}`);
  }

  assert(typeof parsed === "object" && parsed !== null, "Baseline root must be an object");
  const baseline = parsed as Partial<CoverageBaseline>;

  assert(baseline.version === 1, "Baseline version must be 1");
  assert(
    typeof baseline.capturedAt === "string" && baseline.capturedAt.length > 0,
    "baseline capturedAt must be a non-empty string",
  );
  assert(Array.isArray(baseline.baselineBehaviorIds), "baselineBehaviorIds must be an array");
  assert(baseline.baselineBehaviorIds.length > 0, "baselineBehaviorIds must not be empty");

  return baseline as CoverageBaseline;
}

function validateCoverageMatrix(matrix: CoverageMatrix, repoRoot: string): void {
  const ids = new Set<string>();
  const errors: string[] = [];
  const fileCache = new Map<string, string>();

  for (const [index, behavior] of matrix.behaviors.entries()) {
    if (typeof behavior.id !== "string" || behavior.id.length === 0) {
      errors.push(`behavior[${index}] has invalid id`);
      continue;
    }
    if (ids.has(behavior.id)) {
      errors.push(`duplicate behavior id: ${behavior.id}`);
    }
    ids.add(behavior.id);

    if (typeof behavior.description !== "string" || behavior.description.length === 0) {
      errors.push(`behavior '${behavior.id}' has invalid description`);
    }

    if (!Array.isArray(behavior.coverage) || behavior.coverage.length === 0) {
      errors.push(`behavior '${behavior.id}' has no coverage mappings`);
      continue;
    }

    for (const [coverageIndex, coverage] of behavior.coverage.entries()) {
      if (!ALLOWED_LAYERS.includes(coverage.layer)) {
        errors.push(
          `behavior '${behavior.id}' coverage[${coverageIndex}] has invalid layer '${String(coverage.layer)}'`,
        );
      }

      if (typeof coverage.file !== "string" || coverage.file.length === 0) {
        errors.push(`behavior '${behavior.id}' coverage[${coverageIndex}] has invalid file`);
      } else {
        const resolvedFile = path.resolve(repoRoot, coverage.file);
        if (!existsSync(resolvedFile)) {
          errors.push(`behavior '${behavior.id}' references missing file: ${coverage.file}`);
        } else {
          let content = fileCache.get(resolvedFile);
          if (content === undefined) {
            content = readFileSync(resolvedFile, "utf8");
            fileCache.set(resolvedFile, content);
          }
          if (!content.includes(coverage.test)) {
            errors.push(
              `behavior '${behavior.id}' coverage[${coverageIndex}] test label not found in ${coverage.file}: ${coverage.test}`,
            );
          }
        }
      }

      if (typeof coverage.test !== "string" || coverage.test.length === 0) {
        errors.push(`behavior '${behavior.id}' coverage[${coverageIndex}] has invalid test label`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

function validateBaselineParity(matrix: CoverageMatrix, baseline: CoverageBaseline): void {
  const errors: string[] = [];
  const baselineIds = new Set<string>();
  for (const id of baseline.baselineBehaviorIds) {
    if (typeof id !== "string" || id.length === 0) {
      errors.push("baselineBehaviorIds contains an invalid id");
      continue;
    }
    if (baselineIds.has(id)) {
      errors.push(`duplicate baseline behavior id: ${id}`);
    }
    baselineIds.add(id);
  }

  const matrixIds = new Set(matrix.behaviors.map((behavior) => behavior.id));

  for (const baselineId of baselineIds) {
    if (!matrixIds.has(baselineId)) {
      errors.push(`missing baseline behavior id in matrix: ${baselineId}`);
    }
  }
  for (const matrixId of matrixIds) {
    if (!baselineIds.has(matrixId)) {
      errors.push(`matrix contains behavior id not present in baseline: ${matrixId}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

function summarizeByLayer(matrix: CoverageMatrix): string {
  const counts: Record<CoverageLayer, number> = {
    "e2e-smoke": 0,
    "e2e-full": 0,
    unit: 0,
    integration: 0,
  };

  for (const behavior of matrix.behaviors) {
    const uniqueLayers = new Set<CoverageLayer>();
    for (const coverage of behavior.coverage) {
      uniqueLayers.add(coverage.layer);
    }
    for (const layer of uniqueLayers) {
      counts[layer] += 1;
    }
  }

  return ALLOWED_LAYERS.map((layer) => `${layer}=${counts[layer]}`).join(" ");
}

function resolveInputPath(
  repoRoot: string,
  envValue: string | undefined,
  fallback: string,
): string {
  const selected = envValue && envValue.length > 0 ? envValue : fallback;
  return path.isAbsolute(selected) ? selected : path.resolve(repoRoot, selected);
}

function main(): void {
  const repoRoot = process.cwd();
  const matrixPath = resolveInputPath(
    repoRoot,
    process.env.COVERAGE_MATRIX_PATH,
    "tests/e2e/coverage-matrix.json",
  );
  const baselinePath = resolveInputPath(
    repoRoot,
    process.env.COVERAGE_BASELINE_PATH,
    "tests/e2e/coverage-baseline-ids.json",
  );
  const matrix = parseCoverageMatrix(matrixPath);
  const baseline = parseCoverageBaseline(baselinePath);
  validateBaselineParity(matrix, baseline);
  validateCoverageMatrix(matrix, repoRoot);

  console.log(
    `[coverage-matrix] OK behaviors=${matrix.behaviors.length} ${summarizeByLayer(matrix)}`,
  );
}

main();
