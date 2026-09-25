# Automatic rich-text code protection

FluentTyper resolves the current caret's code context for each grammar operation
and prediction request. Moving between code and prose, or changing formatting
without changing text, does not change saved settings or restart the runtime.

## Detection

`CodeContextResolver.ts` recognizes semantic `code`, `pre`, `kbd`, and `samp`
ancestors; Quill's `.ql-code-block` and `.ql-code-block-container`; and the existing
Monaco, CodeMirror, and Ace editor markers. Empty blocks and syntax-highlighting
descendants are covered. Preformatted/literal content receives the same protection.
Code elsewhere in the composer does not disable the active prose paragraph.

Monospace fonts, `spellcheck=false`, `data-gramm=false`, generic `.code` or
`language-*` classes, and program-looking text are not standalone code signals.

Selection is read from the editor's owning document. Shadow editors use
`getComposedRanges()` when available, with scoped or ordinary range fallbacks.
Every resolved range must be collapsed and belong to the target. Missing,
foreign, expanded, or unavailable selections remain unknown. A parent-offset
caret next to code also remains unknown rather than guessing insertion affinity.
A failed composed-selection call never falls back to a different caret.

## Grammar and prediction behavior

`MeasurementEditingContext.ts` preserves existing field eligibility exclusions
and maps every non-prose result to the grammar engine's `protected` hint.
Only code-safe grammar rules run there; an explicitly enabled `autoBracketClose`
still runs. This is not a policy that blocks every extension action.

Prediction requests carry optional `suppressAutoCapitalize: true` for non-prose
DOM contexts. The background applies it per request, never to shared predictor
configuration. Thus `what . wa` can offer and insert `was` in code and `Was` in
prose. Authored `Wa`/`WA`, original candidate casing, and snippet text/metadata
retain their existing behavior; results are not blindly lowercased. Virtual
Google Docs prediction sessions without a DOM element retain their prior behavior.

No dependencies, settings migrations, permissions, external requests, typed-text
logging, or keyboard interception are added. Explicit autocomplete and snippet
acceptance remain available. Markdown parsing is unchanged.

## Limits

Caret-local detection does not validate every replacement range across inline
code, clip grammar context to prose-only spans, or track stale predictions by
region identity. Those are separate transaction safeguards. Custom model-only
code styles and Google Docs canvas formatting need dedicated adapters.

## Tests

`CodeContextResolver.test.ts`, `CodeContextGrammar.test.ts`, and
`CodeContextShadow.test.ts` cover detection, selection boundaries/failures,
formatting changes, real grammar hints, and optional code-safe rules.
`codeContextTestUtils.ts` shares editor/caret fixtures and synchronous property
overrides; exact descriptor restoration is tested even for nested exceptions.

`CodePredictionCapitalization.test.ts` covers casing, request isolation, and
message forwarding. `background.routing.test.ts` covers independent casing and
site suggestion-count overrides. `SuggestionManager.test.ts` checks popup text
and Tab acceptance. The full Chrome/Firefox suite tests the built extension in
real Quill code and prose in the same composer. Automated fixtures are not a
claim of independent live Slack or Google Docs validation.

Run the focused tests:

```sh
bun test tests/CodeContextResolver.test.ts tests/CodeContextGrammar.test.ts tests/CodeContextShadow.test.ts tests/CodePredictionCapitalization.test.ts
```

Run `bun run check`, `bun run test`, `bun run check:e2e:coverage`, and both
browsers' smoke/full suites as specified in `docs/agents/testing.md`. Coverage
entries use the existing stable behavior IDs; no baseline behavior is removed.
