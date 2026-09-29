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
| 11  | Compounds                      | Implemented; Chrome verified; Firefox permission blocked |
| 12  | Countability                   | Implemented; Chrome verified; Firefox permission blocked |
| 13  | Comparatives                   | Implemented; Chrome verified; Firefox permission blocked |
| 14  | Fixed phrases                  | Implemented; Chrome verified; Firefox permission blocked |
| 15  | Session ignore-all             | Implemented; Chrome verified; Firefox permission blocked |
| 16  | Punctuation warnings           | Implemented; Chrome verified; Firefox permission blocked |
| 17  | Brand/acronym casing           | Implemented; Chrome verified; Firefox permission blocked |
| 18  | Preferred terminology          | Implemented; Chrome verified; Firefox permission blocked |
| 19  | Incremental rechecks           | Implemented; Chrome verified; Firefox permission blocked |
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

## #11 contextual compounds

The Review-only `englishContextualCompounds` identity recognizes bounded grammatical slots for everyday → every day, login → log in, and setup → set up. Twelve explicit daily-action frames and complete verb/complement frames supply the evidence. Only the affected lowercase token changes. Capitalized product candidates, mixed-case identifiers, noun/adjective readings, house-style noun spellings, incomplete contexts and unfamiliar complements abstain. Four explanations are translated into all nine UI languages. Findings remain individual-only and use existing spelling-overlap suppression.

Focused corpus: **116 pass**: 36 repairs (12 per subfamily), 77 preservation cases and three pipeline tests. Expected repairs, no target-family findings on preservation cases, and no recorrection. Tests cover exact Unicode offsets, tabs/NBSP, dictionary, protected evidence, scope, every chunk split and native-over-spelling ownership. These authored results do not establish general linguistic accuracy.

The three required examples pass individual Apply/recheck/native undo in Chrome. A separate browser case inserts the compound space across `<b>set</b><i>up</i>`, preserves formatting and restores exact original markup with native undo. New browser cases run independently rather than extending the existing long shared fixture.

- Full unit suite: **4,428 pass, 0 fail**. Chrome full browser suite: **99 pass, 10 skip, 0 fail**.
- `bun run check`, production Chrome/Firefox builds: passed. Coverage mapping: **197 behaviors**.
- Firefox runtime remains pending the previously requested macOS permission.
- Logs: `/tmp/ft-native-compounds-{focused,check,unit,full-chrome,build-chrome,build-firefox,benchmark}.log`.

Synthetic scan costs (Bun 1.4.2, this ID only, 5 warmups then median of 21 full native scans; no AI/spelling/DOM):

| Characters | Clean (ms) | Dense errors (ms) | Dense findings |
| ---------- | ---------- | ----------------- | -------------- |
| 1,000      | 0.070      | 0.150             | 35             |
| 10,000     | 0.379      | 0.977             | 349            |
| 50,000     | 2.344      | 6.489             | 1,744          |

Error phrase: `I use this tool everyday. Please login to continue. We need to setup the environment. `. Clean phrase applies the three intended repairs. Repeat/truncate with whole-text scope. These local fixture costs are not an isolated before/after performance claim.

Production JS delta against #10's retained build (`production-chrome-full-54178-1790708264999`): content script **+5,487 bytes**, background **+1,721**, settings **+3,177**, popup **+369**. Candidate: `production-chrome-full-59985-1790708754356`. No dependency, permission or typing behavior added.

Next: #12 countability. Eleven of twenty features implemented; full completion requires the remaining nine features and Firefox runtime validation.

## #12 conservative countability

The Review-only `englishCountability` identity covers informations, advices and equipments in documented ordinary-prose frames. It also selects criterion/criteria or phenomenon/phenomena from explicit one–ten or single-digit counts, without changing quantities. The existing zero–ten count-word list now lives in the shared noun helper and is reused by #10 and #12. The two special noun pairs remain confined to the countability detector so disabling that family does not leave equivalent findings enabled under general noun number. Three explanations are translated into all nine UI languages.

Quantified mass nouns and a/an constructions abstain instead of inventing an amount or unit; no incomplete determiner repair is offered. Legal, banking, commercial, regional and archaic vocabulary in the bounded 128-character context causes abstention. Unknown syntax, quoted examples, product-name casing, grouped counts, technical tokens, user-dictionary words and protected evidence are preserved. Data agreement and fewer/less style are unchanged; experience/work/paper/coffee are excluded.

Focused corpus: **149 pass**: 48 authored repairs, 99 preservation cases and two pipeline tests. Expected repairs, no target-family findings on preservation cases, no recorrection. Combined countability/noun-number suite: **275 pass**. Self-review added three quoted-term/heading/label cases that failed before the quotation guard was extended; ordinary quoted prose still produces findings. These authored results do not establish general linguistic accuracy. Context covers every specialist or quoted-evidence character read, including following qualifiers, and every chunk split in the Unicode/CRLF fixture yields the same findings.

The existing parameterized individual Apply/recheck/native-undo browser fixture now includes the three required examples and equipment. Every case verifies unchanged source before Apply, one native card, no duplicate spelling card, and no Fix all eligibility.

- Full unit and Chrome suites after the quotation fix: **4,577 unit pass**; **103 Chrome pass, 10 skip, 0 fail**.
- Final-source suites after extracting the shared count list: **4,577 unit pass, 0 fail**; **103 Chrome pass, 10 skip, 0 fail**.
- Final-source `bun run check`, production Chrome/Firefox builds: passed. Coverage mapping: **198 behaviors**.
- Firefox runtime remains pending the previously requested macOS permission.
- Logs: `/tmp/ft-native-countability-{focused,quote-regression-before,shared,check-shared,unit-shared,full-chrome-shared,build-chrome-shared,build-firefox-shared,benchmark-shared}.log`.

