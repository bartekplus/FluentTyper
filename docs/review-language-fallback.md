# Language selection and checking coverage

Review keeps language selection, native rule coverage, dictionary spelling, and Local AI coverage separate.
An empty finding list is not proof that a checker ran.

## Language precedence

1. A language selected in the Review panel applies to that Review session and field.
2. Otherwise, the effective site or global writing-language setting applies.
3. With Auto detect, Review uses reliable local detection from the current snapshot.
4. Short or ambiguous text uses the enabled, configured fallback. The panel identifies this choice as uncertain.
5. Reliable unsupported or disabled languages remain unchecked. They never become an unrelated fallback language.

Review does not use the browser UI locale, page language, or document language to override the writing language.
These values cannot prove the language of the text. UI translation remains a separate preference.
Selecting **Auto detect** in Review also overrides a fixed site or global language for that session.
Closing Review removes the session override.

Typing uses its own field/session detector, manual lock, soft document/page/site hints, and confirmation thresholds.
The manual lock wins over detection. Reliable unsupported detection returns `und`, which has no prediction engine.
A token whose script has no enabled language also remains unchecked. Text Expander remains an explicit non-checking mode.
The persistent field preferences control field eligibility. They do not store a writing language.
Review does not copy a recent typing lock from another field or frame.

Review rechecks after a 400 ms typing pause. It resolves automatic language again for each changed snapshot.
Short Latin samples need three words or 20 letters before automatic detection selects a language.
Greek and Arabic script evidence can qualify shorter samples. Detection must also agree with known script constraints.
This is a rejection guard, not a language detector. It does not establish the language of every word.
A settings change, language override, editor change, or session close invalidates pending results.
Changes to enabled languages or the configured fallback also invalidate automatic results.

## Dictionaries and dialects

The repository contains these ten Hunspell dictionaries in `resources_js/<language>/hunspell/`:

| Resource | Writing language   |
| -------- | ------------------ |
| `en_US`  | English, US        |
| `fr_FR`  | French             |
| `hr_HR`  | Croatian           |
| `es_ES`  | Spanish            |
| `el_GR`  | Greek              |
| `sv_SE`  | Swedish            |
| `de_DE`  | German             |
| `pl_PL`  | Polish             |
| `pt_BR`  | Portuguese, Brazil |
| `ar_SA`  | Arabic             |

Bare supported language codes resolve to their shipped resource.
English `en_GB`, `en_AU`, and `en_CA` use `en_US` for limited dictionary checking.
The selected variant stays visible. The panel names the fallback dictionary and reports partial coverage.
Dictionary lookup preserves accepted spellings from the English dialect tables in both directions.
Variant fallback offers only corrections from the authored typo whitelist. Other unknown forms remain unchanged.
It does not infer an error merely because the US dictionary lacks a word.
Dialect conversion remains an explicit native rule choice. This authored list is not a complete dictionary of every English dialect.
Native English-only rules still require their catalog language. A dictionary fallback does not claim equivalent native grammar coverage.
Other missing regional resources, such as `pt_PT`, remain unavailable.
Irish English (`en_IE`) and New Zealand English (`en_NZ`) have no verified dialect support or dictionary fallback. Review does not offer either variant in the selector.

Native grammar coverage comes from `reviewCatalog.ts`, not the dictionary list.
Language-independent native rules can run without a dictionary. Review reports partial coverage when those rules run for a language without spelling support.
See the [language matrix](review-language-matrix.md) for the rule coverage.
The Local AI registry evaluates English only. Model generation in other languages is not a support claim.

## Mixed and protected text

Review uses the shared protected-range pipeline for language exclusions, code, URLs, identifiers, and editor structures.
Before scanning, local paragraph detection excludes confidently different languages.
Automatic detected-language reviews also exclude uncertain paragraphs.
An explicit or configured fallback choice permits uncertain paragraphs to use that choice.
Different-script words exclude their line conservatively. This can exclude nearby valid prose.

Paragraph detection samples at most 4,000 characters per paragraph and requests at most 32 distinct paragraphs per scan.
Identical paragraphs share a request. Regions beyond this request limit remain unchecked.
Dictionary evidence can also identify foreign paragraphs and suppress spelling findings.
Short, same-script language changes inside a sentence can remain undetected. These heuristics do not provide complete multilingual segmentation.

## States and recovery

The session reports `inactive`, `checking`, `checked`, `partial`, `unsupported`, `failed`, or `stale`.
Spelling retains separate `off`, `checking`, `done`, `partial`, `unavailable`, and `failed` states.
Native coverage retains checked rules, failed rules, language exclusions, and protected ranges.
Local AI retains its separate availability and pass coverage.
The UI shows a success message and completed styling only for `checked` results.
Protected regions, fallback uncertainty, missing native rules, and resource failures prevent that success state.

The packaged Presage module loads all dictionaries through one shared initialization promise.
Concurrent requests reuse it. Successful initialization is reused offline.
A rejected initialization remains rejected for typing. A new dictionary request can retry it.
Review caches negative dictionary outcomes until **Retry checks**, a language change, or a new session.
It does not retry failures on every keystroke. Retry preserves feature settings.
Spelling caches reset between scans after reaching 4,096 entries. Per-pass and per-request limits still apply.
Documents with more unique words than the cache can retain can remain partially checked across repeated passes.

Review request waits have a ten-second deadline. Cancellation releases the wait and ignores late answers.
A timed-out shared module load is not duplicated. It can still finish for a later explicit retry.
Failures use fixed categories such as `resource-failed` and `detection-failed`. No diagnostic event adds reviewed text.
Native checks remain usable when the optional Local AI runtime is unavailable.
Review messages without a translation show in English.
The Review language override is not saved to site settings and does not change a typing-session manual lock.
