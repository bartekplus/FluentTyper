# Native Review roadmap progress

Source: `/Users/bartosztomczyk/Downloads/Documents/FluentTyper_Native_Review_Roadmap_and_Prompts.md` (2026-09-29).
Base: `d0d0996f`. Branch: `codex/native-review-roadmap`.

Execute sequentially: 1, 2, 3, 4, 8, 5, 6, 7, 9–20. Native TypeScript, individual suggestions, existing editor transactions. No push, PR or merge authorized.

| #   | Feature                        | Status                                                   |
| --- | ------------------------------ | -------------------------------------------------------- |
| 1   | Repeated words                 | Implemented; Chrome verified; Firefox launch blocked     |
| 2   | Auxiliary base verbs           | Implemented; Chrome verified; Firefox launch blocked     |
| 3   | Contextual word confusions     | Implemented; Chrome verified; Firefox launch blocked     |
| 4   | Agreement extensions           | Implemented; Chrome verified; Firefox launch blocked     |
| 5   | Contractions and possessives   | Implemented; Chrome verified; Firefox launch blocked     |
| 6   | Fixed prepositions             | Implemented; Chrome verified; Firefox launch blocked     |
| 7   | Verb complements               | Implemented; Chrome verified; Firefox launch blocked     |
| 8   | Independent Review controls    | Implemented; Chrome verified; Firefox launch blocked     |
| 9   | Participles                    | Implemented; Chrome verified; Firefox permission blocked |
| 10  | Demonstratives and noun number | Implemented; Chrome verified; Firefox permission blocked |
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

## #3 contextual word confusions

Four native Review-only identities: `englishThenThan`, `englishYourYouAre`, `englishTheirThereTheyAre`, `englishToToo`. Native pattern evidence requires a complete comparison argument, a bounded future clause, a complete possessive object phrase, or an intensifier construction. Original your-welcome and their-is rules retain sole ownership. All new findings are individual-only. Six contextual explanations are translated into all nine UI languages.

Focused corpus: **153 pass**: 48 authored repairs (12 per subfamily), 100 preservation cases (24/26/26/24), plus five pipeline, isolation, source-boundary, overlap and chunk-ownership checks. Self-review added four failing possessive-gerund regressions; requiring a clause opening fixed them without changing the acceptance examples. Broader sentence shapes remain documented exclusions.

- `bun run check`: passed.
- Full unit suite on the final source: **3,628 pass, 0 fail**.
- Chrome full browser suite: **92 pass, 10 skip, 0 fail**, including all four required #3 repairs, individual-only availability, and native undo. Focused final-source rerun after the mixed-case guard: **1 pass, 0 fail**, covering all six #1–#3 native edit/undo fixtures.
- Production Chrome and Firefox builds: passed.
- Coverage mapping: passed, 189 behaviors.
- Firefox runtime remains unverified due to the launch blocker documented under #1.
- Logs: `/tmp/ft-native-confusions-{focused,red,check,unit,full-chrome,browser,build-chrome,build-firefox,benchmark}.log`.

Authored-corpus result: 48/48 supported errors detected, 0/100 preservation cases flagged by their target subfamily, and no target-family finding after each intended repair. This does not measure open-ended linguistic accuracy. Unlisted predicates/nouns, clause-internal future phrases, unknown comparison arguments and other documented exclusions remain unsupported.

Local synthetic scan costs (Bun 1.4.2, only these four IDs enabled, 5 warmups, median of 21 full native scans; no AI/spelling/DOM):

| Characters | Clean (ms) | Dense errors (ms) | Dense findings |
| ---------- | ---------- | ----------------- | -------------- |
| 1,000      | 0.050      | 0.113             | 30             |
| 10,000     | 0.362      | 1.243             | 305            |
| 50,000     | 1.859      | 5.420             | 1,526          |

Error phrase: `This version is faster then the old version. They forgot there own password. Your going to like this. The box is to heavy to lift. `. Clean phrase replaces then/there/to with than/their/too and Your with You are. Repeat/truncate to size; scope covers all characters. These local fixture costs are not an isolated before/after performance result.

Production JS delta from #2's retained Chrome build (`production-chrome-full-39426-1790703299908`): content script **+7,123 bytes**, background **+1,396**, settings **+1,043**, popup **+1,043**. No dependency, permission or typing-rule addition.

