# Native Review roadmap progress

Source: `/Users/bartosztomczyk/Downloads/Documents/FluentTyper_Native_Review_Roadmap_and_Prompts.md` (2026-09-29).
Base: `d0d0996f`. Branch: `codex/native-review-roadmap`.

Execute sequentially: 1, 2, 3, 4, 8, 5, 6, 7, 9–20. Native TypeScript, individual suggestions, existing editor transactions. No push, PR or merge authorized.

| #   | Feature                        | Status                                                   |
| --- | ------------------------------ | -------------------------------------------------------- |
| 1   | Repeated words                 | Implemented; Chrome verified; Firefox launch blocked     |
| 2   | Auxiliary base verbs           | Implemented; Chrome verified; Firefox launch blocked     |
| 3   | Contextual word confusions     | Pending                                                  |
| 4   | Agreement extensions           | Pending                                                  |
| 5   | Contractions and possessives   | Pending                                                  |
| 6   | Fixed prepositions             | Pending                                                  |
| 7   | Verb complements               | Pending                                                  |
| 8   | Independent Review controls    | Pending; follows #4                                      |
| 9   | Participles                    | Pending                                                  |
| 10  | Demonstratives and noun number | Pending                                                  |
| 11  | Compounds                      | Pending                                                  |
| 12  | Countability                   | Pending                                                  |
| 13  | Comparatives                   | Pending                                                  |
| 14  | Fixed phrases                  | Pending                                                  |
| 15  | Session ignore-all             | Pending                                                  |
| 16  | Punctuation warnings           | Pending                                                  |
| 17  | Brand/acronym casing           | Pending                                                  |
| 18  | Preferred terminology          | Pending                                                  |
| 19  | Incremental rechecks           | Pending; profile first, retain simple path if no benefit |
| 20  | Optional style hints           | Pending; default off                                     |

## Validation

- Catalog capability committed separately as `655a37f0`; full check and 35 focused tests passed.
- #1: 58 focused tests passed (17 repair cases, 37 distinct preservation cases, run/chunk/scope/dictionary/language/typing isolation checks).
- #1: Chrome production browser test passed: individual deletion and native undo; Fix all stays disabled.
- Full unit run initially found two typing-settings count assertions; updated to count only typing rules. Rerun: **3,398 pass, 0 fail**.
- `bun run check`: passed (lint, formatting, typecheck).
- `bun run test:e2e`: Chrome **26 pass, 0 fail**.
- `bun run test:e2e:full`: Chrome **92 pass, 10 skip, 0 fail**.
- `bun run check:e2e:coverage`: passed, 187 mapped behaviors.
- Production Chrome and Firefox builds: passed.
- Firefox full browser suite: **not validated**. Browser launch fails before extension tests with `Could not find profile folder`. Reproduced with default and `/tmp` temporary directories, explicit system Firefox executable, and explicit fresh profile. No test-runner workaround committed.
- Logs: `/tmp/ft-native-{check,unit,smoke,full-chrome,full-firefox,full-firefox-retry,build-chrome,build-firefox}.log`.
- Full release validation remains incomplete until Firefox can launch.

## #1 scope and exclusions

14 function words; horizontal separators only, at most 8 characters. No newline joining. One repair per repeated run. Directly named quoted examples are skipped; ordinary quoted prose is checked. No new dependencies, typing autocorrection, permissions or bulk promotions. Localized explanation in all nine UI languages. Existing editor transaction path reused.

The corpus is authored, not an accuracy benchmark. Distant metalinguistic context and unlisted words remain outside the supported scope.

## #2 auxiliary forms

24 authored common verbs with lemma/third/past/participle and independent-base ambiguity flags. Bounded pronoun-led clauses and inverted questions; 1–8 horizontal separators; at most two intervening adverbs. No suffix inference or automatic editing. Noun readings after lexical do, independent base homographs, unknown forms and subordinate noun clauses abstain. Nine-language explanation and native individual-only catalog metadata.

Focused corpus: **77 passing tests**: 20 repairs plus 53 valid/ambiguous counterexamples and four pipeline/lookup/ownership/typing tests.

- `bun run check`: passed.
- `bun run test`: **3,475 pass, 0 fail**.
- `bun run test:e2e:full`: Chrome **92 pass, 10 skip, 0 fail**. Extended the existing individual-edit browser fixture to exercise both repetition and auxiliaries. Focused rerun: **1 pass, 0 fail**, checking both individual edits and native undo. An initial fixture expected visible-space markers for unchanged separators; corrected that expectation to the existing UI rendering after inspecting the actual panel.
- Production Chrome build (full-suite build) and Firefox build: passed.
- `bun run check:e2e:coverage`: passed, 188 behaviors.
- Firefox runtime remains blocked by the launch failure recorded under #1; a build is not a browser validation.
- Logs: `/tmp/ft-native-aux-{check,unit,full-chrome,browser,firefox-build,benchmark}.log`.

Measured on Bun 1.4.2 locally, new detector only, 5 warmups then median of 21 complete native scans, synthetic repeated phrases:

| Characters | Clean scan (ms) | Dense-error scan (ms) | Dense findings |
| ---------- | --------------- | --------------------- | -------------- |
| 1,000      | 0.069           | 0.209                 | 48             |
| 10,000     | 0.466           | 1.274                 | 476            |
| 50,000     | 2.404           | 6.346                 | 2,381          |

Clean phrase: `Did she read the document? We did cut the cable. `; error phrase: `Did she went home? He can works remotely. `. Repeat and truncate to size. Snapshot scope covers all characters; only `englishAuxiliaryBaseVerb` enabled. No AI/spelling or DOM cost included. A million alternating known/unknown table lookups took 35.11 ms (500,000 hits). These are local synthetic costs, not an isolated performance comparison or an accuracy claim.

Production JS byte delta against #1's saved Chrome full-suite build: content script **+3,589**, background **+1,760**, settings **+276**, popup **+276**. No dependencies added. Existing `.tmp/e2e-builds/production-chrome-full-38473-1790702874427` is the baseline and `production-chrome-full-39426-1790703299908` the candidate.
