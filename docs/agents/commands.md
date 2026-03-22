# Commands and Release Workflow

Use Bun for installs, scripts, and versioning. `bun.lock` is the canonical lockfile.

- Primary language: TypeScript with strict type-checking.
- Linting and formatting are handled with ESLint and Prettier through the Bun scripts in `package.json`.

## Common Commands

- Install dependencies: `bun install`
- Production build: `bun run build`
- Firefox production build: `bun run build --platform=firefox`
- Watch mode: `bun run watch`
- Full repo check: `bun run check`
- Typecheck only: `bun run typecheck`
- Unit tests: `bun run test`
- Smoke e2e: `bun run test:e2e`
- Full e2e: `bun run test:e2e:full`
- Dev-runtime e2e: `bun run test:e2e:dev`
- E2E coverage validation: `bun run check:e2e:coverage`
- Autofix lint and format: `bun run fix`

Production builds write the unpacked extension output to `build/`.

## Local Browser Loading

- Chrome and Edge: load the unpacked extension from `build/`.
- Firefox: open `about:debugging`, choose "This Firefox", then load `build/manifest.json`.

## Versioning

- Browser manifests live in:
  - `platform/chrome/manifest.json`
  - `platform/firefox/manifest.json`
  - `platform/edge/manifest.json`
- `package.json` is the source of truth for the extension version.
- Prefer `bun run bump` for version bumps. It runs `bun pm version`, which triggers the Bun `version` lifecycle and syncs the browser manifests through `scripts/update-manifest-version.cjs`.
- Do not hand-edit manifest versions in `platform/*/manifest.json`.

## Rebuilding Language Assets (presage data)

The Presage prediction engine reads its configuration from `resources_js/<lang>/presage.xml` and loads language data from packed binary `.data` files in `public/third_party/libpresage/`. The `src/third_party/libpresage/libpresage.js` file embeds metadata (file offsets/sizes) that maps the virtual filesystem to those `.data` files.

**Whenever you change a `presage.xml` file or `resources_js_lang_template/presage.xml`, you must repack:**

```
python3 scripts/rebuild_all.py --repack
```

This runs two steps:
1. **Package** – repacks all `resources_js/` directories into updated `.data` files (copied to `public/third_party/libpresage/`) and regenerates the pre-JS loader stubs in `scripts/.deps/gen/`.
2. **Link** – re-links `libpresage.js` with the new stubs embedded, requiring a pre-built `libpresage.so.1.1.1` in `scripts/.deps/presage/`.

If the compiled `.so` is not present (i.e. `scripts/.deps/presage/` is missing), run a full rebuild first:

```
python3 scripts/rebuild_libpresage.py --deps --presage
python3 scripts/rebuild_all.py --repack
```

After repacking, the following files will be modified and must be committed:
- `public/third_party/libpresage/*.data`
- `src/third_party/libpresage/libpresage.js`

> **Note:** `resources_js/<lang>/presage.xml` files are generated from `resources_js_lang_template/presage.xml` during a full rebuild. Always edit the template first, then regenerate per-language files with a full rebuild or by manually applying the same change to all language variants.

## Release-Safe Defaults

- If a change affects runtime behavior, run the expanded e2e suite described in [testing.md](testing.md).
- If a change affects docs or workflows, keep [`README.md`](../../README.md) and [`CONTRIBUTING.md`](../../CONTRIBUTING.md) aligned with the same command surface.

## PR Notes

- Summarize the user-visible impact.
- List the tests you ran.
- If a change affects runtime behavior, add or update tests.
- If a change affects UI, include screenshots when they help reviewers.
