# AGENTS.md

FluentTyper is a privacy-first browser extension that provides local autocomplete, spellcheck, and text expansion across the web.

- Package manager: `bun@1.3.11`
- Build: `bun run build`
- Firefox build: `bun run build --platform=firefox`
- Full repo check: `bun run check`
- Typecheck only: `bun run typecheck`

## Core Principles

- Keep typed content local; do not add telemetry, external uploads, or phone-home behavior.
- Keep the core experience working offline.
- Do not add new permissions or host permissions unless a maintainer explicitly asks for them.
- Preserve platform separation across Chrome, Edge, and Firefox manifests and quirks.
- Preserve architecture boundaries: Domain -> Application -> Adapters -> UI.

## Task-Specific Guides

- [Commands and release workflow](docs/agents/commands.md)
- [Architecture and code placement](docs/agents/architecture.md)
- [Testing and coverage policy](docs/agents/testing.md)
- [Runtime feature workflows](docs/agents/runtime-features.md)