Synthetic scan costs (Bun 1.4.2, this ID only, 5 warmups then median of 21 full native scans; no AI/spelling/DOM):

| Characters | Clean (ms) | Dense errors (ms) | Dense findings |
| ---------- | ---------- | ----------------- | -------------- |
| 1,000      | 0.068      | 0.128             | 29             |
| 10,000     | 0.466      | 1.014             | 291            |
| 50,000     | 2.340      | 6.454             | 1,456          |

Error phrase: `The page contains useful informations. Thanks for the helpful advices. This is one important criteria. `. Clean phrase applies the three intended repairs. Repeat/truncate with whole-text scope. These local fixture costs are not an isolated before/after performance claim.

Production JS delta against #11's retained build (`production-chrome-full-59985-1790708754356`): content script **+5,077 bytes**, background **+660**, settings **+2,431**, popup **+366**. Candidate: `production-chrome-full-67248-1790709478615`. No dependency, permission or typing behavior added.

Next: #13 malformed comparatives/superlatives. Twelve of twenty features implemented; full completion requires the remaining eight features and Firefox runtime validation.

## #13 malformed comparatives and superlatives

The Review-only `englishDoubledDegree` identity removes redundant more/most in complete is/was clauses with known subjects and comparison tails. The ten original comparative words now live in `EnglishDegreeForms.ts` and are reused unchanged by then/than; the new detector additionally knows easier and eleven explicit superlatives. No suffix inference. Only the redundant marker and its following whitespace are deleted through existing minimal edits. Comparison targets, numbers and adjective spelling are preserved. The explanation is localized in all nine UI languages.

Focused degree corpus: **88 pass**: 24 authored repairs, 61 preservation cases and three pipeline tests. Combined with word-confusion and session tests: **284 pass**. No supported misses or target-family findings on preservation cases; intended repairs do not recur. These authored results do not establish general English accuracy. Known-noun syntax, quantity phrases, hyphenation, multiword adjectives, emphasis, named quoted examples, dictionary, scope, protected spans, mixed case, Unicode/CRLF and all chunk splits are covered. A grouped numeric target initially matched only its prefix; the regression now passes because commas and decimal continuations abstain. The final guard reads only bounded evidence inside the declared context.

The session test applies degree deletion first, discovers then/than on the new snapshot, rejects the old diagnostic ID and applies the new card with correct offsets. No Fix all promotion. Browser coverage includes all three required examples and deletion of bold more while retaining italic easier, with exact original markup restored by native undo.

- Final-source unit suite: **4,666 pass, 0 fail**. Final-source `bun run check`, Chrome/Firefox production builds: passed. Coverage mapping: **199 behaviors**.
- First Chrome run: **107 pass, 10 skip**, but the Local AI suite cleanup hook timed out at 5 seconds, so the command failed. The degree and formatting cases passed. No production or test timeout was changed.
- Final-source Chrome rerun: **107 pass, 10 skip, 0 fail**.
- Firefox runtime remains pending the previously requested macOS permission.
- Logs: `/tmp/ft-native-degree-{focused,check-final,unit-final,full-chrome,full-chrome-final,build-chrome-final,build-firefox-final,benchmark-final}.log`.

Synthetic scan costs after validation finished (Bun 1.4.2, this ID only, 5 warmups then median of 21 full native scans; no AI/spelling/DOM):

| Characters | Clean (ms) | Dense errors (ms) | Dense findings |
| ---------- | ---------- | ----------------- | -------------- |
| 1,000      | 0.052      | 0.118             | 28             |
| 10,000     | 0.303      | 0.940             | 283            |
| 50,000     | 1.631      | 6.519             | 1,415          |

Error phrase: `This approach is more easier to test. The revised result is more better. This is the most fastest option. `. Clean phrase applies the three intended repairs. Repeat/truncate with whole-text scope. These local fixture costs are not an isolated before/after performance claim. The earlier measurement overlapped broad validation and is retained separately in `benchmark.log`; the table uses `benchmark-final.log` after the jobs completed.

Production JS delta against #12's retained build (`production-chrome-full-67248-1790709478615`): content script **+2,999 bytes**, background **+1,249**, settings **+1,208**, popup **+379**. Candidate: `production-chrome-full-74398-1790709936446`. No dependency, permission or typing behavior added.

Next: #14 fixed-phrase mistakes. Thirteen of twenty features implemented; full completion requires the remaining seven features and Firefox runtime validation.

## #14 established usage phrases

The Review-only `englishUsagePhrases` identity implements the three requested constructions with explicit grammatical frames: for all intensive purposes before a known completion clause; plural identity clauses with one in the same; and peak/peaks/peaked/peaking a possessive determiner’s interest with known subjects and audited modal/progressive forms. Minimal changes preserve case, tense, possessives and whitespace. Four explanations are localized in all nine UI languages. Cards use the existing grammar category with usage explanations, remain individual-only and are independently configurable.

The matching loop from fixed prepositions is now a shared `phraseTemplates.ts` helper with two concrete callers. Preposition patterns and identity are unchanged; named quotation guards also recognize term, heading, title and label. No phrase DSL, external database or broad replacement engine. Literal uses, incomplete/unknown frames, technical tokens, dictionary words, quoted examples and recognized creative/dialect cues abstain.

Focused usage corpus: **110 pass**: 36 repairs, 72 preservation cases and two pipeline tests. Combined with existing preposition coverage: **221 pass**. No supported misses or usage-family findings on the preservation corpus, and no recorrection. Uppercase repairs, modal/progressive/past forms, all six possessive determiners, protected evidence, scope, Unicode/CRLF and every chunk split are covered. These authored cases do not establish general English accuracy.

