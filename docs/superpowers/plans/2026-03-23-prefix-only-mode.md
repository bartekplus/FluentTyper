# PREFIX_ONLY_MODE Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a prefix-only prediction mode setting that restricts presage to only suggest words starting with the typed prefix, and force-enable it when inline suggestion is active.

**Architecture:** New boolean setting flows from the UI through the existing config pipeline (constants → settings contract → repository → ConfigAssembler → PredictionConfig → PresageConfig → PresageHandler → PresageEngine). The effective value is `prefixOnlyMode || inlineSuggestion`. At the engine level, it calls `libPresage.config("Presage.ContextTracker.PREFIX_ONLY_MODE", "yes"/"no")`.

**Tech Stack:** TypeScript, Bun test runner, presage WASM

**Spec:** `docs/superpowers/specs/2026-03-23-prefix-only-mode-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/core/domain/constants.ts` | Modify | Add `KEY_PREFIX_ONLY_MODE` constant |
| `src/core/domain/contracts/settings.ts` | Modify | Add to `SETTINGS_KEYS` and `SettingsSchema` |
| `src/core/application/repositories/CoreSettingsRepository.ts` | Modify | Add `getPrefixOnlyMode()` accessor |
| `src/adapters/chrome/background/PresageEngine.ts` | Modify | Add `prefixOnlyMode` to config, call `libPresage.config()` |
| `src/adapters/chrome/background/PresageHandler.ts` | Modify | Thread `prefixOnlyMode` through to engines |
| `src/adapters/chrome/background/config/ConfigAssembler.ts` | Modify | Read both settings, compute effective value |
| `src/ui/options/fluenttyperI18n.ts` | Modify | Add i18n entries |
| `src/ui/options/settingsManifest.ts` | Modify | Add checkbox definition |
| `tests/PresageEngine.test.ts` | Modify | Test PREFIX_ONLY_MODE config call |
| `tests/CoreSettingsRepository.test.ts` | Modify | Test default value |
| `tests/PredictionOrchestrator.test.ts` | Modify | Update `createConfig` helper |
| `tests/ConfigAssembler.prefixOnly.test.ts` | Create | Test effective prefixOnlyMode OR-logic |

---

## Chunk 1: Domain and Application Layers

### Task 1: Add constant and settings contract

**Files:**
- Modify: `src/core/domain/constants.ts:74` (after `KEY_INLINE_SUGGESTION`)
- Modify: `src/core/domain/contracts/settings.ts:22,58,112` (import, SETTINGS_KEYS, SettingsSchema)

- [ ] **Step 1: Add the constant**

In `src/core/domain/constants.ts`, add after the `KEY_INLINE_SUGGESTION` line:

```typescript
export const KEY_PREFIX_ONLY_MODE = "prefixOnlyMode";
```

- [ ] **Step 2: Add to settings contract**

In `src/core/domain/contracts/settings.ts`:

Add to imports:
```typescript
KEY_PREFIX_ONLY_MODE,
```

Add to `SETTINGS_KEYS` (after `inlineSuggestion`):
```typescript
prefixOnlyMode: KEY_PREFIX_ONLY_MODE,
```

