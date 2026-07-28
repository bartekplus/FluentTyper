# Contributing to FluentTyper

Thanks for your interest in improving FluentTyper. This document is for developers and contributors.

## Before You Start

- Read the user docs in [README.md](README.md) to understand product behavior.
- Check open issues before starting work: [github.com/bartekplus/FluentTyper/issues](https://github.com/bartekplus/FluentTyper/issues)
- For bugs, use the bug report template: [issues/new/choose](https://github.com/bartekplus/FluentTyper/issues/new/choose)

## Development Setup

### Requirements

- [Bun](https://bun.sh/) `1.3.10` (pinned in `packageManager`)

### Local Setup

1. Fork the repository and clone your fork.
2. Install dependencies (`bun.lock` is the canonical lockfile):
   ```bash
   bun install
   ```
3. Build the extension:
   ```bash
   bun run build
   ```

## Run Locally in a Browser

Build once, or use watch mode for iterative development:

```bash
bun run build              # production build (Chrome)
bun run build --platform=firefox
bun run watch              # dev mode, rebuilds on change
```

Load the unpacked extension from the `build/` directory:

- **Chrome/Edge**: open extensions page, enable developer mode, choose "Load unpacked", select `build/`
- **Firefox**: open `about:debugging`, choose "This Firefox", click "Load Temporary Add-on", select `build/manifest.json`

## Architecture

FluentTyper uses a strict layered clean architecture. Imports flow downward only:

```
src/core/domain/          # Pure business logic, contracts, types
    ↓
src/core/application/     # Use-case orchestration, repositories, logging
    ↓
src/adapters/chrome/      # Browser integration (background + content-script)
    ↓
src/ui/                   # Popup, settings, onboarding UI
```

### Layer Rules

| Layer       | Path                    | Cannot import from        |
| ----------- | ----------------------- | ------------------------- |
| Domain      | `src/core/domain/`      | application, adapters, UI |
| Application | `src/core/application/` | adapters, UI              |
| Adapters    | `src/adapters/chrome/`  | UI                        |
| UI          | `src/ui/`               | adapter internals         |

Additionally, background and content-script are isolated from each other:

- `src/adapters/chrome/background/` must not import from `content-script/`
- `src/adapters/chrome/content-script/` must not import from `background/`

These boundaries are enforced by Oxlint `no-restricted-imports` rules.

### Entry Points

All entry points live in `src/entries/`:

| Entry                                | Context         | Timing           |
| ------------------------------------ | --------------- | ---------------- |
| `background.ts`                      | Service worker  | Extension load   |
| `content_script.ts`                  | Isolated world  | `document_end`   |
| `content_script_main_world.ts`       | Main world      | `document_end`   |
| `content_script_main_world_start.ts` | Main world      | `document_start` |
| `popup.ts`                           | Popup           | User click       |
| `settings.ts`                        | Options page    | User navigation  |
| `onboarding.ts`                      | Onboarding page | First install    |

### Import Conventions

- Prefer path aliases: `@core/*`, `@adapters/*`, `@ui/*`, `@third-party/*`
- Do not add imports from legacy roots (`src/background/*`, `src/content-script/*`, `src/shared/*`)
- Cross-layer contracts go in `src/core/domain/contracts/`
- Runtime message schemas go in `src/core/domain/messageTypes.d.ts`

See [docs/agents/architecture.md](docs/agents/architecture.md) for full details.

## Quality Checks

### Before Every PR

```bash
bun run check              # lint + format + typecheck (all must pass)
bun run test               # unit tests
bun run test:e2e           # e2e smoke (Chrome, <=10s target)
bun run check:e2e:coverage # coverage matrix validation
```

### Conditional Suites

Run these when your changes affect the corresponding area:

```bash
# Runtime or e2e behavior changed:
bun run test:e2e:full
bun run test:e2e:full --platform=firefox

# Development-mode hooks or toggles changed:
bun run test:e2e:dev
bun run test:e2e:dev --platform=firefox

# Cross-browser smoke (recommended):
bun run test:e2e --platform=firefox
```

### Autofix

```bash
bun run fix                # lint:fix + format
```

## Testing Policy

### Regression Tests

Every bug fix must include a regression test that would have caught the bug. The test must fail on the unfixed code and pass on the fixed code.

### Architecture-Sensitive Tests

Update these when your changes affect the corresponding area:

| Change area            | Test file(s)                                                                     |
| ---------------------- | -------------------------------------------------------------------------------- |
| Background routing     | `tests/background.routing.test.ts`                                               |
| Content-script runtime | `tests/content_script.behavior.test.ts`, `tests/content_script.watchdog.test.ts` |

### E2E Coverage Matrix

- Coverage parity is behavior-based, not test-count-based.
- When behavior coverage moves between e2e/unit/integration tests, update:
  - `tests/e2e/coverage-matrix.json`
  - `tests/e2e/coverage-baseline-ids.json`
- Keep selector-heavy permutations in unit/integration tests; reserve e2e for truly editor-specific behavior.

### Smoke Budget

- Target: `<=10s` wall-time for `bun run test:e2e` on both Chrome and Firefox.
- CI reports regressions but does not fail solely for exceeding the target.

## Runtime Feature Workflows

### Prediction and Messaging

Content script observes typing, requests predictions via runtime messaging, background runs prediction and responds, content script renders suggestions.

When changing message shapes, update all of:

1. `src/core/domain/messageTypes.d.ts`
2. `src/core/domain/constants.ts`
3. Background routers under `src/adapters/chrome/background/router/`
4. Content-script handlers under `src/adapters/chrome/content-script/`

### Predictor Constraints

- Production builds are **Presage-only**. Do not make WebLLM required for normal operation.
- Preserve safe fallbacks when the AI predictor is unavailable or times out.
- Do not expand the network surface area in production builds.

### Adding a Setting

1. Add key/constant in `src/core/domain/constants.ts`
2. Wire through repositories in `src/core/application/repositories/`
3. Include in runtime config via `src/adapters/chrome/background/config/ConfigAssembler.ts`
4. Update popup or settings UI, defaults, and any needed migrations

### Adding a Dynamic Variable

1. Add to `resolveDynamicVariable()` in `src/core/domain/variables.ts` if computable locally
2. Extend `TemplateExpander.createResolver()` if it needs browser context (tab, URL, etc.)
3. Add or update tests

### Logging

- Production: warn and error only
- Never log user text content
- Guard debug logging behind development mode or logging level controls

## Rebuilding Language Assets

When changing `presage.xml` or the language template, repack:

```bash
python3 scripts/rebuild_all.py --repack
```

If the compiled `.so` is missing (`scripts/.deps/presage/`), run a full rebuild first:

```bash
python3 scripts/rebuild_libpresage.py --deps --presage
python3 scripts/rebuild_all.py --repack
```

Commit the modified files: `public/third_party/libpresage/*.data` and `src/third_party/libpresage/libpresage.js`.

## Versioning

- `package.json` is the source of truth for the extension version.
- Use `bun run bump` for version bumps (syncs browser manifests automatically).
- Do not hand-edit manifest versions in `platform/*/manifest.json`.
- Browser manifests: `platform/chrome/manifest.json`, `platform/firefox/manifest.json`, `platform/edge/manifest.json`

## Branch and PR Workflow

1. Create a branch from `master`.
2. Keep commits focused and descriptive.
3. Open a pull request against `master`.
4. Ensure CI is green (lint, unit tests, e2e).
5. In the PR description:
   - Summarize user-visible impact
   - List the test suites you ran
   - Include screenshots for UI changes

## Bug Reporting

Report bugs via GitHub issue forms:

- [Issue chooser](https://github.com/bartekplus/FluentTyper/issues/new/choose)
- [Direct bug form](https://github.com/bartekplus/FluentTyper/issues/new?template=bug_report.yml)

Include: reproduction steps, expected vs. actual behavior, browser/OS, FluentTyper version, screenshots or recordings.

## Feature Requests

Propose improvements via GitHub issue forms:

- [Issue chooser](https://github.com/bartekplus/FluentTyper/issues/new/choose)
- [Direct feature form](https://github.com/bartekplus/FluentTyper/issues/new?template=feature_request.yml)

Include: the user problem, a concrete proposal, alternatives considered, browser context.

## Security Reporting

Do not disclose vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md) for private reporting.

## Documentation

- `README.md`: end-user focused
- `CONTRIBUTING.md`: developer and contribution workflow
- `docs/agents/`: detailed guides for architecture, testing, commands, and runtime features

When behavior changes, update docs in the same pull request.

## Dependencies

FluentTyper is built with:

- [Tribute](https://github.com/bartekplus/tribute)
- [Presage](https://github.com/bartekplus/presage)
- [Fancier Settings](https://github.com/bartekplus/fancier-settings)

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

## Sponsorship and Support

If you want to support maintenance and development:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Support-FFDD00?logo=buymeacoffee&logoColor=000000)](https://www.buymeacoffee.com/FluentTyper)
