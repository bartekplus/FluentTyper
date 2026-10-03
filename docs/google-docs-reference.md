# Google Docs engineering record

[FluentTyper](../README.md) / [User guide](google-docs-integration.md) / Technical reference

This record describes the Google Docs implementation and its tests.
See the [user guide](google-docs-integration.md) for the supported path and browser limits.

Passing a build in `production` mode does not mean this private-API integration is
production-certified.
The integration uses no extra permissions, dependencies, network services or clipboard access.
Predictions use the local backend and its settings.
The MAIN-world bridge exposes no extension APIs to the page.

## Architecture and feature mapping

The Google Docs adapter receives logical text and selection from the page-side
annotated-text capability. It supplies explicit text context to the shared
`SuggestionPredictionCoordinator`; no fake textarea is edited to manufacture success.
The background predictor, snippet expansion, language selection, user dictionary,
site configuration, and personalization settings use their normal code paths.

| Requirement                               | Implemented behavior                                                                                                              | Evidence / limitation                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Prefix and non-prefix spelling completion | Plan a complete range replacement, including a suffix under a mid-word caret.                                                     | Model and cross-world fixtures pass. Predictor replies are stubbed in browser fixtures.                                                    |
| Selected-text replacement                 | Explicit manual invocation supports a bounded forward or reversed selection.                                                      | Never autonomously replaces a user's noncollapsed selection.                                                                               |
| Grammar and rewrites                      | Reuses the complete configured local grammar catalog; paragraph-scoped triggers and custom caret offsets.                         | Shared catalog regression suite passes. Every typing rule is fixture-tested in the cross-world suite.                                      |
| Snippets and dynamic variables            | Background expansion feeds the same pipeline; accepts multiline expansion text without flattening whitespace.                     | Multiline insertion is fixture-tested. Real background-to-Docs expansion and formatting require live tests.                                |
| Next-word prediction                      | Shared coordinator accepts empty-prefix requests and inserts without deleting the following word.                                 | Model and browser fixtures pass.                                                                                                           |
| Inline mode                               | Reuses the owned ghost presenter for a safe suffix at a line end.                                                                 | Spelling rewrites, midtext, RTL, multiline or ambiguous geometry use the themed menu. Full canvas-mirror inline parity is NOT implemented. |
| Keyboard and mouse                        | Configured Tab, Enter, Space, arrows, Escape and digit shortcuts; synchronous early key acknowledgment, mouse focus preservation. | Trusted keyboard events cross actual MAIN/isolated contexts in Chromium fixtures.                                                          |
| Themes                                    | Shadow DOM menu, typography service and theme variables.                                                                          | Custom theme regression passes. Exact Docs font/zoom alignment needs live review.                                                          |
| Statistics / learning                     | Local services run only after observed model success; deduplicated late acknowledgment and exact last-edit reversal observation.  | No claim that event dispatch means acceptance. Undo/redo journal observation is fixture-tested, not native Docs undo grouping.             |
| Titles and comments                       | Generic helper remains active in top-level ordinary editable fields; only the hidden Docs input iframe is excluded.               | Real generic SuggestionManager exercised on fixture input and textarea. Actual Docs comment DOM remains a live check.                      |
| Accessibility / localization              | Keyboard access, option semantics, polite selection announcements, visible failure status and nine UI-language translations.      | Does not overwrite Docs' editable ARIA attributes. Not screen-reader/WCAG certified.                                                       |
| IME                                       | Composition guards across frames, settling delays, key-code 229 avoidance; no acceptance while composing.                         | Synthetic composition-event fixture only. Native platform IMEs are a release gate.                                                         |
| RTL and multiple visible carets           | Logical Unicode offsets and grapheme-safe edits; direction-aware menu. A fixed palette avoids guessing a collaborator's caret.    | Does not prove visual bidi shaping/caret affinity or identify every local caret.                                                           |
| Collaboration                             | Fresh model/selection/scope/input/interaction checks before selection and before paste; stale work is discarded.                  | No revision-aware atomic transaction exists in this implementation. Concurrent operation ordering is NOT proven.                           |
| Document tabs                             | Pending work is bound to full edit URL, including tab query parameters, and input-object identity.                                | Same-URL scope changes or private API topology not separately identified. Real multi-tab behavior remains unverified.                      |
| Tables / footnotes / mixed formatting     | Rejects edits crossing exposed object/control markers; minimizes the changed range on grapheme boundaries.                        | Not a structural document model. Text parity cannot prove structure or formatting preservation.                                            |
| Offline                                   | No network dependency; offline browser fixture passes.                                                                            | Does not verify Google Docs' offline cache, save synchronization or persistence.                                                           |
| Smart Compose / other extensions          | Respects configured preference for visible `aria-controls` native popups.                                                         | Canvas Smart Compose and arbitrary third-party overlays are NOT reliably detected. Disable competitors in the initial live test profile.   |

## Live editor quirks

The first three items are verified in Chrome against real Google Docs.

- `setSelection` blurs the editable inside `iframe.docs-texteventtarget-iframe` while the
  frame itself stays focused. The bridge refocuses the editable before pasting and treats a
  blurred editable as active as long as the frame is.
- Docs strips leading/trailing ASCII spaces from a plain-text paste but converts NBSP to a
  regular space. Edge spaces are sent as NBSP; the verified model still contains `" "`.
