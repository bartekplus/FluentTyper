# PREFIX_ONLY_MODE Setting

**Date:** 2026-03-23
**Status:** Approved
**Fixes:** https://github.com/bartekplus/FluentTyper/issues/4
**Upstream:** https://github.com/bartekplus/presage/commit/0830a210fda6a4ef2f8f13ae0d354b1526936390

## Prerequisite

The presage WASM binary (`src/third_party/libpresage/libpresage.js`) must include support for `Presage.ContextTracker.PREFIX_ONLY_MODE`. This was added in the upstream commit above. If the bundled binary is not yet updated, it must be rebuilt first.

## Problem

FluentTyper's presage engine returns spell-correction suggestions alongside prefix-matched completions. Users want an option to only see words that start with what they've already typed, suppressing typo-correction noise.

## Solution

Add a `prefixOnlyMode` boolean setting (default: `false`). When enabled — or when inline suggestion is enabled globally — presage's `PREFIX_ONLY_MODE` is activated, restricting all predictors to return only prefix-matched words.

### Effective value logic

```
effectivePrefixOnlyMode = prefixOnlyMode || inlineSuggestion
```

Inline suggestion implicitly forces prefix-only mode because showing spell-corrections inline (for words the user didn't type) would be confusing.

### Site-profile limitation

The effective value is computed from the **global** `inlineSuggestion` setting, not from per-site profile overrides. The presage engine config is global (shared across all tabs), so per-site inline suggestion overrides do not influence PREFIX_ONLY_MODE. If a user has inline suggestion off globally but enabled for a specific site, prefix-only mode will NOT be automatically activated. This is acceptable for the initial implementation.

## Data Flow

```
Settings UI (checkbox)
  → CoreSettingsRepository.getPrefixOnlyMode()
  → ConfigAssembler.assemblePredictionRuntimeConfig()
      NEW: reads prefixOnlyMode (not currently read here)
      NEW: reads inlineSuggestion (not currently read here — must be added)
      computes: effectivePrefixOnlyMode = prefixOnlyMode || inlineSuggestion
  → PredictionConfig.prefixOnlyMode (boolean)
  → PresageConfig.prefixOnlyMode (boolean)
  → PresageHandler.setConfig():
      stores as this.prefixOnlyMode instance field
      passes { numSuggestions, prefixOnlyMode } to each PresageEngine
  → PresageEngine.setConfig() calls:
      libPresage.config("Presage.ContextTracker.PREFIX_ONLY_MODE", "yes" | "no")
```

## Files to Modify

### Domain layer

1. **`src/core/domain/constants.ts`**
   - Add `KEY_PREFIX_ONLY_MODE = "prefixOnlyMode"`

2. **`src/core/domain/contracts/settings.ts`**
   - Add `prefixOnlyMode: KEY_PREFIX_ONLY_MODE` to `SETTINGS_KEYS`
   - Add `prefixOnlyMode: boolean` to `SettingsSchema`

### Application layer

3. **`src/core/application/repositories/CoreSettingsRepository.ts`**
   - Add `getPrefixOnlyMode(): Promise<boolean>` (delegates to `getBooleanField`, default `false`)

### Adapters layer

4. **`src/adapters/chrome/background/PresageEngine.ts`**
   - Add `prefixOnlyMode: boolean` to `PresageEngineConfig`
   - In `setConfig()`, call `this.libPresage.config("Presage.ContextTracker.PREFIX_ONLY_MODE", config.prefixOnlyMode ? "yes" : "no")`

5. **`src/adapters/chrome/background/PresageHandler.ts`**
   - Add `prefixOnlyMode: boolean` to `PresageConfig`
   - Store as `this.prefixOnlyMode` instance field in `setConfig()`
   - Update the engine config object in the loop (line ~141) to include `prefixOnlyMode`:
     `presageEngine.setConfig({ numSuggestions: this.engineNumSuggestions, prefixOnlyMode: this.prefixOnlyMode })`

6. **`src/adapters/chrome/background/config/ConfigAssembler.ts`**
   - In `assemblePredictionRuntimeConfig()`:
     - **NEW read:** Add `settingsRepository.getPrefixOnlyMode()` to the `Promise.all` block
     - **NEW read:** Add `settingsRepository.getInlineSuggestion()` to the `Promise.all` block (not currently read in this method)
     - Compute `prefixOnlyMode: prefixOnlyMode || inlineSuggestion` in the returned `predictionConfig`

### UI layer

7. **`src/ui/options/fluenttyperI18n.ts`**
   - Add `prefix_only_mode_label` and `prefix_only_mode_desc` entries (English + existing languages)

8. **`src/ui/options/settingsManifest.ts`**
   - Add checkbox entry after inline suggestion, in the same "Behavior after completion" group
   - `name: KEY_PREFIX_ONLY_MODE`, `type: "checkbox"`, `default: false`

## Settings UI

The checkbox appears right after the inline suggestion checkbox in the "Behavior after completion" group on the core settings tab.

- **Label:** "Prefix-only mode" (or localized equivalent)
- **Description:** "Only suggest words that start with what you type. Disables spell-correction suggestions. Automatically enabled when inline suggestion is active."

## Testing

- Build and typecheck pass (`bun run check`)
- Setting persists and flows to the presage engine config call
- Inline suggestion enabled → PREFIX_ONLY_MODE = "yes" even when checkbox is off
- Both disabled → PREFIX_ONLY_MODE = "no"
- Checkbox on, inline suggestion off → PREFIX_ONLY_MODE = "yes"