## #4 agreement extensions

Extended the existing native pronoun detector under its existing ID; the six typing pairs and old per-instance bulk behavior are unchanged. Extra be/have/do forms require a clause-opening pronoun, optionally one listed adverb, and a following word. New findings change only the verb and carry the native individual-only block.

The separate `englishExistentialAgreement` ID uses an authored 14-pair noun-number table. Quantity and noun number must agree; only the verb changes. Coordinated, collective, invariant-number, unknown and contradictory noun phrases abstain, as do unsupported clause tails. Explanation translated into nine UI languages.

Focused corpus: **117 pass**, with 32 repairs (18 pronoun, 14 existential), 80 preservation cases, and five pipeline/typing/ownership/number/casing tests. A self-review regression caught mixed-case pronoun identifiers and was fixed. The have/do forms reuse #2's verb table; be forms remain explicit. Combined #2/#4 focused run: **194 pass**.

- `bun run check`: passed.
- Final-source full unit suite: **3,745 pass, 0 fail**. Final-source Chrome full browser suite: **92 pass, 10 skip, 0 fail**.
- All four required #4 acceptance repairs were added to the existing browser Apply/Undo fixture; all stay outside Fix all safe.
- Production Chrome and Firefox builds: passed.
- Coverage mapping: passed, 190 behaviors.
- Firefox browser validation remains unverified due to the launch blocker under #1.
- Logs: `/tmp/ft-native-agreement-{focused,red,check,unit,full-chrome,build-chrome,build-firefox,benchmark}.log`.

Authored corpus: all 32 supported errors detected; no findings from the target family in 80 preservation cases; no target-family findings after repair. This does not establish general agreement accuracy. Supported and excluded clause shapes are documented in `docs/review-mode.md`.

Local synthetic costs (Bun 1.4.2, both agreement IDs enabled, including the unchanged old pronoun detector; 5 warmups, median of 21 full native scans; no AI/spelling/DOM):

| Characters | Clean (ms) | Dense errors (ms) | Dense findings |
| ---------- | ---------- | ----------------- | -------------- |
| 1,000      | 0.184      | 0.303             | 45             |
| 10,000     | 1.437      | 2.175             | 445            |
| 50,000     | 6.947      | 10.285            | 2,223          |

Error phrase: `They has the files. We was ready. She have a keyboard. There is two errors in the report. `. Clean phrase: `They have the files. We were ready. She has a keyboard. There are two errors in the report. `. Repeat/truncate to size; scope covers all characters. These are local fixture costs, not isolated before/after performance claims.

Production JS delta against #3's retained final-source Chrome build (`production-chrome-full-40989-1790704043997`): content script **+4,295 bytes**, background **+656**, settings **+292**, popup **+292**. No dependency or permission addition, no change to typing behavior.

## #8 independent Review controls

Added validated native rule overrides to the existing repository, config broadcast, Review session and settings cards. Missing choices inherit explicit per-rule defaults; all current native checks retain their existing enabled default. Malformed known choices fail closed; unknown, spelling and AI identities cannot become native preferences. No migration from typing choices and no reviewed text stored.

Native cards offer **Disable this check in Review**; settings restore individual checks or declared defaults. Changes cancel scans and invalidate old Apply/Fix all results. Dictionary spelling remains available with every native check disabled, and the Review launcher stays available outside code mode. Existing Local AI controls, language/site policy, typing and autocomplete remain separate. New control labels and notices use all nine existing UI languages.

- Full unit suite: **3,756 pass, 0 fail**. Additional final card-action test: **18 pass, 0 fail** in `ReviewUiLocalAi.test.ts`, verifying no native disable action for spelling/AI and rejecting untrusted clicks.
- Chrome full browser suite: **93 pass, 10 skip, 0 fail**. The new test disables one check, reopens Review, restores it through options while Review is open, and verifies unchanged text and independent typing settings.
- Chrome options/runtime smoke suite: **26 pass, 0 fail**.
- Unit coverage includes absent/malformed/reset choices, concurrent card writes, persistence failure, multiple sessions during scans, stale batch/apply attempts and spelling with all native rules disabled.
- Self-review: existing browser selectors matched the first of two controls for the same rule. Added the control's setting identity and scoped typing test selectors; the full suite passed after repair.
- `bun run check`, coverage mapping (**191 behaviors**) and production Chrome/Firefox builds: passed.
- Firefox focused browser test still fails before extension startup: `Could not find profile folder`. No Firefox runtime claim.
- Logs: `/tmp/ft-native-controls-{focused,ui,check,unit,browser,full-chrome,smoke,firefox,build-chrome,build-firefox}.log`.

