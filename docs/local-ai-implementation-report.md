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
  disclosure, Recommended (Qwen3 4B, 2.26 GB) or Compact (Qwen3 1.7B, 0.97 GB), status,
  cancel, delete. Nothing is downloaded, loaded or started before that.
- Autocomplete stays Presage-only in every production build.

## Changed areas

| Layer                   | Main files                                                                                                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain (pure)           | `src/core/domain/grammar/review/ai/*` (chunking, prompts `review-ai-3`, strict parser, validator/diff), `src/core/domain/localAi/modelRegistry.ts`, `src/core/domain/contracts/localAi.ts`                                                                |
| Application             | `src/core/application/review/ReviewSession.ts`, `reviewAi.ts`, `repositories/LocalAiSettingsRepository.ts`                                                                                                                                                |
| Background              | `background/localAi/LocalAiController.ts` (consent authority, offscreen lifecycle), `MessageRouter.ts` handlers, `ConfigAssembler.ts`, `PredictionManager.ts` (production never wires the AI predictor)                                                   |
| Offscreen (new adapter) | `offscreen/LocalAiHost.ts`, `JobScheduler.ts`, `WorkerClient.ts`, `worker/LocalAiWorkerEngine.ts`, `worker/networkGuard.ts`, `worker/modelArtifacts.ts`; entries `local_ai_offscreen.ts`, `local_ai_worker.ts`                                            |
| Content script          | `review/LocalAiReviewProvider.ts`, `ReviewController.ts`, `ReviewUi.ts`, `reviewStyles.ts`                                                                                                                                                                |
| Options UI              | `src/ui/options/LocalAiSettingsPanel.ts`, `public/options/local-ai.css`                                                                                                                                                                                   |
| Build and release       | `build.ts` (dev flag decoupled from runtime inclusion; WebLLM only in the two Local AI bundles; CSP), `platform/{chrome,edge}/manifest.json` (`offscreen`), `scripts/fetch-local-ai-assets.ts`, `scripts/check-local-ai-artifact.ts`, `public/local-ai/*` |
| Evaluation              | `scripts/local-ai-bench/*`, `scripts/local-ai-eval/score.ts`, `scripts/local-ai-e2e-real.ts`, `tests/fixtures/local-ai/*` (157 Correct, 34 Rewrite fixtures)                                                                                              |

## Commands and results

Final sweep on the branch head (macOS, Apple M2 Max, Bun 1.4.2):

| Command                                                                                                    | Result                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                                                                            | pass                                                                                                                                |
| `bun run check` (oxlint, prettier, typecheck)                                                              | pass                                                                                                                                |
| `bun run test`                                                                                             | pass: 3,171 in the main suite plus the isolated suites, 0 failures                                                                  |
| `bun run build --platform=chrome` / `edge` / `firefox`, each followed by `bun run check:local-ai:artifact` | pass (all three)                                                                                                                    |
| `bun run build --mode=development`                                                                         | pass                                                                                                                                |
| `bun run test:e2e` (smoke, Chrome)                                                                         | 27 pass, 9.8 s                                                                                                                      |
| `bun run test:e2e:full` (includes `tests/e2e/local-ai.e2e.test.ts`)                                        | 91 pass, 13 skipped (10 dev-runtime-only tests, which run in the dev suite, and the Firefox-only Local AI test, among them), 0 fail |
| `bun run check:e2e:coverage`                                                                               | pass: 184 behaviors                                                                                                                 |
| `bun run test:e2e:docs`                                                                                    | 90 pass                                                                                                                             |
| `bun run test:e2e:dev`                                                                                     | 12 pass                                                                                                                             |
| `bun run bench:local-ai --real` (opt-in, real GPU)                                                         | see Measured model results                                                                                                          |
| `bun run test:local-ai:real` (opt-in, real GPU, production extension)                                      | all 12 steps pass                                                                                                                   |

Not run: Firefox e2e (the bundled Firefox cannot start on this machine; baseline smoke fails
the same way) and anything on Edge in a browser. Baseline before this work: check, unit
tests and build all passed on `master`.

## Independent review

Two rounds of independent read-only review (privacy/security, lifecycle/staleness,
validator/meaning drift; then everything changed after round 1), plus the real-GPU runs,
which found the most serious problems. Every finding below was fixed with a test that
failed first.

| Source                    | Finding                                                                                                        | Fix                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Review 1, privacy         | Review ports accepted on `sender.tab` alone: an extension page in a tab could open one                         | Extension-origin senders refused                  |
| Review 1, validator       | `likely` → `unlikely` accepted as spelling                                                                     | Negating affixes are never close words            |
| Review 1, validator       | `300 kb` → `300 mb` accepted                                                                                   | A word right after a number is never changed      |
| Review 1, validator       | Rewrite could swap `3` and `5`                                                                                 | Numbers compared in order                         |
| Review 1, lifecycle (low) | Dictionary add left a ready rewrite showing "ready"                                                            | Marked stale                                      |
| Runtime agent             | Model load had no bound                                                                                        | 180 s, then the worker is torn down               |
| Real-GPU evaluation       | WebLLM 0.2.85 fails every bare `json_object` request                                                           | Schema sent with every request                    |
| Real-GPU evaluation       | Prompt v1 made Qwen3 echo input (0/70 corrections)                                                             | Measured prompt adopted as `review-ai-2`          |
| Real-GPU evaluation       | Validator accepted dialect swaps, code-bracket edits, edge whitespace, noun-number flips, a translated rewrite | Rejected                                          |
| Real-GPU evaluation       | Both models damaged a Polish rewrite                                                                           | Local AI limited to evaluated languages (English) |
| E2E                       | Firefox showed an AI note on every Review                                                                      | No AI UI without a runtime host                   |
| Real-GPU extension e2e    | Hugging Face redirects to a regional `*.cdn.hf.co` host: installs impossible                                   | Allowlisted in CSP and network guard              |
| Real-GPU extension e2e    | Downloads left a 1.1 GB copy in Chrome's HTTP cache after Delete                                               | `cache: "no-store"`                               |

