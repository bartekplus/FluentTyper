# Build and release commands

[FluentTyper](../../README.md) / [Contributing](../../CONTRIBUTING.md) / Commands

Run commands from the repository root with **Bun 1.4.2**. `bun.lock` defines reproducible dependencies.
The project uses TypeScript 7, Oxlint, and Prettier.

## Common Commands

Start with a production Chrome build:

```sh
bun install --frozen-lockfile
bun run build
```

The output is `build/`. To try it, follow [step 6 of the setup](../../CONTRIBUTING.md#run-the-extension-locally).

| Task                          | Command                            |
| ----------------------------- | ---------------------------------- |
| Build for Firefox             | `bun run build --platform=firefox` |
| Build for Edge                | `bun run build --platform=edge`    |
| Rebuild during development    | `bun run watch`                    |
| Check lint, format, and types | `bun run check`                    |
| Check types only              | `bun run typecheck`                |
| Apply lint and format fixes   | `bun run fix`                      |
| Run unit tests                | `bun run test`                     |
| Run Chrome smoke tests        | `bun run test:e2e`                 |
| Run the full Chrome suite     | `bun run test:e2e:full`            |
| Check development runtime     | `bun run test:e2e:dev`             |
| Check coverage mapping        | `bun run check:e2e:coverage`       |

`FT_LOG_LEVEL=debug bun run build` sets the default log level (`debug`, `info`, `warn` or `error`). Development builds default to `debug` and production builds to `warn`.

Use the [testing guide](testing.md) to choose additional suites.
For release work, continue to [versioning](#versioning).

## Local AI Review Assets

This section is for maintainers of optional Local AI Review. See [user-facing availability](../local-ai-review.md).

- Check pinned model files (size, SHA-256, and revision drift): `bun run probe:local-ai`.
- Check the production artifact: `bun run check:local-ai:artifact [--platform=edge|firefox] [--dir=build]`.
- Run the production build end to end on a real GPU (opt-in, downloads the model): `bun run test:local-ai:real [--tier=compact] [--plumbing-only]`.
- License notices: `public/local-ai/THIRD_PARTY_NOTICES.md` and `public/local-ai/ONNXRUNTIME_THIRD_PARTY_NOTICES.txt`.

`LOCAL_AI_ORT_FILES` in `scripts/check-local-ai-artifact.ts` pins the ONNX Runtime file (`ort-wasm-simd-threaded.asyncify.wasm`) by SHA-256 and size.
`build.ts` fails if `node_modules` holds a different file. When you upgrade Transformers.js, review the new runtime, then update that hash.
For the bundled runtime, `wasmPaths`, and model files, see [Packaging](../local-ai-reference.md#packaging-release-gate).

## Versioning

- Browser manifests live in:
  - `platform/chrome/manifest.json`
  - `platform/firefox/manifest.json`
  - `platform/edge/manifest.json`
- `package.json` is the source of truth for the extension version.
- Prefer `bun run bump` for version bumps. It runs `bun pm version`, which triggers the Bun `version` lifecycle and syncs the browser manifests through `scripts/update-manifest-version.cjs`.
- Do not hand-edit manifest versions in `platform/*/manifest.json`.

## English Lexicon (Review grammar)

Review's English rules read part-of-speech and inflection data from `src/core/domain/grammar/implementations/helpers/englishLexicon.generated.ts`, derived from `resources_js/en_US/hunspell/en_US.dic`/`.aff` and the irregular verb table in `EnglishVerbForms.ts`. After changing any of them, regenerate and commit the result:

```
bun run generate:english-lexicon
```

`tests/grammar/EnglishLexicon.test.ts` fails when the committed file drifts from its sources.

## Rebuilding Language Assets (presage data)

The Presage prediction engine reads its configuration from `resources_js/<lang>/presage.xml` and loads language data from packed binary `.data` files in `public/third_party/libpresage/`. The `src/third_party/libpresage/libpresage.js` file embeds metadata (file offsets/sizes) that maps the virtual filesystem to those `.data` files.

Install the Python packages for the build scripts first:

```
pip install -r scripts/requirements.txt
```

After you change a per-language `resources_js/<lang>/presage.xml` file, repack:

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

A full rebuild generates each `resources_js/<lang>/presage.xml` from `resources_js_lang_template/presage.xml`.
After you change the template, run a full rebuild: `python3 scripts/rebuild_all.py`.
Do not use `--repack` for a template change. It skips the language rebuild, so the change does not get to the per-language files.
As an alternative, apply the same change to each per-language file, then repack.

## Before a pull request

Run the [baseline checks](testing.md#baseline-before-a-pr), then follow [Prepare the pull request](../../CONTRIBUTING.md#prepare-the-pull-request).

---

[Architecture](architecture.md) · [Testing](testing.md) · [Return to contributing](../../CONTRIBUTING.md)
