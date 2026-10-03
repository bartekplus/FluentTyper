# Find the right place for your code

[FluentTyper](../../README.md) / [Contributing](../../CONTRIBUTING.md) / Architecture

Choose a layer by its responsibility, then follow its import rules. Keep browser behavior separate from domain logic.

| If you are changing…                 | Start in…               |
| ------------------------------------ | ----------------------- |
| Pure rules, contracts, or types      | `src/core/domain/`      |
| A use case or repository contract    | `src/core/application/` |
| Browser messaging or editor behavior | `src/adapters/chrome/`  |
| Popup, settings, or onboarding       | `src/ui/`               |

The adapter folder also contains shared code for Edge and Firefox. Platform manifests remain separate under `platform/`.

## Layers

- `src/core/domain/`: pure domain logic, contracts, constants, guards, and types. Do not import from application, adapters, or UI.
- `src/core/application/`: use-case orchestration, repositories, logging, and settings access. Do not import from adapters or UI.
- `src/adapters/chrome/`: browser integration for background and content-script runtime behavior. Do not import from UI.
- `src/ui/`: popup, onboarding, and settings UI. Do not import from adapter internals.

## Adapter Separation

Background code and page code communicate through contracts. They must not import each other's implementation.

<details>
<summary>Review and Local AI boundaries enforced by the build</summary>

- `src/adapters/chrome/background/**` must not import from `src/adapters/chrome/content-script/**`.
- `src/adapters/chrome/content-script/**` must not import from `src/adapters/chrome/background/**`.
- The Local AI Review runtime (engine, job host, consent controller) lives in `src/adapters/chrome/background/localAi/` and runs in the background service worker; content scripts reach it only through the review port and messages in `src/core/domain/contracts/localAi.ts`.
- Review detection (the detectors in `src/core/domain/grammar/review/`, their phrase tables and the generated English lexicon) runs only in the background service worker ([where detection runs](../review-reference.md#architecture)). Content-side code imports only the light Review modules (types, `textRanges`, `reviewFindings`, `reviewSpelling`, `bulkPlanner`, `liveProposalSelection`, `reviewCatalog`, `reviewMessages`, `reviewLocale`, `ai/*`), never `reviewDiagnostics`, `reviewDetectors`, `liveProposals`, `reviewExplanations` or `LocalReviewEngine`; the build fails if detector markers or a finding explanation appear in a content script. The options page may import `reviewExplanations`.
- Only `src/adapters/chrome/background/localAi/engineRuntime.ts` may import `@huggingface/transformers` (Transformers.js + ONNX Runtime Web). Only `src/entries/background.ts` imports it (tests get no engine); builds without the runtime (Firefox) swap it for `engineRuntime.noop.ts`. The build fails if the engine appears in any bundle but a Chrome/Edge `background.js`.

</details>

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
- Put cross-layer contracts in `src/core/domain/contracts/**`.
- Keep runtime message schemas and shared message types in `src/core/domain/messageTypes.d.ts`.

## Placement Heuristics

- Keep modules focused and composable; do not re-introduce large monolithic runtime files.
- Follow existing placement patterns before creating new top-level structure.
- The suggestion popup's look (stylesheet, row/footer markup, sizing, key hints) lives in `src/core/domain/suggestionPopup/`. The content-script popup and the options page's Appearance preview both render from it; change the popup there so the two stay in sync.
- Editor activation, key ownership, and Review write capability follow [editor capability detection](../editor-capabilities.md).
- When architecture changes affect routing or runtime boundaries, update the related tests called out in [testing.md](testing.md).

---

[Runtime feature workflows](runtime-features.md) · [Testing](testing.md) · [Return to contributing](../../CONTRIBUTING.md)
