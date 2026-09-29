# Native Review roadmap progress

Source: `/Users/bartosztomczyk/Downloads/Documents/FluentTyper_Native_Review_Roadmap_and_Prompts.md` (2026-09-29).
Base: `d0d0996f`. Branch: `codex/native-review-roadmap`.

Execute sequentially: 1, 2, 3, 4, 8, 5, 6, 7, 9–20. Native TypeScript, individual suggestions, existing editor transactions. No push, PR or merge authorized.

| #   | Feature                        | Status                                                   |
| --- | ------------------------------ | -------------------------------------------------------- |
| 1   | Repeated words                 | Implemented; Chrome verified; Firefox launch blocked     |
| 2   | Auxiliary base verbs           | Pending                                                  |
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
