# Contributing to FluentTyper

Thanks for your interest in improving FluentTyper. This document is for developers and contributors.

## Before You Start

- Read the user docs in [README.md](README.md) to understand product behavior.
- Check open issues before starting work: [github.com/bartekplus/FluentTyper/issues](https://github.com/bartekplus/FluentTyper/issues)
- For bugs, use the bug report template: [issues/new/choose](https://github.com/bartekplus/FluentTyper/issues/new/choose)

## Development Setup

### Requirements

- Bun 1.3.10 (pinned in `packageManager`)

### Local Setup

1. Fork the repository and clone your fork.
2. Use Bun lockfile-based install for reproducibility (`bun.lock` is canonical).
3. Install dependencies:
   ```bash
   bun install
   ```
4. Build the extension:
   ```bash
   bun run build
   ```

## Run Locally in a Browser

Build once:

```bash
bun run build
```

Or run watch mode for iterative development:

```bash
bun run watch
```

To build Firefox instead of the default Chrome target:

```bash
bun run build --platform=firefox
```

Load the unpacked extension from the `build/` directory:

- Chrome/Edge: open extensions page, enable developer mode, choose "Load unpacked", select `build/`
- Firefox: open `about:debugging`, choose "This Firefox", click "Load Temporary Add-on", select `build/manifest.json`

## Architecture Contribution Rules

This repository uses a layered architecture. New code should follow these boundaries:

- `src/core/domain`: domain models, contracts, guards, and pure logic. Do not import from `@core/application`, `@adapters`, or `@ui`.
- `src/core/application`: use-case orchestration, repositories, logging, and settings access. Do not import from `@adapters` or `@ui`.
- `src/adapters/chrome`: browser/runtime integration (background and content-script). Do not import from `@ui`.
- `src/ui`: popup/options UI. Do not import from adapter internals.

Adapter-specific separation:

- `src/adapters/chrome/background` must not import from `@adapters/chrome/content-script/*`.
- `src/adapters/chrome/content-script` must not import from `@adapters/chrome/background/*`.

Import and placement conventions:

- Prefer path aliases: `@core/*`, `@adapters/*`, `@ui/*`, `@third-party/*`.
- Do not add new imports from legacy roots like `src/background/*`, `src/content-script/*`, or `src/shared/*`.
- Keep modules focused and composable. Avoid re-introducing large monolithic runtime files.
- Put cross-layer contracts in `src/core/domain/contracts` and keep message schemas/types in `src/core/domain/messageTypes.d.ts`.
- Update tests with architectural changes (for example routing changes in `tests/background.routing.test.ts`, content runtime changes in `tests/content_script.behavior.test.ts` and `tests/content_script.watchdog.test.ts`).

## Quality Checks

Run these before opening a pull request:

```bash
bun run check
bun run test
```

Optional local autofix formatting and linting:

```bash
bun run lint
```

PR end-to-end expectations:

```bash
# Required for every PR:
bun run test:e2e
bun run check:e2e:coverage

# Required when changing runtime/e2e behavior:
bun run test:e2e:full
bun run test:e2e:full --platform=firefox

# Required when changing development-mode runtime hooks/toggles:
bun run test:e2e:dev
bun run test:e2e:dev --platform=firefox

# Recommended for cross-browser smoke validation before PR:
bun run test:e2e --platform=firefox
```

Notes:

- `bun run test:e2e` is the fast smoke suite and defaults to `--platform=chrome`.
- `bun run test:e2e:full` runs deeper regression e2e coverage.
- `bun run test:e2e:dev` builds with `--mode=development` and runs dev/runtime-hook-specific e2e coverage.
- Smoke budget policy is strict: CI enforces `<=10s` wall-time for `bun run test:e2e --platform=chrome` and `bun run test:e2e --platform=firefox`.
- `bun run check:e2e:coverage` validates behavior IDs and coverage mappings in:
  - `tests/e2e/coverage-matrix.json`
  - `tests/e2e/coverage-baseline-ids.json`

### E2E Coverage Policy

- Coverage parity is tracked by behavior coverage, not by preserving identical e2e test counts.
- When adding, removing, or moving behavior coverage between e2e/unit/integration tests, update `tests/e2e/coverage-matrix.json` and `tests/e2e/coverage-baseline-ids.json`.
- Keep selector-heavy permutations in unit/integration tests when behavior is selector-agnostic, and reserve e2e selector fan-out for truly editor-specific behavior.

## Branch and PR Workflow

1. Create a branch from `master`.
2. Keep commits focused and descriptive.
3. Open a pull request against `master`.
4. Ensure CI is green (tests and lint checks).
5. Describe what changed, why, and how it was tested.

## Bug Reporting Process

Both users and contributors should report product bugs via GitHub issue forms:

- Issue chooser: [github.com/bartekplus/FluentTyper/issues/new/choose](https://github.com/bartekplus/FluentTyper/issues/new/choose)
- Direct bug form: [bug_report.yml](https://github.com/bartekplus/FluentTyper/issues/new?template=bug_report.yml)

Include these details in every bug report:

- Clear reproduction steps
- Expected result
- Actual result
- Browser and OS
- FluentTyper version
- Screenshots or recordings (if available)

## Feature Request Process

Use GitHub issue forms for feature ideas and product improvements:

- Issue chooser: [github.com/bartekplus/FluentTyper/issues/new/choose](https://github.com/bartekplus/FluentTyper/issues/new/choose)
- Direct feature form: [feature_request.yml](https://github.com/bartekplus/FluentTyper/issues/new?template=feature_request.yml)

Strong feature requests include:

- The user problem and impact
- A concrete proposal
- Alternatives considered
- Browser-specific context

## Security Reporting

Do not disclose vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md) for private reporting.

## Documentation Contributions

Documentation improvements are welcome. Keep audience separation:

- `README.md`: end-user focused
- `CONTRIBUTING.md`: developer and contribution workflow

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
