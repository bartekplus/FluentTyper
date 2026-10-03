# Measure extension performance

[FluentTyper](../README.md) / [Contributing](../CONTRIBUTING.md) / Performance

Use this harness to compare local synthetic workloads and resource counts. It does not test live websites or upload results.
Start with the short smoke workload before choosing a longer run.

## Run a first check

```sh
bun install --frozen-lockfile
bun run perf:smoke
```

Open `summary.md` in the output directory printed by the command. `results.json` contains the measurements.
A failure also writes `failure.json`. The default location is `.tmp/performance/<timestamp>`.

## Choose a workload

| Workload | Command                                            | Scope                                                        |
| -------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Smoke    | `bun run perf:smoke`                               | Two repetitions, four modes, one tab, three cycles per mode. |
| Stress   | `bun run perf:stress`                              | Five tabs and up to 30 cycles.                               |
| Soak     | `PERF_SECONDS=7200 PERF_TABS=40 bun run perf:soak` | A two-hour workload budget with up to 40 tabs.               |

Startup, setup, and teardown add time. Hardware limits can prevent the requested tab count.

## Configure and read a run

The timer stops between complete cycles. The soak budget covers all modes and repetitions.

Use `PERF_TABS`, `PERF_CYCLES`, `PERF_SECONDS`, and `PERF_REPEATS` to change the workload. Use `PERF_OUTPUT` to select a local output directory. The default directory is `.tmp/performance/<timestamp>`. These generated files are ignored by Git.

The harness produces `results.json` and `summary.md`. Use `PERF_BASE_BUILD` with a saved harness extension directory to repeat a baseline without rebuilding its runtime. Its `content_script.original.js` supplies the uninstrumented bundle.

A failed run also produces `failure.json`. Completed modes remain available after a later failure. Do not reuse results from an earlier failed attempt as current evidence.

## Scenarios and measurements

Each repetition compares an extension-free browser, installed idle, normal typing, and native Review with typing in another field. The second repetition reverses the mode order. Each browser uses a fresh profile. The viewport is 1024 × 768. Pages contain two textareas with fixed synthetic content. The first Review source contains 80 repeated sentences. Mount cycles replace it with a short fixed source. The typing sequence is `a`, `b`, `c`, and three deletions. The workload changes focus and replaces both fields. It also changes synthetic routes and repeats extension disable/enable transitions. Longer workloads reload each page after every ten cycles.

Cold load ends when editor helpers attach. One second of quiescence precedes measurement. The first cycle permits lazy resource creation. Later cycles must not exceed its attached resource counts. An additional idle window checks text-query, layout-read, and message counters.

The report includes browser version, CPU, logical CPU count, total machine memory, OS, content/background bundle hashes, fixture bytes, warmup, repetitions, and workload limits. Timing distributions include sample count, minimum, p50, p95, p99, and maximum. Each series retains at most its last 4096 samples.

- FluentTyper callback timing measures individual isolated-world `beforeinput`, `input`, `keydown`, and `selectionchange` callbacks. It excludes MAIN-world bridges and background detection.
- Input-to-frame time measures a page input event until the next animation frame. It is a responsiveness proxy, not physical display latency.
- Keyboard round-trip time includes automation transport and two animation frames. Do not call it input-handler time.
- Review completion time includes concurrent scripted typing. It is an upper bound, not isolated detector execution time.
- Page heap includes page and isolated-world allocations. DOM and browser listener counts also include page resources.
- Attached listener counts exclude detached node candidates. The probe reports detached candidates separately. A detached listener is not proof of a leak.
- Mutation/ResizeObserver registrations, timers, animation frames, pending messages, maximum message backlog, and editor DOM markers give structural measurements. DOM markers do not expose every private editor map.

The probe uses weak target references. It stores no text, suggestion values, event payloads, or URLs. It keeps only counts and durations. It records no heap snapshot and never forces garbage collection. A synthetic test deliberately omits listener cleanup and confirms that the growth assertion fails. Production entry points never import the probe. Only the temporary build receives its prefix.

Separate isolated-world heap, process RSS, and GPU memory are not measured by this harness. Do not attribute page heap or whole-browser usage to FluentTyper alone. Compare post-warmup samples with the extension-free run. Positive growth over three cycles is a measurement, not a retained-memory leak diagnosis. Inspect longer matched runs before drawing that conclusion.

## Optional real Local AI

Use a dedicated synthetic test profile. Never pass your personal browser profile.

First generate the instrumented extension:

```sh
PERF_OUTPUT=.tmp/performance/candidate-final bun run perf:smoke
```

Then open setup in the dedicated test profile:

```sh
PERF_AI_EXTENSION=.tmp/performance/candidate-final/extension bun run perf:ai --setup
```

Select the model configuration for the comparison. Complete the normal consent and installation flow, then close the test browser.
Setup can download model assets. The measurement command does not install assets or change model settings.

Run the measurement after setup completes:

```sh
PERF_AI_EXTENSION=.tmp/performance/candidate-final/extension bun run perf:ai
```

