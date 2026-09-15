# Runtime Feature Workflows

This guide covers the repo-specific workflows most likely to break runtime behavior if they are changed casually.

## Prediction and Messaging

High-level flow:

1. The content script observes typing and requests predictions through runtime messaging.
2. The background layer routes the message and runs prediction.
3. The background layer responds to the correct tab and frame.
4. The content script renders suggestions and handles acceptance.

If you change message shapes:

- Update `src/core/domain/messageTypes.d.ts`.
- Update related constants in `src/core/domain/constants.ts`.
- Update the background routers and handlers under `src/adapters/chrome/background/router/**`.
- Update the content-script message handling under `src/adapters/chrome/content-script/**`.

## Predictor Constraints

- Production store builds are Presage-only.
- WebLLM is allowed only in development and debug builds.
- Do not make WebLLM required for normal operation.
- Preserve safe fallbacks when the AI predictor is unavailable or times out.
- Avoid expanding the network surface area in production builds.

## Text Expansions and Dynamic Variables

Text expansion behavior is split between local domain resolution and browser-context-aware expansion.

- Local dynamic variables live in `src/core/domain/variables.ts`.
- Browser-context-aware expansion lives in `src/adapters/chrome/background/TemplateExpander.ts`.

When adding a new variable:

1. Add it to `resolveDynamicVariable(...)` in `src/core/domain/variables.ts` if it can be computed locally.
2. Extend `TemplateExpander.createResolver(...)` if it needs tab, title, URL, or other browser context.
3. Add or update tests for the new behavior.

## Settings Changes

When adding a user-facing setting:

- Add a key or constant in `src/core/domain/constants.ts` if runtime logic depends on it.
- Wire it through the relevant repositories in `src/core/application/repositories/**`.
- Include it in runtime config assembly when needed, usually in `src/adapters/chrome/background/config/ConfigAssembler.ts`.
- Update the popup or settings UI and any defaults or migrations that keep older stored settings compatible.

## Logging

- Production logging should stay minimal, typically warn and error only.
- Do not log full user text content.
- Guard extra debug logging behind development mode or the existing logging level controls.

## Google Docs

- Code lives in `src/adapters/chrome/content-script/google-docs/`. `ContentRuntimeController` creates `GoogleDocsAdapter` only on a top-level Docs edit page; the generic `SuggestionManager` is disabled only inside the hidden `iframe.docs-texteventtarget-iframe`.
- `GoogleDocsMainWorld` runs from `content_script_main_world_start.ts` (MAIN world, `document_start`) and sets `window._docs_annotate_canvas_by_ext` to FluentTyper's own extension ID so Docs exposes `_docs_annotate_getAnnotatedText`. Never impersonate another extension's ID.
- Isolated and MAIN worlds talk only through `CustomEvent`s with JSON string payloads; the bridge exposes no extension APIs to the page.
- Edits are single-use-token transactions: read model, select the minimal range, dispatch one synthetic plain-text paste, verify text. Unverified edits are never retried.
- Tests: `bun test tests/GoogleDocsModel.test.ts tests/GoogleDocsTransaction.test.ts` and `bun run test:e2e:docs` (Chromium fixture with real MAIN/isolated worlds, mocked Docs API). Live check: `bun run test:e2e:docs:live -- --help`.
