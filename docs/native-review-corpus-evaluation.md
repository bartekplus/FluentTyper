# Evaluation of the supplied broken-text corpus

The broken corpus produces 90 native findings and 2 more local dictionary findings (92 in total). The supplied reference produces no findings. These counts describe detection, not adjudicated recall.

## Reproduce

Reproduce with `bun scripts/evaluate-native-review-corpus.ts`. Add `--spelling` to include the dictionary pass. It emits four JSON records with exact ranges, alternatives, context, coverage and scan timings. Inputs and supplied expectation notes are in `tests/fixtures/native-review-corpus/`. The notes are evaluation material, not assertions that every proposed rewrite is correct.

## Reference limits

The reference is not a perfect gold standard: changing quoted misspellings changes the example's meaning; `themself/myself`-style emphatic uses, collective agreement, double negation in dialect, article choices and optional commas need context. Expanding “0.75 sec” is style, not a numerical conversion or universal grammar requirement. No defensible overall recall percentage can be computed from the loosely phrased expectation table without annotation.
