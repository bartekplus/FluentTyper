# Commands and Release Workflow

Use Bun for installs, scripts, and versioning. `bun.lock` is the canonical lockfile.

- Primary language: TypeScript 7 with strict type-checking.
- Linting and formatting are handled with Oxlint and Prettier through the Bun scripts in `package.json`.

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
- Probe the Local AI model registry against Hugging Face: `bun run probe:local-ai`
- Local AI release gate on a production build: `bun run check:local-ai:artifact [--platform=edge|firefox] [--dir=build]`

Production builds write the unpacked extension output to `build/`.

## Local AI Review Assets

Chrome and Edge builds package the Local AI Review runtime, because Chrome MV3 forbids remotely hosted code: Transformers.js (`@huggingface/transformers`, exact version) bundled into `local-ai/worker.js` (an ES module worker), and the ONNX Runtime WebGPU files it loads, copied unmodified from the `onnxruntime-web` that Transformers.js resolves into `local-ai/ort/`.

- The ONNX Runtime files (`ort-wasm-simd-threaded.asyncify.wasm` and its `.mjs` glue) are pinned by SHA-256 and size in `LOCAL_AI_ORT_FILES` (`scripts/check-local-ai-artifact.ts`). `build.ts` fails if `node_modules` holds anything else. When upgrading Transformers.js, review the new runtime, then update those hashes. The worker points `env.backends.onnx.wasm.wasmPaths` at the extension's `local-ai/ort/`, so the default CDN is never used.
- Models are data only (ONNX graph, weights, tokenizer, config). They are downloaded after consent from the pinned Hugging Face revisions and files listed in `src/core/domain/localAi/modelRegistry.ts`. `bun run probe:local-ai` re-lists each record's files (size and SHA-256) at the pinned revision, flags drift, and reports whether the repository has moved.
- Every runtime component is published under MIT or Apache-2.0 by its authors, and no per-model executable ships, which removes the earlier license blocker on WebLLM's `binary-mlc-llm-libs`. Notices are in `public/local-ai/THIRD_PARTY_NOTICES.md` and `public/local-ai/ONNXRUNTIME_THIRD_PARTY_NOTICES.txt`.
- The `offscreen` permission (Chrome/Edge only) hosts the optional on-device model worker; it shows no install-time warning.

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

## Quality Gate (required before every PR)

Run the full check suite and fix all errors before pushing:

```
bun run check
```

This runs lint (`oxlint`), format check (`prettier --check`), and TypeScript 7 typecheck in sequence. All three must pass. Do not push a branch with a failing `bun run check`.

## PR Notes

- Summarize the user-visible impact.
- List the tests you ran.
- If a change affects runtime behavior, add or update tests.
- If a change affects UI, include screenshots when they help reviewers.