Production JS delta against #4's retained full-suite build (`production-chrome-full-41958-1790704599116`): content script **+6,713 bytes**, background **+5,307**, settings **+95,479**, popup **+4,864**. The settings page now includes the existing nine-language Review message catalog to name Review-only rules; no dependency or permission added. Measurements use the first #8 full-suite build; the later selector identity adds only a small DOM assignment.

Next after #8: #5 contextual contractions and bounded possessives, then #6 and #7. The overall roadmap and Firefox runtime gate remain incomplete.

## #5 contextual contractions and bounded possessives

Three independently configurable native Review-only identities: `englishItsContext`, `englishLetsContext`, `englishElsePossessive`. The new module reuses shared word-case handling; existing contraction normalization retains sole ownership of its words and its original behavior. Each finding changes one token and stays individual-only. Four specific explanations are translated into all nine UI languages.

Supported evidence consists of complete listed predicate/noun phrases: possessive its after selected transitive verbs or before a supported noun/predicate, it-is/it-has contractions at clause openings, twelve complete let-us suggestions, and seven indefinite-pronoun forms before else's plus a known noun phrase. Straight and curly input apostrophes work; inserted apostrophes follow existing straight-apostrophe normalization. Arbitrary owners, plural possessives, names, unknown phrases and technical/multiline evidence abstain. Exact bounded coverage and exclusions are in `docs/review-mode.md`.

Focused corpus: **126 pass**, including 36 authored repairs (12 per identity), 86 distinct preservation cases and four pipeline tests. All supported errors detected, no target-family findings on the negative corpus, and no recorrection after repair. These authored results are not a general English accuracy estimate. Self-review found capitalized Elses could be a name; the new detector now preserves it. Nested normal quotations were added and checked separately from metalinguistic quoted evidence.

- `bun run check`: passed.
- Full unit suite: **3,883 pass, 0 fail**.
- Chrome full browser suite: **93 pass, 10 skip, 0 fail**, including all four required #5 examples through individual Apply and native undo, with Fix all unavailable.
- Production Chrome and Firefox builds: passed. Coverage mapping: **192 behaviors**.
- Firefox runtime remains unverified due to the previously reproduced launch blocker; browser tests were not rerun for this detector-only checkpoint.
- Logs: `/tmp/ft-native-possessives-{focused,red,check,unit,full-chrome,build-chrome,build-firefox,benchmark}.log`.

Synthetic scan costs (Bun 1.4.2, only these three IDs enabled, 5 warmups then median of 21 full native scans; no AI/spelling/DOM):

| Characters | Clean (ms) | Dense errors (ms) | Dense findings |
| ---------- | ---------- | ----------------- | -------------- |
| 1,000      | 0.056      | 0.149             | 40             |
| 10,000     | 0.308      | 1.033             | 412            |
| 50,000     | 1.639      | 9.650             | 2,061          |

Error phrase: `The router lost it's connection. Its ready to use. Lets try again. This is someone elses folder. `. Clean phrase applies all four intended repairs. Repeat/truncate to size with whole-text scope. These fixture costs are not an isolated before/after performance claim.

Production JS delta against #8's final full-suite build (`production-chrome-full-43744-1790705611229`): content script **+7,050 bytes**, background **+1,215**, settings **+4,052**, popup **+1,106**. Candidate: `production-chrome-full-44849-1790706188375`. No new dependencies, permissions or typing behavior.

Next: #6 fixed prepositions. Six of twenty features implemented; full roadmap completion still requires the remaining features and Firefox runtime validation.

## #6 fixed preposition constructions

One independently configurable Review-only identity, `englishFixedPrepositions`, with three native phrase templates and separate explanations. It removes only `of`/`about` and their following horizontal separator, or replaces only `on` with `in`. Complete complements are mandatory: listed noun phrases after despite, listed ordinary topics after audited discuss inflections, and listed activities/topics after pronoun + be + interested. Existing protections, immutable ranges, per-chunk ownership, context dependencies and individual-only policy are retained. Four catalog/explanation messages are translated into all nine UI languages.

