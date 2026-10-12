# Build and release commands

[FluentTyper](../../README.md) / [Contributing](../../CONTRIBUTING.md) / Commands

Run commands from the repository root with **Bun 1.4.3**. `bun.lock` defines reproducible dependencies.
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

`bun run typecheck` uses Bun's built-in type checker, which reports the same errors as `tsc` from TypeScript 7.
It checks `src/` with `tsconfig.json` and the tests with `tests/tsconfig.json`.
Because `package.json` has a `check` script, `bun check` runs that script (lint, format, and types), not the type checker alone. The type checker is `bun --check`.
The `typescript` dev dependency is only for editors. Keep it at the version Bun's checker matches: `bun -p process.versions.typescript`.

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
bun run generate:lexicons english
```

`tests/grammar/EnglishLexicon.test.ts` fails when the committed file drifts from its sources.

The German noun lexicon (`src/core/domain/grammar/review/german/germanLexicon.generated.ts`) comes from `resources_js/de_DE/hunspell/de_DE.dic`/`.aff` the same way: `bun run generate:lexicons german`, checked by `tests/grammar/ReviewGerman.test.ts`.

With no language, `bun run generate:lexicons` runs the generators for all eight languages.

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

### Rebuilding the n-gram databases

`scripts/rebuild_ngram_db.py` builds `resources_js/<variant>/ngrams_db/` from the [HPLT 3.0](https://hplt-project.org/datasets/v3.0) web corpus. `rebuild_all.py` runs it for each language.

```
python3 scripts/rebuild_ngram_db.py -l pl -v pl_PL
```

Host tools: `curl`, `zstd` and `hunspell`. Python 3.12 or later with `scripts/requirements.txt`.

What the script does:

1. **Stream.** It reads `https://data.hplt-project.org/three/sorted/<lang>.map` and streams shards from the best quality bins (10, 9, 8, …) with `curl | zstd -dc`. It stops each stream when its quota of filtered text is full. A shard is 20 GB or more, so it never goes to disk.
2. **Filter documents.** It keeps a document only if all of these are true:
   - HPLT marks it `keep`.
   - Its language probability is 0.9 or more.
   - Its web register is everyday writing: forum or Q&A, opinion, review or blog, narrative or news, how-to, or spoken.
   - It is not machine-translated text, lyrics, an ad or sales text, a legal text, a product description, an encyclopedia text or a research text.
   - For `pt_BR` only, the host ends in `.br`.
3. **Filter lines.** It keeps a line only if all of these are true:
   - Its segment language is the target language.
   - It has 4 or more words.
   - It ends like a sentence.
   - It has no URLs, markup, long numbers, symbol runs or cookie or copyright text.
   - It is not an exact copy of a line already kept from the same shard.
4. **Cache.** It writes the filtered text to `scripts/.cache/hplt/<lang>_<variant>_<filter hash>/` as `.txt.zst`, with one held-out shard (`heldout.txt.zst`) for evaluation. The filter hash changes when the filter code changes, so old text is not used again by accident.
5. **Count.** `gen_ngram.py` counts in parallel, in two passes:
   - The first pass counts words and bigrams. Hunspell then checks each word once, in lowercase and in Title case. Words it rejects, words that contain digits and words seen fewer than 10 times are removed.
   - The second pass counts 1- to 4-grams. It splits the text at every removed word and at every bigram seen fewer than 10 times. This gives the same counts as filtering after counting, but uses much less temporary disk.
   - The pruning is the same as before: each n-gram must be seen 10 times or more, and each order is capped at 75% of the size of the order below it.
6. **Write.** `ngramtxt2marisa.py` writes `ngrams.trie` and `ngrams.counts`.

Useful flags:

- `--target-mb N`: filtered text to count, in MB. Default 1000.
- `--order N`: highest n-gram order. Default 4, which agrees with the four `DELTAS` in `presage.xml`.
- `--corpus-only`: fill the cache only.
- `--clean-cache`: delete the cache at the end. `rebuild_all.py` always sets it.
- `--min-free-gb N`: stop when free disk is below N GB. Default 20.

The script prints the cache size and free disk after each stage. `gen_ngram.py` prints the size of its temporary spill files.

The Review lexicon generators (`scripts/generate-<language>-lexicon.ts`) also read these databases. After a rebuild, run `bun run generate:lexicons` and the Review tests.

To compare models, use `scripts/eval_ngram.py`. It copies the presage `SmoothedNgramTriePredictor` scoring and reports keystroke savings (KSR), top-1 and top-5 next-word accuracy on held-out text:

```
python3 scripts/eval_ngram.py --model resources_js/pl_PL/ngrams_db --heldout scripts/.cache/hplt/<dir>/heldout.txt.zst -l pl
```

Why 1000 MB and order 4 (study on en and pl, held-out HPLT forum and opinion text):

- More text helps up to about 1000 MB. From 1000 to 3000 MB, KSR goes up by only 0.25 percentage points at the same DB size, but counting takes 3 times as long.
- Order 5 adds 0.02 percentage points of KSR or less. Order 3 loses about 0.1 points of KSR and 0.3 points of top-1.
- At the same DB size as the old OSCAR data, HPLT gives about 3 points more KSR for pl.

## Before a pull request

Run the [baseline checks](testing.md#baseline-before-a-pr), then follow [Prepare the pull request](../../CONTRIBUTING.md#prepare-the-pull-request).

---

[Architecture](architecture.md) · [Testing](testing.md) · [Return to contributing](../../CONTRIBUTING.md)