Round 2 found no issues at or above its confidence threshold.

## Measured model results

Apple M2 Max (Metal), Chrome for Testing 154, WebLLM 0.2.85, prompt `review-ai-3`, each
fixture once (200 Correct: 109 expected unchanged, 91 expected corrections including 21
error-dense cases; 35 Rewrite).

| Model                  | False positives on correct text  | Exact corrections | Correct p50 / p90 (one sentence) |
| ---------------------- | -------------------------------- | ----------------- | -------------------------------- |
| Qwen3 4B (Recommended) | 1/109 (subjunctive `was → were`) | 62/91             | 1514 / 1838 ms                   |
| Qwen3 1.7B (Compact)   | 0/109                            | 48/91             | 687 / 801 ms                     |

No accepted English change to a number, negation, hedge or name for either model.
Integrated extension run (Qwen3 4B): install 36 s; Review open → first rule finding
47 ms, → first Local AI finding 1.9 s (warm); a user's 10-sentence, error-dense
paragraph → first Local AI finding 2.7 s, complete 19.7 s, 8 Local AI findings; offline
cold start → first AI finding 4.4 s. Details: [local-ai-evaluation.md](local-ai-evaluation.md).

## Verified support

| Environment                                                              | Status                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chrome (production build, headless Chrome for Testing 154, Apple M2 Max) | Verified end to end with a real model, including offline and partial-cache behavior                                                                                                                          |
| Edge                                                                     | Builds and passes the artifact check; not run in a browser                                                                                                                                                   |
| Firefox                                                                  | Builds without the runtime; Review unchanged by design. Firefox e2e cannot launch on this machine (the existing smoke suite fails the same way), so this path is covered by unit tests only                  |
| Editors                                                                  | Textarea verified with the real model; contenteditable, Quill, review-only editors and Google Docs use the existing verified targets and are covered by unit and existing e2e tests, not by a real-model run |
| Other GPUs and operating systems, low-memory devices                     | Not verified                                                                                                                                                                                                 |

## Acceptance checklist (spec §14)

| Item                                                                     | Status                                                                                                                  |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Popup/inline prediction never routes to WebLLM                           | Done: production never wires the predictor; build fails if WebLLM reaches other bundles; e2e with stale legacy settings |
| Correct is default, automatic after setup, never edits by itself         | Done                                                                                                                    |
| Explicit download; disable/delete persist; no startup inference          | Done (e2e: no offscreen document or model request before consent)                                                       |
| Rewrite explicit, complete diff, explicit accept                         | Done                                                                                                                    |
| Context bounded; protected and read-only text not modifiable             | Done (unit-tested; real-model run on a textarea)                                                                        |
| Strict validation and deterministic mapping                              | Done                                                                                                                    |
| AI never in "Fix all safe"; dependent edits atomic                       | Done                                                                                                                    |
| Editor transaction, undo, IME, capability, readback protections intact   | Done (existing write path only; native undo verified with the real model)                                               |
| Late/stale/cross-tab results cannot land                                 | Done (unit-tested; reviewed twice)                                                                                      |
| No uploads, logs, persistent prompts or journals                         | Verified by sentinel scans in the real run; resumable generation does not exist in 0.2.85                               |
| Offline with networking denied, cold cache; partial cache fails honestly | Verified in the real run                                                                                                |
| Packaged executable WASM; no dev hooks in production                     | Done; artifact check per platform                                                                                       |
| Real-device evidence for the default model                               | Done for one device (above)                                                                                             |
| Unsupported environments keep today's experience                         | Done                                                                                                                    |
| Unit, integration, e2e, build, privacy checks pass                       | See the results table; Firefox e2e unavailable on this machine                                                          |
| Review findings addressed, limitations documented                        | Done                                                                                                                    |

## Remaining release blockers and limitations

1. **Model library license (blocker).** `mlc-ai/binary-mlc-llm-libs`, the source of the
   packaged model WASM, declares no license. Confirm redistribution terms before a store
   release (noted in `public/local-ai/THIRD_PARTY_NOTICES.md`).
2. **Store review** is not guaranteed; the packaged-WASM approach follows the MV3
   remote-code rules but has not been submitted.
3. **Hardware coverage:** one GPU and OS measured. Memory use is WebLLM's estimate, not a
   measurement. Integrated/low-memory GPUs, Windows, Linux and ChromeOS are unverified.
4. **Recall:** the Recommended model still misses about a third of the fixture errors
   (it abstains rather than guessing); Compact misses most.
5. **Languages:** English only. Polish and others need their own evaluation first.
6. **Known validator limits:** a wrong but plausible "correction" of a valid word (e.g.
   `cant` → `cante`, seen only with an unshipped model) needs a dictionary check; hedge
   swaps in rewrites (`might` → `may`) pass because hedges are counted, not matched.
7. **Firefox and Edge** were not exercised in a browser here.
8. **First Chrome/Edge build needs network** once to fetch the pinned model libraries
   (`bun run fetch:local-ai`); later builds verify them offline.
