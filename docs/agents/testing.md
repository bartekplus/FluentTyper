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
The TypeScript check covers `src/` and the test folders that `tests/tsconfig.json` includes.
The browser smoke suite defaults to Chrome.

## Full Regression and Gutenberg Suites

- `bun run test:e2e:full` runs in parallel shards. Each shard has its own browser. The default shard count is half the CPU count. Use `--shards=N` to change it. A run with `bun test` arguments (for example `--test-name-pattern`) uses one shard.
- `bun run test:e2e:wordpress --platform=chrome` (or `--platform=firefox`) runs the Gutenberg fixtures.

The Gutenberg fixture suite uses pinned WordPress packages. It starts no server and requires no Docker.
The full regression suite includes these tests on both browsers.
For native saving and history checks, use `--runtime=playground` with Node.js 22 or 24.
Set `WORDPRESS_NODE_BIN` if that executable is not the default `node`.
Playground uses a temporary local PHP/WASM site with WordPress 7.1.2.
The optional `--runtime=docker` uses `@wordpress/env` and requires a running Docker daemon.
A requested native suite fails if its environment cannot start.
See the [Gutenberg support matrix](../gutenberg-support.md) for feature evidence and open gaps.

## Timing Tests

Put each test that asserts a time budget (`cpuMs`, `slowestChunkMs`, `chunkTimes`, `chunkTimesWithoutJit`) in a file whose name ends in `.timing.test.ts`, for example `tests/grammar/ReviewFrench.timing.test.ts`.
`bun run test` runs all other files in parallel workers first. Then it runs the timing files serially.
Under full parallel load, cores are shared and the measured CPU time can be 3 to 5 times larger. Thus a timing test in a parallel file fails at random on CI.

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

## Coverage Matrix Policy

- Coverage parity is behavior-based, not test-count-based.
- When behavior is added, removed, or moved across unit, integration, and e2e coverage, update `tests/e2e/coverage-matrix.json`.
- Validate the mapping with `bun run check:e2e:coverage`.

## Architecture-Sensitive Tests

- Routing changes often need updates in `tests/background.routing.test.ts`.
- Content runtime changes often need updates in `tests/content_script.behavior.test.ts`.

## Scoped Test Overrides

- When editing files under `tests/**`, also follow [`tests/AGENTS.override.md`](../../tests/AGENTS.override.md).

---

[Build commands](commands.md) · [Performance measurements](../extension-performance.md) · [Return to contributing](../../CONTRIBUTING.md)