Focused corpus: **111 pass**: 36 authored repairs (12 per construction), 73 distinct preservation cases, and two pipeline checks. Every supported error is repaired; none of the preservation cases produces this rule, and corrected phrases produce no repeat finding. Coverage includes approximate quantities (`about five issues`), embedded questions, temporal/location attachments, incomplete complements, noun uses, quoted evidence, technical tokens, Unicode and protected/partial scopes. Tests exercise every possible chunk split in a mixed two-finding fixture. Authored cases do not establish open-ended English accuracy.

- `bun run check`: passed.
- Full unit suite: **3,994 pass, 0 fail**.
- Chrome full browser suite: **93 pass, 10 skip, 0 fail**, including all three required #6 repairs through individual Apply/native undo and no Fix all promotion.
- Production Chrome and Firefox builds: passed. Coverage mapping: **193 behaviors**.
- Firefox runtime remains unverified due to the launch blocker recorded under #1; not rerun for this detector-only checkpoint.
- Logs: `/tmp/ft-native-prepositions-{focused,check,unit,full-chrome,build-chrome,build-firefox,benchmark}.log`.

Synthetic scan costs (Bun 1.4.2, only this ID enabled; 5 warmups then median of 21 full native scans, no AI/spelling/DOM):

| Characters | Clean (ms) | Dense errors (ms) | Dense findings |
| ---------- | ---------- | ----------------- | -------------- |
| 1,000      | 0.048      | 0.127             | 29             |
| 10,000     | 0.288      | 0.828             | 297            |
| 50,000     | 1.457      | 6.214             | 1,485          |

Error phrase: `Despite of the delay, we finished. We discussed about the release. I am interested on learning Rust. `. Clean phrase applies all three intended repairs. Repeat/truncate to size, whole-text scope. These local fixture costs are not an isolated before/after performance result.

Production JS delta against #5's retained full-suite build (`production-chrome-full-44849-1790706188375`): content script **+5,042 bytes**, background **+1,495**, settings **+2,997**, popup **+389**. Candidate: `production-chrome-full-45650-1790706527758`. No dependencies, permissions, typing changes or generalized rule interpreter added.

Next: #7 verb complements. Seven of twenty features implemented; full completion remains pending the rest of the roadmap and Firefox runtime validation.

## #7 verb complement constructions

A separate Review-only `englishVerbComplements` identity recognizes complete pronoun-led need/want/plan frames and look-forward-to frames. It inserts only `to` using the existing one-grapheme anchor, or selects an explicitly stored gerund for the affected verb. Fourteen audited verb/argument pairs; gerund spellings live in the existing shared verb-form helper without changing #2's auxiliary forms. Negation and contracted do-not forms are retained. Three messages are translated into all nine UI languages.

Focused grammar corpus: **108 pass**: 30 repairs (including six negated/contracted constructions), 75 preservation cases, and three offset/morphology/pipeline checks. All authored errors detected, no findings on the preservation corpus, no recorrection after repair. Subjectless headings/fragments, incomplete and unknown complements, noun readings, need-not and optional/forbidden-to constructions abstain. These authored results do not establish general English coverage.

Application coverage verifies a recheck after insertion, updated offsets, and refusal of the old diagnostic ID. The real browser fixture inserts `to` into `<b>f</b><i>ix</i>`, verifies `<b>to f</b><i>ix</i>`, and restores the exact original markup with native undo. The three required acceptance examples also run through the common individual Apply/Undo fixture. No adapter bypass or Fix all promotion.

- Combined grammar/session focused suite: **150 pass, 0 fail**.
- Final-source full unit suite: **4,103 pass, 0 fail**. Final-source Chrome full browser suite: **94 pass, 10 skip, 0 fail**.
- `bun run check`, production Chrome and Firefox builds: passed. Coverage mapping: **194 behaviors**.
- Firefox runtime remains unverified due to the previously reproduced launch blocker; not rerun for this checkpoint.
- Logs: `/tmp/ft-native-complements-{focused,check,unit,full-chrome,build-chrome,build-firefox,benchmark,benchmark-before}.log`.

Synthetic scan costs (Bun 1.4.2, this ID only, 5 warmups then median of 21 full native scans; no AI/spelling/DOM):