- An unverified write blocks the adapter only until the next trusted user interaction; it is
  then forgotten without being retried or learned.
- Firefox can ignore `ClipboardEventInit.clipboardData` and make its own empty data store
  ([Mozilla bug 2027025](https://bugzilla.mozilla.org/show_bug.cgi?id=2027025)). The bridge
  fills and reads back the clipboard data of the constructed event. If it cannot write that
  store, it does not dispatch the paste.
- Firefox does not inject `document_start` content scripts into empty iframes, also with
  `match_about_blank`. The parent bridge installs the frame key handler when it finds or
  rebinds the input document, so the early-key path does not depend on the blank iframe.

## Edit transaction invariants

`GoogleDocsModel.ts` validates metadata, Unicode boundaries and edit ranges.
`GoogleDocsTransaction.ts` owns single-use tokens, model validation, the edit journal,
selection restoration and acknowledgments. `GoogleDocsMainWorld.ts` adapts the private
API and iframe input realm. `GoogleDocsBridgeClient.ts` uses bounded JSON requests.
`GoogleDocsAdapter.ts` connects predictions, grammar, UI and local learning.

A token contains a fresh full logical model, raw selection, focused input object,
full URL, interaction generation and expiry. Only bounded context crosses to the
content-script prediction adapter. Limits are 2,000,000 UTF-16 code units per document,
16,384 per edit/selection, and 8,192 of context per side. Unsupported states fail closed.

An edit token is consumed before asynchronous work. The adapter re-reads the model,
selects only the minimum changed span, then rechecks text, selection and identity.
It dispatches **one synthetic plain-text paste** in the input iframe's event realm.
Synthetic paste is still untrusted and may be ignored. Neither `dispatchEvent` nor
`execCommand` return values are accepted as proof of insertion.

The bridge verifies the expected raw logical text independently. A delayed exact
acknowledgment can recover the session without another paste. An ambiguous write
retains its journal across adapter disable/cancel; it is never blindly retried,
fuzzily relocated, repaired by rewriting a block, or rolled back over user edits.
Native undo/redo shortcuts are not hijacked. The journal observes an exact last-edit
text reversal to reverse local personalization; it does not certify native undo units.

These checks reduce races but are **not atomic compare-and-swap** against Google's
collaborative model. Text equality does not prove formatting, revision identity,
persistence, or that an independent identical edit was not made concurrently.

Known limitation: the keyboard bridge publishes the current single-use token in a DOM
attribute on the input iframe, so a script already running on docs.google.com could forge
an acceptance of a visible suggestion. Such a script can already edit the document through
the same page API; the only extension-side effect is a spurious local learning record.

## Automated tests and continuous integration

Run the [baseline checks](agents/testing.md#baseline-before-a-pr) and the
[Google Docs tests](agents/runtime-features.md#google-docs).

The Docs fixture suite compiles the real adapter and shared services, creates MAIN
and isolated Chromium worlds, and sends real browser keyboard events. Only the editor's
annotated API, its canvas model and prediction responses are mocked. It does not load
the packaged extension's service worker. Its URL facade and randomUUID fallback are
strictly fixture code, never included in the extension build. The fixture runs
in-memory; no browser policy or live-site access restriction is bypassed.

The Chrome full-regression CI job runs this suite. There is no equivalent Firefox
cross-world fixture. Firefox builds use the generic regression suite.

## Real-document check

```sh
bun run test:e2e:docs:live -- --help
```

For manual tests, use a dedicated browser profile and a new, empty, disposable document.
Load the unpacked build and enable FluentTyper on docs.google.com. The annotation
bootstrap runs at `document_start`, so reload the document after you enable the site.

The supplied operator-assisted script requires an explicit disposable document URL,
a dedicated local profile, an unpacked extension and `--allow-edits`. Authentication
happens in your local browser, not through shared credentials. The script refuses a
nonempty logical document, tests an actual offered completion and native undo/redo,
and asks the operator to verify Saved to Drive before testing reload persistence.
It writes a local report and never retries a failed edit. It is a smoke check, not the full matrix.

Verified live in Chrome (2026-09-15): the annotated API activates for FluentTyper's own
extension ID, suggestions render at the caret, Tab acceptance is verified as applied, and
native undo/redo work. Still unverified: Edge/Firefox, all supported keyboard settings, snippets/dynamic variables,
user dictionaries, language/site profiles, mixed formatting and
links, headings/lists/tables/footnotes, multiple tabs, two collaborating accounts,
disjoint and overlapping remote edits, zoom/scroll, RTL, native IMEs, screen readers,
Smart Compose/competing extensions, offline/reconnection, save and reload. Do not
mark missing evidence passed because a fixture or build succeeded.

## References

- Harper's implementation overview: https://writewithharper.com/docs/contributors/chrome-extension
- Harper's page bridge: https://github.com/Automattic/harper/blob/master/packages/chrome-plugin/public/google-docs-bridge.js
- Chrome content-script world/lifecycle documentation: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

The annotated-text surface is not a stable public Google Docs editing API. Access
for FluentTyper's own extension IDs and compatibility with current Docs must be
validated in a real browser. This implementation never impersonates Harper or another
extension and never overwrites an already-set annotation bootstrap flag.
