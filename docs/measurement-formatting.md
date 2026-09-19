# Measurement-unit formatting: implementation and safety assessment

Implemented against checkout `bce365b5`; reviewed 2026-09-19. This is a conservative offline notation formatter, not numerical conversion, a natural-language unit-name parser, or a full UCUM implementation. Browser verification has the limits listed below; this report does not claim universal safety or production readiness across every editor/browser.

## Behavior and boundaries

The existing grammar catalog registers `measurementUnitFormatting` (UI: **Measurement unit formatting**). The pure rule and bounded parser live in `src/core/domain/grammar/implementations/MeasurementUnitFormattingRule.ts` and `src/core/domain/grammar/measurement/`. The existing grammar engine, edit sequencing, settings toggle, stable writing-language updates, and editor transactions are reused.

Only a completed expression followed by a typed space/newline can receive a missing U+00A0 NO-BREAK SPACE. An adapter must positively identify an editable prose context. The insertion preserves the exact number, unit spelling/case, operator order, exponent scope, and trailing delimiter. Numbers are never converted to JavaScript Number. Existing ordinary space, NBSP, and narrow NBSP remain unchanged.

| Writing locale | Example before → after (the inserted space is NBSP) |
| -------------- | --------------------------------------------------- |
| en-US          | `Mass: 1.50kg ` → `Mass: 1.50 kg `                  |
| fr-FR          | `Masse : 1,50kg ` → `Masse : 1,50 kg `              |
| hr-HR          | `Masa: 1,50kg ` → `Masa: 1,50 kg `                  |
| es-ES          | `Masa: 1,50kg ` → `Masa: 1,50 kg `                  |
| el-GR          | `Μάζα: 1,50kg ` → `Μάζα: 1,50 kg `                  |
| sv-SE          | `Massa: 1,50kg ` → `Massa: 1,50 kg `                |
| de-DE          | `Masse: 1,50kg ` → `Masse: 1,50 kg `                |
| pl-PL          | `Masa: 1,50kg ` → `Masa: 1,50 kg `                  |
| pt-BR          | `Massa: 1,50kg ` → `Massa: 1,50 kg `                |

Other supported examples include `Speed: 5m/s `, `Energy: 10kWh `, `Storage: 250MiB `, `Temperature: 20°C `, `Area: 3m² `, `Flux: 2W/(m·K) `, and the accepted litre alias `Volume: 10ml `. Only the separator changes.

The live writing-language registry is checked by the generator and tests. The nine UI locales also have translated titles, descriptions, and examples. `auto_detect` and `textExpander` are not locale policies. Underscore/hyphen variants resolve to the same exact supported locale. Region/script information is never reduced to a base-language guess: unverified `en-GB`, `pt-PT`, script-bearing tags, and unknown tags fail closed. No browser UI language is used. Written names, plural categories, and inflection are preserved rather than rewritten; leaving an unknown name alone is not recognition coverage.

## Exact coverage and deliberate gaps

The curated registry contains **96 exact prose entries**, with all 24 current SI decimal prefixes (including Q/R/r/q and both micro glyphs) and ten binary prefixes Ki through Qi where permitted. Finite lookup tables recognize **1,383 exact/prefixed forms**; 1,169 can receive spacing in the test context `Measured: 1<form> `, while 214 are preserved. These counts exclude the unbounded combinations of supported atoms. They do not count unknown no-ops as support.

Composition supports `/`, `·`, `⋅`, `*`, signed integer caret exponents, superscript exponents, and explicit denominator/operator grouping. It never simplifies expressions or reassociates divisions. Token matching consumes complete symbols, so `ms`, `mmHg`, and identifiers cannot match a shorter prefix accidentally. Absolute Celsius/Fahrenheit compound expressions are rejected; no temperature/difference inference is attempted.

All **312 UCUM 2.2 atomic codes** are audited in the generated [coverage matrix](../data/measurement/ucum-coverage.md): **42** have standalone spacing-eligible prose mappings, **32** map to preserved ambiguous notation, and **238** are unsupported. The matrix is about prose mappings, not accepting UCUM machine identifiers. Many clinical, legacy, constants, qualified customary-volume/mass definitions, and specialized scientific codes remain unsupported. Bare regional volume/mass abbreviations are not assigned a region. This is broad SI/practical symbol coverage, not “all units.”

Default behavior deliberately leaves these unchanged:

