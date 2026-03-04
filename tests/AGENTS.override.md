# tests/AGENTS.override.md

This override applies to `tests/**`.

## E2E Suite Policy

- Keep end-to-end coverage split into:
  - `tests/e2e/smoke.e2e.test.ts` for fast PR signal (default `bun run test:e2e`)
  - `tests/e2e/full.e2e.test.ts` for deep regression (`bun run test:e2e:full`)
- Do not duplicate the same behavior across many selectors in e2e unless behavior is selector/editor specific.
- For selector-agnostic behavior, prefer one representative selector in e2e and cover selector breadth in unit/integration tests.

## Coverage Matrix Policy

- Any e2e behavior added, removed, or moved across layers must update:
  - `tests/e2e/coverage-matrix.json`
- Validate mapping integrity with:
  - `bun run check:e2e:coverage`
- Coverage parity is behavior-based, not e2e test-count-based.

## Waiting and Polling

- Prefer `waitUntil(...)` from `tests/e2e/e2e-helpers.ts` instead of ad hoc polling loops.
- Avoid fixed sleeps.
- Sleeps above `200ms` are not allowed unless documented inline with why no event/state wait is possible.

## Platform Expectations

- E2E changes must consider both `chrome` and `firefox`.
- Keep Firefox navigation fallback paths intact unless replacing with a demonstrably reliable alternative.

## Runtime Goals

- Keep smoke runtime suitable for quick feedback (`~10s` target per platform command).
- Put slower or broad permutation checks into full regression.