| Characters | Clean (ms) | Dense errors (ms) | Dense findings |
| ---------- | ---------- | ----------------- | -------------- |
| 1,000      | 0.050      | 0.154             | 39             |
| 10,000     | 0.326      | 1.131             | 389            |
| 50,000     | 1.705      | 8.286             | 1,948          |

Error phrase: `We need fix this bug. They plan deploy tomorrow. I look forward to meet you. `. Clean phrase applies all three intended repairs. Repeat/truncate with whole-text scope. An initial scan per lexical verb cost 10.140/33.849 ms at 50,000 characters clean/error. Two frame scans with bounded argument validation lowered that to 1.705/8.286 ms, with unchanged counts and the focused corpus passing. These sequential local fixture measurements are not a controlled production speedup claim.

Production JS delta against #6's retained build (`production-chrome-full-45650-1790706527758`): content script **+4,649 bytes**, background **+507**, settings **+2,412**, popup **+379**. Candidate: `production-chrome-full-47095-1790707038158`. No dependencies, permissions or typing behavior added.

Next: #9 perfect-tense participles; #8 controls are already implemented. Overall completion remains pending all remaining features and Firefox runtime validation.

## Firefox launch diagnosis (2026-09-29)

The profile-folder error is now attributed to macOS 27 application-data protection, not FluentTyper or an absent temporary directory. Current host: macOS 27.0; cached Firefox 156.0.1. Bun and Node launches both fail with fresh profiles. A direct Python subprocess also fails with either `-profile` or `--profile` under `/private/tmp`. The new profile directories exist, and Puppeteer writes `user.js` before launch.

