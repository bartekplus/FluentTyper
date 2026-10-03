# Native Review roadmap completion audit

The 2026-10-03 P0 follow-up below supersedes earlier editor support and batch claims. Earlier test results remain historical records.

Audited 2026-09-30 against the supplied `FluentTyper_Native_Review_Roadmap_and_Prompts.md`, implementation commit `56c94339`, and its retained verification logs. This audit preserves all twenty items and the shared contract. **Implementation and Chrome validation are complete; Firefox runtime validation is not.** No publication was requested or performed.

The preceding goal turn made progress: it completed and committed #20, fixed two reproduced safety/overlap defects, and passed the final implementation gates. This audit adds direct acceptance verification, an overlap regression, a final Chrome smoke run and a fresh Firefox launch result.

## Numbered requirements and evidence

All grammar-family tests below call `detectReviewDiagnostics` with immutable snapshots. Positive loops assert exact alternatives through `applyEdits`, no target-family recorrection, source/range/context evidence and no bulk eligibility. Negative loops assert no target-family findings. Their larger authored corpora and performance/bundle measurements are recorded in [the progress ledger](native-review-progress.md); they are not general English accuracy estimates.

| Item               | Implementation and requirement evidence                                                                                                                                                                                          | Authoritative tests                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Repetition       | Curated function words in the existing native detector; exact deletion, bounded runs, whitespace/protection/selection guards; no dummy typing rule                                                                               | `ReviewRepeatedWords.test.ts`; browser native grammar Apply/undo                                                                                                                         |
| 2 Auxiliaries      | `englishAuxiliaryForms.ts`, shared `EnglishVerbForms.ts`; explicit morphology, pronoun/question/adverb evidence, homograph abstention, unchanged modal-of ownership                                                              | `ReviewAuxiliaryForms.test.ts`; browser native grammar Apply/undo                                                                                                                        |
| 3 Confusions       | `englishWordConfusions.ts`; four independent IDs and contextual evidence, existing your-welcome/their-is ownership                                                                                                               | `ReviewWordConfusions.test.ts`; browser native grammar Apply/undo                                                                                                                        |
| 4 Agreement        | `englishAgreement.ts`; existing pronoun identity with individual-only added forms, separate existential identity, quantity preserved, old typing mappings unchanged                                                              | `ReviewAgreementExtensions.test.ts`; browser native grammar Apply/undo                                                                                                                   |
| 5 Possessives      | `englishPossessives.ts`; bounded its/lets/else contexts, minimal apostrophe edits, nested quotation and name/ownership abstention                                                                                                | `ReviewPossessives.test.ts`; browser split-format possessive repair                                                                                                                      |
| 6 Prepositions     | `englishPrepositions.ts` and `phraseTemplates.ts`; bounded complete frames, contextual exclusions and dependency ranges                                                                                                          | `ReviewPrepositions.test.ts`; browser grammar Apply/undo                                                                                                                                 |
| 7 Complements      | `englishComplements.ts`; explicit verb/gerund data and complete frames, no inferred fragment completion or negation changes                                                                                                      | `ReviewComplements.test.ts`; browser split-format missing-to insertion/recheck/undo                                                                                                      |
| 8 Controls         | Canonical Review metadata → repository → config → runtime/session; sparse validated overrides and independent typing selection; card disable and settings restore                                                                | `ReviewRuleSettings.test.ts`, `CoreSettingsRepository.test.ts`, session stale/settings tests, UI disable tests; browser independent-controls workflow                                    |
| 9 Participles      | `englishParticiples.ts` reuses explicit irregular data; auxiliary versus noun/causative evidence, tense/negation retained, regional/homograph abstention                                                                         | `ReviewParticiples.test.ts`; browser native grammar Apply/undo                                                                                                                           |
| 10 Number          | `englishNounNumber.ts` and shared noun pairs; preserves numerals, exposes genuine number alternatives, rejects units/grouped counts/invariants                                                                                   | `ReviewNounNumber.test.ts`; browser explicit alternative choice and undo                                                                                                                 |
| 11 Compounds       | `englishCompounds.ts`; contextual everyday/login/setup frames, spelling ownership and minimal edits                                                                                                                              | `ReviewCompounds.test.ts`; browser compound insertion across formatting                                                                                                                  |
| 12 Countability    | `englishCountability.ts`; documented ordinary-prose frames, specialist exclusions, atomic local changes, quantities preserved                                                                                                    | `ReviewCountability.test.ts`; browser native grammar Apply/undo                                                                                                                          |
| 13 Degree          | `englishDegree.ts`; curated doubled-degree constructions, hyphenation/quotation/quantity exclusions, then/than recheck                                                                                                           | `ReviewDegree.test.ts`; browser formatted deletion                                                                                                                                       |
| 14 Usage           | `englishUsagePhrases.ts`; authored complete frames, tense/case/possessive preservation and literal/metalinguistic exclusions                                                                                                     | `ReviewUsagePhrases.test.ts`; browser phrase replacement across formatting                                                                                                               |
| 15 Ignore matching | `ReviewSession.ts`; in-memory equivalent occurrence/evidence/alternative identity, native remapping, evidence/protection invalidation, reset and close                                                                           | `ReviewSession.test.ts` matching-ignore cases; `ReviewUiLocalAi.test.ts`; browser counts/reset/reopen/storage-privacy workflow                                                           |
| 16 Warnings        | `quotationWarnings.ts`; complete unprotected stateful scan, apostrophes/measurements/nested/paragraph conventions; explicit warning-only type and no Apply/bulk path                                                             | `ReviewQuotationWarnings.test.ts`; session/UI warning tests; browser keyboard warning workflow                                                                                           |
| 17 Casing          | `canonicalCasing.ts`; explicit canonical forms, sentence-start ownership, dictionary/technical guards and stable corrected forms                                                                                                 | `ReviewCanonicalCasing.test.ts`; browser formatted casing Apply/undo                                                                                                                     |
| 18 Terminology     | `preferredTerminology.ts`, `terminologyMatcher.ts`, `PreferredTerminologyPanel.ts`; explicit enablement, validated bounded literal schema, stable IDs, cycle/duplicate checks, safe import/export and user-authored presentation | `PreferredTerminology.test.ts`, `ReviewTerminology.test.ts`, `PreferredTerminologyPanel.test.ts`; session removal/AI ownership tests; browser import/settings/Apply/undo                 |
| 19 Reuse           | `nativeReviewCache.ts`; two audited bounded detectors, full source/config/evidence/protection keys, fresh finalization, bounded FIFO memory and full-scan fallback; session invalidation/cancellation                            | `NativeReviewCache.test.ts` exact oracle comparison over 100 seeded edits, eviction and scope tests; session structure/settings/fence/close tests; long-draft browser Apply/recheck/undo |
| 20 Advice          | `styleAdvice.ts`, `readability.ts`; default-off style IDs, separate counts/filter, explicit acronym list, masked bounded sentence view, validated threshold 10–200/default 35 and warning-only long sentences                    | `StyleAdvice.test.ts`, `Readability.test.ts`, session/UI/config/options tests; browser enable/filter/Apply/undo and live threshold persistence                                           |

