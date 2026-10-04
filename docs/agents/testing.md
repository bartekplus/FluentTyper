# Test your change

[FluentTyper](../../README.md) / [Contributing](../../CONTRIBUTING.md) / Testing

Every pull request needs the baseline below. Add the relevant browser and runtime suites when behavior changes.
Use [Bun 1.4.2 and the project setup](../../CONTRIBUTING.md#run-the-extension-locally) before running these commands.

## Baseline Before a PR

```sh
bun run check
bun run test
bun run test:e2e
bun run check:e2e:coverage
```

All four commands must pass. `bun run check` includes lint, formatting, and TypeScript checks.
The browser smoke suite defaults to Chrome.

## Regression Tests for Bug Fixes

Every bug fix must include a regression test that would have caught the bug. Add the test to the most appropriate existing test file before writing the fix, or immediately after. The test must fail on the unfixed code and pass on the fixed code.

## Conditional Suites

- If runtime or end-to-end behavior changed, also run:
  - `bun run test:e2e:full`
  - `bun run test:e2e:full --platform=firefox`
- If development-mode runtime hooks or toggles changed, also run:
  - `bun run test:e2e:dev`
  - `bun run test:e2e:dev --platform=firefox`
- Recommended cross-browser smoke validation before PR:
  - `bun run test:e2e --platform=firefox`
- The target smoke runtime is `<=10s` wall-time on Chrome and on Firefox.
  CI reports smoke runtime regressions, but it does not fail only because a run exceeds the target.

## Coverage Matrix Policy

- Coverage parity is behavior-based, not test-count-based.
- When behavior is added, removed, or moved across unit, integration, and e2e coverage, update:
  - `tests/e2e/coverage-matrix.json`
  - `tests/e2e/coverage-baseline-ids.json`
- Validate the mapping with `bun run check:e2e:coverage`.

## Architecture-Sensitive Tests

- Routing changes often need updates in `tests/background.routing.test.ts`.
- Content runtime changes often need updates in `tests/content_script.behavior.test.ts`.

## Scoped Test Overrides

- When editing files under `tests/**`, also follow [`tests/AGENTS.override.md`](../../tests/AGENTS.override.md).

---

[Build commands](commands.md) · [Performance measurements](../extension-performance.md) · [Return to contributing](../../CONTRIBUTING.md)
