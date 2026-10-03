# Editor capability detection

FluentTyper separates activation, current keyboard ownership, and Review transactions.
A fingerprint restricts a writer. It does not prove that an editor supports that writer.

## Existing safeguards and modules

- `SuggestionElementDiscovery.ts` discovers fields and open shadow roots. Each injected frame has its own runtime.
- `FieldEligibility.ts` excludes credentials, payment fields, locked controls, and hidden fields before Review reads text.
- `CodeContextResolver.ts` identifies semantic code and protected selection ranges. Weak CSS names do not exclude a document.
- `NativeAutocompleteConflictDetector.ts` distinguishes structured fields and browser datalists from prose. It checks linked popup visibility and actionable options.
- `SuggestionManagerRuntime.ts` manages activation, saved field choices, active sessions, and teardown.
- `DomObserver.ts`, `MutationPipeline.ts`, and the mutation scheduler process relevant changes. Typing-only mutations do not cause discovery scans.
- `SuggestionEntrySession.ts` cancels stale requests and timers. `SuggestionTextEditService.ts` uses the existing adapter transactions.
- `ReviewTargets.ts` separates reading from verified writes. `ReviewController.ts` and `ReviewUi.ts` show restrictions outside editor content.

These files are under `src/adapters/chrome/content-script/`. Suggestion modules are in `suggestions/`; Review modules are in `review/`.
Review detection remains in the extension background. This change adds no inference work to typing handlers.

## Changes and reproduced risks

The original detector classified an ordinary input with only `role="combobox"` as manual.
The regression test failed against the original detector and passes against the changed detector.
ARIA roles, popup hints, and stale expanded flags no longer prevent automatic activation.
Structured purpose attributes and usable browser datalists retain manual activation.

`EditorCapabilities.ts` returns a fixed, text-free record. It reports inspection, mapping, suggestions, replacement, selection/Undo requirements, Review, key ownership, conflict, and reason.
It performs no model reads, stores no history, and creates no observers.
The existing runtime checks this record before interaction. Review uses the same metadata gate before its existing text safety checks.
`reviewApply` requires the target's separate `ReviewCapabilities` evidence. Typing permission never grants Review write permission.

The existing typing adapters support host transactions for ProseMirror and TinyMCE, plus verified host input handling for CKEditor and Lexical.
Their typing paths still validate each write. Their fingerprints alone do not grant Review writes.
A Quill fingerprint without a working model bridge now provides Review only. It cannot select a generic Review DOM writer.

Acceptance handlers consume keys only after a synchronous action succeeds. Tab no longer queues acceptance of an unseen inline suggestion.
Code/prose transitions invalidate predictions, including same-text transitions. The early Tab bridge checks the context recorded when the menu rendered.
Temporary unknown selection states retain the existing host reconciliation path.
ARIA-disabled and ARIA-readonly ancestors now block interaction across shadow boundaries.
Review-only finding cards offer Copy. Clipboard writes require a trusted click and do not edit the field.

## Capability and reason matrix

| Context                                                    | Prose inspection / mapping          | Typing suggestions / acceptance                                             | Review / Apply                              | Reason or limit                                    |
| ---------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| Ordinary input or textarea, including stale ARIA hints     | Yes                                 | Yes, when a valid action is visible                                         | Yes / native transaction required           | `available`                                        |
| Associated visible native popup                            | Yes                                 | Temporarily paused with the preference enabled                              | Yes / target transaction required           | `native-popup`                                     |
| Unrelated visible popup                                    | Yes                                 | Unchanged                                                                   | Unchanged                                   | No field association                               |
| Structured purpose                                         | According to existing privacy rules | Manual activation                                                           | Existing conservative Review exclusions     | `manual-activation`                                |
| Usable browser datalist                                    | Yes for prose                       | Manual activation; acceptance keys yield while native preference is enabled | Yes / target transaction required           | `browser-unknown`                                  |
| Unknown model writer, such as a Slate fingerprint          | Yes                                 | Disabled                                                                    | Review and Copy / no Apply                  | `unverified-writer`                                |
| Verified Quill or ProseMirror Review bridge                | Yes                                 | Existing typing transaction path                                            | Yes / verified model transaction            | Each edit revalidates model and ranges             |
| Mixed prose and code                                       | Prose with protected ranges         | Fresh code predictions keep existing capitalization suppression             | Prose only / protected ranges cannot change | Current context is separate from host eligibility  |
| Credential, disabled, read-only, hidden, or detached field | No                                  | No                                                                          | No                                          | `sensitive`, `restricted`, `hidden`, or `detached` |

`replaceText` permits an attempt through the existing writer. It does not prove that an arbitrary replacement will succeed.
`preserveSelectionAndUndo: transaction-required` has the same limitation. A transaction must validate its target, range, selection, and result.
The diagnostic record contains no text, identifiers, URLs, or accumulated event history. It is not uploaded or persisted.

## Settings and lifecycle precedence

1. Global and site enablement determine whether the runtime starts.
2. Credential and structural exclusions remain mandatory. Site choices and manual activation cannot bypass them.
3. Existing saved field choices can enable structured fields. Disabling the native preference preserves the user's explicit interaction choice.
4. With native preference enabled, a current linked popup overrides field activation. Review remains independent.
5. A writer must still pass its own transaction checks. Review-only capability never authorizes a Review mutation.