- `C`, `F`, and `K` never acquire a degree sign. Standalone capital Latin symbols also remain unchanged because they can denote grades, product models, or resolutions (`4K`, `10A`). They can still participate in unambiguous compounds.
- `ms`, `Ms`, `mW`, `MW`, `Mb`, `MB`, `kB`, `KiB`, `kW`, `kWh`, and `nm` retain their exact symbols. Ambiguous bit/barn and byte/bel forms are preserved; binary bytes are distinguished from decimal quantities.
- Angular degrees/primes and percentages retain existing everyday/scientific styles. Regional `gal`, `qt`, `pt`, `cup`, spoon abbreviations, `oz`, `lb`, calories, horsepower, and survey-acre ambiguities are preserved. Medical notation is not rewritten to alternative glyphs.
- Written names, fuzzy spelling, case repair, missing-degree inference, unit-system preferences, value scaling, and grammatical inflection are not implemented.
- Fractions, ranges, scientific-number notation, grouping spaces/mixed separators, and non-ASCII digits either retain the complete lexeme or fail closed. Ordinary locale decimal lexemes, signs, trailing zeros, and arbitrarily large digit strings within the bound are preserved exactly.
- Bare quantities without preceding prose, mid-text cursors, punctuation completion, paste/idle/delete events, unknown units/locales, malformed expressions, leading algebraic groups, and over-limit input are unchanged.

The rule accepts at most 512 UTF-16 code units of context, scans at most 128 expression units, and limits nesting to four levels. The full-context ceiling intentionally makes long textarea content and long paragraphs no-ops; it prevents interpreting a truncated code fence as fresh prose. This is a usability limitation, not a claim that arbitrarily long documents are supported.

## Safety assessment and default decision

The reviewed default is **on for fresh installations and explicit resets when grammar correction is enabled** (`all`, `safe`, `on`, `recommended`). Evidence is the independent adversarial/property-style suite, typing simulation, settings tests, transaction tests, and successful Chromium integration. This decision covers a restricted separator insertion, not arbitrary unit normalization.

False-positive review removed prefix-word collisions (`am`, `as`, `Ms`, `dam`), regional-unit guesses, angular spacing, root-em/CSS and 5G ambiguities, standalone capital letters, common commands, and detectable Markdown/code syntax. Detected code/readonly/password/structured fields are rejected in the adapter, including password fields temporarily exposed as text. Natural-language semantic ambiguity cannot be perfectly identified from a short suffix: unknown product names or novel command syntax can still resemble a measurement. Stronger context recognition would need separate evidence, not more aggressive aliases.

The mutation shrinks to the separator insertion to retain rich nodes. Live text and collapsed caret must match before applying. Measurement edits cannot use stale host rewriting or corrective destructive retries. A failed verification is not reported as a successful correction. Existing source-rule attribution and immediate undo/revert suppression are retained. No new listener, permissions, remote API, telemetry, typed-text logging, or runtime network data access was added.

Two real typing interactions required narrow guards when this feature is enabled: decimal/grouping punctuation following digits must wait instead of becoming prose punctuation; exponent signs and compact numeric range hyphens must not become arithmetic spacing. This means a comma after a digit may need an explicit user space in prose lists. Unrelated rules remain available, and disabling the new rule restores their existing behavior. All-rule typing tests preserve grouped/decimal numbers, scientific notation, compounds, and bracket caret behavior; no iteration-cap-based oscillation workaround is used.

Google Docs intentionally supplies a protected context for this rule. Its current model lacks protected/code styling information. Existing Docs transactions continue to run for other features; measurement text is left unchanged.

## Settings and upgrades

Historical V3 snapshots are frozen. Grammar settings now store explicit per-rule boolean choices under the existing storage key. Missing choices inherit the live catalog default; explicit `false` stays off and explicit `true` stays on. Fresh/reset settings use an empty map. Individual toggle changes record only that rule's choice; presets choose all currently offered rules, leaving future rules free to inherit defaults.

The one-time V8 schema migration converts old enabled-rule arrays into explicit choices for the frozen pre-measurement rule inventory. This preserves existing choices (including custom/empty lists) for old rules while the new measurement rule inherits its on default. No feature-specific migration marker is required: the stored map distinguishes the new schema. Missing settings remain unset and malformed settings are preserved and fail closed. Global extension enablement is unchanged. Tests cover legacy migration, failed-write retry, missing defaults, explicit opt-out, settings persistence, runtime resolution, and reset behavior.