Add to `SettingsSchema` (after `inlineSuggestion: boolean`):
```typescript
prefixOnlyMode: boolean;
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (no consumers of the new field yet)

- [ ] **Step 4: Commit**

```bash
git add src/core/domain/constants.ts src/core/domain/contracts/settings.ts
git commit -m "feat: add prefixOnlyMode to domain constants and settings contract"
```

### Task 2: Add repository accessor with test

**Files:**
- Modify: `src/core/application/repositories/CoreSettingsRepository.ts:101` (after `getInlineSuggestion`)
- Modify: `tests/CoreSettingsRepository.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/CoreSettingsRepository.test.ts`:

```typescript
test("defaults prefixOnlyMode to false when the setting is absent", async () => {
  const repository = new CoreSettingsRepository(createSettingsManagerMock({}));

  await expect(repository.getPrefixOnlyMode()).resolves.toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/CoreSettingsRepository.test.ts`
Expected: FAIL — `getPrefixOnlyMode is not a function`

- [ ] **Step 3: Implement the accessor**

In `src/core/application/repositories/CoreSettingsRepository.ts`, add after `getInlineSuggestion()`:

```typescript
async getPrefixOnlyMode(): Promise<boolean> {
  return this.getBooleanField("prefixOnlyMode");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/CoreSettingsRepository.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/application/repositories/CoreSettingsRepository.ts tests/CoreSettingsRepository.test.ts
git commit -m "feat: add getPrefixOnlyMode to CoreSettingsRepository"
```

---

## Chunk 2: Presage Engine Layer

### Task 3: Add prefixOnlyMode to PresageEngine with test

**Files:**
- Modify: `src/adapters/chrome/background/PresageEngine.ts:8-9,39-42`
- Modify: `tests/PresageEngine.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/PresageEngine.test.ts` (new test case inside the describe block):

```typescript
test("setConfig calls PREFIX_ONLY_MODE on native presage", () => {
  const config = jest.fn();

  const module = {
    PresageCallback: { implement: jest.fn((cb) => cb) },
    Presage: class {
      constructor(_cb: unknown, public path: string) {}
      config = config;
      predictWithProbability() {
        return { size: () => 0, get: () => ({ prediction: "" }) };
      }
    },
    FS: { writeFile: jest.fn() },
  } as unknown as PresageModule;

  const engine = new PresageEngine(module, { numSuggestions: 3, prefixOnlyMode: false }, "en_US");

  // Constructor calls setConfig which should set PREFIX_ONLY_MODE to "no"
  expect(config).toHaveBeenCalledWith("Presage.ContextTracker.PREFIX_ONLY_MODE", "no");

  engine.setConfig({ numSuggestions: 3, prefixOnlyMode: true });
  expect(config).toHaveBeenCalledWith("Presage.ContextTracker.PREFIX_ONLY_MODE", "yes");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/PresageEngine.test.ts`
Expected: FAIL — `prefixOnlyMode` not in type / no PREFIX_ONLY_MODE config call

- [ ] **Step 3: Implement in PresageEngine**

In `src/adapters/chrome/background/PresageEngine.ts`:

Update `PresageEngineConfig`:
```typescript
export interface PresageEngineConfig {
  numSuggestions: number;
  prefixOnlyMode: boolean;
}
```

Update `setConfig()`:
```typescript
setConfig(config: PresageEngineConfig) {
  this.config = config;
  this.libPresage.config("Presage.Selector.SUGGESTIONS", this.config.numSuggestions.toString());
  this.libPresage.config(
    "Presage.ContextTracker.PREFIX_ONLY_MODE",
    this.config.prefixOnlyMode ? "yes" : "no",
  );
}
```

- [ ] **Step 4: Fix the existing test**

The first test in `PresageEngine.test.ts` creates a config with `{ numSuggestions: 3 }` — this now needs `prefixOnlyMode`. Update:

```typescript
const engine = new PresageEngine(module, { numSuggestions: 3, prefixOnlyMode: false }, "en_US");
```

And update the `setConfig` call:
```typescript
engine.setConfig({ numSuggestions: 7, prefixOnlyMode: false });
```

Similarly for the second existing test:
```typescript
const engine = new PresageEngine(module, { numSuggestions: 3, prefixOnlyMode: false }, "en_US");
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/PresageEngine.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/adapters/chrome/background/PresageEngine.ts tests/PresageEngine.test.ts
git commit -m "feat: add PREFIX_ONLY_MODE config to PresageEngine"
```

### Task 4: Thread prefixOnlyMode through PresageHandler

**Files:**
- Modify: `src/adapters/chrome/background/PresageHandler.ts:25-36,56-58,105-144`

- [ ] **Step 1: Add to PresageConfig interface**

In `PresageHandler.ts`, add `prefixOnlyMode` to the `PresageConfig` interface:

```typescript
export interface PresageConfig {
  numSuggestions: number;
  engineNumSuggestions?: number;
  minWordLengthToPredict: number;
  insertSpaceAfterAutocomplete: boolean;
  autoCapitalize: boolean;
  textExpansions: Array<[string, object]>;
  prefixOnlyMode: boolean;

  timeFormat?: string;
  dateFormat?: string;
  userDictionaryList?: string[];
}
```

- [ ] **Step 2: Add instance field and wire up setConfig**

Add instance field (after `private autoCapitalize: boolean;`):
```typescript
private prefixOnlyMode: boolean;
```

Initialize in constructor (after `this.autoCapitalize = true;`):
```typescript
this.prefixOnlyMode = false;
```

In `setConfig()`, after `this.autoCapitalize = config.autoCapitalize;`:
```typescript
this.prefixOnlyMode = config.prefixOnlyMode;
```

Update the engine config in the loop (lines ~140-144):
```typescript
for (const [, presageEngine] of Object.entries(this.presageEngines)) {
  presageEngine.setConfig({
    numSuggestions: this.engineNumSuggestions,
    prefixOnlyMode: this.prefixOnlyMode,
  });
}
```

Also update the constructor's initial engine config (line ~70):
```typescript
const engineConfig: PresageEngineConfig = {
  numSuggestions: SUGGESTION_COUNT,
  prefixOnlyMode: false,
};
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: May fail if callers of `PresageConfig` don't provide `prefixOnlyMode` yet — that's expected.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/chrome/background/PresageHandler.ts
git commit -m "feat: thread prefixOnlyMode through PresageHandler to engines"
```

---

## Chunk 3: Config Assembly and Orchestrator

### Task 5: Update PredictionOrchestrator test helper

**Files:**
- Modify: `tests/PredictionOrchestrator.test.ts:29-44`

- [ ] **Step 1: Add prefixOnlyMode to createConfig helper**

In `tests/PredictionOrchestrator.test.ts`, update `createConfig()`:

```typescript
function createConfig(overrides: Partial<PredictionConfig> = {}): PredictionConfig {
  return {
    numSuggestions: 5,
    minWordLengthToPredict: 0,
    insertSpaceAfterAutocomplete: false,
    autoCapitalize: false,
    textExpansions: [],
    prefixOnlyMode: false,

    timeFormat: "",
    dateFormat: "",
    userDictionaryList: [],
    aiPredictorEnabled: false,
    aiModelId: DEFAULT_AI_MODEL_ID,
    ...overrides,
  };
}
```

- [ ] **Step 2: Run tests**

Run: `bun test tests/PredictionOrchestrator.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/PredictionOrchestrator.test.ts
git commit -m "test: add prefixOnlyMode to PredictionOrchestrator test helper"
```

### Task 6: Wire up ConfigAssembler

**Files:**
- Modify: `src/adapters/chrome/background/config/ConfigAssembler.ts:96-153`

- [ ] **Step 1: Add reads to assemblePredictionRuntimeConfig**

In `ConfigAssembler.assemblePredictionRuntimeConfig()`, add two new reads to the `Promise.all` block:

```typescript
async assemblePredictionRuntimeConfig(): Promise<AssembledPredictionRuntimeConfig> {
  const language = await resolveActiveLanguage(this.settingsManager);
  const [
    numSuggestions,
    minWordLengthToPredict,
    insertSpaceAfterAutocomplete,
    enabledGrammarRules,
    textExpansions,

    timeFormat,
    dateFormat,
    userDictionaryList,
    predictorSettings,
    observability,
    prefixOnlyMode,
    inlineSuggestion,
  ] = await Promise.all([
    this.coreSettingsRepository.getNumSuggestions(),
    this.coreSettingsRepository.getMinWordLengthToPredict(),
    this.coreSettingsRepository.getInsertSpaceAfterAutocomplete(),
    this.coreSettingsRepository.getEnabledGrammarRules(),
    this.coreSettingsRepository.getTextExpansions(),

    this.coreSettingsRepository.getTimeFormat(),
    this.coreSettingsRepository.getDateFormat(),
    this.coreSettingsRepository.getUserDictionaryList(),
    this.predictorSettingsRepository.getSnapshot(),
    this.getObservabilityConfig(),
    this.coreSettingsRepository.getPrefixOnlyMode(),
    this.coreSettingsRepository.getInlineSuggestion(),
  ]);
```

- [ ] **Step 2: Add effective value to the returned config**

In the returned `predictionConfig` object, add:

```typescript
prefixOnlyMode: prefixOnlyMode || inlineSuggestion,
```

(Place after `autoCapitalize,`)

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/adapters/chrome/background/config/ConfigAssembler.ts
git commit -m "feat: compute effective prefixOnlyMode in ConfigAssembler"
```

### Task 6b: Test ConfigAssembler effective value logic

**Files:**
- Create: `tests/ConfigAssembler.prefixOnly.test.ts`

- [ ] **Step 1: Write tests for the three scenarios from the spec**

Create `tests/ConfigAssembler.prefixOnly.test.ts`:

```typescript
import { ConfigAssembler } from "../src/adapters/chrome/background/config/ConfigAssembler";
import type { SettingsManager } from "../src/core/application/settingsManager";

function createSettingsManagerMock(seed: Record<string, unknown>): SettingsManager {
  return {
    get: async (key: string) => seed[key] as never,
    set: async () => undefined,
  } as unknown as SettingsManager;
}

describe("ConfigAssembler.assemblePredictionRuntimeConfig prefixOnlyMode", () => {
  const baseSettings: Record<string, unknown> = {
    language: "en_US",
    enabled_languages: ["en_US"],
    numSuggestions: 5,
    minWordLengthToPredict: 1,
    insertSpaceAfterAutocomplete: true,
    enabledGrammarRules: [],
    textExpansions: [],
    timeFormat: "",
    dateFormat: "",
    userDictionaryList: [],
    aiPredictorEnabled: false,
    aiModelId: "",
    aiPredictionTimeoutMs: 120,
    debugPresagePredictorEnabled: true,
    debugAiPredictorEnabled: true,
  };

  test("prefixOnlyMode=false, inlineSuggestion=false → false", async () => {
    const sm = createSettingsManagerMock({
      ...baseSettings,
      prefixOnlyMode: false,
      inline_suggestion: false,
    });
    const assembler = new ConfigAssembler(sm, {
      enableAIPredictor: false,
      isDevBuild: false,
    });
    const result = await assembler.assemblePredictionRuntimeConfig();
    expect(result.predictionConfig.prefixOnlyMode).toBe(false);
  });

  test("prefixOnlyMode=true, inlineSuggestion=false → true", async () => {
    const sm = createSettingsManagerMock({
      ...baseSettings,
      prefixOnlyMode: true,
      inline_suggestion: false,
    });
    const assembler = new ConfigAssembler(sm, {
      enableAIPredictor: false,
      isDevBuild: false,
    });
    const result = await assembler.assemblePredictionRuntimeConfig();
    expect(result.predictionConfig.prefixOnlyMode).toBe(true);
  });

  test("prefixOnlyMode=false, inlineSuggestion=true → true (forced by inline)", async () => {
    const sm = createSettingsManagerMock({
      ...baseSettings,
      prefixOnlyMode: false,
      inline_suggestion: true,
    });
    const assembler = new ConfigAssembler(sm, {
      enableAIPredictor: false,
      isDevBuild: false,
    });
    const result = await assembler.assemblePredictionRuntimeConfig();
    expect(result.predictionConfig.prefixOnlyMode).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test tests/ConfigAssembler.prefixOnly.test.ts`
Expected: PASS (all 3 scenarios)

- [ ] **Step 3: Commit**

```bash
git add tests/ConfigAssembler.prefixOnly.test.ts
git commit -m "test: verify effective prefixOnlyMode OR-logic in ConfigAssembler"
```

---

## Chunk 4: UI Layer

### Task 7: Add i18n entries

**Files:**
- Modify: `src/ui/options/fluenttyperI18n.ts` (after `enable_inline_suggestion_desc` block, around line 3189)

- [ ] **Step 1: Add i18n entries**

Add after the `enable_inline_suggestion_desc` block:

```typescript
prefix_only_mode_label: {
  en: "Prefix-only mode",
  fr: "Mode préfixe uniquement",
  hr: "Način rada samo s prefiksom",
  es: "Modo solo prefijo",
  el: "Λειτουργία μόνο προθέματος",
  sv: "Prefix-läge",
  de: "Nur-Präfix-Modus",
  pl: "Tryb tylko prefiksu",
  pr: "Modo apenas prefixo",
},
prefix_only_mode_desc: {
  en: "Only suggest words that start with what you type. Disables spell-correction suggestions. Automatically enabled when inline suggestion is active.",
  fr: "Ne suggérer que les mots commençant par ce que vous tapez. Désactive les suggestions de correction orthographique. Activé automatiquement avec la suggestion en ligne.",
  hr: "Predlaži samo riječi koje počinju s onim što tipkate. Onemogućuje prijedloge za ispravku pravopisa. Automatski omogućeno kada je inline prijedlog aktivan.",
  es: "Solo sugerir palabras que comiencen con lo que escribes. Desactiva las sugerencias de corrección ortográfica. Se activa automáticamente con la sugerencia en línea.",
  el: "Πρόταση μόνο λέξεων που αρχίζουν με αυτό που πληκτρολογείτε. Απενεργοποιεί τις προτάσεις ορθογραφικής διόρθωσης.",
  sv: "Föreslå bara ord som börjar med det du skriver. Inaktiverar stavningskorrigeringar. Aktiveras automatiskt med inline-förslag.",
  de: "Nur Wörter vorschlagen, die mit Ihrer Eingabe beginnen. Deaktiviert Rechtschreibkorrekturen. Automatisch aktiv bei Inline-Vorschlägen.",
  pl: "Sugeruj tylko słowa zaczynające się od wpisanego tekstu. Wyłącza sugestie korekty pisowni. Automatycznie włączane przy podpowiedziach inline.",
  pr: "Sugerir apenas palavras que começam com o que você digita. Desativa sugestões de correção ortográfica. Ativado automaticamente com sugestão inline.",
},
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/options/fluenttyperI18n.ts
git commit -m "feat: add prefix-only mode i18n entries"
```

### Task 8: Add settings manifest entry

**Files:**
- Modify: `src/ui/options/settingsManifest.ts:51,418` (import + entry)

- [ ] **Step 1: Add import**

Add `KEY_PREFIX_ONLY_MODE` to the imports from `@core/domain/constants`.

- [ ] **Step 2: Add checkbox entry**

After the `KEY_INLINE_SUGGESTION` checkbox block (line ~418), before the Grammar Rules comment, add:

```typescript
{
  tab: "core_settings",
  group: i18n.get("behavior_after_completion"),
  name: KEY_PREFIX_ONLY_MODE,
  type: "checkbox",
  label: buildFieldLabel(
    i18n.get("prefix_only_mode_label"),
    i18n.get("prefix_only_mode_desc"),
  ),
  default: false,
},
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/ui/options/settingsManifest.ts
git commit -m "feat: add prefix-only mode checkbox to settings UI"
```

---

## Chunk 5: Final Verification

### Task 9: Full check

- [ ] **Step 1: Run full unit tests**

Run: `bun run test`
Expected: All tests PASS

- [ ] **Step 2: Run typecheck and lint**

Run: `bun run check`
Expected: PASS

- [ ] **Step 3: Run build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 4: Final commit if any fixes were needed**

If any adjustments were required, commit them.
