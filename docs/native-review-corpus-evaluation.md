# Evaluation of the supplied broken-text corpus

## Follow-up implementation

The initial evaluation below is retained as the baseline at `701375db`. The follow-up fixes the reproduced safety defects and expands finite grammar coverage; it does not claim general English parsing or complete correction of this corpus.

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

Latest local medians (three warmups, eleven samples) were 62 ms for the broken default scan and 69 ms with style enabled, versus the initial 25–27 ms baseline. Additional coverage costs more CPU; no speedup is claimed. The full offline dictionary pass took 192 ms for 499 distinct broken-text lookups and 46 ms for 517 reference lookups. These are local engine timings, not browser latency.

### Deliberate remaining limits

Missing articles and definiteness, narrative tense, conditional meaning, dialect negation, coordinated pronoun case, collective agreement, optional commas and stylistic rewrites still need contextual judgment. Some ordinary noun/relative-clause agreements, extended complements and unit spellings remain outside the finite patterns. They are coverage gaps, not “correct” sentences merely because no finding appears. A quantified warning likewise does not mean the sentence has been repaired.

Independent review rejected overbroad subject matching, effect/affect rewriting, gerund-content-clause rewrites and `st` measurement corruption. Regression tests preserve these counterexamples; coverage is reduced wherever correctness is uncertain.

## Initial evaluation

Evaluated native Review at `701375db` using the actual `detectReviewDiagnostics` pipeline, English US, default Review rules, empty user dictionary, whole-field scope, then with both optional style checks enabled (35-word threshold). The heading, expected-fix table and reference text were excluded from the broken-input scan. No Local AI or Presage dictionary service was invoked. The results therefore describe native detection, not the extension's combined spelling/AI coverage.

Reproduce with `bun scripts/evaluate-native-review-corpus.ts`. It emits four JSON records with exact ranges, alternatives, context, coverage and scan timings. Inputs and supplied expectation notes are in `tests/fixtures/native-review-corpus/`. The notes are evaluation material, not assertions that every proposed rewrite is correct.

## Measured result

| Input                        | Characters | Native findings | Findings with style enabled |
| ---------------------------- | ---------: | --------------: | --------------------------: |
| Broken text                  |      8,176 |              34 |                          34 |
| Supplied corrected reference |      8,071 |               0 |                           0 |

Of the 34 initial findings, **33 use pre-existing rules and only one uses a new rule**, repeated words. That occurrence is inside an explicitly described error example. This sample demonstrates very low incremental coverage from the new rules; it does not justify saying the twenty-feature roadmap provides broad grammar checking.

Breakdown: sentence-start capitalization 5; day/month capitalization 7; `alot` 1; contractions 7; typo whitelist 6; repeated words 1; pronoun I 2; measurement formatting 1; comma spacing 3; repeated spaces 1. No detector threw, and coverage reported no skipped regions. “Checked” means a detector ran, not that every grammatical construction was understood.

Initial local median scans (three warmups, eleven samples) were approximately 25–27 ms. These exclude spelling lookups, AI, editor reads, rendering and bulk proof. They are not browser latency measurements.

An in-memory simulation accepted one single-alternative suggestion at a time and rechecked. It stopped after **36 edits with zero remaining findings**, despite many obvious errors remaining. It changed neither the fixture nor an editor and is not a proposal to bulk-apply the suggestions. Later findings included `We didn't had` → `We didn't have` and additional comma spacing exposed by prior edits.

## What works

- Native casing catches sentence starts and several lowercase days/months; contractions catch `didnt`, `dont`, `doesnt` and `wasnt`.
- Existing small corrections catch `alot`, several known typos, double spaces and selected comma-spacing errors.
- Minimal repairs and rechecking compose: `We didnt had` → `We didn't had` → `We didn't have`.
- No native finding appears on the supplied corrected reference. This is useful clean-text evidence, not proof against false positives elsewhere.
- Style remains separate. The sample has no PIN/ATM redundancy, and its individual prose sentences do not exceed the default threshold after explicit sentence-boundary handling. A native ICU segment containing several lowercase sentence starts was correctly split before word counting; no style hint is expected merely because the paragraph is long.

## Problems demonstrated