Browser additions cover all three required examples with individual Apply/recheck/native undo, one native card and no duplicate spelling card. A rich-text fixture replaces intensive across bold/italic nodes while preserving formatting and restoring exact markup with native undo.

- Full unit suite: **4,776 pass, 0 fail**. Final Chrome rerun with the repaired test helper: **111 pass, 10 skip, 0 fail**. Final `bun run check` passed.
- Initial Chrome run: **110 pass, 10 skip, 2 fail** (dictionary-to-Fix-all timeout and teardown timeout). Focused reruns reproduced the first failure. A pointerdown probe captured the actual target as `BUTTON`, action `fix-all`, **disabled: true**, label `Fix all safe (0)` during a dictionary-triggered recheck. The shared browser click helper now waits for an enabled native/ARIA control before computing the existing clipped hit point. No production behavior or test timeout changed. The original failing card-flow test passes with the fix; temporary probes were removed. Evidence: `/tmp/ft-native-usage-card-event-probe.log`; verification: `card-fixed.log`.
- Initial typecheck found optional-context annotations at the usage filter. The helper always supplies context; explicit assertions fix the caller type. The rebuilt production Chrome JavaScript is **byte-identical in every JS file** to the browser suite’s build, so this type-only change does not invalidate that runtime validation.
- Chrome/Firefox production builds passed. Coverage mapping: **200 behaviors**. Firefox runtime remains pending the previously requested macOS permission.
- Logs: `/tmp/ft-native-usage-{focused,check-helper,unit,full-chrome,full-chrome-final,card-event-probe,card-fixed,build-chrome-final,build-firefox-final,benchmark}.log`.

Synthetic scan costs after broad validation finished (Bun 1.4.2, this ID only, 5 warmups then median of 21 full native scans; no AI/spelling/DOM):

| Characters | Clean (ms) | Dense errors (ms) | Dense findings |
| ---------- | ---------- | ----------------- | -------------- |
| 1,000      | 0.079      | 0.124             | 27             |
| 10,000     | 0.343      | 0.934             | 275            |
| 50,000     | 1.866      | 6.668             | 1,376          |

Error phrase: `For all intensive purposes, the test is complete. They are one in the same. That feature peaked my interest. `. Clean phrase applies all three intended repairs. Repeat/truncate with whole-text scope. These local fixture costs are not an isolated before/after performance claim.

Production JS delta against #13's retained build (`production-chrome-full-74398-1790709936446`): content script **+4,560 bytes**, background **+1,519**, settings **+3,046**, popup **+363**. Final candidate: `production-chrome-full-84329-1790710823561`; all runtime JS is byte-identical to the earlier `production-chrome-full-78768-1790710331475` and typecheck build `production-chrome-usage-typecheck`. No dependency, permission or typing behavior added.

Next: #15 context-aware ignore-all within a Review session. Fourteen of twenty features implemented; full completion requires the remaining six features and Firefox runtime validation.

## #15 context-aware matching ignores within a Review session

Native and dictionary cards now distinguish Ignore once, Ignore matching occurrences in this review, and the existing persistent Disable this check in Review. A visible localized explanation states the matching scope: current findings with the same rule, language, category, normalized evidence and alternative edits. It captures existing equivalent occurrences rather than learning a pattern for future text. AI findings retain Ignore once only. Restore ignored findings in the footer resets both session-ignore forms. Labels and explanations cover all nine UI languages.

The existing occurrence list now optionally retains matched evidence and relative protection identity. Both verified writes and external snapshot diffs use the existing native remappers through one shared session method. Edits outside unchanged evidence preserve suppression after shifting offsets; edits touching evidence, changed protection and deletion/reinsertion release the affected entry. Ambiguous duplicate insertion follows the native remapper’s conservative behavior and releases suppression rather than guessing identity. A regression fixture with a distinct ending verifies that unambiguous new occurrences remain visible while old entries stay ignored. Complete evidence equality is deliberately more specific than matching a word alone.

Reset and matching ignores invalidate the existing list/batch caches through their input identities, update counts/filters/navigation and preserve keyboard focus through the controller. Close explicitly clears exception entries, their lookup and the list cache. No persistence callback, dictionary learning, sentence hash, telemetry or new permission is involved. The real browser test verifies storage does not contain the reviewed fixture and that dictionary and rule preferences are unchanged.

- Session/AI/UI focused suite: **116 pass, 0 fail**. Includes remapping, evidence edits, deletion/reinsertion, protection changes, verified writes, new occurrences, ambiguous placement, filters/batches/reset, independent editors, closure, then/than context separation and AI exclusion.
- Full unit suite: **4,788 pass, 0 fail**. Full Chrome browser suite: **112 pass, 10 skip, 0 fail**.
- Browser workflow verifies three repeated-word findings, suppresses only two equivalent occurrences, inserts text before unchanged evidence, restores findings with reset, and closes/reopens with no retained ignores.
- `bun run check`, production Chrome/Firefox builds: passed. Coverage mapping: **201 behaviors**. Firefox runtime remains pending the previously requested macOS permission.
- Logs: `/tmp/ft-native-ignore-{session-ui-final,browser,check,unit,full-chrome,build-chrome,build-firefox,benchmark}.log`.

Session action costs after broad validation (Bun 1.4.2, 5 warmups then median of 21 ignore/reset cycles; existing native findings, no DOM/AI/spelling or scan timing):