Domain test paths are under `tests/grammar/`; session/UI tests under `tests/`; browser tests in `tests/e2e/full.e2e.test.ts`. Implementation modules are under `src/core/domain/grammar/review/` unless a layer/file is named otherwise.

A separate audit read the required input/output and preservation strings directly from the supplied roadmap and ran them through the current all-default-rules native pipeline, filtering only the relevant family. **46/46 required repairs and 101/101 preservation examples passed**, including exact expected output, no recorrection and individual-only eligibility. It covers linguistic items 1–7, 9–14 and 17; prose workflow requirements are covered by the behavioral tests above, not counted as linguistic examples. Log: `/tmp/ft-roadmap-acceptance-audit.log`; local audit runner: `.tmp/roadmap-acceptance-audit.ts`. The same literal fixtures also exist in the tracked family tests.

## Shared contract audit

- **Architecture/catalog/typing:** the existing rule catalog owns identities; the factory instantiates only `TYPING_RULE_CATALOG`. Review metadata and settings stay separate. New morphology and phrase helpers are native domain code; editor changes use the existing session/adapter boundary. No no-op typing rules, external grammar provider, copied third-party corpus or new engine was introduced.
- **Privacy/offline/dependencies:** dependency files and Chrome/Edge/Firefox manifests are unchanged against `d0d0996f`. New detection/cache code has no network or storage calls. Session caches/ignores are ephemeral and cleared on close; only explicit preferences and terminology use existing settings storage. Terminology import/export is explicit user-authored JSON. AI model/runtime/download files and Presage candidate generation are unchanged.
- **Exact edits/protection:** the shared finalizer still enforces scope, grapheme boundaries, exact source and protected edit ranges. Detectors expose evidence; prepared masking retains structural barriers. Readability's protected-punctuation regression is fixed. Existing session writes preserve stale/structure/IME/cancellation checks and verified native transactions; no direct DOM mutation path was added.
- **Ambiguity and bulk:** documented finite lexical/context scopes abstain on unknown or ambiguous constructions. Number alternatives remain explicit choices. New findings stay individual-only; warning-only findings cannot enter bulk even with forged metadata. Existing approved bulk behavior remains exercised by browser and domain tests.
- **Coexistence:** grammar/spelling ownership tests preserve candidate order; custom terminology protects explicitly preferred text. Style warnings coexist with terminology and spelling; optional AI corrections remain independent of style. A final session regression confirms both AI corrections around unchanged preferred wording remain visible (`go`, `goes`), with no automatic editor write. This passed without a production change, and the full AI session suite passed **47 tests** (`/tmp/ft-roadmap-ai-overlap-after.log`).
- **Shared regressions:** family tests exercise language/dictionary/protection/scope/UTF-16/CRLF/chunk ownership. Existing session/editor suites cover sensitive fields, unsupported adapters, stale snapshots, composition and undo. `AmbiguityGuards.test.ts` retains `16rd`/`42RD`; browser Quill cases retain code casing, formatting and native undo. No test was weakened to a no-crash assertion.
- **Settings/localization/accessibility:** validated absent/invalid/default/reset choices and independent typing settings are tested. New messages use nine existing UI locales; controls use labels, accessible names and warning-only actions. Style is opt-in even after reset/migration; threshold changes do not enable it. Imported HTML is rendered as text.
- **Measurement/documentation:** per-family authored positive/negative results, exclusions, scan costs and retained-artifact bundle deltas are in the progress ledger. #19 includes before/after timing and exact full-scan equivalence separately. #20 includes style-only off/on costs. `docs/review-mode.md` documents supported constructions, exclusions and workflows. These measurements do not establish universal linguistic accuracy.