| Priority | Observation                                                         | Evidence / implication                                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Supported families require excessively specific surrounding phrases | `We discussed about the problem.` is caught, but `We discussed about the problem during the meeting.` is missed. The preposition template requires punctuation/end immediately after its allowed noun phrase.                                                                                                                                                                             |
| High     | Common possessive and degree errors fall outside tiny tables        | Neither `The company changed it's policy, but its unclear whether ...` nor `The new version is more faster than the previous one` is caught. The existing positive fixtures use narrower noun/frame choices.                                                                                                                                                                              |
| High     | Metalinguistic quoted examples are not consistently protected       | `somebody writes "the the application crashed"` gets a deletion: the new repetition guard recognizes `write`, not `writes`. Five typo-whitelist findings also alter the explicitly named misspelling examples. This conflicts with preserving quoted evidence, even though the supplied expected-fix list asks to correct those spellings. Test these words separately as ordinary prose. |
| Medium   | Repetition omits `to to` entirely                                   | `We need to to restart it.` returns no finding. `to` is absent from the explicit allowlist. This is a coverage gap, independent of quotation handling.                                                                                                                                                                                                                                    |
| Medium   | Document context suppresses an otherwise supported ordinal          | Full text misses `21th`; its isolated sentence catches `21th` → `21st`. Earlier quotes plus more than 4,000 characters without a blank paragraph separator trigger the existing conservative quote-lookback cutoff. `3st` is outside the existing ordinal matcher (`nd`/`th` only).                                                                                                       |
| Medium   | Formatting coverage is uneven in a list                             | The unit sentence reports only `10kg` → `10 kg` (nonbreaking space), leaving `25km`, `100ms`, `5GB` and `20%CPU`. These are existing measurement-prefix/parser limits, not successes of the new grammar rules.                                                                                                                                                                            |
| Medium   | Some local repairs are only partial                                 | `It also dont` gets `don't`, leaving incorrect agreement. A finding is not equivalent to fully correcting a sentence.                                                                                                                                                                                                                                                                     |

## Missed scope

The corpus contains substantial unsupported grammar: ordinary noun-subject agreement (`The feature look`, `everyone have`), coordinated subjects, extended existential frames (`there is still ... problems`), time-span prepositions (`since two years`), missing articles, irregular tense/conditional sequences, indirect questions, broad verb-complement selection and pronoun case. These require explicit new evidence or broader audited frames; they cannot honestly be counted as covered because a similarly named rule exists.

Also missed are plausible local candidates such as `responsible of`, `interested on checking`, `more simpler`, `a information`, `feedbacks`, `informations`, `three advices`, `equipments`, `datas`, `criterias`, and affect/effect or weather/whether confusions. Dictionary spelling might detect some misspellings, but it was not run here and must not be credited with unmeasured results.

## Improvements, in order

1. Fix the demonstrated quoted-example guard inconsistency, with ordinary dialogue counterexamples. Keep the quoted-error paragraph as preservation data; make separate ordinary-prose spelling/repetition fixtures.
2. Extend existing preposition, possessive, degree and agreement frames to accept audited common modifiers/continuations. Add minimal pairs for each extension; do not remove completion guards wholesale.
3. Add bounded `to to` coverage and test genuine infinitival/quotation contexts. Keep it individual-only.
4. Improve quote-state handling for long texts so balanced earlier quotations do not silence distant ordinal findings. Preserve the deliberate `16rd`/`42RD` and quoted-ordinal exclusions.
5. Evaluate measurement lists and the real dictionary-spelling stage separately, then measure combined Review coverage. The native-only typo count is not a spelling-service result.
6. Build issue-level expected annotations (range, family, accepted alternatives, intentional preservation), and report missed supported cases separately from unsupported families. Do not lock current misses into tests that expect silence or use whole-document string equality.

The reference is not a perfect gold standard: changing quoted misspellings changes the example's meaning; `themself/myself`-style emphatic uses, collective agreement, double negation in dialect, article choices and optional commas need context. Expanding “0.75 sec” is style, not a numerical conversion or universal grammar requirement. No defensible overall recall percentage can be computed from the loosely phrased expectation table without annotation.

The initial evaluation added reproducible data and a runner only. The follow-up implementation and its remaining limits are described above.