| Matching findings | Characters | Ignore matching (ms) | Reset (ms) |
| ----------------- | ---------- | -------------------- | ---------- |
| 10                | 1,480      | 0.047                | 0.004      |
| 100               | 14,800     | 0.321                | 0.021      |
| 300               | 44,400     | 0.880                | 0.069      |

Each cycle asserts all expected findings are suppressed and then restored. The repeated paragraph has nine `Plain context. ` sentences before `the the cat. `, supplying identical bounded evidence. These local action costs are not a before/after production speedup claim.

Production JS delta against #14's retained build (`production-chrome-full-84329-1790710823561`): content script **+5,090 bytes**, settings **+2,550**; background and popup unchanged. Candidate: `production-chrome-full-92282-1790711677535`. No dependency, permission or typing behavior added.

Next: #16 punctuation warnings and explicit warning-only diagnostics. Fifteen of twenty features implemented; full completion requires the remaining five features and Firefox runtime validation.

## #16 punctuation warnings and explicit warning-only diagnostics

`unclosedQuotation` scans complete English fields once per prepared snapshot with a bounded quotation stack. Straight double, curly double/single and guillemet styles support different-style nesting and repeated paragraph openings. The diagnostic highlights the unmatched opening mark without proposing a closing position. Partial selections, unread windows, protected/technical text, over-limit fields, unsupported conventions and ambiguous nesting abstain. Straight single quotes remain outside the supported scope because apostrophes are ambiguous.

Warning-only findings explicitly contain no alternatives and cannot enter individual writes or batch plans. The shared deduplicator now retains distinct warnings instead of treating their empty edit lists as the same fix. AI alternatives cannot attach to a warning. Cards/list labels explain the warning, keep Ignore/Disable actions and focus the close control for keyboard access. All nine UI languages have labels and explanations; typing and existing four categories remain unchanged.

The authored detector corpus covers 12 warning examples and 32 preservation/ambiguity examples, plus complete-scope/protection, chunk ownership and forged-bulk guards. No supported misses or false positives in those fixtures; this does not establish general quotation accuracy. Session/UI/AI tests cover zero write calls, filters, ignore/reset, manual closing-mark recheck, unread adapter content and accessible labels. The browser workflow covers keyboard entry/Escape, filters and no Apply/Fix-all path. An existing test expecting only whitespace correction now also expects the deliberately added warning, while still excluding automatic punctuation insertion.

- Focused detector/session/UI suite: **123 pass**, with **44 AI session tests** separately passing.
- Full unit command passed: **4,839 main-suite tests plus 152 isolated tests**, **4,991 total**, zero failures. Earlier feature entries reported the main-suite count only.
- Final full Chrome suite: **113 pass, 10 existing skips, 0 fail**. `bun run check`, production Chrome/Firefox builds and coverage mapping (**202 behaviors**) passed.
- Firefox runtime remains blocked by the previously reported macOS Files & Folders permission; builds do not establish Firefox runtime correctness.
- Logs: `/tmp/ft-native-quotes-{focused,ai,check-final,unit-complete,full-chrome-final,build-chrome,build-firefox-final,benchmark}.log`.

Native scan costs (Bun 1.4.2, 5 warmups, median of 21 runs; only this rule, full native preparation/conversion):

| Characters | Balanced (ms) | Unclosed (ms) |
| ---------- | ------------- | ------------- |
| 1,000      | 0.097         | 0.105         |
| 10,000     | 0.594         | 0.587         |
| 50,000     | 2.704         | 2.774         |

The fixture is `He wrote, “` followed by repeated `The build is ready. `, ending with a closing mark or period. Every timed run asserts zero or one warning as appropriate. Costs are local fixture measurements, not a before/after production performance claim.

Production JS delta against #15 (`production-chrome-full-92282-1790711677535`): content script **+4,856 bytes**, settings **+2,487**, background/popup **+370 each**. Candidate: `production-chrome-full-99126-1790713624759`. No dependency, permission, persistence or typing behavior added.

Next: #17 canonical brand/acronym casing. Sixteen of twenty features implemented; remaining four features and Firefox runtime validation are still required.

## #17 canonical brand and acronym casing

The independently configurable, English Review-only `englishCanonicalCasing` check uses eight explicit canonical forms: GitHub, JavaScript, TypeScript, WebRTC, FluentTyper, iPhone, macOS and eBay. Lowercase and ordinary title-case inputs receive the exact form, never generic title casing. Deliberate uppercase, arbitrary mixed-case tokens, glued identifiers/possessives, links, file names, paths, handles, code, dictionary entries and named quoted spellings abstain. Isolated quoted names also abstain. Common words such as go/rust/may are not entries. The explanation is localized in all nine UI languages and the rule remains individual-only.

Shared deduplication yields sentence-start/line-start findings only when a canonical finding covers that start. Disabling the canonical rule retains the existing capitalization behavior. The existing internal-capital guard preserves corrected iPhone/macOS/eBay starts without a new typing exception.

A real browser test exposed formatting movement: replacing `javas` with `JavaS` across `<b>java</b><i>script</i>` produced `<b>JavaS</b><i>cript</i>`. The shared minimal-edit builder now emits only the changed ASCII letters for case-only repairs. This preserves exact formatting and reuses existing editor transactions. Textareas retain single-step undo; contenteditable retains its existing advertised per-edit undo, verified one step per changed letter. The failed initial one-step expectation was corrected to match that adapter contract, with intermediate and final markup assertions. No DOM-write bypass or new history manager.

The authored corpus has 16 positives and 41 preservation cases, plus dictionary/scope/language/typing isolation, sentence-start ownership, every Unicode/CRLF chunk split and exact case-edit checks: **61 focused tests passed**. No supported misses or false positives in that corpus; arbitrary brand recognition is not claimed. Browser cases cover the three required examples, a lower-camel sentence start, and split formatting/native undo.

