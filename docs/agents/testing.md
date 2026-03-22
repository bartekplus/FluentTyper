# Testing and Coverage Policy

Testing expectations depend on what changed. Use the smallest suite that still proves the behavior, then add the required broader suites when runtime behavior moves.

## Test Commands

- Unit tests: `bun run test`
- Smoke e2e: `bun run test:e2e`
- Full regression e2e: `bun run test:e2e:full`
- Dev-runtime e2e: `bun run test:e2e:dev`
- Coverage matrix validation: `bun run check:e2e:coverage`

## Regression Tests for Bug Fixes

Every bug fix must include a regression test that would have caught the bug. Add the test to the most appropriate existing test file before writing the fix, or immediately after. The test must fail on the unfixed code and pass on the fixed code.

## Baseline Before a PR

Run these for every PR:

- `bun run check`
- `bun run test`
- `bun run test:e2e`
- `bun run check:e2e:coverage`

## Conditional Suites

- If runtime or end-to-end behavior changed, also run:
  - `bun run test:e2e:full`
  - `bun run test:e2e:full --platform=firefox`
- If development-mode runtime hooks or toggles changed, also run:
  - `bun run test:e2e:dev`
  - `bun run test:e2e:dev --platform=firefox`
- Recommended cross-browser smoke validation before PR:
  - `bun run test:e2e --platform=firefox`

## Smoke Runtime Expectations

- `bun run test:e2e` defaults to `--platform=chrome`.
- Target smoke runtime is `<=10s` wall-time for both:
  - `bun run test:e2e --platform=chrome`
  - `bun run test:e2e --platform=firefox`
- CI reports smoke runtime regressions but does not fail solely for exceeding the target.

## Coverage Matrix Policy

- Coverage parity is behavior-based, not test-count-based.
- When behavior is added, removed, or moved across unit, integration, and e2e coverage, update:
  - `tests/e2e/coverage-matrix.json`
  - `tests/e2e/coverage-baseline-ids.json`
- Validate the mapping with `bun run check:e2e:coverage`.

## Architecture-Sensitive Tests

- Routing changes often need updates in `tests/background.routing.test.ts`.
- Content runtime changes often need updates in:
  - `tests/content_script.behavior.test.ts`
  - `tests/content_script.watchdog.test.ts`

## Scoped Test Overrides

- When editing files under `tests/**`, also follow [`tests/AGENTS.override.md`](../../tests/AGENTS.override.md).