## Verification and remaining gate

Implementation commit `56c94339` passed `bun run check`, `bun run test` (**5,174 tests**), `bun run check:e2e:coverage` (**206 behaviors**), Chrome full browser tests (**123 pass, 10 existing skips**), and both production builds. Logs: `/tmp/ft-style-complete-{check,unit,coverage,chrome,build-chrome,build-firefox}.log`. The final audit adds one AI session test, separately verified with its complete 47-test suite; production source is unchanged.

Final Chrome smoke: **26 pass, 0 fail**, `/tmp/ft-roadmap-audit-smoke.log`. Fresh final Firefox command: `bun run test:e2e:full --platform=firefox` built successfully but failed both suite setup hooks before extension startup: **“Could not find profile folder.”** Log: `/tmp/ft-roadmap-audit-firefox.log`. This reproduces the previously diagnosed macOS Files & Folders permission blocker. It is not a Firefox feature test failure or a runtime pass.

**Remaining:** enable the previously requested Firefox Application Support access for Codex, then run the full Firefox browser suite and fix any actual runtime failures. Until that gate passes, the roadmap goal is not complete. No further implementation gap was found by this audit; no push, PR, merge or release is authorized.

## Subsequent authorization and corpus follow-up

The user subsequently authorized review fixes and PR creation; PR #424 is open. The corpus-driven follow-up and current verification supersede the earlier delivery status above. See `native-review-progress.md` and `native-review-corpus-evaluation.md` for bounded coverage, rejected ambiguous rewrites and the latest local/CI evidence. Firefox runtime must be verified on the current head, not inferred from its build or from earlier checks.

## Editor safety and reliability hardening — 2026-10-02

This implementation pass covers autocomplete, expansion, typing rules, native/spelling/AI Review, rewrite, editor discovery and disable lifecycle. The host remains authoritative. An uncertain target is refused; a write that landed but cannot be verified is reported as unverified and never repaired from a cached draft. No permissions, production dependencies or external grammar engines were added. React is a development-only dependency for the controlled-form browser fixture.

### Architecture assessment