- Full unit command: **4,900 main-suite tests plus 152 isolated tests = 5,052 pass**, zero failures.
- Full Chrome suite: **118 pass, 10 existing skips, 0 fail**. `bun run check`, production Chrome/Firefox builds and coverage mapping (**203 behaviors**) passed.
- Firefox runtime remains blocked by the previously reported macOS permission; no claim of Firefox runtime validation.
- Logs: `/tmp/ft-native-casing-{focused-final,unit-final,full-chrome,check-complete,build-chrome,build-firefox,benchmark}.log`. Initial formatting evidence: `format-probe.log`; initial per-edit undo expectation failure: `format-fixed.log`.

Native scan costs after broad checks (Bun 1.4.2; 5 warmups then median of 21; canonical and sentence-start rules enabled, native preparation/conversion included):

| Characters | Clean (ms) | Repeated errors (ms) | Error findings |
| ---------- | ---------- | -------------------- | -------------- |
| 1,000      | 0.104      | 0.254                | 47             |
| 10,000     | 0.624      | 1.888                | 462            |
| 50,000     | 3.321      | 9.598                | 2,308          |

Fixture: repeated/truncated `github hosts code. javascript runs here. iphone sales increased. `; clean version uses GitHub/JavaScript/iPhone. Clean counts are zero; error counts include any sentence-start finding in a truncated final token. These are local costs, not a before/after performance claim.

Production JS delta against #16 (`production-chrome-full-99126-1790713624759`): content script **+2,875 bytes**, background **+515**, settings **+1,301**, popup **+384**. Candidate: `production-chrome-full-1715-1790714106596`. No dependency, permission or typing behavior added.

Next: #18 optional user-authored preferred terminology. Seventeen of twenty features implemented; the remaining three features and Firefox runtime validation are still required.

## #18 preferred terminology — domain contract checkpoint (incomplete)

Added a strict pure-domain settings/import boundary in `preferredTerminology.ts`. Version 1 contains an explicit off-by-default global switch and user-authored entries with stable IDs, literal source/replacement, exact or insensitive case policy, explanation, concrete language, all-prose or selection scope, and per-entry enabled state. No runtime registration, persisted key or settings UI is connected yet, so this checkpoint does not expose the feature or change existing Review behavior.

Bounds: 64 entries; 80/120/240 UTF-16 units for source/replacement/explanation; 64-character IDs; 65,536 UTF-8 import bytes. Unknown fields, controls, non-NFC/untrimmed text, invalid languages, malformed types, no-op exact entries, duplicate IDs and conflicting duplicate sources fail as a whole. HTML and regex-looking strings are data, never executed. Successful validation returns a copy and retains IDs. Import uses JSON only.

Cycle validation builds a bounded dependency graph, including whole-phrase prefix/suffix transitions completed by untouched neighboring words (A → B, B C → A C). It rejects potential cyclic dependencies conservatively, including disabled entries so later enabling cannot activate a latent cycle. A standalone case repair is stable at its preferred literal spelling; opposing case mappings are rejected. Different languages are independent. Acyclic chains are allowed. Scope does not weaken cycle checks because all-prose entries can also run in selections.

Validation: **42 focused domain tests passed**, final `bun run check` passed. Runtime/browser/build gates have not been rerun for this unconnected module. Logs: `/tmp/ft-native-terms-{schema-final,check-final}.log`.

Remaining #18 work: settings/repository/config wiring; accessible localized entry editor plus explicit bounded import/export; native literal detection with technical/dictionary/scope protection, stable per-entry diagnostic identity, overlap and canonical/other-rule loop handling; user-authored explanation rendered as text; live removal/recheck; full unit and browser validation, privacy independence, docs and costs. The roadmap remains **17/20 implemented**.

### #18 settings/configuration checkpoint (still incomplete)

Added the `preferredTerminology` setting to the existing settings contract, hidden value control and config-refresh list. The repository validates reads and writes, defaults missing/corrupt values to an empty disabled configuration, and rejects invalid writes without changing storage. Background set-config carries only validated terminology; prediction configuration does not carry the preferences or authored phrases. Content Review options receive the setting. Session option equality includes terminology so actual changes trigger rechecks while identical broadcasts do not.

Focused repository/config/session tests: **76 pass**. These verify safe defaults, rejected writes, explicit save/removal, unchanged dictionary/expansion settings, predictor isolation and recheck invalidation. No terminology matcher or visible editor is connected yet; this remains a preparation checkpoint rather than a delivered feature.

Broad validation: **5,097 unit tests passed** (4,945 main + 152 isolated); full Chrome **118 pass, 10 existing skips, 0 fail**. `bun run check`, Chrome/Firefox production builds and coverage mapping (203 behaviors) passed. Firefox runtime remains permission-blocked. Logs: `/tmp/ft-native-terms-wire-{focused,check,unit,full-chrome,build-chrome,build-firefox}.log`.

Implementation follow-up: the Grammar workspace can mount an editor using the existing `ValueOnlyControl`, `createWorkspaceCard`, `createStackField`, `bindControlEvents` and `downloadBlob` helpers. Validate before setting the control and bound files before reading them. Existing Review messages can label user-authored advice, but explanation text needs its own safe text-content path. Native findings still need per-entry identity, explicit selection-scope metadata and preferred-phrase ownership to prevent conflicts with canonical casing and other native/spelling checks.

### #18 native matching checkpoint (editor still pending)

