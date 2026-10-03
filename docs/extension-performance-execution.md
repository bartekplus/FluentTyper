# Execution report: 2026-10-03

The patch adds a local browser harness and fixes three demonstrated resource risks. It does not establish a real-site speed improvement.

The checkout was clean at the start. The baseline runtime came from commit `5be1e84e0c46000ad486aa7c535b8fd26041e5f4`. The candidate contains the uncommitted patch. Nothing was pushed or published.

## Existing safeguards

Native Review already ran in the background and yielded between chunks. Presage already shared initialization. The runtime already coalesced mutations, used targeted discovery, removed detached editors, and cancelled session timers. Native cache, Review session, AI cache, and model queue limits already existed. Local AI used its own serialized scheduler and cancellation/unloading policy.

The [audit and commands](extension-performance.md) identify the actual modules and lifecycle paths. No external grammar service, permission, model, quantization, backend, or telemetry change was introduced.

## Reproduced defects and changes

| Reproduction on original code                                                                                         | Fix                                                                                              | Production path                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| A deferred mutation callback retained 1000 records.                                                                   | Retain at most 200 records. Overflow releases records and requests one full discovery pass.      | `src/adapters/chrome/content-script/MutationScheduler.ts`, `ContentRuntimeController.ts` |
| An obsolete same-session scan completed instead of cancelling. Reused IDs could lose the current cancellation handle. | Abort obsolete scans/proofs. Delete a completion's handle only when it is still current.         | `src/adapters/chrome/background/ReviewEngineHost.ts`                                     |
| The domain cache retained 300 distinct domains and repeated concurrent storage reads.                                 | Limit entries to 128. Share pending reads. Prevent invalidated completions from restoring state. | `src/adapters/chrome/background/config/DomainSettingsCache.ts`                           |

The new regression tests failed on original code and passed after the fixes. No ordinary browser memory leak was proved. The probe initially overcounted listeners on detached, collectible UI nodes. Its corrected report separates attached registrations and detached candidates.

Harness files are `scripts/performance/run.ts`, `probe.js`, `metrics.ts`, and `ai.ts`. The deliberate synthetic resource fault is in `tests/PerformanceHarness.test.ts`. Existing regression files, the coverage matrix, package commands, documentation, and `.github/workflows/test.yml` were updated.

## Actual browser measurements

Two repetitions per build completed all four modes, with one tab and three cycles. Each active mode produced 18 input-to-frame samples per repetition. The machine used Apple M2 Max, 12 logical CPUs, 32 GiB RAM, and Chrome `154.0.8037.57`. The viewport was 1024 × 768. The report records cold loading separately. Each cycle used a one-second quiescence window. No collection was forced.

[Machine-readable evidence](extension-performance-results.json) includes bundle hashes, environment, distributions, sample counts, resource counts, and heap deltas. Full per-cycle local results remain in `.tmp/performance/final-baseline/results.json` and `.tmp/performance/final-candidate/results.json`.

| Input-to-next-frame p95   | Baseline, repetitions 1 / 2 | Candidate, repetitions 1 / 2 | Paired absolute change | Paired relative change |
| ------------------------- | --------------------------: | ---------------------------: | ---------------------: | ---------------------: |
| Extension absent          |              16.3 / 16.5 ms |               16.1 / 16.4 ms |         -0.2 / -0.1 ms |          -1.2% / -0.6% |
| Normal typing             |              16.7 / 18.4 ms |               16.3 / 16.6 ms |         -0.4 / -1.8 ms |          -2.4% / -9.8% |
| Native Review plus typing |              16.5 / 23.8 ms |               16.1 / 15.9 ms |         -0.4 / -7.9 ms |         -2.4% / -33.2% |

These small samples do not prove a speed improvement. With 18 samples, nearest-rank p95 is the maximum. Earlier exploratory runs also showed candidate Review p95 increases. The changes between runs support report-only timing status.

FluentTyper callback p95 was 0.1–0.2 ms across the active scenarios. The candidate recorded 132 callbacks per typing repetition and 150 per Review repetition. End-of-cycle timers, animation frames, and pending messages were zero. Attached listeners stayed at 45 for active scenarios, with two observers for typing and three for Review. Idle scan/query, layout-read, and message counters did not increase during the checked windows. The intentional undisposed-listener test detected growth.