| Concern             | Production path and safety boundary                                                                                                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extraction          | `TextTargetAdapter` handles native controls; `ContentEditableAdapter` resolves active typing blocks; `ContentEditableTextMap` maps UTF-16 text, virtual block separators and protected spans for Review. A block/sentence can contain many DOM nodes.                                                                                           |
| Anchoring           | `ReviewSession` associates diagnostics with immutable source snapshots, generations, structural signatures and source/context evidence. IDs from a prior refresh cannot be applied. The shared typing writer also verifies current source text and grapheme boundaries. No search for the first identical occurrence is used to relocate a fix. |
| Replacement         | Native controls use selected native editing. Contenteditable uses minimal native range transactions and current maps; host adapters use model transactions. Declined native/host writes are final. Browser readback proves success; extension snapshots never rebuild the editor.                                                               |
| Invalidation        | Input invalidates immediately, aborts work and schedules a paused recheck. Verified own edits remap ranges; external context changes release affected suppression. Structural/protection changes invalidate results. Hidden Review does no extraction or scheduled recheck until resumed.                                                       |
| Detection           | Inputs/textareas, eligible contenteditable, open shadow roots and permitted frames use existing discovery. Credential/search/code/protected contexts remain excluded. Recognized model editors without a proven Review transaction remain read-only.                                                                                            |
| Host events/history | Native insertion follows browser editing/event semantics; ProseMirror/CKEditor/line adapters transact through host APIs; TinyMCE encloses native insertion in `undoManager.transact`. Deferred `beforeinput` acceptance remains unverified until matching host input. Host/native undo is never replaced with an extension inverse.             |
| Observers           | Discovery ignores text-only records and extension UI before threshold calculation; relevant structural changes use targeted roots. Extension writes use existing observer disconnection. A temporary Review transaction observer detects sibling/protection changes before another batch edit and disconnects in `finally`.                     |
| Async results       | Generation/abort checks, source/chunk validation, option/selection/target checks and final target readback reject obsolete native/spelling/AI/rewrite results. Cancellation alone is not trusted. The current Local AI runtime is the repository's packaged Transformers/ONNX path; no additional WebLLM subsystem was introduced.              |

### Problems discovered and corrected

| Severity | File / function                                                                        | Problem and real-world failure                                                                                                                                                                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | `SuggestionTextEditService.ts` / `replaceTextByOffsets`, grammar and host repair paths | Whole-value/whole-block repair from an old snapshot could overwrite concurrent host typing. Removed these repair paths and require current text/readback.                                                                                                                                                             |
| P0       | `HostEditorMainWorldBridge.ts` / `applyCKEditor5BlockReplacement`                      | A lagging model could be reconstructed from extension DOM text, discarding model content/formatting. Flush existing reconciliation, then refuse unresolved mismatch.                                                                                                                                                  |
| P0       | `ContentEditableAdapter.ts` / `replaceTextByOffsets`                                   | Focus or `beforeinput` can rerender nodes or move text among existing nodes without changing aggregate text. A live Range can move with the DOM; comparing it with itself proves nothing. Immutable endpoints now require exact absolute prefixes after page callbacks.                                               |
| P0       | `ReviewTargets.ts` / `ContentEditableReviewTarget.apply`                               | A synchronous host callback can alter an earlier sibling while descending offsets are still in use. Transaction mutation records trigger a full safety read and stop before the next edit when its prefix/protection changed.                                                                                         |
| P1       | `HostEditorAdapterResolver.ts` / `LineEditorHostSession`                               | A captured session could operate on a different line or revised host text. Capture expected line/text and revalidate immediately before the host operation.                                                                                                                                                           |
| P1       | `SuggestionTextEditService.ts`, `ContentEditableAdapter.ts` / accept and undo          | Unverified or deferred host writes could be treated as learned corrections, or Ctrl+Z could insert an extension inverse into host history. Unverified paths never learn; native/host/deferred transactions keep native undo.                                                                                          |
| P1       | `HostEditorMainWorldBridge.ts` / `applyTinyMCE`                                        | Browser insertion could merge with prior TinyMCE typing history; undo lost the shortcut instead of restoring it. Use its existing undo manager with source/selection checks before and inside the transaction.                                                                                                        |
| P1       | `MutationPipeline.ts` / `buildPlan`                                                    | A large text-only mutation batch crossed the discovery threshold and triggered a page scan. Filter irrelevant/owned mutations before counting.                                                                                                                                                                        |
| P1       | `EditableContextResolver.ts`, `SuggestionEntrySession.ts` / input and key fallback     | Grammar enabled status and fallback bookkeeping forced full contenteditable snapshots even without a proposed write. Keep block context lazy, take a whole anchor only for a write/undo, and scope key fallback comparisons to the active block.                                                                      |
| P1       | `SuggestionEntrySession.ts` / `handleInput`                                            | Nested native grammar insertion during Quill's unreconciled input event duplicated punctuation in Firefox. Coalesce Quill handling into its reconciliation microtask and cancel it on dispose.                                                                                                                        |
| P1       | `ReviewSession.ts` / accepted choice history                                           | Valid local AI proposals could reverse accepted choices; insertion boundaries and history eviction could reopen cycles. Shared bounded history preserves all remembered forms, rejects reversals/broader rewrites, and refuses new writes at capacity. Verified NBSP normalization retains that history.              |
| P1       | Runtime controller, watchdog, MAIN-world bridges and shadow interceptor / disable      | Disabled pages retained timers/model hooks, detached root references or shadow attribute writes. Gate active listeners/hooks by runtime enablement, disconnect and clear retained roots, and cancel queued shadow writes. Cleanup uses an already-installed listener, so later CSP restrictions cannot block disable. |
| P2       | `ContentEditableAdapter.ts` / refusal selection restoration                            | A native refusal left a word selected. Restore the prior selection only while the exact temporary selection remains; leave host-owned selection changes alone.                                                                                                                                                        |