Registered `preferredTerminology` as a Review-only native rule. Its catalog switch permits the check, but no terms run without the separately enabled user configuration and enabled entries. The matcher validates config, uses escaped literal patterns with exact/insensitive case policy, preserves UTF-16 offsets and grapheme boundaries, and restricts matching to complete protected/dictionary-safe prose tokens in the current language and requested field/selection scope. Selection intent is explicit even when it covers the full field. Work is bounded by the existing 64-entry/phrase limits and a 50,000-character window; oversized direct calls report skipped coverage. Native UI sessions already enforce that window.

Each finding carries the authored entry ID and explanation, has a stable per-entry diagnostic identity and stays outside Fix all safe. Longest complete overlapping source wins; ties use position then stable ID. A bounded occupancy buffer chooses nonoverlapping findings without all-pairs comparisons. Source and exact preferred-form spans reserve ownership against conflicting native/spelling/AI suggestions so a user preference such as GitHub → github stays stable. Ownership is session/snapshot-local, does not teach the dictionary, and ends when the preference is removed. Merged sorted spans use binary overlap lookup for native/AI filtering. Ignore-matching identity includes entry metadata.

Review cards/list accessibility text label the result as user-authored advice and append the explanation as text content, not markup. Nine-language labels are present. A browser test writes an explicit preference through the existing settings path, checks safe HTML-like explanation rendering, applies through the native textarea transaction, verifies recheck and undo, then removes the preference and verifies live disappearance without modifying the source.

Focused matcher tests cover 24 scenarios including literal metacharacters, dictionary/code/technical protection, scope/language, explicit enable/removal, overlap, stable IDs, every Unicode chunk split, native/spelling ownership and direct-call limits. Session/UI focused coverage and a separate AI regression verify live invalidation, safe rendering and no recorrection of preferred wording. Final review added a failing Unicode regression: insensitive matching equates Greek sigma forms, but lowercasing alone did not expose their cycle/duplicate edges. Conservative upper-then-lower folding now rejects those cases; the regression passes. This is deliberately conservative for Unicode expansions.

Final checks: **5,125 unit tests passed** (4,973 main + 152 isolated), full Chrome **119 pass, 10 existing skips, 0 fail**. `bun run check`, Chrome/Firefox production builds and coverage mapping (**204 behaviors**) passed. Firefox runtime is still blocked by the previously reported OS permission. Logs: `/tmp/ft-native-terms-match-verified-{check,unit,chrome,build-chrome,build-firefox}.log`; focused Unicode evidence: `/tmp/ft-native-terms-unicode-{before,after}.log`.

Native preparation/detection/conversion costs after broad validation (Bun 1.4.2; 5 warmups then median of 21 runs; only terminology enabled):

| Entries | Characters | Preferred text (ms) | Source text (ms) | Findings |
| ------- | ---------- | ------------------- | ---------------- | -------- |
| 1       | 1,000      | 0.071               | 0.148            | 40       |
| 1       | 10,000     | 0.309               | 0.929            | 400      |
| 1       | 50,000     | 1.465               | 5.392            | 2,000    |
| 64      | 1,000      | 0.809               | 0.832            | 40       |
| 64      | 10,000     | 1.096               | 1.982            | 400      |
| 64      | 50,000     | 2.714               | 6.273            | 2,000    |

Repeated/truncated fixtures use `We use Acme Suite today. ` or the preferred `Acme Workspace` form; the 64-entry case adds 63 distinct nonmatching LegacyN → PreferredN preferences. Preferred-text counts are zero. These are local costs, not a production speedup claim. Log: `/tmp/ft-native-terms-match-benchmark.log`.

Production JS delta against the configuration checkpoint (`production-chrome-full-2888-1790714674785`): content script **+6,296 bytes**, background/popup **+461 each**, settings **+1,038**. Candidate: `production-chrome-full-5012-1790715326921`. No dependency, permission or typing change.

The visible settings editor, authored-entry CRUD, localized controls/errors and explicit bounded import/export remain outstanding. Roadmap count remains **17/20 implemented**.

### #18 editor and import/export completion

The Grammar workspace now exposes Preferred terminology with labeled native fields for literal source/replacement, authored explanation, case policy, language, scope and per-entry enablement. Entries receive stable UUIDs on creation and retain them through editing and import/export. Saving an entry does not enable the feature; the separate global switch is off by default. Edit, cancel, remove, explicit JSON import-and-replace and JSON export use existing workspace controls and local storage. All labels, help and validation errors cover the nine UI languages. Settings-only translations live in the options UI module, keeping them out of page content scripts.

Imports check file size before reading, then use the existing complete schema validation and byte bound. Malformed/duplicate/cyclic data does not partially change storage. A version check against the current control value prevents a delayed file read from overwriting a newer saved edit. Export contains only validated authored configuration; HTML-like strings render as text. User documentation now explains enablement, precedence, boundaries, conservative cycle handling, limits and the versioned JSON shape.

A real browser test exposed stale active Review findings after removal from the settings editor. Root cause: controls fired their action before their asynchronous storage write completed, allowing the runtime config refresh to read old data. The shared storage-success path now emits `persisted`; runtime refresh listeners (including UI-language reload) wait for that event. Existing immediate UI actions remain intact. A delayed-storage regression verifies notification ordering. The previously failing editor-to-active-Review removal now passes without a test-side forced config refresh.

Visual inspection of the editor in the production browser confirmed label/readability and exposed native select/checkbox alignment issues, fixed by reusing the existing select wrappers, checkbox labels, action groups and workspace spacing. Screenshot: `/tmp/ft-terms-editor.png`; temporary screenshot instrumentation was removed from the test.

