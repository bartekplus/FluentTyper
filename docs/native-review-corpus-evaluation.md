# Evaluation of the supplied broken-text corpus

## Follow-up implementation

The initial evaluation at `701375db` found 34 native findings on the broken text. The follow-up fixes the reproduced safety defects and expands finite grammar coverage; it does not claim general English parsing or complete correction of this corpus.

| Finding                                     | Disposition                                                                                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Named quoted mistakes were being edited     | Fixed in shared native finalization and dictionary candidate selection; ordinary dialogue still runs. Includes contractions and possessives inside curly single quotes.                                              |
| Long-distance quote state hid date ordinals | Fixed with one quotation scan. Added `October 3st` coverage only with named-month evidence; stone weights, `16rd` and `42RD` remain unchanged.                                                                       |
| Repeated `to to`                            | Added to the existing individual-only function-word rule.                                                                                                                                                            |
| Longer preposition/possessive/degree frames | Added audited adjuncts and vocabulary: meeting, policy, unclear whether, previous one, much simpler, easiest solution.                                                                                               |
| Agreement                                   | Added a Review-only subject check with known heads/predicates and sentence/paragraph boundaries. Expanded existing pronoun/existential frames; unsafe coordinated/nested subjects and soft wraps abstain.            |
| Prepositions and lexical choices            | Added responsible for, duration for/since, arrive at, wait for, investigate; bounded between you and me, noun effect, whether, whose and loose contexts. Ambiguous verb effect/affect is deliberately not rewritten. |
| Complements and indirect questions          | Added bounded enjoy/avoid, decide, suggest, make/let, help and four embedded-question frames. Removed ambiguous allows + participle rewriting; coordinated gerund content clauses remain unchanged.                  |
| Countability                                | Equipment/data/criteria repairs; quantified feedback/information/advice warn with **no proposed edit**. No quantity or unit is invented.                                                                             |
| Unit lists                                  | Supported list items such as `10kg, 25km, 100ms` are checked individually. Registry exclusions for ambiguous `GB`, `%`, `%CPU` and noncanonical casing are retained; no unit conversion or registry policy change.   |
| Real spelling quality                       | The actual local Presage dictionary was measured. Added contextual `aswell` and `finded` repairs because its candidates omitted “as well”/“found”; numeric `sec`/`secs` abbreviations are preserved.                 |

The corpus now produces **76 native findings**, including **three warning-only quantity cases**, and **three additional local dictionary findings** (79 combined). The supplied reference produces **zero native findings** with optional style off or on, and **zero dictionary findings** in the default combined pass. Six unsafe baseline findings inside quoted error examples disappear. Counts describe initial detection, not independently adjudicated recall or fully repaired sentences.

Run `bun scripts/evaluate-native-review-corpus.ts --spelling` for exact ranges and alternatives. The dictionary pass deduplicates lookup words and uses production candidate filtering, ranking and diagnostic validation; it intentionally measures full offline lookup coverage, not the browser's per-pass budget or UI latency. Remaining dictionary suggestions are `particulary`, `easilly` and British `utilisation` under the selected US dictionary; the last is a locale preference, not a universal misspelling.

`tests/grammar/ReviewCorpus.test.ts` supplies issue-level source/expected-repair pairs, warning expectations and preservation cases. A whole-corpus regression checks representative repairs inside their full surrounding prose and keeps the reference clean. Original broken/reference text and the user's broad notes remain separate fixtures. The supplied reference is not used as a whole-document rewrite oracle.

Latest local medians (three warmups, eleven samples) were 62 ms for the broken default scan and 69 ms with style enabled, versus the initial 25–27 ms baseline at `701375db`. Additional coverage costs more CPU; no speedup is claimed. The full offline dictionary pass took 192 ms for 499 distinct broken-text lookups and 46 ms for 517 reference lookups. These are local engine timings, not browser latency.

### Deliberate remaining limits

Missing articles and definiteness, narrative tense, conditional meaning, dialect negation, coordinated pronoun case, collective agreement, optional commas and stylistic rewrites still need contextual judgment. Some ordinary noun/relative-clause agreements, extended complements and unit spellings remain outside the finite patterns. They are coverage gaps, not “correct” sentences merely because no finding appears. A quantified warning likewise does not mean the sentence has been repaired.

Independent review rejected overbroad subject matching, effect/affect rewriting, gerund-content-clause rewrites and `st` measurement corruption. Regression tests preserve these counterexamples; coverage is reduced wherever correctness is uncertain.

## Reproduce

Reproduce with `bun scripts/evaluate-native-review-corpus.ts`. It emits four JSON records with exact ranges, alternatives, context, coverage and scan timings. Inputs and supplied expectation notes are in `tests/fixtures/native-review-corpus/`. The notes are evaluation material, not assertions that every proposed rewrite is correct.

## Reference limits

The reference is not a perfect gold standard: changing quoted misspellings changes the example's meaning; `themself/myself`-style emphatic uses, collective agreement, double negation in dialect, article choices and optional commas need context. Expanding “0.75 sec” is style, not a numerical conversion or universal grammar requirement. No defensible overall recall percentage can be computed from the loosely phrased expectation table without annotation.