### Release-blocking contracts and regression evidence

- **FT-INV-1:** validate current text, occurrence, context, structure and grapheme endpoints before mutation. Stale offsets and async responses are invalidated. Tests cover identical words/sentences/paragraphs, overlapping edits, rerender, same-node redistribution, Unicode, arbitrary ordering and Apply All length changes.
- **FT-INV-2:** input performs bookkeeping/block processing and schedules paused work; it does not start a whole-document Review. Deterministic tests prove 100/1,000 text mutations cause no discovery scan, 1,000 keydowns on a 50k editor take zero whole snapshots, 1,000 Review notifications produce one scan, and hidden notifications produce zero reads/scans.
- **FT-INV-3:** disable removes UI, active editor listeners, observers, scheduled watchdog work and host hooks. Tests execute the actual shadow patch, tighten simulated CSP, drain queued callbacks, and verify hook/attribute cleanup and re-enable.
- **FT-INV-4:** own verified fixes preserve occurrence history across native/spelling/AI/rewrite and browser normalization. Tests cover two/three-form cycles, eight-form churn, consecutive insertion/deletion cycles, 140 identical occurrences in seeded random order, and three-pass convergence. History is local to an active session, never persisted. Limits are eight distinct forms per occurrence, 1M retained UTF-16 units and 50,001 spans; capacity exhaustion refuses a write rather than evicting evidence. A user context edit releases affected history; explicitly closing/reconfiguring Review starts a fresh policy/session.
- **FT-INV-5:** the host owns text and undo. Tests verify resulting content, autosave and FormData; real React controlled input/textarea tests verify DOM/state/submission and native undo/redo. Existing real Quill, Lexical, ProseMirror and TinyMCE fixtures verify supported host paths. Model refusal never permits a foreign DOM fallback or whole-draft repair.

The seeded operation test uses a reference text model through insert/delete/replace/ignore/apply/review operations. The browser concurrency regression uses a large Unicode contenteditable draft, host structural rerender, random fixes, undo, more typing, Fix All and a second Review; it asserts exact visible/host/submitted text and convergence. Coverage is registered in `tests/e2e/coverage-matrix.json` under the five contracts and the React/concurrency behaviors.

### Performance and limits

Normal contenteditable typing extracts active-block context, runs existing native typing rules, updates prediction bookkeeping and resets existing debounce timers. Quill input is coalesced after host reconciliation. Native text controls read their current value. A real replacement, pending undo fingerprint, unsafe/missing block selection or delayed fallback reconciliation can require a complete editor snapshot; these safety reads are retained deliberately.

Whole-page editor discovery remains necessary at initial enable and sufficiently large **structural** mutation batches. Native Review remains bounded to the supported 50k window and yields between chunks. Only the two already-audited native detector families have incremental chunk reuse; other native families reprocess the reviewed window after a pause. AI reuses unchanged chunks. This pass does not claim universal incremental Review or constant-time work for an arbitrarily long single paragraph. Deterministic counters establish the tested workload bounds; they do not prove a wall-clock latency guarantee on every device/site.

Recognized model editors without a verified adapter are Review-only; safety takes precedence over applying a fix. Closed shadow roots, inaccessible frames and unsupported canvas editors remain outside the writable contract. Live Gmail/Slack/Vue/Angular/Slate/Draft.js deployments were not separately certified. The browser matrix exercises real local editor fixtures and permitted frames, not every version of every website. GPU model quality/inference is not certified by scripted AI response tests; those tests exercise the production generation/validation/cancellation/application boundary. The separate real-model gate is opt-in because it downloads model assets.

### Validation and verdict

All final gates passed against the completed production source:

| Gate                                               | Result                                                                              | Evidence log                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `bun run test`                                     | 13,130 pass, 0 fail (12,972 main + 158 isolated)                                    | `/tmp/ft-hardening-unit-exact.log`                                                                |
| Chrome full production                             | 137 pass, 10 expected platform/development skips, 0 fail                            | `/tmp/ft-hardening-chrome-exact.log`                                                              |
| Firefox full production                            | 132 pass, 15 expected platform/development skips, 0 fail                            | `/tmp/ft-hardening-firefox-exact.log`                                                             |
| Development runtime, Chrome and Firefox            | 9 pass each, 0 fail; repository runner intentionally selects development-only cases | `/tmp/ft-hardening-{chrome,firefox}-dev.log`                                                      |
| Smoke, Chrome and Firefox                          | 26 pass each, 0 fail                                                                | `/tmp/ft-hardening-{chrome,firefox}-smoke.log`                                                    |
| `bun run check`                                    | Lint, formatting and TypeScript pass                                                | `/tmp/ft-hardening-check-exact.log`                                                               |
| Coverage matrix                                    | 225 behaviors, all mappings valid                                                   | `/tmp/ft-hardening-coverage-final.log`                                                            |
| Both production builds and Local AI artifact gates | Pass, no permission/manifest changes                                                | `/tmp/ft-hardening-build-{chrome,firefox}.log`, `/tmp/ft-hardening-artifact-{chrome,firefox}.log` |
| Independent strict review                          | LGTM, 365 focused tests, no remaining release-blocking finding                      | Independent reviewer plus `git diff --check`                                                      |

The ten Chrome skips comprise nine development-only cases (run separately) and one Firefox-only Local AI case. Firefox similarly skips nine development-only cases and six Chrome-runtime Local AI cases; its supported no-runtime behavior is tested. The skips are not newly weakened tests.

| Invariant | Verdict for the supported architecture and tested bounds                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| FT-INV-1  | PASS: current target validation, stale refusal, Unicode/structure/context safety and random ordering                                                 |
| FT-INV-2  | PASS: bounded typing bookkeeping, no typing-only page rescans/full Review, paused/yielded work; complete snapshot safety exceptions documented above |
| FT-INV-3  | PASS: disabled observers, timers, active hooks/UI cleaned up; necessary passive configuration listeners and Docs initialization hint remain          |
| FT-INV-4  | PASS: active-session convergence guards, no history eviction; capacity exhaustion refuses writes                                                     |
| FT-INV-5  | PASS: verified native/host transactions, native undo, autosave/submission parity; unsupported writes fail closed                                     |

These are tested engineering contracts, not a promise that arbitrary third-party code accepts editing or preserves its own state correctly. The compatibility and real-model limitations above remain explicit. This audit records local verification before PR publication. Remote checks, merge and release status must be assessed separately.

## P0 text safety follow-up — 2026-10-03

This follow-up used the current checkout. The initial working tree was clean.
No model, model asset, inference backend, permission, telemetry or external service changed.
The implementation and validation results below describe this safety patch.

### Mutation audit

| Path                                              | Existing safety boundary and result                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autocomplete and text expansion                   | `suggestions/SuggestionPredictionCoordinator.ts` checks request identity. `SuggestionEntrySession.ts` owns editor lifetime, focus, composition and pending work. `SuggestionTextEditService.ts` checks the source text and grapheme boundaries before the shared typing write. Keyboard acceptance consumes its key before attempting a write. |
| Capitalization, spacing and spelling while typing | `SuggestionGrammarCoordinator.ts` and `SuggestionEntrySession.ts` supply the current context to `SuggestionTextEditService.ts`. Strict edits compare the complete supplied snapshot and caret. The same writer handles accepted expansions and native typing corrections.                                                                      |
| Native Review and dictionary results              | `src/core/application/review/ReviewSession.ts` binds results to a session, generation, immutable text and structure signature. `review/ReviewController.ts` invalidates work on input and composition. Async dictionary and engine responses must match the active generation.                                                                 |
| Individual Review, Apply All and AI application   | `ReviewSession.ts` prepares edits against one snapshot. `textRanges.ts` checks original spans, bounds, duplicates and overlaps. The bulk planner excludes individual-only advice. AI and explicit rewrites use the same target port and source validation.                                                                                     |
| Text controls                                     | `review/ReviewTargets.ts` merges validated edits into one native command. It checks eligibility, composition, current text, focus and maxlength. It retains selection direction and verifies text after host reconciliation.                                                                                                                   |
| Plain rich text and Quill                         | `review/ContentEditableTextMap.ts` maps UTF-16 offsets, virtual separators and protected spans. `RichTextFormatting.ts` validates formatting. Plain rich-text batches use one native command. Verified Quill instances use one model Delta and history boundaries.                                                                             |
| Model-owned editors                               | `suggestions/ProseMirrorEditor.ts` prepares one host transaction and verifies model text and marks. `HostEditorAdapterResolver.ts` validates line, cursor and source text. `HostEditorMainWorldBridge.ts` uses CKEditor model writes and TinyMCE history transactions. Unknown model-backed Review editors remain read-only.                   |
| Google Docs and Word                              | `google-docs/GoogleDocsTransaction.ts` binds single-use tokens to model and editor identity, then verifies paste results. `review/WordReviewMainWorld.ts` validates model ranges and commits native transactions. These paths retain their editor-specific checks.                                                                             |
| Undo and selection                                | Native and host writers retain browser or host history. Pending extension records validate fingerprints before any legacy inverse. This patch removes direct-write fallbacks and the two-command Firefox workaround. It also prevents restoration of a selection that changed during verification.                                             |
| Geometry                                          | `SuggestionPositioningService.ts` formerly inserted and removed a marker inside the editor. It now reads geometry only and uses editor bounds when the caret has no usable rectangle. Text-control mirrors remain outside user content.                                                                                                        |