Popup closure, focus, relevant mutations, and new input re-evaluate the current element.
The session remains attached during a temporary native popup. Requests issued before a capability change cannot restore old suggestions.
Closure restores eligibility without a reload. Fresh suggestions use the next input or explicit request, so native choices are not replayed as corrections.
Removed fields lose their sessions, listeners, timers, and UI. Replacement fields receive new sessions.
If a model mounts on the same host during Review, Apply becomes unavailable. Reopen Review to resolve the new model adapter.
No new observer or negative cache is added. FluentTyper UI stays outside serialized editor content.

## Limits and manual smoke procedure

DOM inspection cannot reliably identify browser chrome popup state, closed-shadow popups, canvas pickers, or unlinked custom keyboard handlers.
Usable datalists therefore keep an explicit limitation and yield acceptance keys with native preference enabled.
Other invisible or unassociated native handlers remain a limitation. FluentTyper does not infer conflicts from a site's domain or historical editor family.
The MAIN-world early Tab bridge still sends an asynchronous request. An intervening host change can make that request fail after key capture.
The receiving session revalidates the edit. The new context check reduces this race but does not eliminate all asynchronous host changes.

The automated tests use synthetic pages and editor fixtures. They do not establish current live-site compatibility.
For a live smoke check:

1. Open a non-sensitive composer with the production extension.
2. Record the actual editor and adapter evidence. Do not infer it from the site's name.
3. Open and close native suggestions. Check Tab, Enter, arrows, and focus movement.
4. Start Review while native suggestions are open. Check that it reads without automatic edits.
5. Test a single replacement and Undo only where the target offers Apply.
6. Replace the field or navigate. Check that the old UI and listeners are removed.
7. Disable FluentTyper for the site. Check that the page receives normal keys.

Live-site checks are not part of the fixture results.

## Draft PR description

Fix false manual activation in prose fields that expose stale autocomplete metadata.
Use current linked popup evidence for temporary typing suppression, while Review keeps its independent read and write capabilities.
Preserve Tab when no visible action can succeed, reject predictions after code-context changes, and offer Copy for Review-only findings.
Keep existing privacy, code-range, host transaction, and lifecycle safeguards.

Validation includes unit tests, Chrome and Firefox fixture suites, repository checks, and the coverage matrix.
No live-site compatibility claim is made. No model, backend, permissions, or text telemetry changed.

## Validation results

All results below came from this checkout on 2026-10-03.

| Exact command                                                                                                                                 | Result                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                                                                                                               | Passed. Installed the locked dependencies with Bun 1.4.2.           |
| `bun run check`                                                                                                                               | Passed lint, formatting, and typecheck after the final edits.       |
| `bun run test`                                                                                                                                | Passed 13,070 main tests and 158 isolated tests.                    |
| `bun run test:e2e`                                                                                                                            | Passed 26 Chrome smoke tests in 10.60 seconds.                      |
| `bun run test:e2e --platform=firefox`                                                                                                         | Passed 26 Firefox smoke tests in 13.83 seconds.                     |
| `bun run test:e2e:full`                                                                                                                       | Passed 146 tests, with 10 skips.                                    |
| `bun run test:e2e:full --platform=firefox`                                                                                                    | Passed 141 tests, with 15 skips.                                    |
| `bun run test:e2e:full --test-name-pattern=Review`                                                                                            | Passed 57 tests, with 1 skip, after the final Review writer guard.  |
| `bun run test:e2e:full --platform=firefox --test-name-pattern=Review`                                                                         | Passed 52 tests, with 6 skips, after the final Review writer guard. |
| `bun test tests/EditorCapabilities.test.ts tests/ReviewAdapters.test.ts tests/QuillReviewTransaction.test.ts tests/ProseMirrorReview.test.ts` | Passed 117 tests after the final Review writer guard.               |
| `bun test tests/SuggestionManagerRuntime.test.ts`                                                                                             | Passed 79 tests after the final status notice change.               |
| `bun run check:e2e:coverage`                                                                                                                  | Passed. The matrix contains 241 behaviors.                          |
| `git diff --check`                                                                                                                            | Passed.                                                             |

The full suites preceded the last Review writer guard and status notice changes. The focused reruns above cover those final changes.
The smoke measurements exceeded the repository's 10-second target. They are measured results, not performance improvements.
The development-runtime suites were not run because development hooks did not change. Live sites, real AI generation, and remote CI were not tested.
The browser suites include synthetic editor fixtures and existing mocked Local AI cases. They do not prove live AI quality or live-site compatibility.

A regression against the original detector used `bun test ./.tmp/capability-baseline/regression.test.ts`.
It failed as expected: `role="combobox"` returned `manual` instead of `automatic`.
The retained regression in `tests/NativeAutocompleteConflictDetector.test.ts` passes with the patch.
Initial failures in the old manual-combobox and queued-inline-accept expectations were updated to the required behavior.
An intermediate context guard also disrupted host reconciliation. The corrected guard passed the full unit suite and browser fixtures.
