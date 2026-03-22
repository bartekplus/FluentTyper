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