Paths in this table without a repository prefix are under
`src/adapters/chrome/content-script/`. The domain range utilities are under
`src/core/domain/grammar/review/`.

Offsets remain UTF-16 code units with exclusive ends. Grapheme checks prevent
splitting combining marks and emoji sequences. No first-occurrence text search
was added. Protected spans, links, mentions, virtual breaks and formatting remain
part of the existing mapping contract. No old document snapshot is restored after
an unexpected host result.

### Reproduced gaps and changes

Regression tests failed before the corresponding fixes for these cases:

- Expansion and rich-text correction wrote directly when native editing was absent.
- Review threw when the native writer was missing.
- Delayed rich-text verification replaced another editor's selection.
- Review took focus from another text field before applying an old result.
- Review reported success before a host replaced the text during reconciliation.
- A rewrite remained applicable on an editor without a batch transaction.
- Caret measurement inserted a node into the host editor and could throw during cleanup.

Existing tests also demonstrated separate native writes for rich-text batches,
split-format corrections and Firefox whole-node replacements. The first safety
commit refused these paths. The Apply All follow-up below restores batches through
one native command or one Quill model transaction. Unsupported operations still
fail before writing. Explicit rewrites offer Copy without a supported transaction.

The patch reuses the existing target port, edit validation, outcomes and adapters.
`TextTargetAdapter.ts` supplies the shared check for focus in another editor.
Review continues to distinguish applied, stale, rejected with a reason, and
unverified results. Typing refusal does not count as accepted text or replay the
acceptance key as a page action.

Unit tests now simulate native editing in `tests/nativeEditingTestUtils.ts`.
That helper has no history implementation and does not prove browser Undo.
Native Undo, host persistence, formatting and submission checks remain in the
browser suites with real React, Quill, ProseMirror, Lexical and TinyMCE fixtures.
The Word API fixture and controlled AI responses are simulations, not live-site
or real-model verification.

### Remaining support limits

- Plain rich-text batches refuse stateful or noneditable nodes inside the required native replacement range. Batches across different structural containers also remain unsupported.
- Quill batches require the public `window.Quill.find` API and a history module. Other Quill instances retain individual native fixes.
- Ambiguous replacement formatting remains unsupported.
- Firefox whole-node replacements with unsafe whitespace behavior are refused.
- Rewrites use Copy on editors without a supported batch transaction.
- Unknown model-backed Review editors remain read-only. Missing native writers do not receive direct DOM or value writes.
- Unmeasurable carets use editor bounds, so suggestion placement can be less precise.
- No live Gmail, Slack, Word or Google Docs account was tested in this follow-up. No real-model inference or quality test was run.
- The checks cover tested adapters and fixtures. They do not certify every host application or editor version.

### Verification for the initial safety commit

| Exact command                              | Result                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `bun run check`                            | Passed lint, formatting and type checking.                                                           |
| `bun run test`                             | Passed all seven processes: 13,187 tests total, zero failures. The main process passed 13,029 tests. |
| `bun run test:e2e`                         | Headless Chrome: 26 passed, zero failures.                                                           |
| `bun run test:e2e:full`                    | Headless Chrome: 139 passed, 10 skipped, zero failures.                                              |
| `bun run test:e2e:full --platform=firefox` | Headless Firefox: 134 passed, 15 skipped, zero failures.                                             |
| `bun run check:e2e:coverage`               | Passed: 231 registered behaviors.                                                                    |
| `git diff --check`                         | Passed.                                                                                              |

These commands reproduced defects before their corresponding production fixes:

- `bun test tests/SuggestionTextEditService.test.ts tests/ContentEditableAdapter.test.ts -t 'native editing is unavailable'`
- `bun test tests/ReviewAdapters.test.ts -t 'Review selection ownership'`
- `bun test tests/ReviewAdapters.test.ts -t 'text-control verification preserves'`
- `bun test tests/ReviewAdapters.test.ts -t 'Review does not take focus'`
- `bun test tests/ReviewSessionAi.test.ts -t 'copy-only rewrite'`
- `bun test tests/SuggestionPositioningService.test.ts -t 'without writing|without creating'`

