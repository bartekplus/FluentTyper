# AGENTS.md

This file is the **project brief for AI coding agents** working on FluentTyper (browser extension: autocomplete + spellcheck + text expansions).

If you’re an agent: follow the guardrails below, prefer small focused changes, and keep the extension privacy-first and offline-friendly.

---

## Non‑negotiables

- **Privacy-first**: do not add telemetry, external uploads, or “phone home” behavior. Typed content must stay local.
- **Offline-first**: keep the core experience working offline.
- **Don’t expand permissions casually**: avoid adding new permissions/host permissions unless a maintainer request explicitly requires it.
- **Respect platform separation** (Chrome/Edge vs Firefox manifests and quirks).
- **Keep architecture boundaries** (Domain → Application → Adapters → UI). See “Architecture rules”.

---

## Tech stack + tooling

- **Language**: TypeScript (strict).
- **Runtime/build**: Bun (repo is pinned to a specific Bun version via `packageManager`).
- **Bundling**: `bun run build` produces `build/` and copies assets/manifests.
- **Lint/format**: ESLint + Prettier.
- **Tests**:
  - Unit: `bun run test`
  - Fast e2e smoke: `bun run test:e2e`
  - Full e2e regression: `bun run test:e2e:full`
  - Dev-runtime e2e: `bun run test:e2e:dev`
  - Coverage matrix validation: `bun run check:e2e:coverage`

---

## “Golden” commands (run these)

### Install

```bash
bun install
```

### Build

```bash
bun run build
# Build Firefox:
bun run build --platform=firefox
```

### Watch mode (iterative dev)

```bash
bun run watch
```

### Quality gates (before PR)

```bash
bun run check
bun run test
bun run test:e2e
bun run check:e2e:coverage
# Required when runtime/e2e behavior changes:
bun run test:e2e:full
bun run test:e2e:full --platform=firefox
# Required when changing dev-runtime hooks/toggles:
bun run test:e2e:dev
bun run test:e2e:dev --platform=firefox
# Recommended smoke cross-browser check:
bun run test:e2e --platform=firefox
```

Smoke budget policy:

- `bun run test:e2e --platform=chrome` and `bun run test:e2e --platform=firefox` both target `<=10s` wall-time.
- CI records and reports smoke runtime, but does not fail solely for exceeding the 10s target.

### Autofix

```bash
bun run fix
```

---

## Load the extension locally

1. Build for your target browser:
   - **Chrome/Edge**: `bun run build`
   - **Firefox**: `bun run build --platform=firefox`
2. Load `build/` as an unpacked extension:
   - **Chrome/Edge**: Extensions → Developer mode → “Load unpacked” → select `build/`
   - **Firefox**: `about:debugging` → “This Firefox” → “Load Temporary Add-on” → select `build/manifest.json`

---

## Repository map (where things live)

### Entry points (bundled)

- `src/entries/background.ts` → background bootstrap
- `src/entries/content_script.ts` → content-script bootstrap
- `src/entries/popup.ts` → popup UI bootstrap
- `src/entries/settings.ts` → options/settings bootstrap

### Layered architecture

- `src/core/domain/`  
  Contracts, types, constants, pure logic. **No imports from application/adapters/ui**.
- `src/core/application/`  
  Use-cases, repositories, settings/logging utilities. **No imports from adapters/ui**.
- `src/adapters/chrome/`  
  Browser integration:
  - `background/` service worker + prediction orchestration, settings application, routing
  - `content-script/` DOM integration + suggestion rendering
- `src/ui/`  
  Popup + options UI.

### Path aliases (use these)

- `@core/*`, `@adapters/*`, `@ui/*`, `@third-party/*`

Avoid legacy import roots like:

- `src/background/*`, `src/content-script/*`, `src/shared/*`

---

## Architecture rules (important)

Follow these boundaries when adding/changing code:

- `src/core/domain`: **pure** domain logic only.
- `src/core/application`: orchestration/repositories/utilities; **no adapter or UI imports**.
- `src/adapters/chrome`: integration layer; background and content-script must remain separated:
  - `src/adapters/chrome/background/**` must not import from `.../content-script/**`
  - `src/adapters/chrome/content-script/**` must not import from `.../background/**`
- `src/ui`: UI only; do not reach into adapter internals.

If you need a cross-layer contract, put it in:

- `src/core/domain/contracts/**` and/or `src/core/domain/messageTypes.d.ts`

---

## Prediction + messaging overview (so you don’t break it)

High level flow:

1. Content script observes typing and requests predictions via runtime messaging.
2. Background routes messages and runs prediction (Presage in prod; optional WebLLM in dev builds).
3. Background sends prediction response back to the correct tab/frame.
4. Content script renders suggestions + handles acceptance (Tab/keyboard navigation).

If you change message shapes:

- Update `src/core/domain/messageTypes.d.ts`
- Update constants in `src/core/domain/constants.ts`
- Update routers/handlers in `src/adapters/chrome/background/router/**`
- Update content message handling in `src/adapters/chrome/content-script/**`

---

## WebLLM / AI predictor constraint (dev/debug only)

- Production store builds are **Presage-only**.
- Dev/debug builds can include WebLLM and will adjust CSP/connect-src accordingly during build.

When touching this area:

- Do not make WebLLM required for normal operation.
- Keep safe fallbacks when the AI predictor is unavailable or times out.
- Avoid increasing network surface area in production builds.

---

## Text expansions + dynamic variables

Text expansion is configured via settings and used in prediction + expansion logic.

Dynamic variables are resolved in:

- `src/core/domain/variables.ts` (e.g. `${time}`, `${date}`, `${datetime}`, `${uuid}`, `${random:...}`)
- `src/adapters/chrome/background/TemplateExpander.ts` (async resolver; can also read active tab context for page variables)

If you add a new variable:

1. Add it to `resolveDynamicVariable(...)` in `src/core/domain/variables.ts` when it can be computed locally.
2. If it needs browser context (tab/title/url), extend the resolver in `TemplateExpander.createResolver(...)`.
3. Add/adjust tests if behavior changes.

---

## Settings changes (how to do it safely)

When adding a new user-facing setting:

- Add a key/constant in `src/core/domain/constants.ts` (if it’s used in runtime logic).
- Wire it through repositories (likely `src/core/application/repositories/**`).
- Ensure config assembly includes it if it affects runtime (`src/adapters/chrome/background/config/ConfigAssembler.ts`).
- Update UI (options/popup) and defaults/migrations as needed.

Keep backward compatibility in mind; migrations exist for older stored settings.

---

## Platform manifests + versioning

Manifests live under:

- `platform/chrome/manifest.json`
- `platform/firefox/manifest.json`
- `platform/edge/manifest.json`

Versioning workflow:

- `package.json` is the source of truth for the version.
- `bun version` runs `scripts/update-manifest-version.cjs` to sync manifest versions.

Do not hand-edit versions in multiple places without running the script.

---

## Logging guidelines

- Default prod logging should be minimal (warn/error).
- Avoid logging full user text content.
- If you add debug logs, guard them behind dev mode and/or existing logging levels.

---

## What to include in PRs

- A short description of the user-visible impact.
- Tests run (at least `bun run check` + `bun run test` + `bun run test:e2e` + `bun run check:e2e:coverage`).
- If changing runtime behavior: add/adjust tests (unit and/or e2e).
- If changing UI: screenshots are helpful.

E2E coverage policy:

- Coverage parity is enforced by behavior mapping, not by preserving identical e2e case counts.
- If behavior moves between e2e/unit/integration tests, update `tests/e2e/coverage-matrix.json` and `tests/e2e/coverage-baseline-ids.json`.

---

## If you’re unsure

Prefer:

- Small, reversible changes
- Adding tests
- Keeping behavior consistent with README/Contributing docs

When in doubt, do not widen permissions, do not add network dependencies, and do not cross architecture boundaries.