## Reproduction and evidence

Source versions, licenses, curated-data generation, and explicit refresh instructions are in [measurement-data.md](measurement-data.md). Generation is offline and verifies the pinned UCUM SHA-256, duplicate symbols/mappings, source identifiers, and live-language completeness. Two consecutive generations produced identical registry and coverage hashes.

Environment: macOS 27.0 (26A428), Apple M2 Max, arm64, Bun 1.4.2 (repository pins 1.4.0). No dependency or version changes were made.

| Command                                    | Result                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `bun run check`                            | Lint, format, typecheck pass                                                  |
| `bun run test`                             | 1,727 pass across main and six isolated processes; zero failures              |
| `bun run build`                            | Chrome production pass                                                        |
| `bun run build --platform=firefox`         | Firefox production pass                                                       |
| `bun run build --platform=edge`            | Edge production pass; no Edge live browser available                          |
| `bun run test:e2e`                         | Latest Chrome: 26 pass; prior host-load failures reproduced on clean baseline |
| `bun run test:e2e:full`                    | Latest Chrome: 66 pass / 7 existing skips; zero failures                      |
| `bun run test:e2e:docs`                    | Chromium cross-world fixture: 26 pass; not live Google Docs                   |
| `bun run check:e2e:coverage`               | Pass: 134 mapped behaviors                                                    |
| `bun run test:e2e --platform=firefox`      | Blocked before extension loading: browser launch/profile failure              |
| `bun run test:e2e:full --platform=firefox` | Blocked before extension loading: browser launch/profile failure              |
| `bun scripts/measurement-data.ts`          | Offline generation and byte-for-byte reproducibility pass                     |
| `bun scripts/benchmark-measurement.ts`     | Results below                                                                 |

The default Chrome cache lacked its framework. An isolated install was completed with native unzip, then Chrome commands ran with `PUPPETEER_CACHE_DIR=/tmp/fluenttyper-measurement-browsers`. Initial failed launch attempts are not test passes. System Chrome also ran the Docs fixture successfully, but cannot load this unpacked extension through the current launch flags. Cached Firefox timed out; installed Firefox 156 failed with “Could not find profile folder,” also reproduced in independent Node/Puppeteer launches, including an explicit fresh profile. Firefox runtime compatibility is **unverified**, and there was no live Google Docs or Edge browser test.

Earlier reruns experienced Chromium worker/startup timeouts during heavy unrelated host load (load average above 50). A clean `bce365b5` archive reproduced smoke failures (13 pass / 13 fail) under the same conditions. After the per-rule settings schema update, final Chrome smoke (26 pass) and full (66 pass, 7 existing skips) runs passed. The full run includes both measurement typing and the new options test proving default inheritance, explicit opt-out persistence, and reload behavior. Firefox runtime remains unverified; the earlier failures are retained here as environment history rather than reported as current Chrome results.

The new browser test types an English measurement, protects a path, and types a Polish decimal with punctuation rules enabled. Rich-node preservation, stale input, and immediate undo are verified in DOM integration tests; that is not a claim of testing every rich editor live. The broader existing suite checks editor/IME/selection/revert behaviors.

Benchmark: 100,000 operations/case, fixed inputs, same machine. Typical match **661 ns/op**, ordinary non-match **444 ns/op**, over-limit prose **24 ns/op**, malformed adversarial expression **1,386 ns/op**. These are rule-only timings, not total keystroke latency or a cross-machine guarantee. No per-miss lookup cache retains user strings.

Chrome production JavaScript compared with clean `bce365b5`, same build options and gzip with mtime zero:

| Bundle             | Uncompressed increase | gzip increase |
| ------------------ | --------------------: | ------------: |
| content_script.js  |          18,148 bytes |   4,147 bytes |
| background.js      |           2,198 bytes |     225 bytes |
| settings.js        |           5,025 bytes |   1,338 bytes |
| popup.js           |          13,020 bytes |   2,392 bytes |
| onboarding.js      |           1,828 bytes |     643 bytes |
| MAIN-world bundles |                     0 |             0 |
| Total              |          40,219 bytes |   8,745 bytes |

The remaining release limitations are Firefox runtime verification, Docs measurement support, conservative context/numeric/name gaps, and the explicitly unsupported source inventory. No release or version bump is included.