The optional scenario keeps a Review session open. It measures the first model operation and two subsequent operations, with scripted typing in another field. It records the configured model ID, tier, runtime state before each operation, and timing samples. Output is `.tmp/performance-ai/results.json`. `PERF_AI_PROFILE` changes the dedicated profile directory. GPU memory remains unavailable. Failure to obtain real model completion fails this command. This path requires separate execution on supported hardware; a mock test is not equivalent.

## Audit of existing paths

<details>
<summary>Resource ownership and cleanup by module</summary>

Paths below are relative to the repository root.

| Path                                                                              | Existing work and lifecycle                                                                                                                                                                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/adapters/chrome/content-script/suggestions/SuggestionLifecycleController.ts` | Per-editor key/input/composition listeners and shared document selection listeners. Detach removes registered handlers.                                                                                       |
| `src/adapters/chrome/content-script/suggestions/SuggestionEntrySession.ts`        | Native typing edits, debounce state, pending prediction/idle timers, proposal state, and bounded interaction traces. Dispose clears timers and pending work.                                                  |
| `src/adapters/chrome/content-script/suggestions/SuggestionManagerRuntime.ts`      | Strong editor/session maps and fallback timers. Detached fields are pruned. Detach disposes sessions and removes menus/listeners. Disable detaches all helpers.                                               |
| `src/adapters/chrome/content-script/ContentRuntimeController.ts`                  | Mutation batching, targeted discovery, shadow observers, late focus/input discovery, and config restarts. Disabled runtime disconnects observers and clears scheduled work. Detached shadow roots are pruned. |
| `src/adapters/chrome/content-script/MutationPipeline.ts`                          | Filters typing-only and owned UI mutations. Uses affected roots with bounded full-discovery fallbacks.                                                                                                        |
| `src/adapters/chrome/content-script/HostChangeWatcher.ts`                         | Event-driven host/body checks with a 250 ms debounce. Stop cancels the timer and removes listeners. No periodic full-page scan was added.                                                                     |
| `src/adapters/chrome/background/PredictionManager.ts`                             | Reuses one initialization promise for Presage and dictionaries. Prediction remains Presage-only. Development traces have existing limits.                                                                     |
| `src/adapters/chrome/background/config/DomainSettingsCache.ts`                    | Short-lived domain configuration cache. Bounds entries, shares pending reads, and prevents stale repopulation.                                                                                                |
| `src/adapters/chrome/content-script/review/MessagingReviewEngine.ts`              | Coarse background requests, immediate abort rejection, cancellation messages, and session release. Live requests send a bounded text tail.                                                                    |
| `src/adapters/chrome/background/ReviewEngineHost.ts`                              | Eight sender-scoped sessions. Eviction aborts work. Permits one current scan/proof per session. A worker restart creates empty sessions.                                                                      |
| `src/core/application/review/LocalReviewEngine.ts`                                | Native detection yields between chunks and checks cancellation. Release clears the snapshot and cache.                                                                                                        |
| `src/core/domain/grammar/review/nativeReviewCache.ts`                             | Existing limits of 64 entries and 500,000 serialized UTF-16 units.                                                                                                                                            |
| `src/core/application/review/ReviewSession.ts`                                    | Snapshot/version checks, cancellation, spelling batches, accepted/ignored state, and a 256-entry AI cache. Close aborts scans and releases the engine.                                                        |
| `src/adapters/chrome/content-script/review/LocalAiReviewProvider.ts`              | Port-owned pending jobs, cancellation deadlines, visibility handling, and disposal. Disconnect settles pending requests.                                                                                      |
| `src/adapters/chrome/background/localAi/JobScheduler.ts`                          | One running model job, two pending jobs per port, 16 pending jobs globally, and four joined request IDs. Port removal cancels its work.                                                                       |
| `src/adapters/chrome/background/localAi/LocalAiHost.ts`                           | Shared model loading, cancellation/settlement deadlines, unload policy, and bounded keep-alive activity. Model work remains independent of Presage.                                                           |

This is a scoped audit, not proof that every retained object is bounded. In particular, ReviewController closes sessions on `pagehide`. Native sessions whose pages disappear without release can remain until eight-session eviction or worker shutdown. Browser closure destroys their process. Existing tests model port disconnection and fresh-engine recovery. This harness does not directly measure browser tab-close cleanup or forced worker restart. Necessary per-editor state scales with attached editors. No global editor limit was introduced.

</details>

## Gates

Immediate failures cover resource growth after the first cycle, nonzero idle scan/layout/message growth, missing editor helpers, mutation overflow, stale request cancellation, and cache limits. The intentional synthetic listener fault must fail its assertion. Unit tests run in the normal unit suite. The separate Chrome performance smoke job uploads reports in CI.

Timing and heap comparisons have no release threshold yet. The initial two-repetition baseline does not establish stable browser-specific timing variance. Firefox has normal smoke/full regression coverage but no calibrated performance budget. Obtain repeated matched runs on each release machine before proposing numeric timing limits. Report both absolute and relative changes, and preserve positive heap deltas. Do not convert a report-only metric into a pass badge.

The short browser workload must complete locally. Medium stress, two-hour soak, optional real AI, and live-site checks require separate evidence.

---

[Testing requirements](agents/testing.md) · [Return to contributing](../CONTRIBUTING.md)
