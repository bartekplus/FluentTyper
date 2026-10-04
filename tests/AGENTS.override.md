# tests/AGENTS.override.md

This override applies to `tests/**`.
Also follow [docs/agents/testing.md](../docs/agents/testing.md). It gives the PR commands, the conditional suites and the coverage matrix policy.

## E2E Suite Policy

- Keep end-to-end coverage split into:
  - `tests/e2e/smoke.e2e.test.ts` for fast PR signal (default `bun run test:e2e`)
  - `tests/e2e/full.e2e.test.ts` for deep regression (`bun run test:e2e:full`)
- Put slower or broad permutation checks into full regression.
- Do not duplicate the same behavior across many selectors in e2e unless behavior is selector/editor specific.
- For selector-agnostic behavior, prefer one representative selector in e2e and cover selector breadth in unit/integration tests.

## Type Checks

- `bun run typecheck` checks all TypeScript files in `tests/` (see `tests/tsconfig.json`). `tests/bun-test.d.ts` gives the types for `bun:test`.
- Do not use `any`, `@ts-ignore` or `@ts-expect-error` to hide a type error. For a partial fake, use one narrow cast at the boundary or a typed helper.

## Waiting and Polling

- Prefer `waitUntil(...)` from `tests/e2e/e2e-helpers.ts` instead of ad hoc polling loops.
- Avoid fixed sleeps.
- Sleeps above `200ms` are not allowed unless documented inline with why no event/state wait is possible.

## Platform Expectations

- E2E changes must consider both `chrome` and `firefox`.
- Keep Firefox navigation fallback paths intact unless replacing with a demonstrably reliable alternative.
