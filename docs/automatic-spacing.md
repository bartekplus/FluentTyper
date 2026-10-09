# Automatic spacing: runtime trace and regression

The Options label is **Add space automatically**. Its storage key is
`store.settings.insertSpaceAfterAutocomplete`. This setting defaults to `true`.
An explicit `false` disables it. Site profiles do not override it.

## Configuration paths

| Stage                      | Code                                                                                     | Behavior                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Options                    | `settingsManifest.ts`, `CheckboxControl.ts`, `FieldControl.ts`                           | The checkbox saves through `Store`. The `persisted` event sends a config-change message after the write completes. |
| Import                     | `options/settings.ts`                                                                    | Import writes local storage, then sends the same config-change message.                                            |
| Storage                    | `Store.ts`, `ChromeStorageBackend.ts`, `settingsManager.ts`, `CoreSettingsRepository.ts` | Local storage holds JSON. The repository accepts booleans and uses the on default for missing or invalid values.   |
| Startup and worker restart | `BackgroundBootstrap.ts`, `BackgroundServiceWorker.ts`                                   | Startup applies migrations and loads config. The first prediction also loads config if needed.                     |
| Other refresh callers      | `MessageRouter.ts`, `FieldPreferenceService.ts`                                          | Options, dictionary edits, Review preferences, and field preferences can request a runtime refresh.                |
| Config assembly            | `ConfigAssembler.ts`                                                                     | The same repository getter supplies the predictor config and the page config.                                      |
| Predictor                  | `PredictionManager.ts`, `PredictionOrchestrator.ts`, `PresageHandler.ts`                 | The manager retains config while Presage loads. The handler stores the spacing flag.                               |
| Pages and frames           | `TabMessenger.ts`, `MessageRouter.ts`                                                    | Startup and updates broadcast config to all injected frames. GET_CONFIG supplies config to a new content script.   |
| Page runtime               | `ContentMessageHandler.ts`, `ContentRuntimeController.ts`                                | SET_CONFIG stores the config and restarts active suggestion managers and the Google Docs adapter.                  |

Config refreshes now use one queue per worker. The queue covers config reads,
predictor updates, cache invalidation, and page broadcasts. A rejected refresh
does not prevent the next refresh.

GET_CONFIG also uses this queue. It waits for startup migration and predictor
configuration before it reads page settings. Predictions wait for startup before
they resolve the language. A startup failure prevents configuration delivery.
If a later predictor refresh fails, GET_CONFIG must complete a successful retry
before it can publish new page settings.

The content runtime stays stopped until it receives valid required settings.
An enable command cannot start it before that point. A requested configuration
refresh stops it until settings arrive. A newer request or SET_CONFIG broadcast
supersedes an older GET_CONFIG reply. Thus a delayed reply cannot restore an old
spacing or Enter selection value.
A broadcast during GET_CONFIG can precede that request's storage read. The page
requests a fresh reply and stays stopped until it arrives. It does not choose
between two snapshots whose delivery order cannot prove their age.

## Prediction and acceptance paths

1. `SuggestionPredictionCoordinator` reads the caret context. It sends the first
   character after the caret as `nextChar`.
2. `PresageHandler.finalizePrediction` appends a space when the setting is on and
   the next character permits one. It does not append a second existing space.
   Punctuation follows `SPACING_RULES`. Text expansions use this finalization too.
3. Popup Tab, Enter, Space, digit selection, mouse selection, and inline acceptance
   reach `SuggestionEntrySession.acceptSuggestion` through their existing handlers.
4. `SuggestionTextEditService` inserts the suggestion through the field or editor
   writer. It consumes an existing following space if the suggestion includes one.
   Generic contenteditable block ends use NBSP to preserve a visible trailing gap.
5. `SuggestionAcceptedState` arms delayed spacing only when the setting is on and
   neither the inserted text nor the following text supplies a space.
6. On the next character key, `handleMissingSpaceAfterAccept` checks the caret,
   block, and punctuation. It inserts the space and character together. A caret
   move, changed block, or whitespace key cancels that pending action. Search
   fields and protected editor states retain their existing restrictions.
7. Google Docs uses `GoogleDocsAdapter.completion` and `GoogleDocsModel.planCompletion`
   with the same flag. Its model transaction inserts the prediction text and can
   advance past an existing following space. It does not use generic delayed spacing.

The setting also reaches the typing grammar coordinator and Review options.
Comma/period, closing-bracket, and slash rules use it where their existing rules
permit spacing. Review detects applicable spacing issues without an automatic write.

## Confirmed defects

- The repository previously defaulted a missing setting to `false`. Options
  displayed its own on default after creating defaults. Runtime behavior could
  differ until a config refresh. The repository now defaults to `true`.
- Refreshes previously ran concurrently. A refresh could capture `false`, wait,
  then apply it after a newer refresh applied `true`. The page broadcast could
  read `true` while the predictor retained `false`. Another Options update
  restored the predictor. The queue prevents this order reversal.

The second defect fits the reported recovery after an off/on toggle. It does not
prove that it caused every reported occurrence without the original page and events.

## Regression evidence

`CoreSettingsRepository.test.ts` and `ConfigAssembler.localAi.test.ts` cover the
default, explicit off/on values, and agreement between page and predictor config.
`background.routing.test.ts` pauses an older captured config, requests a newer
value, then resumes the old config. This test failed before the queue fix.
It also checks recovery after a failed config read.

The Chrome/Firefox smoke test accepts a real prediction and types another
character after each missing/off/on value in an open page. The coverage matrix
records these tests. Existing tests cover delayed spacing, caret cancellation,
contenteditable blocks, inline acceptance, editor writers, and Google Docs fixtures.

`content_script.behavior.test.ts` covers delayed replies, startup enable commands,
refresh suspension, and invalid required settings. The routing tests cover
startup migration, queued GET_CONFIG reads, and language resolution after migration.
The smoke suite checks Enter selection with missing, off, and on settings.
When Enter selection is off, Enter inserts a native newline in the textarea.