All these regressions passed in the final unit suite. Intermediate browser runs
also failed where fixtures still expected the removed batch behavior. Updated
fixtures check individual application or refusal with unchanged content.
An initial headless Chrome connection failed. One `bun run test:e2e --headed`
smoke run passed before the request to avoid visible UI. Subsequent runs, including
all final browser gates above, used headless mode.

The development-hook suites and the separate live Docs and real-model commands
were not run. The runtime hooks and model configuration did not change.
Platform-specific and development-only skips remain visible in the full-suite
counts. No skipped test is treated as verified behavior.

### Draft PR description

Prevent unsupported or stale text changes from modifying an editor. Remove direct
DOM/value fallbacks and caret-measurement writes, retain newer focus and selection,
and verify text controls after host reconciliation. Apply rich-text batches in one
native command and Quill batches in one model transaction. Offer Copy for rewrites
without a supported transaction.

Validation: unit tests, lint, formatting, type checking, headless Chrome smoke,
headless Chrome/Firefox full suites, coverage mapping and diff checks passed.

## Apply All follow-up — 2026-10-03

PR #445 contains the initial safety patch and this follow-up. The initial verification
table above applies to commit `a228e744`. All follow-up browser tests run headless.

The first new browser test reproduced why partial `insertHTML` ranges are unsafe:
Chrome added style spans and changed a boundary space. The final native planner
uses the original DOM offsets for single-node batches. Multi-node batches use
complete affected block contents, preserving their markup in one native command.
It does not serialize the editor root or mutate the live DOM to prepare a batch.
The browser tests also found different native list-boundary requirements in Chrome
and Firefox. The planner uses the verified boundary for each browser. Batches
across different structural containers remain unsupported. Stateful elements in
the replacement range cause refusal before any write. Outside blocks
retain their nodes. No whole-document rollback is used.

`review/NativeReviewTransaction.ts` prepares this native transaction.
`suggestions/QuillEditor.ts` verifies public Quill ownership, maps each edit to
model offsets, submits one Delta, and checks the resulting model with Delta.diff.
The existing page bridge carries the request. `review/ReviewTargets.ts` checks
model signatures again after reconciliation. Formatting, stale-source, focus,
composition and edit-set validation remain in the existing pipeline.

New deterministic tests are in `tests/NativeReviewTransaction.test.ts` and
`tests/QuillReviewTransaction.test.ts`. The Quill unit fixture simulates the model
and faults. It is not evidence of native history. The full browser suite uses the
real local Quill library and native contenteditable. It checks multiple corrections,
exact markup or Delta contents, protected code, Unicode, whitespace, one-step Undo,
redo, preceding typing, embedded objects, list structure, outside node identity,
and refusal across noneditable islands. The split-casing browser test now
checks one native transaction instead of refusing the correction.

### Final Apply All verification

| Exact command                                                                                                      | Result                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `bun run check`                                                                                                    | Passed lint, formatting and type checking.                                             |
| `bun run test`                                                                                                     | Passed 13,199 tests across seven processes, zero failures. Main process: 13,041 tests. |
| `bun test tests/NativeReviewTransaction.test.ts tests/QuillReviewTransaction.test.ts tests/ReviewAdapters.test.ts` | Passed 94 tests, zero failures.                                                        |
| `bun run test:e2e`                                                                                                 | Headless Chrome: 26 passed, zero failures.                                             |
| `bun run test:e2e:full`                                                                                            | Headless Chrome: 143 passed, 10 skipped, zero failures.                                |
| `bun run test:e2e:full --platform=firefox`                                                                         | Headless Firefox: 138 passed, 15 skipped, zero failures.                               |
| `bun run check:e2e:coverage`                                                                                       | Passed: 232 registered behaviors.                                                      |
| `git diff --check`                                                                                                 | Passed.                                                                                |

The final source diff was reviewed for editor ownership, partial writes, history
boundaries, stale mappings, formatting and unnecessary abstractions. No model,
asset, backend, permission or typing-generation configuration changed. Local
fixtures do not establish compatibility with every live site or Quill version.
The live-site, development-hook and real-inference checks listed above were not run.

Draft PR description: Reject stale and unsupported text changes without direct
DOM fallbacks. Preserve newer input, focus and selection. Restore plain rich-text
Apply All with one verified native command, and Quill Apply All with one model
Delta and history boundaries. Refuse unsupported batch structures before writing.
