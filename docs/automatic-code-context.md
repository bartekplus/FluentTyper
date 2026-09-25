# Automatic rich-text code protection

FluentTyper applies the existing Code-mode grammar filter at the current caret,
without changing saved global/site settings or restarting the content runtime.
Moving back into prose restores the configured prose rules on the next grammar
operation. The resolver is synchronous and uncached, so changing a paragraph's
format without changing its text is also recognized.

## Supported DOM signals

- Semantic `code`, `pre`, `kbd`, and `samp` ancestors. Literal/preformatted text is
  protected even when it is not a programming language.
- Quill 2's editing DOM: `.ql-code-block` and `.ql-code-block-container`, including
  empty blocks and syntax-highlighting descendants. No `.ql-editor` ancestor is
  required, so the standalone code-block representation works too.
- Existing whole-editor markers: `.monaco-editor`, `.CodeMirror`, `.cm-editor`,
  and `.ace_editor`.

Code blocks elsewhere in a composer do not change the active prose paragraph's
mode. Inline code does not disable adjacent prose text. Monospace fonts,
`spellcheck="false"`, `data-gramm="false"`, generic `.code`/`language-*` classes,
and text that merely resembles a program are not used as code evidence.

## Selection and eligibility

`CodeContextResolver.ts` uses the editor's owning document and inspects the
caret's ancestors. For shadow-root editors it supplies the accessible ancestor
roots to `getComposedRanges()` when available, with scoped-selection/ordinary
range fallbacks. It checks that the returned range actually belongs to the
editor rather than treating a re-scoped host position as prose.

Missing, foreign, non-collapsed, or unavailable selections are unknown. A
parent/child-offset position immediately adjacent to code also has uncertain
formatting affinity; prose-only rules are withheld rather than choosing a
sibling. An ordinary text-node position in adjacent prose remains eligible.

`MeasurementEditingContext.ts` retains the existing grammar-hint interface and
sensitive/read-only/input-type exclusions. Unknown and protected contexts map to
its existing `protected` hint. This hint is already consumed by the shared
local grammar paths, including Enter's virtual word-boundary processing.

## Semantics and scope

This is automatic **grammar protection**, not a new autocomplete mode. The
existing `codeSafe` rule allowlist still applies; an explicitly enabled
`autoBracketClose` remains enabled. Unknown/protected does not introduce a new
"block every extension action" policy. Existing composition, edit eligibility,
and selection-stability guards remain responsible for their respective checks.

No settings, migrations, permissions, network requests, logging of typed text,
prediction messages, or keyboard interception are added. Suggestions, explicit
snippet acceptance, the early-Tab bridge, and Markdown parsing are unchanged.

This change does not add final replacement-range validation across inline-code
boundaries, clip grammar context to prose-only spans, or add stale-prediction
region tokens. A caret-local check alone is not a guarantee that every possible
replacement range avoids code. Those broader safeguards need a separate edit-
transaction change and end-to-end validation. Custom model-only code styles and
Google Docs canvas code formatting also need dedicated adapters.

## Tests

`tests/CodeContextResolver.test.ts` covers the supplied mixed Quill markup, empty
blocks, semantic/inline code, highlighted descendants, prose restoration,
formatting-only changes, negative heuristics, existing protected controls,
ambiguous boundaries, owning-document selection, composed shadow ranges, and
selection API failures.

`tests/CodeContextGrammar.test.ts` exercises the real grammar coordinator and
catalog: default-rule protection and restoration, all automatic trigger types,
Enter boundaries, and preservation of the optional code-safe bracket rule.

Run the focused repository tests with:

```sh
bun test tests/CodeContextResolver.test.ts tests/CodeContextGrammar.test.ts
```

Before marking the draft ready, run the repository checks, unit suite, coverage
registry validation, and smoke/full extension suites on Chrome and Firefox as
specified in `docs/agents/testing.md`. Focused DOM checks are not a substitute
for the complete extension or live Slack/editor validation.