Seven editor tests cover CRUD/stable IDs, explicit enablement, whole-config rejection, HTML-safe rendering, cancellation, bounded import/read rejection, stale import protection, exact JSON export and all nine locales. Combined editor/settings/local-AI settings checks: **49 passed**. The browser workflow covers authoring, enabling, editing, ID preservation, import/removal, live native Review and dictionary/expansion independence. The earlier native browser workflow separately verifies Apply, recheck, native undo and safe explanation rendering.

Final validation: **5,133 unit tests passed** (4,981 main + 152 isolated), full Chrome **120 pass, 10 existing skips, 0 fail**. `bun run check`, Chrome/Firefox production builds and coverage mapping (**204 behaviors**) passed. Firefox runtime remains blocked by the previously reported macOS permission.

Logs: `/tmp/ft-native-terms-ui-verified-{check,unit,chrome,build-chrome,build-firefox}.log`. Original live-removal failure: `/tmp/ft-native-terms-ui-browser-complete.log`; fixed browser workflow: `browser-fixed.log`. Final editor/local-AI/settings focused run: `label-tests.log`.

Moving the editor translations out of the shared Review table removed an observed **11,871-byte** content-script increase. Relative to the native matcher checkpoint, final content/background/popup JS are unchanged; settings JS adds **19,037 bytes**. For all of #18 against #17 (`production-chrome-full-1715-1790714106596`), final deltas are content **+6,431 bytes**, background **+3,175**, settings **+20,269**, popup **+3,088**. Final candidate: `production-chrome-full-6888-1790716334843`. Native scan costs remain recorded in the matching checkpoint above. No new dependencies, permissions, external services or typing activation.

Item #18 is implemented with Chrome validation. **18/20 implemented.** Next: #19 profile native rechecks before choosing bounded result reuse; #20 optional style hints remains afterward. Complete roadmap delivery still requires Firefox runtime validation.

## #19 profiling checkpoint

Reproducible baseline at runtime commit `7bb09dfe`: `bun scripts/profile-native-review.ts`. The script uses authored repeated/truncated clean, error-bearing and context-dependent proof paragraphs, exactly 1k/10k/50k UTF-16 characters. All native catalog rules are requested in English; authored terminology is unconfigured, spelling/AI and DOM work are excluded. Bun **1.4.2**, Apple M2 Max, arm64. Five warmups, 21 measured samples per fixture; values below are phase medians in milliseconds. Detection includes chunk construction, finalization includes diagnostic validation/deduplication/coverage, bulk includes planning and its actual proof requests. Proof time is a subset of bulk time; phase medians are not an end-to-end percentile.

| Fixture | Characters | Prepare | Detect  | Finalize | Bulk    | Proof within bulk | Detection calls | Proof calls |
| ------- | ---------- | ------- | ------- | -------- | ------- | ----------------- | --------------- | ----------- |
| clean   | 1,000      | 0.067   | 0.494   | 0.003    | 0.004   | 0.000             | 31              | 0           |
| clean   | 10,000     | 0.321   | 26.059  | 0.006    | 0.004   | 0.000             | 93              | 0           |
| clean   | 50,000     | 1.529   | 110.111 | 0.010    | 0.007   | 0.000             | 403             | 0           |
| proof   | 1,000      | 0.037   | 0.426   | 0.041    | 1.032   | 0.975             | 31              | 62          |
| proof   | 10,000     | 0.341   | 26.811  | 0.360    | 65.331  | 64.940            | 93              | 186         |
| proof   | 50,000     | 1.672   | 92.677  | 1.515    | 187.270 | 184.934           | 403             | 806         |
| errors  | 1,000      | 0.035   | 0.467   | 0.058    | 0.009   | 0.000             | 31              | 0           |
| errors  | 10,000     | 0.334   | 20.146  | 0.588    | 0.075   | 0.000             | 93              | 0           |
| errors  | 50,000     | 1.955   | 126.166 | 3.419    | 0.357   | 0.000             | 403             | 0           |

Each size scans 1/3/13 chunks and calls 31 enabled detector groups per chunk (including empty document-wide result distributors). The proof fixture really invokes two proof requests, producing another 2/6/26 chunk scans; clean and ordinary error fixtures invoke no proof. At 50k there are 0/2,326/1,483 diagnostics for clean/proof/errors respectively. The benchmark asserts no rule failures, expected clean/error presence, actual proof invocation and exact equality of the instrumented output with the ordinary full-scan result. Per-detector call/time instrumentation runs separately after the median samples and restores every detector in `finally`; its clocks do not inflate the median measurements. Raw output: `/tmp/ft-native-review-baseline.jsonl`.

Detection dominates full-scan cost on the long authored drafts; preparation and finalization are much smaller. In a separate instrumented 50k clean scan, usage phrases took 13.196 ms, contextual possessives 12.487 ms, word confusions 8.993 ms and countability 8.245 ms. These single-run attribution values are directional, not paired performance results. Dense context-dependent batches add significant proof work (184.934 ms median at 50k); reuse must not weaken or bypass that proof. Timing variation between the initial probe and final run means any candidate still needs paired before/after measurement.

Next implementation target: bounded, session-local reuse for explicitly audited dependency scopes, starting with the shared phrase-template path (`englishFixedPrepositions` and `englishUsagePhrases`). It reads from 256 characters before chunk ownership, has explicit named/literal evidence 96 characters before a match, scans with the existing 1,024-character lookahead, and reads phrase-end evidence. These actual reads must be captured, including negative-match evidence and edge conditions; current diagnostic context alone is insufficient. Continue full preparation for Markdown/structure and document-wide rules, rebuild diagnostics through finalization, and leave safe-batch proof on the full-scan path. Expand reuse only after source auditing and measured benefit. No runtime cache is implemented in this checkpoint.

