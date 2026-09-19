# Measurement formatting verification

The rule inserts one U+00A0 separator between an authored number and a known unit. Verification treats every other character as immutable and uses hand-written expected strings rather than parser output.

Run the focused checks:

```sh
bun test tests/grammar/MeasurementUnitFormattingRule.test.ts tests/grammar/MeasurementAdversarial.test.ts tests/MeasurementEditTransaction.test.ts tests/MeasurementEditingContext.test.ts
bun scripts/benchmark-measurement.ts
```

The adversarial suite covers all nine supported locales, decimal marks, signs, prefixes, unit exponents, compounds, grouped expressions, existing separators, malformed tails, ambiguous symbols, identifiers, URLs, paths, code-like text, paste, non-insert actions, protected contexts, and all-default pipeline stability. Transaction checks require a live collapsed snapshot, preserve adjacent rich formatting nodes, and verify immediate undo.

The benchmark reports Bun version, OS, architecture, iteration count, total time, time per operation, and match count for a typical match, ordinary non-match, long prose, and an overlong malformed expression. Inputs are fixed and the parser's bounded tail scan keeps runtime independent of document length after the bound.

Reference run on 2026-09-19 with Bun 1.4.2 on macOS arm64, 100,000 iterations per case: typical 661 ns/op, non-match 444 ns/op, long prose 24 ns/op, and adversarial malformed input 1,386 ns/op. These figures are a local sanity check rather than a performance budget.

Google Docs intentionally remains fail-closed for this feature. Its current model does not expose enough semantic information to distinguish prose from protected or code-like content, so it supplies no `measurementContext: "prose"` hint.