The candidate's sampled heap grew by 919,596 and 593,176 bytes during normal typing. Baseline growth was 556,604 and 522,552 bytes. The extension-free control grew by approximately 25,500 bytes. Candidate Review growth was 49,512 and 47,888 bytes; baseline Review growth ranged from 16,076 to 1,469,952 bytes. These values include the page and isolated contexts. They are neither retained-size measurements nor proof of leaks. Longer matched runs remain necessary.

## Commands actually run

| Command                                                                                                                                  | Result                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                                                                                                          | Passed with Bun 1.4.2.                                                |
| `bun test tests/ReviewEngine.test.ts tests/MutationScheduler.test.ts` before fixes                                                       | 12 passed, two new regressions failed as expected.                    |
| `bun test tests/DomainSettingsCache.test.ts` before its fix                                                                              | 10 passed, two new regressions failed as expected.                    |
| `bun test tests/PerformanceHarness.test.ts tests/MutationScheduler.test.ts tests/ReviewEngine.test.ts tests/DomainSettingsCache.test.ts` | 29 passed.                                                            |
| `bun run check`                                                                                                                          | Passed after correcting probe global declarations.                    |
| `bun run test`                                                                                                                           | 13,217 passed across the isolated suites and main suite. No failures. |
| `bun run test:e2e`                                                                                                                       | Chrome: 26 passed.                                                    |
| `bun run test:e2e:full`                                                                                                                  | Chrome: 146 passed, 10 skipped.                                       |
| `bun run test:e2e:full --platform=firefox`                                                                                               | Firefox: 141 passed, 15 skipped.                                      |
| `bun run check:e2e:coverage`                                                                                                             | Passed, 241 behaviors.                                                |
| `PERF_BASE_BUILD=.tmp/performance/1791019721764/extension PERF_OUTPUT=.tmp/performance/final-baseline bun run perf:smoke`                | Eight baseline browser runs passed.                                   |
| `PERF_OUTPUT=.tmp/performance/final-candidate bun run perf:smoke`                                                                        | Eight candidate browser runs passed.                                  |
| `git diff --check`                                                                                                                       | Passed.                                                               |

Earlier exploratory harness commands also ran while selector readiness and listener accounting were corrected. Their failures were harness defects, not extension leak evidence. The recorded baseline/candidate pair uses the corrected measurement method.

## Remaining limits

- Medium stress, the two-hour 30–50-tab soak, and optional real Local AI were not executed.
- The optional AI command received static checks only. It needs a dedicated profile and supported hardware.
- No live-site behavior, GPU memory, browser process RSS, or separate isolated-world heap was measured.
- The harness counts attached editor DOM markers, not every private runtime collection. Unit tests enforce the changed collection limits.
- Forced background restart and abrupt tab-close cleanup are not browser scenarios in this patch. Existing pagehide and port-disconnect safeguards remain. Normal navigation is available in longer workloads.
- Firefox passed functional regression tests. Its performance budget remains uncalibrated.
- Development E2E was not run because the patch adds no development runtime hook.
- CI configuration was updated but remote CI was not run. No PR was opened.

Diff review checked cancellation identity, overflow recovery, stale cache completion, bounded probe storage, and production isolation. Timing and heap thresholds remain reports. Deterministic resource limits and idle assertions are immediate gates.

## Draft PR description

Add a reproducible extension performance harness with synthetic local typing, native Review, idle, and lifecycle scenarios. Produce privacy-safe JSON and human reports, with smoke, stress, soak, and optional real-model commands.

Bound pending mutation records and domain settings. Cancel obsolete native Review requests without deleting newer cancellation handles. Preserve current typing behavior, native Review architecture, model configuration, and permissions.

Validation: repository checks, 13,217 unit tests, Chrome smoke, Chrome/Firefox full regression, coverage validation, and eight browser runs per baseline/candidate passed. Timing and heap values remain report-only. Stress, soak, and real Local AI were not executed.
