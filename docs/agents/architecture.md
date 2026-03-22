# Architecture and Code Placement

FluentTyper uses a layered architecture. Keep imports and responsibilities flowing downward only.

## Layers

- `src/core/domain/`: pure domain logic, contracts, constants, guards, and types. Do not import from application, adapters, or UI.
- `src/core/application/`: use-case orchestration, repositories, logging, and settings access. Do not import from adapters or UI.
- `src/adapters/chrome/`: browser integration for background and content-script runtime behavior. Do not import from UI.
- `src/ui/`: popup, onboarding, and settings UI. Do not import from adapter internals.

## Adapter Separation

- `src/adapters/chrome/background/**` must not import from `src/adapters/chrome/content-script/**`.
- `src/adapters/chrome/content-script/**` must not import from `src/adapters/chrome/background/**`.

## Entry Points

- `src/entries/background.ts`
- `src/entries/content_script.ts`
- `src/entries/content_script_main_world.ts`
- `src/entries/content_script_main_world_start.ts`
- `src/entries/popup.ts`
- `src/entries/settings.ts`
- `src/entries/onboarding.ts`

## Imports and Shared Contracts

- Prefer path aliases: `@core/*`, `@adapters/*`, `@ui/*`, `@third-party/*`.
- Avoid legacy roots such as `src/background/*`, `src/content-script/*`, and `src/shared/*`.
- Put cross-layer contracts in `src/core/domain/contracts/**`.
- Keep runtime message schemas and shared message types in `src/core/domain/messageTypes.d.ts`.

## Placement Heuristics

- Keep modules focused and composable; do not re-introduce large monolithic runtime files.
- Follow existing placement patterns before creating new top-level structure.
- When architecture changes affect routing or runtime boundaries, update the related tests called out in [testing.md](testing.md).