Opening only the Firefox application-data directory (`~/Library/Application Support/Firefox`) with `os.open(..., O_RDONLY | O_DIRECTORY)` fails with **PermissionError 1, Operation not permitted**; no directory contents were read. This matches [Mozilla bug 2060476](https://bugzilla.mozilla.org/show_bug.cgi?id=2060476) and its documented Files & Folders permission requirement. Asked the user to enable Firefox access for Codex under System Settings → Privacy & Security → Files & Folders. No OS permission, personal profile, app installation or security setting was changed. Firefox runtime remains pending this user action. Logs: `/tmp/ft-firefox-launch-debug.log`, `/tmp/ft-firefox-node-probe.log`; temporary probe source is `.tmp/firefox-profile-probe.mjs` (untracked/ignored).

## #9 perfect-tense participles

A separate Review-only `englishPerfectParticiples` identity reuses the original irregular verb-form table. Thirteen complete verb/argument frames establish auxiliary-have context; only the affected past-form token changes. Past forms that are already participles are preserved. At most two listed adverbs, including negation, and unambiguous have contractions are supported; ambiguous has/is and had/would contractions abstain. Incorrect have/has agreement is left to #4, then the participle is reconsidered after that repair. One explanation translated into all nine UI languages.

Focused corpus: **83 pass**: 20 repairs, 60 preservation cases and three pipeline/ownership tests. No supported misses or target-family findings on the preservation corpus; corrected text produces no repeat finding. Noun/causative uses, shared forms, unknown morphology, regional alternatives, protected evidence, dictionary, scope and every chunk split in a Unicode/quoted mixed fixture are covered. These are authored cases, not general linguistic accuracy claims.

- Full unit suite: **4,186 pass, 0 fail**.
- Chrome full browser rerun: **94 pass, 10 skip, 0 fail**. Focused individual Apply/Undo fixture passed all 23 examples, including the three #9 requirements.
- The first full/focused browser runs exposed a real test-helper defect: an 85px finding inside a 40px scrolling list was clicked at its center, under the footer. A geometry/hit-test probe confirmed the footer received that point. The shared click helper now intersects clipping ancestors/viewport and verifies the hit target before a real click; no production UI or editor behavior was changed.
- `bun run check`, Chrome/Firefox production builds: passed. Coverage mapping: **195 behaviors**.
- Firefox runtime remains blocked on the macOS permission described above.
- Logs: `/tmp/ft-native-participles-{focused,check,unit,browser,full-chrome,click-probe,build-chrome,build-firefox,benchmark}.log`.

Synthetic scan costs (Bun 1.4.2, this ID only, 5 warmups then median of 21 full native scans; no AI/spelling/DOM):

| Characters | Clean (ms) | Dense errors (ms) | Dense findings |
| ---------- | ---------- | ----------------- | -------------- |
| 1,000      | 0.073      | 0.166             | 34             |
| 10,000     | 0.418      | 1.458             | 344            |
| 50,000     | 2.258      | 7.794             | 1,724          |

Error phrase: `I have went through the report. She has wrote the summary. We had took the wrong turn. `. Clean phrase applies all three intended repairs. Repeat/truncate to size, whole-text scope. These local fixture costs are not an isolated before/after performance claim.

Production JS delta against #7's retained build (`production-chrome-full-47095-1790707038158`): content script **+3,334 bytes**, background **+694**, settings **+1,407**, popup **+385**. Candidate: `production-chrome-full-48207-1790707458323`; subsequent changes only repair the browser test helper. No dependency, permission or typing behavior added.

Next: #10 demonstratives and noun number. Overall completion remains pending the remaining features and Firefox runtime validation.

## #10 demonstratives and noun-number constructions

The Review-only `englishNounNumber` identity reuses the shared noun-pair map, adding device/devices and exposing explicit singular/plural forms. Fifteen known pairs; no suffix-based number inference. Complete one-of-the clauses preserve the outer singular subject/verb while pluralizing the set noun. Explicit ungrouped counts preserve their number and repair only the noun. Demonstrative clauses use are/were versus is/was as evidence; failed/arrived/returned leave quantity ambiguous, so the existing choice-card UI offers plural-noun and singular-demonstrative repairs with no preselection. Four localized explanations cover all nine UI languages. All new findings remain individual-only.

Focused #10 corpus: **126 pass**: 36 single-repair examples, four ambiguous two-choice examples, 83 preservation cases and three pipeline tests. Combined with the existing #4 corpus: **243 pass**. Authored cases produce the expected repair(s), no target-family findings on preservation cases and no recorrection. These results do not establish general English accuracy. Noun modifiers, invariant/plural-looking nouns, data/news/series, ordinal tokens, model labels, units, measurements, grouped counts, Unicode, protected evidence and all chunk splits are covered. A chained test proves quantity repair occurs before the independent existential-agreement repair.

Self-review caught a grouped-number boundary error: the suffix `001` of `1,001` could have been interpreted as singular. Grouped numeric tokens with comma, ordinary space, NBSP or narrow NBSP now abstain. Final tests exercise the actual new guard. A prior concurrently started unit run loaded the earlier detector before those three additional fixtures; final-source rerun is the authoritative result below.

- Final-source full unit suite: **4,312 pass, 0 fail**. Final-source Chrome full browser suite: **95 pass, 10 skip, 0 fail**.
- First Chrome run: **95 pass, 10 skip, 0 fail**, including all three required #10 repairs and both ambiguous quantity choices through native Apply/recheck/undo. Final-source rerun covers the added grouped-number guards.
- `bun run check`: passed. Coverage mapping: **196 behaviors**.
- Production Chrome/Firefox builds: passed. Firefox runtime is still pending the previously requested macOS permission.
- Logs: `/tmp/ft-native-number-{focused,check,unit-final,full-chrome-final,build-chrome,build-firefox,benchmark}.log`.

Synthetic scan costs (Bun 1.4.2, this ID only, 5 warmups then median of 21 full native scans; no AI/spelling/DOM):

| Characters | Clean (ms) | Dense errors (ms) | Dense findings |
| ---------- | ---------- | ----------------- | -------------- |
| 1,000      | 0.098      | 0.146             | 35             |
| 10,000     | 0.696      | 1.045             | 357            |
| 50,000     | 3.793      | 7.417             | 1,785          |

Error phrase: `One of the device failed. We found two error in the report. Those file are missing. `. Clean phrase applies the three intended repairs. Repeat/truncate with whole-text scope. These local fixture costs are not an isolated before/after performance claim.

Production JS delta against #9's retained build (`production-chrome-full-48207-1790707458323`): content script **+5,860 bytes**, background **+1,142**, settings **+3,360**, popup **+378**. Candidate: `production-chrome-full-54178-1790708264999`. No dependency, permission or typing behavior added.

Next: #11 compounds. Full completion still requires the remaining ten features and Firefox runtime validation.
