# Find the right place for your code

[FluentTyper](../../README.md) / [Contributing](../../CONTRIBUTING.md) / Architecture

Choose a layer by its responsibility, then follow its import rules. Keep browser behavior separate from domain logic.

| If you are changing…                 | Start in…               |
| ------------------------------------ | ----------------------- |
| Pure rules, contracts, or types      | `src/core/domain/`      |
| A use case or repository contract    | `src/core/application/` |
| Browser messaging or editor behavior | `src/adapters/chrome/`  |
| Popup, settings, or onboarding       | `src/ui/`               |

The adapter folder also contains shared code for Edge and Firefox. Platform manifests remain separate under `platform/`.

## Layers

- `src/core/domain/`: pure domain logic, contracts, constants, guards, and types. Do not import from application, adapters, or UI.
- `src/core/application/`: use-case orchestration, repositories, logging, and settings access. Do not import from adapters or UI.
- `src/adapters/chrome/`: browser integration for background and content-script runtime behavior. Do not import from UI.
- `src/ui/`: popup, onboarding, and settings UI. Do not import from adapter internals.

## Adapter Separation

Background code and page code communicate through contracts. They must not import each other's implementation.

<details>
<summary>Review and Local AI boundaries enforced by the build</summary>

- `src/adapters/chrome/background/**` must not import from `src/adapters/chrome/content-script/**`.
- `src/adapters/chrome/content-script/**` must not import from `src/adapters/chrome/background/**`.
- The Local AI Review runtime (engine, job host, consent controller) lives in `src/adapters/chrome/background/localAi/` and runs in the background service worker; content scripts reach it only through the review port and messages in `src/core/domain/contracts/localAi.ts`.
- Review detection (the detectors in `src/core/domain/grammar/review/`, their phrase tables and the generated English lexicon) runs only in the background service worker: `ReviewEngineHost` runs a `LocalReviewEngine` per review session. Content scripts reach it through the `ReviewEngine` port (`src/core/application/review/ReviewEngine.ts`), implemented by `MessagingReviewEngine`, with the messages in `src/core/domain/contracts/reviewEngine.ts`. Content-side code imports only the light Review modules (types, `textRanges`, `reviewFindings`, `reviewSpelling`, `bulkPlanner`, `liveProposalSelection`, `reviewCatalog`, `reviewMessages`, `reviewLocale`, `ai/*`), never `reviewDiagnostics`, `reviewDetectors`, `liveProposals`, `reviewExplanations` or `LocalReviewEngine`; the build fails if detector markers or a finding explanation appear in a content script. Findings' explanations (`reviewExplanations.ts`) are resolved in the background and sent with scan results and live proposals; `reviewMessages.ts` keeps the page's UI text and only the explanations of findings the page builds (dictionary, Local AI). The background bundle carries the English explanations only: `build.ts` inlines them (`englishExplanations.ts`) and writes `review-explanations/<lang>.json` for the other UI languages, which `ReviewEngineHost` reads on first need. The generated data of the languages other than English (the `*.generated.ts` modules under `review/<language>/`) is not in background.js either: `build.ts` writes `review-data/<lang>.json` (it fails if background.js contains any of it), and `LocalReviewEngine` loads a language's file before the first scan, proof or live check of text in that language. Detectors read the data synchronously with `reviewData(lang)` (`reviewLanguageData.ts`) and import the generated modules only as types (`import type`). Without loaded data, `reviewData` throws: the detector fails as a rule error and gives no findings. Tests (the preload), child processes and tools fill all data from source with `loadAllReviewData()` (`reviewLanguageSources.ts`). The options page may import `reviewExplanations`.
- Only `src/adapters/chrome/background/localAi/engineRuntime.ts` may import `@huggingface/transformers` (Transformers.js + ONNX Runtime Web). Only `src/entries/background.ts` imports it (tests get no engine); builds without the runtime (Firefox) swap it for `engineRuntime.noop.ts`. The build fails if the engine appears in any bundle but a Chrome/Edge `background.js`.

</details>

## Review Clause Reader

`src/core/domain/grammar/review/clauseReader.ts` is a limited clause reader that the agreement checks share. It is not a parser. From the head noun of a subject, it reads past:

- the adjectives and participles after the noun (`skipPostnominal`);
- up to four complements, such as "de la maison" or "of the list" (`skipComplements`);
- a second noun phrase joined by "et", "and", "y" or "e", which makes the subject plural (`skipCoordinated`);
- a relative clause whose subject is the relative pronoun, such as "qui émet depuis Lyon" or "who ran the light" (`verbAfterRelative`).

Each language gives a `ClauseProfile`: its determiners, prepositions, quantifiers, number words, relative pronouns, coordinators, clitics, and the lexicon callbacks `isNoun`, `postnominal`, `prenominal`, `isAdverb` and `isFiniteVerb`. The profiles are `FRENCH_CLAUSE` (french/agreement.ts), `ENGLISH_CLAUSE` (english/agreementSlots.ts) and the Spanish and Portuguese profiles in their `verbAgreement.ts`. The language code keeps its own checks for the main verb and its fix.

Rules for the reader:

- It works on the caller's tokens (`ClauseToken`). `clauseTokensAfter` is a small token pass for a language that has none.
- Each step reads a fixed maximum number of tokens. Thus a scan stays linear in the chunk length.
- When a step is not sure, it stops: a skip function gives back its start index, and `verbAfterRelative` gives -1. The caller then reports nothing.
- Add a word to a profile only when the word has one reading in that position. Test new readings in `tests/grammar/ReviewClauseReader.test.ts`, with correct sentences that must stay silent, and put the worst-case timing case in a `*.timing.test.ts` file.
- The language code uses the reader for more shapes: French inverted subjects ("où vivent les loups"), asides between commas and the antecedent of "que" before avoir (french/agreement.ts, french/adjectives.ts).

## Entry Points

- `src/entries/background.ts`
- `src/entries/content_script.ts`
- `src/entries/content_script_main_world.ts`
- `src/entries/content_script_main_world_start.ts`
- `src/entries/popup.ts`
- `src/entries/settings.ts`
- `src/entries/onboarding.ts`

## Imports and Shared Contracts

- Prefer path aliases: `@core/*`, `@adapters/*`, `@ui/*`, `@third-party/*`.
- Avoid legacy roots such as `src/background/*`, `src/content-script/*`, and `src/shared/*`.
- Put cross-layer contracts in `src/core/domain/contracts/**`.
- Keep runtime message schemas and shared message types in `src/core/domain/messageTypes.d.ts`.

## Placement Heuristics

- Keep modules focused and composable; do not re-introduce large monolithic runtime files.
- Follow existing placement patterns before creating new top-level structure.
- The suggestion popup's look (stylesheet, row/footer markup, sizing, key hints) lives in `src/core/domain/suggestionPopup/`. The content-script popup and the options page's Appearance preview both render from it; change the popup there so the two stay in sync.
- When architecture changes affect routing or runtime boundaries, update the related tests called out in [testing.md](testing.md).

---

[Runtime feature workflows](runtime-features.md) · [Testing](testing.md) · [Return to contributing](../../CONTRIBUTING.md)