`bun run check` passed; the benchmark's runnable assertions passed for all nine fixtures. This checkpoint changes profiling/documentation only, so browser/runtime gates remain those of #18. **18/20 implemented**, #19 still in progress: exact full-scan/property comparisons, invalidation/limits/cancellation/undo coverage, candidate timing and runtime validation remain outstanding.

### #19 bounded domain cache candidate

Added an optional raw-finding cache to `scanReviewChunk`, limited to the two audited `phraseTemplates` detectors: fixed prepositions and usage phrases. **ReviewSession does not use it yet.** Every other detector and all existing callers still take the normal full-scan path; safe-batch proof remains unchanged.

The exact (unhashed) key includes a detector/read-contract version, rule identity, full options, enabled rules, normalized dictionary, source/masked/scan text, actual 352-character left evidence and 1,034-character right evidence, edge positions and relative protection ranges. Identical source/masked/scan strings are represented once. Results store relative ranges/context and are cloned/remapped before ordinary finalization rebuilds IDs and validates source/protection/graphemes. Partial selections, incomplete snapshots, non-whole scopes and sources over 50k fall back to the detector. Storage is FIFO-bounded to 64 entries and 500,000 serialized UTF-16 units; oversized entries are not retained. This bounds serialized payload, not exact engine heap bytes. `clear()` releases retained entries.

Four focused tests (402 assertions) compare the entire result and bulk plans with uncached scans, prove detector-call reuse after an inserted opening paragraph and fresh snapshot IDs, verify explicit clearing, cover fences/dictionary/rules/protection/partial sources, apply 100 seeded random edits including newline joins, chunk-edge changes, quotes and Unicode, and exercise entry/payload eviction and oversized-key fallback. Random edits deliberately exclude code fences so protection cannot make most cases trivially empty; fence insertion has its own explicit test. Session structure signatures, close/cancellation, native undo, and broader settings/lifecycle integration remain for the next checkpoint.

`bun scripts/profile-native-reuse.ts` provides five warmups and 21 paired full/candidate/full samples at each size, asserting exact equality on each result. Each candidate sample starts with a newly cleared cache populated from the original text, then changes one isolated paragraph (Record 3 to Record 4); it does not reuse a previous scan of the edited draft. Fixtures use uniquely numbered authored paragraphs and all native rules. Timings include preparation/detection/finalization; no spelling/AI, DOM or bulk proof.

The initial candidate duplicated source/masked/scan strings in each key and regressed at 50k (109.835 ms full versus 115.532 ms cached), exposing FIFO churn. Removing duplicate key strings produced exploratory medians:

| Characters | Full scan (ms) | Candidate recheck (ms) |
| ---------- | -------------- | ---------------------- |
| 1,000      | 0.612          | 0.635                  |
| 10,000     | 26.623         | 24.920                 |
| 50,000     | 115.551        | 97.879                 |

This supports continuing the candidate for longer drafts, not a production speedup claim. Small drafts gain nothing; the session integration should retain the simple scan there. Logs: `/tmp/ft-native-cache-paired{,-compact}.jsonl`, `/tmp/ft-native-cache-domain-{tests,unit,check}.log`. Final full unit gate passed **5,137 tests** (4,985 main + 152 isolated), as did `bun run check`; focused tests also passed after key compaction. Final unit log: `/tmp/ft-native-cache-domain-unit-final.log`. Runtime/editor validation is pending because the cache is not connected. **18/20 implemented; #19 remains in progress.**

### #19 session integration and validation

ReviewSession now owns the bounded native cache and passes it only for complete whole-field drafts over 8,000 and at most 50,000 UTF-16 characters. Short drafts showed no benefit and retain the simple scan. Partial selections, unread windows and oversized sources clear the cache and rescan. Real settings changes, editor structure-signature changes, unavailable reads and close clear retained entries. Existing generation checks after every yield prevent cancelled scans from publishing or resuming detector work after close. The cache remains session-local; spelling/AI caches and safe-batch proof are unchanged.

Session tests prove fewer detector calls after an isolated paragraph edit, exact equality with a fresh full scan, full detector reruns after structure-only changes, dictionary invalidation, downstream code-fence invalidation, and cache release/no later detector calls when closing during a yielded scan. The seeded domain property test now compares **all native rules**, including diagnostic IDs, ranges, alternatives, context, coverage and bulk plans, over 100 reproducible edits. Its all-rule run passed separately after broadening coverage (`/tmp/ft-native-cache-all-rules-property.log`). The production browser test applies a phrase repair in a draft over 8k, waits for recheck, restores exact source through native undo, and inserts an opening code fence to verify the finding disappears with protected-text coverage.

Final gates: **5,139 unit tests passed** (4,987 main + 152 isolated); full Chrome **121 pass / 10 existing skips / 0 fail**. `bun run check`, coverage mapping (**205 behaviors**), and Chrome/Firefox production builds passed. Firefox runtime is still unverified because of the previously documented macOS permission blocker. Logs: `/tmp/ft-native-cache-final-{check,coverage,unit,chrome,build-chrome,build-firefox}.log`; focused browser: `/tmp/ft-native-cache-browser-focused.log`.

Production JS delta versus #18 (`production-chrome-full-6888-1790716334843`): content script **+1,560 bytes**; other JS artifacts unchanged. Candidate: `production-chrome-full-8491-1790717366305`. Paired domain timing and retained-payload limits remain in the prior checkpoint; these are authored local measurements, not universal responsiveness or heap guarantees. No permissions, dependencies, uploads, AI/model changes or typing behavior added.

**19/20 implemented**, with Chrome validation. Next: #20 default-off optional style/readability advice, separate from error counts and safe bulk fixes. Full roadmap completion still requires Firefox runtime validation.
