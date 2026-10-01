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
- The Local AI Review runtime (engine, job host, consent controller) lives in `src/adapters/chrome/background/localAi/` and runs in the background service worker; content scripts reach it only through the review port and messages in `src/core/domain/contracts/localAi.ts`.
- Review detection (the detectors in `src/core/domain/grammar/review/`, their phrase tables and the generated English lexicon) runs only in the background service worker: `ReviewEngineHost` runs a `LocalReviewEngine` per review session. Content scripts reach it through the `ReviewEngine` port (`src/core/application/review/ReviewEngine.ts`), implemented by `MessagingReviewEngine`, with the messages in `src/core/domain/contracts/reviewEngine.ts`. Content-side code imports only the light Review modules (types, `textRanges`, `reviewFindings`, `reviewSpelling`, `bulkPlanner`, `liveProposalSelection`, `reviewCatalog`, `reviewMessages`, `ai/*`), never `reviewDiagnostics`, `reviewDetectors`, `liveProposals` or `LocalReviewEngine`; the build fails if detector markers appear in a content script.
- Only `src/adapters/chrome/background/localAi/engineRuntime.ts` may import `@huggingface/transformers` (Transformers.js + ONNX Runtime Web). Only `src/entries/background.ts` imports it (tests get no engine); builds without the runtime (Firefox) swap it for `engineRuntime.noop.ts`. The build fails if the engine appears in any bundle but a Chrome/Edge `background.js`.

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
- The suggestion popup's look (stylesheet, row/footer markup, sizing, key hints) lives in `src/core/domain/suggestionPopup/`. The content-script popup and the options page's Appearance preview both render from it; change the popup there so the two stay in sync.
- When architecture changes affect routing or runtime boundaries, update the related tests called out in [testing.md](testing.md).
