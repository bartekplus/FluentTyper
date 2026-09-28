# Local AI Review: implementation report

Branch `feat/local-ai-review` (from `master` at `53171743`). Not merged, published or
submitted to any store. Design: [local-ai-review.md](local-ai-review.md). Evidence:
[local-ai-evaluation.md](local-ai-evaluation.md). User documentation:
[review-mode.md](review-mode.md#local-ai-optional).

## What was built

Optional on-device proofreading inside the existing Review panel (Chrome and Edge):

- **Correct** (default): after the rule and dictionary results, a local model checks the
  scope paragraph by paragraph; validated corrections join the same list tagged
  "Local AI". Never in "Fix all safe"; applied one at a time or through a previewed
  "Apply selected AI corrections".
- **Rewrite** (explicit): six styles, one proposal, before/after diff, Apply only for a
  complete validated proposal; Copy on review-only editors.
- **Setup** in Settings → Grammar → Local AI: explicit download with size and host
  disclosure, Recommended (Gemma 4 E4B, 5.2 GB) or Compact (Qwen3 4B Instruct 2507,
  2.9 GB), status, cancel, delete. Nothing is downloaded, loaded or started before that.
- **Engine:** Transformers.js 4.3.0 (ONNX Runtime Web on WebGPU) in a module worker of an
  offscreen document; the runtime ships inside the extension, a model is only data. The
  model holds GPU memory only while a Review with Local AI is open. WebLLM, first used for
  this feature, is removed completely (its per-model libraries had no license).
- Autocomplete stays Presage-only in every production build.

## Changed areas

| Layer                   | Main files                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain (pure)           | `src/core/domain/grammar/review/ai/*` (chunking, prompts `review-ai-3`, strict parser, validator/diff), `src/core/domain/localAi/modelRegistry.ts`, `src/core/domain/contracts/localAi.ts`                                                                                                                                         |
| Application             | `src/core/application/review/ReviewSession.ts`, `reviewAi.ts`, `repositories/LocalAiSettingsRepository.ts`                                                                                                                                                                                                                         |
| Background              | `background/localAi/LocalAiController.ts` (consent authority, offscreen lifecycle), `MessageRouter.ts` handlers, `ConfigAssembler.ts`, `PredictionManager.ts` (production never wires the AI predictor)                                                                                                                            |
| Offscreen (new adapter) | `offscreen/LocalAiHost.ts`, `JobScheduler.ts`, `WorkerClient.ts`, `worker/LocalAiWorkerEngine.ts` (Transformers.js), `worker/networkGuard.ts` (exact-file allowlist), `worker/modelArtifacts.ts` + `worker/sha256.ts` (streamed install, hash verification); entries `local_ai_offscreen.ts`, `local_ai_worker.ts`                 |
| Content script          | `review/LocalAiReviewProvider.ts`, `ReviewController.ts`, `ReviewUi.ts`, `reviewStyles.ts`                                                                                                                                                                                                                                         |
| Options UI              | `src/ui/options/LocalAiSettingsPanel.ts`, `public/options/local-ai.css`                                                                                                                                                                                                                                                            |
| Build and release       | `build.ts` (dev flag decoupled from runtime inclusion; the engine only in the worker bundle; packaged, hash-pinned ONNX Runtime files; CSP), `platform/{chrome,edge}/manifest.json` (`offscreen`), `scripts/fetch-local-ai-assets.ts` (`--probe` of pinned model files), `scripts/check-local-ai-artifact.ts`, `public/local-ai/*` |
| Removed                 | `@mlc-ai/web-llm`, the dev-only WebLLM autocomplete experiment (`WebLLMPredictor`, `background/webllm/*`, its settings and tests)                                                                                                                                                                                                  |
| Evaluation              | `scripts/local-ai-bench/*`, `scripts/local-ai-eval/score.ts`, `scripts/local-ai-e2e-real.ts`, `tests/fixtures/local-ai/*` (230 Correct, 35 Rewrite fixtures)                                                                                                                                                                       |

## Commands and results

Final sweep on the branch head (macOS, Apple M2 Max, Bun 1.4.2):

| Command                                                                                                    | Result                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                                                                            | pass                                                                                    |
| `bun run check` (oxlint, prettier, typecheck)                                                              | pass                                                                                    |
| `bun run test`                                                                                             | pass: 3,281 in the main suite plus the isolated suites, 0 failures                      |
| `bun run build --platform=chrome` / `edge` / `firefox`, each followed by `bun run check:local-ai:artifact` | pass (all three)                                                                        |
| `bun run build --mode=development`                                                                         | pass                                                                                    |
| `bun run test:e2e` (smoke, Chrome)                                                                         | 26 pass                                                                                 |
| `bun run test:e2e:full` (includes `tests/e2e/local-ai.e2e.test.ts`)                                        | 91 pass, 10 skipped (dev-runtime-only tests and the Firefox-only Local AI test), 0 fail |
| `bun run check:e2e:coverage`                                                                               | pass: 181 behaviors                                                                     |
| `bun run test:e2e:docs`                                                                                    | 90 pass                                                                                 |
| `bun run test:e2e:dev`                                                                                     | 9 pass                                                                                  |
| `bun run bench:local-ai --real` (opt-in, real GPU)                                                         | see Measured model results                                                              |
| `bun run test:local-ai:real` (opt-in, real GPU, production extension)                                      | all 14 steps pass (Gemma 4 E4B)                                                         |

Not run: Firefox e2e (the bundled Firefox cannot start on this machine; baseline smoke fails
the same way) and anything on Edge in a browser. Baseline before this work: check, unit
tests and build all passed on `master`.

## Independent review

Two rounds of independent read-only review (privacy/security, lifecycle/staleness,
validator/meaning drift; then everything changed after round 1), plus the real-GPU runs,
which found the most serious problems. Every finding below was fixed with a test that
failed first.

| Source                    | Finding                                                                                                        | Fix                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Review 1, privacy         | Review ports accepted on `sender.tab` alone: an extension page in a tab could open one                         | Extension-origin senders refused                                                                              |
| Review 1, validator       | `likely` → `unlikely` accepted as spelling                                                                     | Negating affixes are never close words                                                                        |
| Review 1, validator       | `300 kb` → `300 mb` accepted                                                                                   | A word right after a number is never changed                                                                  |
| Review 1, validator       | Rewrite could swap `3` and `5`                                                                                 | Numbers compared in order                                                                                     |
| Review 1, lifecycle (low) | Dictionary add left a ready rewrite showing "ready"                                                            | Marked stale                                                                                                  |
| Runtime agent             | Model load had no bound                                                                                        | 180 s, then the worker is torn down                                                                           |
| Real-GPU evaluation       | WebLLM 0.2.85 fails every bare `json_object` request                                                           | Schema sent with every request                                                                                |
| Real-GPU evaluation       | Prompt v1 made Qwen3 echo input (0/70 corrections)                                                             | Measured prompt adopted as `review-ai-2`                                                                      |
| Real-GPU evaluation       | Validator accepted dialect swaps, code-bracket edits, edge whitespace, noun-number flips, a translated rewrite | Rejected                                                                                                      |
| Real-GPU evaluation       | Both models damaged a Polish rewrite                                                                           | Local AI limited to evaluated languages (English)                                                             |
| E2E                       | Firefox showed an AI note on every Review                                                                      | No AI UI without a runtime host                                                                               |
| Real-GPU extension e2e    | Hugging Face redirects to a regional `*.cdn.hf.co` host: installs impossible                                   | Allowlisted in CSP and network guard                                                                          |
| Real-GPU extension e2e    | Downloads left a 1.1 GB copy in Chrome's HTTP cache after Delete                                               | `cache: "no-store"`                                                                                           |
| User report               | Correct found almost nothing on error-dense text; Rewrite discarded for one sentence; unclear message          | Prompt `review-ai-3`, one sentence per request, per-change validation, per-sentence Rewrite, clearer messages |
| User request              | Model stayed in GPU memory 5 min after a Review                                                                | Released as soon as the last Review closes                                                                    |
| Real-GPU extension e2e    | GPU release broke installs (idle closed the document mid-install)                                              | Install in flight keeps the document                                                                          |
| Engine comparison         | WebLLM's per-model libraries have no license                                                                   | Engine switched to Transformers.js                                                                            |
| Real-GPU extension e2e    | Transformers.js requested `tokenizer_config.json` from `main`, not the pinned revision                         | Every request pinned to the registry revision                                                                 |
| Gemma 4 full suite        | 6 accepted style edits to correct text (commas, subjunctive, case after a colon, collective nouns)             | Rejected by the validator: 0 of 119                                                                           |

Round 2 found no issues at or above its confidence threshold.

## Measured model results

Apple M2 Max (Metal), Chrome for Testing 154, Transformers.js 4.3.0, prompt `review-ai-3`,
current validator; each fixture ran once (230 Correct: 119 expected unchanged, 111
expected corrections; 35 Rewrite). Details: [local-ai-evaluation.md](local-ai-evaluation.md).

| Model                                    | Correct text changed | Exact corrections | Dense / held-out fixes accepted | Per sentence p50 | Cold load |
| ---------------------------------------- | -------------------- | ----------------- | ------------------------------- | ---------------- | --------- |
| Gemma 4 E4B-it (Recommended, 5.2 GB)     | 0/119                | 98/111            | 78% / 84%                       | 1.8 s            | ~10 s     |
| Qwen3-4B-Instruct-2507 (Compact, 2.9 GB) | 0/119                | 83/111            | 63% / 58%                       | 1.5 s            | ~4 s      |

No accepted English change to a number, negation, hedge or name. Gemma 4 E4B Rewrite: one
real drift in 35 (`the thing restarts` → `the system restarts`).

Integrated extension run (production build, Gemma 4 E4B, `bun run test:local-ai:real`, all
14 steps pass): install 157 s (5.2 GB); first Local AI finding 8.1 s after Review opens
(model loads from disk each time a Review opens); the user's 10-sentence paragraph
complete in 29 s; GPU released 1.1 s after the Review closes; Rewrite 7.9 s; offline cold
start → first finding 8.0 s; partial cache fails honestly; delete leaves no copy; no
sentinel text in storage, console or profile files.

## Verified support

| Environment                                                              | Status                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chrome (production build, headless Chrome for Testing 154, Apple M2 Max) | Verified end to end with a real model, including offline and partial-cache behavior                                                                                                                          |
| Edge                                                                     | Builds and passes the artifact check; not run in a browser                                                                                                                                                   |
| Firefox                                                                  | Builds without the runtime; Review unchanged by design. Firefox e2e cannot launch on this machine (the existing smoke suite fails the same way), so this path is covered by unit tests only                  |
| Editors                                                                  | Textarea verified with the real model; contenteditable, Quill, review-only editors and Google Docs use the existing verified targets and are covered by unit and existing e2e tests, not by a real-model run |
| Other GPUs and operating systems, low-memory devices                     | Not verified                                                                                                                                                                                                 |

## Acceptance checklist (spec §14)

| Item                                                                     | Status                                                                                                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Popup/inline prediction never routes to a model                          | Done: autocomplete has no AI path at all; the build fails if the engine reaches any bundle but the worker; e2e with stale legacy settings |
| Correct is default, automatic after setup, never edits by itself         | Done                                                                                                                                      |
| Explicit download; disable/delete persist; no startup inference          | Done (e2e: no offscreen document or model request before consent)                                                                         |
| Rewrite explicit, complete diff, explicit accept                         | Done                                                                                                                                      |
| Context bounded; protected and read-only text not modifiable             | Done (unit-tested; real-model run on a textarea)                                                                                          |
| Strict validation and deterministic mapping                              | Done                                                                                                                                      |
| AI never in "Fix all safe"; dependent edits atomic                       | Done                                                                                                                                      |
| Editor transaction, undo, IME, capability, readback protections intact   | Done (existing write path only; native undo verified with the real model)                                                                 |
| Late/stale/cross-tab results cannot land                                 | Done (unit-tested; reviewed twice)                                                                                                        |
| No uploads, logs, persistent prompts or journals                         | Verified by sentinel scans in the real run; no resumable generation or chat history                                                       |
| Offline with networking denied, cold cache; partial cache fails honestly | Verified in the real run                                                                                                                  |
| Packaged executable WASM; no dev hooks in production                     | Done: ONNX Runtime WASM packaged and hash-pinned; model files are data; artifact check per platform                                       |
| Real-device evidence for the default model                               | Done for one device (above)                                                                                                               |
| Unsupported environments keep today's experience                         | Done                                                                                                                                      |
| Unit, integration, e2e, build, privacy checks pass                       | See the results table; Firefox e2e unavailable on this machine                                                                            |
| Review findings addressed, limitations documented                        | Done                                                                                                                                      |

## Remaining release blockers and limitations

1. **ONNX Runtime Web is a dev pre-release** (`1.31.0-dev.20260914`, pinned exactly by
   Transformers.js 4.3.0). A stable ORT with a compatible Transformers.js release should be
   adopted before a store release.
2. **Store review** is not guaranteed; the packaged runtime follows the MV3 remote-code
   rules (nothing executable is downloaded) but has not been submitted.
3. **Size and speed:** the Recommended model is a 5.2 GB download, and since the GPU is
   released after every Review, each Review waits ~8 s for the model to load before the
   first Local AI finding (rule findings still appear at once).
4. **Hardware coverage:** one GPU and OS measured; memory use not measured. Integrated or
   low-memory GPUs, Windows, Linux and ChromeOS are unverified.
5. **Recall:** Gemma 4 E4B still misses some errors (about 1 in 5 on the dense fixtures);
   it abstains rather than guessing.
6. **Languages:** English only. Other languages need their own evaluation first.
7. **Known validator limits:** hedge swaps in rewrites (`might` → `may`) pass because
   hedges are counted, not matched; a plausible wrong "correction" of a valid word would
   need a dictionary check.
8. **Firefox and Edge** were not exercised in a browser here (Firefox has no offscreen
   documents: Review works without AI there).
